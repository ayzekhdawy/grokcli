/**
 * Settings → About: Developer mode.
 *
 * Local preference that gates in-app developer tooling (update simulation,
 * future debug surfaces). Not the same as `import.meta.env.DEV` — works in
 * signed builds when the user opts in, and stays off by default.
 */

export const DEVELOPER_MODE_STORAGE_KEY = "grok.developerMode";

/** Fired on `window` after a successful save (detail = boolean enabled). */
export const DEVELOPER_MODE_CHANGE_EVENT = "grok-developer-mode-change";

/** Off by default — product UI stays clean until the user opts in. */
export const DEFAULT_DEVELOPER_MODE = false;

/** Minimal storage surface so unit tests need no jsdom. */
export interface DeveloperModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function defaultStorage(): DeveloperModeStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → default false. */
export function parseDeveloperModePref(raw: unknown): boolean {
  if (raw === "0" || raw === "false" || raw === false) return false;
  if (raw === "1" || raw === "true" || raw === true) return true;
  return DEFAULT_DEVELOPER_MODE;
}

export function loadDeveloperModePref(
  storage: DeveloperModeStorage = defaultStorage(),
): boolean {
  try {
    return parseDeveloperModePref(
      storage.getItem(DEVELOPER_MODE_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_DEVELOPER_MODE;
  }
}

/** Alias for call sites that read “is developer mode on right now”. */
export function isDeveloperModeEnabled(
  storage: DeveloperModeStorage = defaultStorage(),
): boolean {
  return loadDeveloperModePref(storage);
}

export function saveDeveloperModePref(
  enabled: boolean,
  storage: DeveloperModeStorage = defaultStorage(),
): void {
  try {
    storage.setItem(DEVELOPER_MODE_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(DEVELOPER_MODE_CHANGE_EVENT, {
          detail: enabled,
        }),
      );
    } catch {
      /* ignore */
    }
  }
}
