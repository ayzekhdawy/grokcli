/**
 * User preference: show message timestamps in chat action rows.
 * localStorage-only — does not touch Host AppSettings.
 * Default: true (timestamps visible when createdAt exists).
 */

export const MESSAGE_TIMESTAMPS_STORAGE_KEY = "grok.messageTimestamps";

/** Fired on `window` after a successful save (detail = boolean show). */
export const MESSAGE_TIMESTAMPS_CHANGE_EVENT = "grok-message-timestamps-change";

export const DEFAULT_SHOW_MESSAGE_TIMESTAMPS = true;

/** Minimal storage surface so unit tests need no jsdom. */
export interface MessageTimestampsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): MessageTimestampsStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → default true. */
export function parseMessageTimestampsPref(raw: unknown): boolean {
  if (raw === "0" || raw === "false" || raw === false) return false;
  if (raw === "1" || raw === "true" || raw === true) return true;
  return DEFAULT_SHOW_MESSAGE_TIMESTAMPS;
}

export function loadMessageTimestampsPref(
  storage: MessageTimestampsStorage = defaultStorage(),
): boolean {
  try {
    return parseMessageTimestampsPref(
      storage.getItem(MESSAGE_TIMESTAMPS_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_SHOW_MESSAGE_TIMESTAMPS;
  }
}

export function saveMessageTimestampsPref(
  show: boolean,
  storage: MessageTimestampsStorage = defaultStorage(),
): void {
  try {
    storage.setItem(MESSAGE_TIMESTAMPS_STORAGE_KEY, show ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(
        new CustomEvent(MESSAGE_TIMESTAMPS_CHANGE_EVENT, { detail: show }),
      );
    } catch {
      /* ignore */
    }
  }
}
