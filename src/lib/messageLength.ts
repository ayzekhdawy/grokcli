/**
 * Pure word/char counts for message text + optional “Show reply length” pref.
 * Pref is localStorage-only — does not touch Host AppSettings.
 * Default: off (no length meta under assistant replies).
 */

/** Storage key for the Appearance “Show reply length” toggle. */
export const SHOW_REPLY_LENGTH_STORAGE_KEY = "grok.showReplyLength";

/** Fired on `window` after a successful save (detail = boolean show). */
export const SHOW_REPLY_LENGTH_CHANGE_EVENT = "grok-show-reply-length-change";

/** Off by default — length meta only when the user opts in. */
export const DEFAULT_SHOW_REPLY_LENGTH = false;

/** Minimal storage surface so unit tests need no jsdom. */
export interface MessageLengthStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): MessageLengthStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

// ── Pure counts ─────────────────────────────────────────────────────────────

/**
 * Character count using Unicode code points (not UTF-16 code units).
 * Emoji / astral plane characters count as 1.
 */
export function countChars(text: string): number {
  if (!text) return 0;
  return [...text].length;
}

/**
 * Word count with simple CJK-friendly rules:
 * - Each CJK character counts as one word (Hiragana, Katakana, CJK Ext-A /
 *   Unified / Compatibility, Hangul Syllables, halfwidth katakana).
 * - Non-CJK runs are split on whitespace (Latin tokens).
 * - Empty / whitespace-only → 0.
 *
 * Examples: "hello world" → 2; "你好世界" → 4; "你好 world" → 3.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  // Insert spaces around each CJK char so split treats them as tokens.
  const normalized = trimmed.replace(
    /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\uff66-\uff9f]/g,
    " $& ",
  );
  let n = 0;
  for (const token of normalized.split(/\s+/)) {
    if (token) n += 1;
  }
  return n;
}

export type MessageLengthStats = {
  chars: number;
  words: number;
  /** True when text has no non-whitespace content. */
  empty: boolean;
};

/** Full length stats for UI. Whitespace-only is treated as empty. */
export function computeMessageLength(text: string): MessageLengthStats {
  if (!text || text.trim().length === 0) {
    return { chars: 0, words: 0, empty: true };
  }
  return {
    chars: countChars(text),
    words: countWords(text),
    empty: false,
  };
}

// ── Preference ──────────────────────────────────────────────────────────────

/** Parse stored value; invalid / empty → default false. */
export function parseShowReplyLengthPref(raw: unknown): boolean {
  if (raw === "0" || raw === "false" || raw === false) return false;
  if (raw === "1" || raw === "true" || raw === true) return true;
  return DEFAULT_SHOW_REPLY_LENGTH;
}

export function loadShowReplyLengthPref(
  storage: MessageLengthStorage = defaultStorage(),
): boolean {
  try {
    return parseShowReplyLengthPref(
      storage.getItem(SHOW_REPLY_LENGTH_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_SHOW_REPLY_LENGTH;
  }
}

export function saveShowReplyLengthPref(
  show: boolean,
  storage: MessageLengthStorage = defaultStorage(),
): void {
  try {
    storage.setItem(SHOW_REPLY_LENGTH_STORAGE_KEY, show ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(SHOW_REPLY_LENGTH_CHANGE_EVENT, { detail: show }),
      );
    } catch {
      /* ignore */
    }
  }
}
