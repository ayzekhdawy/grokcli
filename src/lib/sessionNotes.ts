/**
 * Per-session sticky notes (localStorage map sessionId → text).
 *
 * Client-only scratch pad for the user. Notes are never attached to agent
 * prompts unless the user pastes them. Do not log note contents (may hold
 * secrets / personal context).
 */

export const SESSION_NOTES_STORAGE_KEY = "grok.sessionNotes";

/** Fired on `window` after a successful save (detail = sessionId keys touched or full map keys). */
export const SESSION_NOTES_CHANGE_EVENT = "grok-session-notes-change";

/** Soft cap for a single note (~2k code units). */
export const SESSION_NOTE_MAX_LENGTH = 2000;

/** Default tip preview length (characters). */
export const SESSION_NOTE_PREVIEW_LENGTH = 80;

/** Minimal storage surface so unit tests need no jsdom. */
export interface SessionNotesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function defaultStorage(): SessionNotesStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

function normalizeId(sessionId: string | null | undefined): string | null {
  if (typeof sessionId !== "string") return null;
  const id = sessionId.trim();
  return id ? id : null;
}

/** Clamp note text to max length (UTF-16 code units). */
export function clampNoteText(
  text: string,
  maxLen: number = SESSION_NOTE_MAX_LENGTH,
): string {
  if (typeof text !== "string") return "";
  if (maxLen <= 0) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

/**
 * One-line preview for tooltips / aria. Collapses whitespace; truncates with ellipsis.
 * Does not log; pure transform only.
 */
export function notePreview(
  text: string | null | undefined,
  maxLen: number = SESSION_NOTE_PREVIEW_LENGTH,
): string {
  if (typeof text !== "string") return "";
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  if (maxLen <= 0) return "";
  if (flat.length <= maxLen) return flat;
  if (maxLen <= 1) return "…";
  return flat.slice(0, maxLen - 1) + "…";
}

/**
 * Parse stored JSON object into sessionId → note text.
 * Invalid / empty → {}.
 */
export function parseSessionNotes(raw: unknown): Record<string, string> {
  if (raw == null || raw === "") return {};
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const id = normalizeId(k);
    if (!id) continue;
    if (typeof v !== "string") continue;
    const note = clampNoteText(v);
    if (!note.trim()) continue;
    out[id] = note;
  }
  return out;
}

/** Load full map from storage. */
export function loadSessionNotes(
  storage: SessionNotesStorage = defaultStorage(),
): Record<string, string> {
  try {
    return parseSessionNotes(storage.getItem(SESSION_NOTES_STORAGE_KEY));
  } catch {
    /* private mode */
    return {};
  }
}

/**
 * Persist full map. Empty-string notes are dropped. Sorted keys for stable JSON.
 * Dispatches SESSION_NOTES_CHANGE_EVENT with detail = sorted session ids that have notes.
 */
export function saveSessionNotes(
  map: Record<string, string>,
  storage: SessionNotesStorage = defaultStorage(),
): void {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(map ?? {})) {
    const id = normalizeId(k);
    if (!id) continue;
    if (typeof v !== "string") continue;
    const note = clampNoteText(v);
    if (!note.trim()) continue;
    cleaned[id] = note;
  }
  const keys = Object.keys(cleaned).sort();
  const ordered: Record<string, string> = {};
  for (const k of keys) ordered[k] = cleaned[k]!;
  try {
    if (keys.length === 0) {
      if (typeof storage.removeItem === "function") {
        storage.removeItem(SESSION_NOTES_STORAGE_KEY);
      } else {
        storage.setItem(SESSION_NOTES_STORAGE_KEY, "{}");
      }
    } else {
      storage.setItem(SESSION_NOTES_STORAGE_KEY, JSON.stringify(ordered));
    }
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
        new CustomEvent(SESSION_NOTES_CHANGE_EVENT, { detail: keys }),
      );
    } catch {
      /* ignore */
    }
  }
}

/** Read note for one session ("" when missing). */
export function getNote(
  sessionId: string | null | undefined,
  storage: SessionNotesStorage = defaultStorage(),
): string {
  const id = normalizeId(sessionId);
  if (!id) return "";
  return loadSessionNotes(storage)[id] ?? "";
}

