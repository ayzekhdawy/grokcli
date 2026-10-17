/**
 * Cross-session recent prompt history (localStorage ring buffer).
 *
 * Appended on successful user send. Entries: { text, sessionId, at },
 * newest first, max 50. Consecutive identical text is deduped (no re-append).
 * Text is truncated for storage size; no secret redaction beyond that.
 *
 * COMPOSER-HISTORY-PRO: clear-all + remove-at (in-app confirm in UI; no
 * `window.confirm`).
 */

export type RecentPromptEntry = {
  /** Stored prompt text (`[[skill:…]]` form). */
  text: string;
  /** App session id at send time (may be empty for draft edge cases). */
  sessionId: string;
  /** ISO-8601 timestamp. */
  at: string;
};

export const RECENT_PROMPT_HISTORY_STORAGE_KEY = "grok.recentPromptHistory";
export const RECENT_PROMPT_HISTORY_MAX = 50;
/** Cap stored prompt length (localStorage). Display still truncates in the list. */
export const RECENT_PROMPT_TEXT_MAX = 8000;

/** Fired on `window` after a successful record (detail = entries). */
export const RECENT_PROMPT_HISTORY_CHANGE_EVENT = "grok-recent-prompt-history-change";

/** Minimal storage surface so unit tests need no jsdom. */
export interface RecentPromptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): RecentPromptStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/**
 * Normalize one raw object into a RecentPromptEntry, or null if invalid.
 * Truncates text; only known fields.
 */
export function parseRecentPromptEntry(raw: unknown): RecentPromptEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const textRaw = typeof o.text === "string" ? o.text : "";
  // Collapse only for emptiness check; keep original whitespace in stored text
  // up to max (composer needs exact stored form for skill tokens).
  if (!textRaw.trim()) return null;
  const text =
    textRaw.length > RECENT_PROMPT_TEXT_MAX
      ? textRaw.slice(0, RECENT_PROMPT_TEXT_MAX)
      : textRaw;

  const sessionId =
    typeof o.sessionId === "string" ? o.sessionId.trim() : "";

  const at =
    typeof o.at === "string" && o.at.trim()
      ? o.at.trim()
      : new Date(0).toISOString();

  return { text, sessionId, at };
}

/**
 * Parse stored JSON into a clean, newest-first list (capped).
 * Tolerates corrupt / partial data.
 */
