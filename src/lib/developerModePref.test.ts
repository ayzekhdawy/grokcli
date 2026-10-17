import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEVELOPER_MODE_CHANGE_EVENT,
  DEVELOPER_MODE_STORAGE_KEY,
  isDeveloperModeEnabled,
  loadDeveloperModePref,
  parseDeveloperModePref,
  saveDeveloperModePref,
} from "./developerModePref";

describe("developerModePref", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  };

  it("defaults to off", () => {
    expect(loadDeveloperModePref(storage)).toBe(false);
    expect(isDeveloperModeEnabled(storage)).toBe(false);
    expect(parseDeveloperModePref(null)).toBe(false);
    expect(parseDeveloperModePref("nope")).toBe(false);
  });

  it("parses true/false tokens", () => {
    expect(parseDeveloperModePref("1")).toBe(true);
    expect(parseDeveloperModePref("true")).toBe(true);
    expect(parseDeveloperModePref("0")).toBe(false);
    expect(parseDeveloperModePref("false")).toBe(false);
  });

  it("persists and reloads", () => {
    saveDeveloperModePref(true, storage);
    expect(store.get(DEVELOPER_MODE_STORAGE_KEY)).toBe("1");
    expect(loadDeveloperModePref(storage)).toBe(true);
    saveDeveloperModePref(false, storage);
    expect(store.get(DEVELOPER_MODE_STORAGE_KEY)).toBe("0");
    expect(loadDeveloperModePref(storage)).toBe(false);
  });

  it("dispatches change event when window is available", () => {
    const dispatch = vi.fn();
    vi.stubGlobal("window", { dispatchEvent: dispatch });
    saveDeveloperModePref(true, storage);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const ev = dispatch.mock.calls[0][0] as CustomEvent;
    expect(ev.type).toBe(DEVELOPER_MODE_CHANGE_EVENT);
    expect(ev.detail).toBe(true);
    vi.unstubAllGlobals();
  });
});