/** Whether the session has a non-empty sticky note. */
export function hasNote(
  sessionId: string | null | undefined,
  storage: SessionNotesStorage = defaultStorage(),
): boolean {
  return getNote(sessionId, storage).trim().length > 0;
}

/**
 * Set note text for a session. Empty / whitespace-only clears the entry.
 * Returns the stored text (clamped), or "" when cleared / invalid id.
 */
export function setNote(
  sessionId: string | null | undefined,
  text: string,
  storage: SessionNotesStorage = defaultStorage(),
): string {
  const id = normalizeId(sessionId);
  if (!id) return "";
  const map = loadSessionNotes(storage);
  const next = clampNoteText(typeof text === "string" ? text : "");
  if (!next.trim()) {
    delete map[id];
    saveSessionNotes(map, storage);
    return "";
  }
  map[id] = next;
  saveSessionNotes(map, storage);
  return next;
}

/** Remove note for a session. */
export function clearNote(
  sessionId: string | null | undefined,
  storage: SessionNotesStorage = defaultStorage(),
): void {
  setNote(sessionId, "", storage);
}

// ---------------------------------------------------------------------------
// SESSION-NOTES-PRO — budget, empty honesty, search, clear plans
// ---------------------------------------------------------------------------
// Pure helpers for the sticky-notes GlassModal. Notes are client-only; never
// attach note bodies to agent prompts and never include bodies in log meta.

/** Fraction of max length that triggers the near-cap warning. */
export const SESSION_NOTE_NEAR_CAP_RATIO = 0.9;

/** Visual severity for chips / count / banners. */
export type SessionNoteSeverity = "ok" | "warn" | "err" | "info";

/** Char-budget snapshot for a note draft. */
export type SessionNoteBudget = {
  /** Length of the raw editor value. */
  rawLen: number;
  /** Length after sanitize (NUL strip + clamp; no trim of interior spaces). */
  sanitizedLen: number;
  max: number;
  remaining: number;
  /** True when input was longer than max. */
  clamped: boolean;
  /** True when raw contained NUL bytes that sanitize strips. */
  nulStripped: boolean;
  /** True when sanitized body is empty/whitespace-only (save will clear). */
  empty: boolean;
  /** >= 90% of max (warn). */
  nearCap: boolean;
  /** At max capacity. */
  atCap: boolean;
};

/** Stable status for note editor chrome. */
export type SessionNoteStatus =
  | "empty"
  | "ok"
  | "near_cap"
  | "at_cap"
  | "nul_stripped"
  | "will_clear";

export type SessionNoteValidation = {
  budget: SessionNoteBudget;
  status: SessionNoteStatus;
  /** Value ready to persist (`""` means clear). */
  sanitized: string;
  /** Draft differs from baseline (raw string compare). */
  dirty: boolean;
  severity: SessionNoteSeverity;
  /**
   * Message key for a short status line (caller passes through `t()`).
   * Null when no extra status beyond the char counter is needed.
   */
  statusKey:
    | "session.noteStatus.empty"
    | "session.noteStatus.willClear"
    | "session.noteStatus.nearCap"
    | "session.noteStatus.atCap"
    | "session.noteStatus.nulStripped"
    | null;
};

/**
 * Sanitize note text for persistence: strip NULs, clamp length.
 * Does not trim interior spaces (so mid-edit drafts stay honest); callers
 * treat whitespace-only as empty via `.trim()`.
 */
export function sanitizeSessionNote(
  raw: string | null | undefined,
  maxLen: number = SESSION_NOTE_MAX_LENGTH,
): string {
  if (typeof raw !== "string") return "";
  const withoutNul = raw.includes("\0") ? raw.replace(/\0/g, "") : raw;
  return clampNoteText(withoutNul, maxLen);
}

/**
 * Clamp raw editor input for controlled textareas.
 * Does not trim (so typing spaces mid-edit is preserved); strips NULs only
 * when present so the caret does not jump on ordinary keystrokes.
 */
