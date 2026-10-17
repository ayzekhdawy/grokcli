import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_HOTKEY_ENABLED,
  loadVoiceHotkeyEnabled,
  parseVoiceHotkeyEnabled,
  saveVoiceHotkeyEnabled,
  shouldFireLiveVoiceHotkey,
  VOICE_HOTKEY_STORAGE_KEY,
} from "./voiceHotkeyPref";

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe("parseVoiceHotkeyEnabled", () => {
  it("defaults to true for empty / unknown", () => {
    expect(parseVoiceHotkeyEnabled(null)).toBe(true);
    expect(parseVoiceHotkeyEnabled(undefined)).toBe(true);
    expect(parseVoiceHotkeyEnabled("")).toBe(true);
    expect(parseVoiceHotkeyEnabled("weird")).toBe(true);
    expect(DEFAULT_VOICE_HOTKEY_ENABLED).toBe(true);
  });

  it("accepts 0/1 and true/false strings", () => {
    expect(parseVoiceHotkeyEnabled("0")).toBe(false);
    expect(parseVoiceHotkeyEnabled("1")).toBe(true);
    expect(parseVoiceHotkeyEnabled("false")).toBe(false);
    expect(parseVoiceHotkeyEnabled("true")).toBe(true);
    expect(parseVoiceHotkeyEnabled(false)).toBe(false);
    expect(parseVoiceHotkeyEnabled(true)).toBe(true);
  });
});

describe("load/save voiceHotkeyEnabled", () => {
  it("defaults to true when unset", () => {
    expect(loadVoiceHotkeyEnabled(memoryStorage())).toBe(true);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveVoiceHotkeyEnabled(false, s);
    expect(s.getItem(VOICE_HOTKEY_STORAGE_KEY)).toBe("0");
    expect(loadVoiceHotkeyEnabled(s)).toBe(false);
    saveVoiceHotkeyEnabled(true, s);
    expect(s.getItem(VOICE_HOTKEY_STORAGE_KEY)).toBe("1");
    expect(loadVoiceHotkeyEnabled(s)).toBe(true);
  });
});

describe("shouldFireLiveVoiceHotkey", () => {
  it("fires only when enabled", () => {
    expect(shouldFireLiveVoiceHotkey(true)).toBe(true);
    expect(shouldFireLiveVoiceHotkey(false)).toBe(false);
  });
});
