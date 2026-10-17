/**
 * Environment panel pin: dropdown (default) vs chat-column dock.
 * localStorage-only — does not touch Host AppSettings.
 */

export const ENV_INFO_PINNED_STORAGE_KEY = "grok.envInfoPinned";

/** Fired on `window` after a successful save (detail = boolean pinned). */
export const ENV_INFO_PINNED_CHANGE_EVENT = "grok-env-info-pinned-change";

export const DEFAULT_ENV_INFO_PINNED = false;

/** Minimal storage surface so unit tests need no jsdom. */
export interface EnvInfoPinnedStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): EnvInfoPinnedStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → default false (dropdown). */
export function parseEnvInfoPinnedPref(raw: unknown): boolean {
  if (raw === "1" || raw === "true" || raw === true) return true;
  if (raw === "0" || raw === "false" || raw === false) return false;
  return DEFAULT_ENV_INFO_PINNED;
}

export function loadEnvInfoPinnedPref(
  storage: EnvInfoPinnedStorage = defaultStorage(),
): boolean {
  try {
    return parseEnvInfoPinnedPref(
      storage.getItem(ENV_INFO_PINNED_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_ENV_INFO_PINNED;
  }
}

export function saveEnvInfoPinnedPref(
  pinned: boolean,
  storage: EnvInfoPinnedStorage = defaultStorage(),
): void {
  try {
    storage.setItem(ENV_INFO_PINNED_STORAGE_KEY, pinned ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(ENV_INFO_PINNED_CHANGE_EVENT, {
          detail: pinned,
        }),
      );
    } catch {
      /* ignore */
    }
  }
}
