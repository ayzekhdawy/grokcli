/**
 * User preference: skip the confirm dialog when using "Stop all" on busy sessions.
 * localStorage-only — does not touch Host AppSettings.
 * Default: false (always confirm before stopping all).
 */

export const STOP_ALL_SKIP_CONFIRM_STORAGE_KEY = "grok.stopAllSkipConfirm";

/** Fired on `window` after a successful save (detail = boolean skip). */
export const STOP_ALL_SKIP_CONFIRM_CHANGE_EVENT =
  "grok-stop-all-skip-confirm-change";

export const DEFAULT_STOP_ALL_SKIP_CONFIRM = false;

/** Minimal storage surface so unit tests need no jsdom. */
export interface StopAllSkipConfirmStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StopAllSkipConfirmStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → default false. */
export function parseStopAllSkipConfirmPref(raw: unknown): boolean {
  if (raw === "1" || raw === "true" || raw === true) return true;
  if (raw === "0" || raw === "false" || raw === false) return false;
  return DEFAULT_STOP_ALL_SKIP_CONFIRM;
}

export function loadStopAllSkipConfirmPref(
  storage: StopAllSkipConfirmStorage = defaultStorage(),
): boolean {
  try {
    return parseStopAllSkipConfirmPref(
      storage.getItem(STOP_ALL_SKIP_CONFIRM_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_STOP_ALL_SKIP_CONFIRM;
  }
}

export function saveStopAllSkipConfirmPref(
  skip: boolean,
  storage: StopAllSkipConfirmStorage = defaultStorage(),
): void {
  try {
    storage.setItem(STOP_ALL_SKIP_CONFIRM_STORAGE_KEY, skip ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(STOP_ALL_SKIP_CONFIRM_CHANGE_EVENT, {
          detail: skip,
        }),
      );
    } catch {
      /* ignore */
    }
  }
}