export function clampSessionNoteInput(
  raw: string,
  maxLen: number = SESSION_NOTE_MAX_LENGTH,
): { value: string; clamped: boolean; nulStripped: boolean } {
  const hadNul = typeof raw === "string" && raw.includes("\0");
  const cleaned = hadNul ? raw.replace(/\0/g, "") : typeof raw === "string" ? raw : "";
  const cap = maxLen > 0 ? maxLen : 0;
  if (cap <= 0) {
    return { value: "", clamped: cleaned.length > 0, nulStripped: hadNul };
  }
  if (cleaned.length <= cap) {
    return { value: cleaned, clamped: false, nulStripped: hadNul };
  }
  return {
    value: cleaned.slice(0, cap),
    clamped: true,
    nulStripped: hadNul,
  };
}

/** Char budget + flags for a draft (raw editor value). */
export function sessionNoteBudget(
  raw: string | null | undefined,
  maxLen: number = SESSION_NOTE_MAX_LENGTH,
): SessionNoteBudget {
  const max = maxLen > 0 ? maxLen : 0;
  const source = typeof raw === "string" ? raw : "";
  const hadNul = source.includes("\0");
  const withoutNul = hadNul ? source.replace(/\0/g, "") : source;
  const sanitized = sanitizeSessionNote(source, max);
  const rawLen = source.length;
  const sanitizedLen = sanitized.length;
  const clamped = withoutNul.length > max;
  const remaining = Math.max(0, max - rawLen);
  const empty = sanitized.trim().length === 0;
  const atCap = max > 0 && rawLen >= max;
  const nearCap =
    !empty && max > 0 && rawLen >= Math.floor(max * SESSION_NOTE_NEAR_CAP_RATIO);
  return {
    rawLen,
    sanitizedLen,
    max,
    remaining,
    clamped,
    nulStripped: hadNul,
    empty,
    nearCap,
    atCap,
  };
}

/** True when draft text differs from the baseline opened in the editor. */
export function isSessionNoteDirty(
  draft: string | null | undefined,
  baseline: string | null | undefined,
): boolean {
  const d = typeof draft === "string" ? draft : "";
  const b = typeof baseline === "string" ? baseline : "";
  return d !== b;
}

/**
 * Full validation model for the session-note editor.
 * `baseline` is the value loaded when the modal opened (pre-edit).
 */
export function validateSessionNote(opts: {
  draft: string | null | undefined;
  baseline?: string | null | undefined;
  maxLen?: number;
  /** True when a non-empty value is currently stored for this session. */
  hadStored?: boolean;
}): SessionNoteValidation {
  const max =
    opts.maxLen != null && opts.maxLen > 0
      ? opts.maxLen
      : SESSION_NOTE_MAX_LENGTH;
  const draft = typeof opts.draft === "string" ? opts.draft : "";
  const budget = sessionNoteBudget(draft, max);
  const sanitized = sanitizeSessionNote(draft, max);
  const dirty = isSessionNoteDirty(draft, opts.baseline ?? "");

  let status: SessionNoteStatus = "ok";
  let severity: SessionNoteSeverity = "ok";
  let statusKey: SessionNoteValidation["statusKey"] = null;

  if (budget.nulStripped) {
    status = "nul_stripped";
    severity = "warn";
    statusKey = "session.noteStatus.nulStripped";
  } else if (budget.empty && opts.hadStored) {
    status = "will_clear";
    severity = "info";
    statusKey = "session.noteStatus.willClear";
  } else if (budget.empty) {
    status = "empty";
    severity = "info";
    statusKey = "session.noteStatus.empty";
  } else if (budget.atCap || budget.clamped) {
    status = "at_cap";
    severity = "warn";
    statusKey = "session.noteStatus.atCap";
  } else if (budget.nearCap) {
    status = "near_cap";
    severity = "warn";
    statusKey = "session.noteStatus.nearCap";
  }

  return {
    budget,
    status,
    sanitized,
    dirty,
    severity,
    statusKey,
  };
}

/** True when closing the modal should confirm discard. */
export function shouldConfirmSessionNoteDiscard(
  validation: Pick<SessionNoteValidation, "dirty">,
): boolean {
  return Boolean(validation.dirty);
}

/**
 * True when Clear should ask for confirmation (stored note and/or non-empty draft).
 */
export function shouldConfirmSessionNoteClear(opts: {
  draft?: string | null | undefined;
  hadStored?: boolean;
}): boolean {
  if (opts.hadStored) return true;
  const d = typeof opts.draft === "string" ? opts.draft : "";
  return d.trim().length > 0;
}

