import { describe, expect, it } from "vitest";
import {
  canSwitchCliChannel,
  cliChannelLabelKey,
  formatCliUpdateStatus,
  isValidCliVersionPin,
  normalizeCliChannel,
} from "./cliUpdateChannel";

describe("normalizeCliChannel", () => {
  it("recognizes stable and alpha only", () => {
    expect(normalizeCliChannel("stable")).toBe("stable");
    expect(normalizeCliChannel("ALPHA")).toBe("alpha");
    expect(normalizeCliChannel("  alpha  ")).toBe("alpha");
  });

  it("never invents unknown channels", () => {
    expect(normalizeCliChannel(null)).toBe("unknown");
    expect(normalizeCliChannel(undefined)).toBe("unknown");
    expect(normalizeCliChannel("")).toBe("unknown");
    expect(normalizeCliChannel("beta")).toBe("unknown");
    expect(normalizeCliChannel("nightly")).toBe("unknown");
  });
});

describe("canSwitchCliChannel", () => {
  it("allows switch when current differs or unknown", () => {
    expect(canSwitchCliChannel("stable", "alpha")).toBe(true);
    expect(canSwitchCliChannel("alpha", "stable")).toBe(true);
    expect(canSwitchCliChannel("unknown", "stable")).toBe(true);
    expect(canSwitchCliChannel(null, "alpha")).toBe(true);
  });

  it("blocks switch when already on target", () => {
    expect(canSwitchCliChannel("stable", "stable")).toBe(false);
    expect(canSwitchCliChannel("alpha", "alpha")).toBe(false);
  });
});

describe("isValidCliVersionPin", () => {
  it("accepts semver-ish pins", () => {
    expect(isValidCliVersionPin("0.2.117")).toBe(true);
    expect(isValidCliVersionPin("0.1.151-alpha.2")).toBe(true);
  });

  it("rejects empty, flags, paths, and non-version text", () => {
    expect(isValidCliVersionPin("")).toBe(false);
    expect(isValidCliVersionPin("  ")).toBe(false);
    expect(isValidCliVersionPin("--help")).toBe(false);
    expect(isValidCliVersionPin("../etc/passwd")).toBe(false);
    expect(isValidCliVersionPin("a b")).toBe(false);
    expect(isValidCliVersionPin("no-digits")).toBe(false);
  });
});

describe("cliChannelLabelKey", () => {
  it("maps to i18n keys without inventing", () => {
    expect(cliChannelLabelKey("stable")).toBe("settings.cliChannel.stable");
    expect(cliChannelLabelKey("alpha")).toBe("settings.cliChannel.alpha");
    expect(cliChannelLabelKey("nightly")).toBe("settings.cliChannel.unknown");
  });
});

describe("formatCliUpdateStatus", () => {
  it("summarizes check payload", () => {
    expect(
      formatCliUpdateStatus({
        currentVersion: "0.2.117",
        latestVersion: "0.2.118",
        channel: "stable",
        updateAvailable: true,
      }),
    ).toEqual({
      current: "0.2.117",
      latest: "0.2.118",
      channel: "stable",
      updateAvailable: true,
    });
  });

  it("defaults missing channel to unknown", () => {
    expect(
      formatCliUpdateStatus({
        currentVersion: "0.2.100",
      }).channel,
    ).toBe("unknown");
  });
});
