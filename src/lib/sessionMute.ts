/**
 * Per-session mute for desktop notifications.
 * localStorage-only Set of muted session ids — does not touch Host AppSettings.
 *
 * When a session is muted, system desktop notifications for that session are
 * suppressed. In-app toasts remain unaffected (callers use this only at the
 * desktop notify boundary).
 */

export const SESSION_MUTE_STORAGE_KEY = "grok.sessionMute";

/** Fired on `window` after a successful save (detail = string[] of muted ids). */
export const SESSION_MUTE_CHANGE_EVENT = "grok-session-mute-change";

/** Minimal storage surface so unit tests need no jsdom. */
export interface SessionMuteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): SessionMuteStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

function normalizeId(sessionId: string | null | undefined): string | null {
  if (typeof sessionId !== "string") return null;
  const id = sessionId.trim();
  return id ? id : null;
}

/**
 * Parse stored JSON array of session ids into a Set.
 * Invalid / empty → empty Set.
 */
export function parseMutedSessionIds(raw: unknown): Set<string> {
  if (raw == null || raw === "") return new Set();
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return new Set();
    }
  }
  if (!Array.isArray(value)) return new Set();
  const out = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (id) out.add(id);
  }
  return out;
}

/** Load muted session id Set from storage. */
export function loadMutedSessionIds(
  storage: SessionMuteStorage = defaultStorage(),
): Set<string> {
  try {
    return parseMutedSessionIds(storage.getItem(SESSION_MUTE_STORAGE_KEY));
  } catch {
    /* private mode */
    return new Set();
  }
}

/** Persist muted session ids (sorted for stable JSON). */
export function saveMutedSessionIds(
  ids: Iterable<string>,
  storage: SessionMuteStorage = defaultStorage(),
): void {
  const unique = new Set<string>();
  for (const item of ids) {
    const id = normalizeId(item);
    if (id) unique.add(id);
  }
  const list = Array.from(unique).sort();
  try {
    storage.setItem(SESSION_MUTE_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* private mode / quota */
    return;
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(SESSION_MUTE_CHANGE_EVENT, { detail: list }),
      );
    } catch {
      /* ignore */
    }
  }
}

/** Whether `sessionId` is currently muted for desktop notifications. */
export function isMuted(
  sessionId: string | null | undefined,
  storage: SessionMuteStorage = defaultStorage(),
): boolean {
  const id = normalizeId(sessionId);
  if (!id) return false;
  return loadMutedSessionIds(storage).has(id);
}

/**
 * Toggle mute for `sessionId`.
 * Returns the new muted state (`true` = muted). Empty / missing id → `false`.
 */
export function toggle(
  sessionId: string | null | undefined,
  storage: SessionMuteStorage = defaultStorage(),
): boolean {
  const id = normalizeId(sessionId);
  if (!id) return false;
  const ids = loadMutedSessionIds(storage);
  const nextMuted = !ids.has(id);
  if (nextMuted) ids.add(id);
  else ids.delete(id);
  saveMutedSessionIds(ids, storage);
  return nextMuted;
}

/** Explicitly set muted state for a session. Returns the applied muted state. */
export function setMuted(
  sessionId: string | null | undefined,
  muted: boolean,
  storage: SessionMuteStorage = defaultStorage(),
): boolean {
  const id = normalizeId(sessionId);
  if (!id) return false;
  const ids = loadMutedSessionIds(storage);
  if (muted) ids.add(id);
  else ids.delete(id);
  saveMutedSessionIds(ids, storage);
  return muted;
}

/**
 * Sorted list of muted session ids (stable order for Settings / tests).
 * Mute only suppresses desktop notifications — unread dots still apply
 * (see `sessionUnread.shouldMarkUnreadOnTurnDone`).
 */
export function listMutedSessionIds(
  storage: SessionMuteStorage = defaultStorage(),
): string[] {
  return Array.from(loadMutedSessionIds(storage)).sort();
}

/**
 * Clear every session mute. Returns how many ids were unmuted.
 * Does not clear unread markers.
 */
export function clearAllMutes(
  storage: SessionMuteStorage = defaultStorage(),
): number {
  const ids = loadMutedSessionIds(storage);
  const n = ids.size;
  if (n === 0) return 0;
  saveMutedSessionIds([], storage);
  return n;
}

/** Default: confirm bulk unmute when more than this many muted sessions. */
export const CLEAR_ALL_MUTES_CONFIRM_THRESHOLD = 3;

/**
 * Whether bulk "clear all mutes" should show an in-app confirm dialog.
 * Threshold is exclusive lower bound: count > threshold → confirm.
 */
export function shouldConfirmClearAllMutes(
  count: number,
  threshold: number = CLEAR_ALL_MUTES_CONFIRM_THRESHOLD,
): boolean {
  if (!Number.isFinite(count) || count <= 0) return false;
  const t =
    Number.isFinite(threshold) && threshold >= 0
      ? Math.floor(threshold)
      : CLEAR_ALL_MUTES_CONFIRM_THRESHOLD;
  return count > t;
}

/** Aliases matching DoD naming. */
export const load = loadMutedSessionIds;
export const save = saveMutedSessionIds;
export const listMuted = listMutedSessionIds;
export const clearAll = clearAllMutes;