/** Outcome after a successful note save (toast only — never the body). */
export type SessionNoteSaveOutcome = {
  kind: "saved" | "cleared";
  /** Safe meta for logs — never the body. */
  logMeta: { sessionId: string; chars: number } | null;
  toastKey: "session.noteSaved" | "session.noteCleared";
};

export function sessionNoteSaveOutcome(
  sessionId: string | null | undefined,
  stored: string | null | undefined,
): SessionNoteSaveOutcome {
  const id = normalizeId(sessionId) ?? "";
  const text = sanitizeSessionNote(stored);
  if (!text.trim()) {
    return {
      kind: "cleared",
      logMeta: null,
      toastKey: "session.noteCleared",
    };
  }
  return {
    kind: "saved",
    logMeta: id ? { sessionId: id, chars: text.length } : null,
    toastKey: "session.noteSaved",
  };
}

/**
 * Safe log meta for a note — never the body.
 * Returns null when empty / invalid id.
 */
export function sessionNoteLogMeta(
  sessionId: string | null | undefined,
  raw: string | null | undefined,
): { sessionId: string; chars: number } | null {
  const id = normalizeId(sessionId);
  if (!id) return null;
  const s = sanitizeSessionNote(raw);
  if (!s.trim()) return null;
  return { sessionId: id, chars: s.length };
}

// ---------------------------------------------------------------------------
// Map listing / search / clear plans (pure; no storage side effects)
// ---------------------------------------------------------------------------

/** One note entry for list / search UIs. */
export type SessionNoteEntry = {
  sessionId: string;
  /** Note body (never log this from call sites that emit telemetry). */
  text: string;
  /** Optional session title when the host knows ids. */
  title: string;
  /** One-line preview for list rows. */
  preview: string;
  chars: number;
};

/** Empty-state kinds for notes map / search honesty. */
export type SessionNotesEmptyKind =
  | "no_notes"
  | "no_matches"
  | "no_session"
  | "empty_draft";

export type SessionNotesEmptyState = {
  kind: SessionNotesEmptyKind;
  /** i18n key for the empty line. */
  messageKey:
    | "session.notesEmpty.none"
    | "session.notesEmpty.noMatches"
    | "session.notesEmpty.noSession"
    | "session.noteStatus.empty";
};

/** Build sorted list entries from a notes map + optional title lookup. */
export function listSessionNoteEntries(
  map: Record<string, string> | null | undefined,
  titles?: Record<string, string> | null | undefined,
  previewLen: number = SESSION_NOTE_PREVIEW_LENGTH,
): SessionNoteEntry[] {
  const src = map ?? {};
  const out: SessionNoteEntry[] = [];
  for (const id of Object.keys(src).sort()) {
    const text = typeof src[id] === "string" ? src[id]! : "";
    if (!text.trim()) continue;
    const title =
      titles && typeof titles[id] === "string" ? titles[id]!.trim() : "";
    out.push({
      sessionId: id,
      text,
      title,
      preview: notePreview(text, previewLen),
      chars: text.length,
    });
  }
  return out;
}

/**
 * Search notes by content and/or session title (when titles are known).
 * Case-insensitive substring; empty query returns all non-empty entries.
 */
export function searchSessionNotes(
  map: Record<string, string> | null | undefined,
  query: string | null | undefined,
  titles?: Record<string, string> | null | undefined,
  previewLen: number = SESSION_NOTE_PREVIEW_LENGTH,
): SessionNoteEntry[] {
  const entries = listSessionNoteEntries(map, titles, previewLen);
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => {
    const body = e.text.toLowerCase();
    const title = e.title.toLowerCase();
    const id = e.sessionId.toLowerCase();
    return body.includes(q) || title.includes(q) || id.includes(q);
  });
}