export function parseRecentPromptHistory(
  raw: unknown,
  max = RECENT_PROMPT_HISTORY_MAX,
): RecentPromptEntry[] {
  let list: unknown[] = [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    list = raw;
  } else {
    return [];
  }

  const out: RecentPromptEntry[] = [];
  for (const item of list) {
    const e = parseRecentPromptEntry(item);
    if (!e) continue;
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Pure ring-buffer push: newest first, max length.
 * Skips append when the newest existing entry has identical text (consecutive dedupe).
 * Does not touch storage.
 */
export function pushRecentPrompt(
  existing: readonly RecentPromptEntry[],
  entry: RecentPromptEntry,
  max = RECENT_PROMPT_HISTORY_MAX,
): RecentPromptEntry[] {
  const next = parseRecentPromptEntry(entry);
  if (!next) return parseRecentPromptHistory(existing, max);

  const cleaned = parseRecentPromptHistory(existing, max);
  const newest = cleaned[0];
  if (newest && newest.text === next.text) {
    // Consecutive identical: keep existing newest (update sessionId/at optionally)
    return [
      { text: newest.text, sessionId: next.sessionId || newest.sessionId, at: next.at },
      ...cleaned.slice(1),
    ];
  }
  return parseRecentPromptHistory([next, ...cleaned], max);
}

export function loadRecentPromptHistory(
  storage: RecentPromptStorage = defaultStorage(),
  max = RECENT_PROMPT_HISTORY_MAX,
): RecentPromptEntry[] {
  try {
    return parseRecentPromptHistory(
      storage.getItem(RECENT_PROMPT_HISTORY_STORAGE_KEY),
      max,
    );
  } catch {
    /* private mode */
    return [];
  }
}

export function saveRecentPromptHistory(
  entries: readonly RecentPromptEntry[],
  storage: RecentPromptStorage = defaultStorage(),
  max = RECENT_PROMPT_HISTORY_MAX,
): void {
  const clean = parseRecentPromptHistory(entries, max);
  try {
    storage.setItem(RECENT_PROMPT_HISTORY_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    /* private mode / quota */
  }
}

/**
 * Record a successful user send: load → push → save → notify.
 * Returns the updated list. Skips empty / whitespace-only text.
 */
export function recordRecentPrompt(
  input: {
    text: string;
    sessionId?: string | null;
    at?: string;
  },
  storage: RecentPromptStorage = defaultStorage(),
  max = RECENT_PROMPT_HISTORY_MAX,
): RecentPromptEntry[] {
  const text = typeof input.text === "string" ? input.text : "";
  if (!text.trim()) {
    return loadRecentPromptHistory(storage, max);
  }
  const entry: RecentPromptEntry = {
    text,
    sessionId: (input.sessionId ?? "").trim(),
    at: input.at || new Date().toISOString(),
  };
  const next = pushRecentPrompt(
    loadRecentPromptHistory(storage, max),
    entry,
    max,
  );
  saveRecentPromptHistory(next, storage, max);
  notifyRecentPromptHistoryChange(next);
  return next;
}

/**
 * Fuzzy-filter recent prompts (newest first) into picker rows.
 * Empty query returns every entry. Match is case-insensitive substring.
 * `historyIndex` is the index into the unfiltered recent list.
 */
export function filterRecentPromptHistory(
  history: readonly RecentPromptEntry[],
  query: string,
): Array<{ historyIndex: number; text: string; sessionId: string; at: string }> {
  const q = query.trim().toLowerCase();
  const out: Array<{
    historyIndex: number;
    text: string;
    sessionId: string;
    at: string;
  }> = [];
  for (let historyIndex = 0; historyIndex < history.length; historyIndex++) {
    const e = history[historyIndex];
    if (!e) continue;
    if (q && !e.text.toLowerCase().includes(q)) continue;
    out.push({
      historyIndex,
      text: e.text,
      sessionId: e.sessionId,
      at: e.at,
    });
  }
  return out;
}

/**
 * Remove one entry by unfiltered index. Returns the updated list.
 * Out-of-range index is a no-op (returns cleaned existing).
 */
export function removeRecentPromptAt(
  existing: readonly RecentPromptEntry[],
  index: number,
  max = RECENT_PROMPT_HISTORY_MAX,
): RecentPromptEntry[] {
  const cleaned = parseRecentPromptHistory(existing, max);
  if (!Number.isFinite(index)) return cleaned;
  const i = Math.trunc(index);
  if (i < 0 || i >= cleaned.length) return cleaned;
  return [...cleaned.slice(0, i), ...cleaned.slice(i + 1)];
}

/**
 * Persist removal of one entry (by unfiltered index) and notify listeners.
 * Returns the updated list.
 */
export function removeRecentPrompt(
  index: number,
  storage: RecentPromptStorage = defaultStorage(),
  max = RECENT_PROMPT_HISTORY_MAX,
): RecentPromptEntry[] {
  const next = removeRecentPromptAt(
    loadRecentPromptHistory(storage, max),
    index,
    max,
  );
  saveRecentPromptHistory(next, storage, max);
  notifyRecentPromptHistoryChange(next);
  return next;
}

/**
 * Wipe the cross-session recent ring (empty list + notify).
 * Returns the empty list. Safe no-op on storage failure.
 * Session ("This chat") history is message-derived and is not cleared here.
 */
export function clearRecentPromptHistory(
  storage: RecentPromptStorage = defaultStorage(),
): RecentPromptEntry[] {
  saveRecentPromptHistory([], storage);
  notifyRecentPromptHistoryChange([]);
  return [];
}

function notifyRecentPromptHistoryChange(
  next: readonly RecentPromptEntry[],
): void {
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(RECENT_PROMPT_HISTORY_CHANGE_EVENT, { detail: next }),
      );
    } catch {
      /* ignore */
    }
  }
}
