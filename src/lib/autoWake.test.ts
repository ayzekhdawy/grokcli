import { describe, expect, it } from "vitest";
import {
  AUTO_WAKE_CONFIG_KEY,
  autoWakeConfigAssignment,
  autoWakeEqual,
  autoWakeGrokConfigOverlay,
  normalizeAutoWakeEnabled,
} from "./autoWake";

describe("normalizeAutoWakeEnabled", () => {
  it("defaults to false", () => {
    expect(normalizeAutoWakeEnabled(null)).toBe(false);
    expect(normalizeAutoWakeEnabled(undefined)).toBe(false);
    expect(normalizeAutoWakeEnabled(false)).toBe(false);
  });

  it("is true only for true", () => {
    expect(normalizeAutoWakeEnabled(true)).toBe(true);
  });
});

describe("autoWakeConfigAssignment", () => {
  it("emits top-level key = bool", () => {
    expect(autoWakeConfigAssignment(true)).toBe("auto_wake_enabled = true");
    expect(autoWakeConfigAssignment(false)).toBe("auto_wake_enabled = false");
    expect(autoWakeConfigAssignment(null)).toBe("auto_wake_enabled = false");
    expect(autoWakeConfigAssignment(undefined)).toBe(
      "auto_wake_enabled = false",
    );
  });
});

describe("autoWakeEqual", () => {
  it("compares after normalize", () => {
    expect(autoWakeEqual(null, false)).toBe(true);
    expect(autoWakeEqual(true, true)).toBe(true);
    expect(autoWakeEqual(true, false)).toBe(false);
    expect(autoWakeEqual(undefined, null)).toBe(true);
  });
});

describe("config key constant", () => {
  it("matches CLI surface", () => {
    expect(AUTO_WAKE_CONFIG_KEY).toBe("auto_wake_enabled");
  });
});

describe("autoWakeGrokConfigOverlay", () => {
  it("emits features.auto_wake for GROK_CONFIG", () => {
    expect(autoWakeGrokConfigOverlay(true)).toEqual({
      features: { auto_wake: true },
    });
    expect(autoWakeGrokConfigOverlay(null)).toEqual({
      features: { auto_wake: false },
    });
  });
});
