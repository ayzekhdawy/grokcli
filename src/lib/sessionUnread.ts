/**
 * Per-session unread indicator for background turns.
 * localStorage-only Set of session ids that finished a turn while not viewed.
 *
 * Independent of desktop-notification mute (`sessionMute`): muted sessions still
 * get an unread dot when a background turn completes.
 */

export const SESSION_UNREAD_STORAGE_KEY = "grok.sessionUnread";

/** Fired on `window` after a successful save (detail = string[] of unread ids). */
export const SESSION_UNREAD_CHANGE_EVENT = "grok-session-unread-change";

/** Minimal storage surface so unit tests need no jsdom. */
export interface SessionUnreadStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): SessionUnreadStorage {
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
export function parseUnreadSessionIds(raw: unknown): Set<string> {
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

/** Load unread session id Set from storage. */
export function loadUnreadSessionIds(
  storage: SessionUnreadStorage = defaultStorage(),
): Set<string> {
  try {
    return parseUnreadSessionIds(storage.getItem(SESSION_UNREAD_STORAGE_KEY));
  } catch {
    /* private mode */
    return new Set();
  }
}

/** Persist unread session ids (sorted for stable JSON). */
export function saveUnreadSessionIds(
  ids: Iterable<string>,
  storage: SessionUnreadStorage = defaultStorage(),
): void {
  const unique = new Set<string>();
  for (const item of ids) {
    const id = normalizeId(item);
    if (id) unique.add(id);
  }
  const list = Array.from(unique).sort();
  try {
    storage.setItem(SESSION_UNREAD_STORAGE_KEY, JSON.stringify(list));
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
        new CustomEvent(SESSION_UNREAD_CHANGE_EVENT, { detail: list }),
      );
    } catch {
      /* ignore */
    }
  }
}

/** Whether `sessionId` is currently marked unread. */
export function isUnread(
  sessionId: string | null | undefined,
  storage: SessionUnreadStorage = defaultStorage(),
): boolean {
  const id = normalizeId(sessionId);
  if (!id) return false;
  return loadUnreadSessionIds(storage).has(id);
}

/**
 * Mark a session unread. Returns `true` when the id is now in the set.
 * Empty / missing id → `false`.
 */
export function markUnread(
  sessionId: string | null | undefined,
  storage: SessionUnreadStorage = defaultStorage(),
): boolean {
  const id = normalizeId(sessionId);
  if (!id) return false;
  const ids = loadUnreadSessionIds(storage);
  if (!ids.has(id)) {
    ids.add(id);
    saveUnreadSessionIds(ids, storage);
  }
  return true;
}

/**
 * Clear unread for a session (e.g. when the user opens/views it).
 * Returns `true` when the id is not in the set afterward.
 */
export function clearUnread(
  sessionId: string | null | undefined,
  storage: SessionUnreadStorage = defaultStorage(),
): boolean {
  const id = normalizeId(sessionId);
  if (!id) return true;
  const ids = loadUnreadSessionIds(storage);
  if (!ids.has(id)) return true;
  ids.delete(id);
  saveUnreadSessionIds(ids, storage);
  return true;
}

/**
 * Sorted list of unread session ids (stable order for UI / tests).
 * Independent of mute — muted sessions may still appear here.
 */
export function listUnreadSessionIds(
  storage: SessionUnreadStorage = defaultStorage(),
): string[] {
  return Array.from(loadUnreadSessionIds(storage)).sort();
}

/**
 * Toggle unread for `sessionId`.
 * Returns the new unread state (`true` = unread). Empty / missing id → `false`.
 */
export function toggleUnread(
  sessionId: string | null | undefined,
  storage: SessionUnreadStorage = defaultStorage(),
): boolean {
  const id = normalizeId(sessionId);
  if (!id) return false;
  const ids = loadUnreadSessionIds(storage);
  const nextUnread = !ids.has(id);
  if (nextUnread) ids.add(id);
  else ids.delete(id);
  saveUnreadSessionIds(ids, storage);
  return nextUnread;
}

/**
 * Clear every unread marker. Returns how many ids were removed.
 * Mute state is never touched.
 */
export function clearAllUnread(
  storage: SessionUnreadStorage = defaultStorage(),
): number {
  const ids = loadUnreadSessionIds(storage);
  const n = ids.size;
  if (n === 0) return 0;
  saveUnreadSessionIds([], storage);
  return n;
}

/** Default: confirm bulk clear when more than this many unread sessions. */
export const CLEAR_ALL_UNREAD_CONFIRM_THRESHOLD = 3;

/**
 * Whether bulk "clear all unread" should show an in-app confirm dialog.
 * Threshold is exclusive lower bound: count > threshold → confirm.
 * Zero/negative count → never confirm (caller should no-op first).
 */
export function shouldConfirmClearAllUnread(
  count: number,
  threshold: number = CLEAR_ALL_UNREAD_CONFIRM_THRESHOLD,
): boolean {
  if (!Number.isFinite(count) || count <= 0) return false;
  const t =
    Number.isFinite(threshold) && threshold >= 0
      ? Math.floor(threshold)
      : CLEAR_ALL_UNREAD_CONFIRM_THRESHOLD;
  return count > t;
}

/**
 * True when the main workbench is actually in front of the user.
 * Hidden, minimized, or unfocused windows are not a "read" — the desktop
 * pet still shows a completed-unread bubble until they click it or come
 * back to this chat with the window focused.
 *
 * Missing `document` (unit tests / SSR) defaults to foreground so callers
 * that omit focus/visibility keep the old "viewing = read" behavior.
 */
export function isWorkbenchForeground(opts?: {
  hasFocus?: boolean;
  visibilityState?: string | null;
}): boolean {
  const hasFocus =
    typeof opts?.hasFocus === "boolean"
      ? opts.hasFocus
      : typeof document !== "undefined" &&
          typeof document.hasFocus === "function"
        ? document.hasFocus()
        : true;
  const visibility =
    opts && "visibilityState" in opts
      ? opts.visibilityState
      : typeof document !== "undefined"
        ? document.visibilityState
        : "visible";
  return hasFocus && visibility !== "hidden";
}

/**
 * Whether a completed turn should mark the session unread.
 * Background chats always mark. The currently viewed chat also marks when the
 * workbench is hidden or unfocused (not a real read). Mute is intentionally
 * ignored — muted sessions still get the sidebar unread dot (mute only
 * suppresses desktop notify).
 */
export function shouldMarkUnreadOnTurnDone(opts: {
  sessionId: string | null | undefined;
  viewingSessionId: string | null | undefined;
  hasFocus?: boolean;
  visibilityState?: string | null;
}): boolean {
  const finished = normalizeId(opts.sessionId);
  if (!finished) return false;
  const viewing = normalizeId(opts.viewingSessionId);
  if (finished !== viewing) return true;
  return !isWorkbenchForeground(opts);
}

/**
 * True when Host/UI state moves from an in-progress turn into `ready`.
 * Used to avoid marking unread on cold reconnect / idle→ready shells.
 */
export function isTurnDoneReadyTransition(
  previousState: string | null | undefined,
  nextState: string | null | undefined,
): boolean {
  if (nextState !== "ready") return false;
  return (
    previousState === "streaming" || previousState === "awaiting_permission"
  );
}

/** Aliases matching DoD naming. */
export const load = loadUnreadSessionIds;
export const save = saveUnreadSessionIds;
export const listUnread = listUnreadSessionIds;
export const clearAll = clearAllUnread;
