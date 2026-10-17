/**
 * Confirm before quitting when agent sessions are still busy.
 *
 * Pref is localStorage-only ("Always quit without asking") — default false.
 * Host close path: window CloseRequested when not close-to-tray, and tray Quit.
 */

export const ALWAYS_QUIT_WITHOUT_ASKING_STORAGE_KEY =
  "grok.alwaysQuitWithoutAsking";

/** Fired on `window` after a successful save (detail = boolean enabled). */
export const ALWAYS_QUIT_WITHOUT_ASKING_CHANGE_EVENT =
  "grok-always-quit-without-asking-change";

export const DEFAULT_ALWAYS_QUIT_WITHOUT_ASKING = false;

/** Event from Host when the user requests a real app exit (not hide-to-tray). */
export const APP_CLOSE_REQUESTED_EVENT = "app://close-requested";

/**
 * Event from Host when File/Window → Close (⌘W / Ctrl+W) is chosen.
 * FE closes an open side tab when present; otherwise calls window.close().
 * Replaces native PredefinedMenuItem::close_window so tabs win over the window.
 */
export const APP_CLOSE_TAB_OR_WINDOW_EVENT = "app://close-tab-or-window";

/** Minimal storage surface so unit tests need no jsdom. */
export interface AlwaysQuitWithoutAskingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): AlwaysQuitWithoutAskingStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → default false. */
export function parseAlwaysQuitWithoutAskingPref(raw: unknown): boolean {
  if (raw === "1" || raw === "true" || raw === true) return true;
  if (raw === "0" || raw === "false" || raw === false) return false;
  return DEFAULT_ALWAYS_QUIT_WITHOUT_ASKING;
}

export function loadAlwaysQuitWithoutAskingPref(
  storage: AlwaysQuitWithoutAskingStorage = defaultStorage(),
): boolean {
  try {
    return parseAlwaysQuitWithoutAskingPref(
      storage.getItem(ALWAYS_QUIT_WITHOUT_ASKING_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_ALWAYS_QUIT_WITHOUT_ASKING;
  }
}

export function saveAlwaysQuitWithoutAskingPref(
  enabled: boolean,
  storage: AlwaysQuitWithoutAskingStorage = defaultStorage(),
): void {
  try {
    storage.setItem(
      ALWAYS_QUIT_WITHOUT_ASKING_STORAGE_KEY,
      enabled ? "1" : "0",
    );
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(ALWAYS_QUIT_WITHOUT_ASKING_CHANGE_EVENT, {
          detail: enabled,
        }),
      );
    } catch {
      /* ignore */
    }
  }
}

/**
 * Whether the app should show an in-app confirm before quitting.
 *
 * @param busyCount Number of live sessions that are busy / connecting / awaiting permission
 * @param alwaysQuitWithoutAsking User pref — when true, never confirm
 */
export function shouldConfirmQuit(
  busyCount: number,
  alwaysQuitWithoutAsking: boolean,
): boolean {
  if (alwaysQuitWithoutAsking) return false;
  const n = Number.isFinite(busyCount) ? Math.floor(busyCount) : 0;
  return n > 0;
}