/** Honest empty-state for map / search UIs. */
export function resolveSessionNotesEmptyState(opts: {
  map?: Record<string, string> | null | undefined;
  query?: string | null | undefined;
  matchCount?: number;
  /** True when the single-session editor has no session id target. */
  noSession?: boolean;
  /** True when the open editor draft is empty (and no map context). */
  emptyDraft?: boolean;
}): SessionNotesEmptyState | null {
  if (opts.noSession) {
    return {
      kind: "no_session",
      messageKey: "session.notesEmpty.noSession",
    };
  }
  const map = opts.map ?? {};
  const total = Object.values(map).filter(
    (v) => typeof v === "string" && v.trim().length > 0,
  ).length;
  const q = (opts.query ?? "").trim();
  if (q) {
    const matches =
      opts.matchCount != null
        ? opts.matchCount
        : searchSessionNotes(map, q).length;
    if (matches === 0) {
      return {
        kind: "no_matches",
        messageKey: "session.notesEmpty.noMatches",
      };
    }
    return null;
  }
  if (total === 0) {
    if (opts.emptyDraft) {
      return {
        kind: "empty_draft",
        messageKey: "session.noteStatus.empty",
      };
    }
    return {
      kind: "no_notes",
      messageKey: "session.notesEmpty.none",
    };
  }
  return null;
}

/** Plan for clearing one session's note (pure — does not touch storage). */
export type ClearOneNotePlan = {
  ok: boolean;
  sessionId: string | null;
  /** True when the session had a non-empty note. */
  hadNote: boolean;
  /** Next map after clear (copy). */
  nextMap: Record<string, string>;
  /** Safe meta for logs — never the body. */
  logMeta: { sessionId: string; cleared: true } | null;
};

export function planClearOneNote(
  map: Record<string, string> | null | undefined,
  sessionId: string | null | undefined,
): ClearOneNotePlan {
  const id = normalizeId(sessionId);
  const src = map ?? {};
  const nextMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    const kid = normalizeId(k);
    if (!kid) continue;
    if (typeof v !== "string" || !v.trim()) continue;
    nextMap[kid] = clampNoteText(v);
  }
  if (!id) {
    return {
      ok: false,
      sessionId: null,
      hadNote: false,
      nextMap,
      logMeta: null,
    };
  }
  const hadNote = Boolean(nextMap[id]?.trim());
  delete nextMap[id];
  return {
    ok: true,
    sessionId: id,
    hadNote,
    nextMap,
    logMeta: hadNote ? { sessionId: id, cleared: true } : null,
  };
}

/** Plan for clearing every note (pure — does not touch storage). */
export type ClearAllNotesPlan = {
  ok: boolean;
  /** Number of notes that will be removed. */
  count: number;
  /** Session ids that had notes (sorted). Never includes bodies. */
  sessionIds: string[];
  nextMap: Record<string, string>;
  logMeta: { clearedCount: number } | null;
};

export function planClearAllNotes(
  map: Record<string, string> | null | undefined,
): ClearAllNotesPlan {
  const entries = listSessionNoteEntries(map);
  const sessionIds = entries.map((e) => e.sessionId);
  const count = sessionIds.length;
  return {
    ok: true,
    count,
    sessionIds,
    nextMap: {},
    logMeta: count > 0 ? { clearedCount: count } : null,
  };
}

/**
 * Apply a clear-one plan to storage.
 * Returns whether a note was actually removed.
 */
export function applyClearOneNote(
  sessionId: string | null | undefined,
  storage: SessionNotesStorage = defaultStorage(),
): boolean {
  const map = loadSessionNotes(storage);
  const plan = planClearOneNote(map, sessionId);
  if (!plan.ok || !plan.hadNote) {
    if (plan.ok && plan.sessionId) {
      // Ensure entry is gone even if blank.
      clearNote(plan.sessionId, storage);
    }
    return false;
  }
  saveSessionNotes(plan.nextMap, storage);
  return true;
}

/**
 * Clear every sticky note from storage.
 * Returns how many notes were removed.
 */
export function clearAllNotes(
  storage: SessionNotesStorage = defaultStorage(),
): number {
  const map = loadSessionNotes(storage);
  const plan = planClearAllNotes(map);
  if (plan.count === 0) {
    saveSessionNotes({}, storage);
    return 0;
  }
  saveSessionNotes({}, storage);
  return plan.count;
}

/** Count non-empty notes in a map. */
export function countSessionNotes(
  map: Record<string, string> | null | undefined,
): number {
  if (!map) return 0;
  let n = 0;
  for (const v of Object.values(map)) {
    if (typeof v === "string" && v.trim()) n += 1;
  }
  return n;
}

/** Aliases matching common load/save naming. */
export const load = loadSessionNotes;
export const save = saveSessionNotes;
