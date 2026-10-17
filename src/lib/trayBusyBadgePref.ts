/**
 * Show unread session count on dock badge (macOS) / tray tooltip (elsewhere).
 * Count comes from background turn completions (sessionUnread), not live busy.
 * localStorage-only — does not touch Host AppSettings.
 * Default: on. Fail-closed outside Tauri (invoke no-op via api).
 */

export const TRAY_BUSY_BADGE_STORAGE_KEY = "grok.trayBusyBadge";

/** Fired on `window` after a successful save (detail = boolean enabled). */
export const TRAY_BUSY_BADGE_CHANGE_EVENT = "grok-tray-busy-badge-change";

export const DEFAULT_TRAY_BUSY_BADGE = true;

/** Minimal storage surface so unit tests need no jsdom. */
export interface TrayBusyBadgeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): TrayBusyBadgeStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → default true. */
export function parseTrayBusyBadgePref(raw: unknown): boolean {
  if (raw === "1" || raw === "true" || raw === true) return true;
  if (raw === "0" || raw === "false" || raw === false) return false;
  return DEFAULT_TRAY_BUSY_BADGE;
}

export function loadTrayBusyBadgePref(
  storage: TrayBusyBadgeStorage = defaultStorage(),
): boolean {
  try {
    return parseTrayBusyBadgePref(storage.getItem(TRAY_BUSY_BADGE_STORAGE_KEY));
  } catch {
    /* private mode */
    return DEFAULT_TRAY_BUSY_BADGE;
  }
}

export function saveTrayBusyBadgePref(
  enabled: boolean,
  storage: TrayBusyBadgeStorage = defaultStorage(),
): void {
  try {
    storage.setItem(TRAY_BUSY_BADGE_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(TRAY_BUSY_BADGE_CHANGE_EVENT, {
          detail: enabled,
        }),
      );
    } catch {
      /* ignore */
    }
  }
}
