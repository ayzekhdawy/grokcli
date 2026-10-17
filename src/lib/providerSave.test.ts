import { describe, expect, it, vi } from "vitest";
import {
  PROVIDER_SAVE_TIMEOUT_MS,
  providerMutationNeedsAgentReload,
  slugifyProviderId,
  withProviderSaveTimeout,
} from "./providerSave";

describe("providerMutationNeedsAgentReload", () => {
  it("reloads when set as default", () => {
    expect(
      providerMutationNeedsAgentReload({
        setAsDefault: true,
        providerId: "relay",
        activeSource: "official",
        activeProviderId: null,
      }),
    ).toBe(true);
  });

  it("reloads when editing the active custom provider", () => {
    expect(
      providerMutationNeedsAgentReload({
        setAsDefault: false,
        providerId: "relay",
        activeSource: "custom",
        activeProviderId: "relay",
      }),
    ).toBe(true);
  });

  it("skips reload when editing a non-active provider", () => {
    expect(
      providerMutationNeedsAgentReload({
        setAsDefault: false,
        providerId: "other",
        activeSource: "custom",
        activeProviderId: "relay",
      }),
    ).toBe(false);
  });

  it("skips reload when official is active and not setting default", () => {
    expect(
      providerMutationNeedsAgentReload({
        setAsDefault: false,
        providerId: "relay",
        activeSource: "official",
        activeProviderId: null,
      }),
    ).toBe(false);
  });
});

describe("slugifyProviderId", () => {
  it("normalizes display names", () => {
    expect(slugifyProviderId("My Relay")).toBe("my-relay");
    expect(slugifyProviderId("  Foo_Bar  ")).toBe("foo_bar");
  });
});

describe("withProviderSaveTimeout", () => {
  it("resolves when the promise finishes in time", async () => {
    await expect(
      withProviderSaveTimeout(Promise.resolve(42), 1000),
    ).resolves.toBe(42);
  });

  it("rejects on timeout without waiting forever", async () => {
    vi.useFakeTimers();
    const pending = withProviderSaveTimeout(
      new Promise(() => {
        /* never settles */
      }),
      50,
      "timed out",
    );
    const assertion = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    vi.useRealTimers();
  });

  it("exports a positive default budget", () => {
    expect(PROVIDER_SAVE_TIMEOUT_MS).toBeGreaterThan(1000);
  });
});
