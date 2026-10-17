/**
 * Preference: enable the Live Voice keyboard shortcut (catalog `liveVoice`).
 *
 * localStorage-only — does not touch Host AppSettings.
 * Default: on. Composer button, slash `/live-voice`, and menus stay available
 * when the hotkey is disabled. Dictation (Ctrl+Space) is unrelated.
 */

export const VOICE_HOTKEY_STORAGE_KEY = "grok.voiceHotkeyEnabled";

/** Fired on `window` after a same-tab preference save. */
export const VOICE_HOTKEY_CHANGED_EVENT = "grok:voiceHotkeyEnabled";

export const DEFAULT_VOICE_HOTKEY_ENABLED = true;

/** Display token used in the shortcuts catalog when the Live Voice hotkey is off. */
export const SHORTCUT_KEYS_OFF = "Off";

/** Minimal storage surface so unit tests need no jsdom. */
export interface VoiceHotkeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): VoiceHotkeyStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → default true. */
export function parseVoiceHotkeyEnabled(raw: unknown): boolean {
  if (raw === "1" || raw === "true" || raw === true) return true;
  if (raw === "0" || raw === "false" || raw === false) return false;
  return DEFAULT_VOICE_HOTKEY_ENABLED;
}

export function loadVoiceHotkeyEnabled(
  storage: VoiceHotkeyStorage = defaultStorage(),
): boolean {
  try {
    return parseVoiceHotkeyEnabled(storage.getItem(VOICE_HOTKEY_STORAGE_KEY));
  } catch {
    /* private mode */
    return DEFAULT_VOICE_HOTKEY_ENABLED;
  }
}

export function saveVoiceHotkeyEnabled(
  enabled: boolean,
  storage: VoiceHotkeyStorage = defaultStorage(),
): void {
  try {
    storage.setItem(VOICE_HOTKEY_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(VOICE_HOTKEY_CHANGED_EVENT, { detail: enabled }),
      );
    } catch {
      /* ignore */
    }
  }
}

/**
 * Pure gate for the Live Voice catalog hotkey.
 * True only when the preference is enabled (default product behavior).
 * Composer / menu / slash entry points do not use this helper.
 */
export function shouldFireLiveVoiceHotkey(enabled: boolean): boolean {
  return enabled === true;
}
