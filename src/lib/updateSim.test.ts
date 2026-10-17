import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEVELOPER_MODE_STORAGE_KEY,
  saveDeveloperModePref,
} from "./developerModePref";
import {
  UPDATE_SIM_STORAGE_KEY,
  isUpdateSimActive,
  isUpdateSimAllowed,
  readUpdateSimMode,
  writeUpdateSimMode,
} from "./updateSim";

describe("updateSim (developer-mode gated)", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
    vi.stubGlobal("window", {
      location: { search: "" },
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is off when developer mode is off", () => {
    expect(isUpdateSimAllowed()).toBe(false);
    expect(readUpdateSimMode()).toBe("off");
    writeUpdateSimMode("silent");
    // Cannot enable sim without developer mode.
    expect(store.has(UPDATE_SIM_STORAGE_KEY)).toBe(false);
    expect(isUpdateSimActive()).toBe(false);
  });

  it("allows silent/manual when developer mode is on", () => {
    saveDeveloperModePref(true);
    expect(store.get(DEVELOPER_MODE_STORAGE_KEY)).toBe("1");
    expect(isUpdateSimAllowed()).toBe(true);
    writeUpdateSimMode("silent");
    expect(readUpdateSimMode()).toBe("silent");
    expect(isUpdateSimActive()).toBe(true);
    writeUpdateSimMode("manual");
    expect(readUpdateSimMode()).toBe("manual");
    writeUpdateSimMode("off");
    expect(readUpdateSimMode()).toBe("off");
  });
});
