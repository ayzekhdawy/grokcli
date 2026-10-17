/**
 * Phone mirror write-ACL audit log (localStorage ring buffer).
 *
 * Records local security-relevant actions only:
 * - write_enabled / write_disabled
 * - token_rotated (never stores the token value)
 * - host_started / host_stopped (optional)
 *
 * Never stores secrets, tokens, or URLs that may embed tokens.
 * Newest first, max ~50. Local only — no network surface.
 */

export type MirrorWriteAuditType =
  | "write_enabled"
  | "write_disabled"
  | "token_rotated"
  | "host_started"
  | "host_stopped";

export type MirrorWriteAuditEvent = {
  id: string;
  type: MirrorWriteAuditType;
  /** ISO-8601 timestamp. */
  at: string;
  /** Optional short note — never secrets/tokens/URLs. */
  note?: string;
};

export const MIRROR_WRITE_AUDIT_STORAGE_KEY = "grok.mirrorWriteAudit";
export const MIRROR_WRITE_AUDIT_MAX = 50;
/** Cap free-form note length (localStorage + UI). */
export const MIRROR_WRITE_AUDIT_NOTE_MAX = 200;

/** Fired on `window` after a successful record/clear (detail = events). */
export const MIRROR_WRITE_AUDIT_CHANGE_EVENT = "grok-mirror-write-audit-change";

const AUDIT_TYPES = new Set<MirrorWriteAuditType>([
  "write_enabled",
  "write_disabled",
  "token_rotated",
  "host_started",
  "host_stopped",
]);

/** Minimal storage surface so unit tests need no jsdom. */
export interface MirrorWriteAuditStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function defaultStorage(): MirrorWriteAuditStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

function newAuditId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `mwa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Normalize optional note: trim, strip controls, cap length.
 * Drops notes that look like URLs or token-bearing payloads.
 */
export function sanitizeMirrorWriteAuditNote(
  raw: unknown,
  max = MIRROR_WRITE_AUDIT_NOTE_MAX,
): string | undefined {
  if (typeof raw !== "string") return undefined;
  let s = raw.replace(/[\u0000-\u001f]/g, "").trim();
  if (!s) return undefined;
  // Never persist URLs or obvious token material in the audit note.
  if (
    /https?:\/\//i.test(s) ||
    /[?&#]token=/i.test(s) ||
    /\btoken\s*[:=]/i.test(s) ||
    /\bbearer\s+/i.test(s)
  ) {
    return undefined;
  }
  if (s.length > max) s = s.slice(0, max);
  return s;
}

/**
 * Normalize one raw object into a MirrorWriteAuditEvent, or null if invalid.
 * Only known fields; drops free-form payload that could carry secrets.
 */
export function parseMirrorWriteAuditEvent(
  raw: unknown,
): MirrorWriteAuditEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const typeRaw = typeof o.type === "string" ? o.type.trim() : "";
  if (!AUDIT_TYPES.has(typeRaw as MirrorWriteAuditType)) return null;
  const type = typeRaw as MirrorWriteAuditType;

  const idRaw = typeof o.id === "string" ? o.id.trim() : "";
  // Require a non-empty id; reject control-only junk
  const id = idRaw.replace(/[\u0000-\u001f]/g, "").trim();
  if (!id) return null;

  const at =
    typeof o.at === "string" && o.at.trim()
      ? o.at.trim()
      : new Date(0).toISOString();

  const note = sanitizeMirrorWriteAuditNote(o.note);

  return {
    id,
    type,
    at,
    ...(note ? { note } : {}),
  };
}

/**
 * Parse stored JSON into a clean, newest-first list (capped).
 * Tolerates corrupt / partial data. Dedupes by id (keep first = newest).
 */
export function parseMirrorWriteAudit(
  raw: unknown,
  max = MIRROR_WRITE_AUDIT_MAX,
): MirrorWriteAuditEvent[] {
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

  const out: MirrorWriteAuditEvent[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const e = parseMirrorWriteAuditEvent(item);
    if (!e) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Pure ring-buffer push: newest first, max length.
 * Does not touch storage. Replaces any existing entry with the same id.
 */
export function pushMirrorWriteAudit(
  existing: readonly MirrorWriteAuditEvent[],
  entry: MirrorWriteAuditEvent,
  max = MIRROR_WRITE_AUDIT_MAX,
): MirrorWriteAuditEvent[] {
  const next = parseMirrorWriteAuditEvent(entry);
  if (!next) return parseMirrorWriteAudit(existing, max);
  const rest = existing.filter((e) => e.id !== next.id);
  return parseMirrorWriteAudit([next, ...rest], max);
}

export function loadMirrorWriteAudit(
  storage: MirrorWriteAuditStorage = defaultStorage(),
  max = MIRROR_WRITE_AUDIT_MAX,
): MirrorWriteAuditEvent[] {
  try {
    return parseMirrorWriteAudit(
      storage.getItem(MIRROR_WRITE_AUDIT_STORAGE_KEY),
      max,
    );
  } catch {
    /* private mode */
    return [];
  }
}

export function saveMirrorWriteAudit(
  entries: readonly MirrorWriteAuditEvent[],
  storage: MirrorWriteAuditStorage = defaultStorage(),
  max = MIRROR_WRITE_AUDIT_MAX,
): void {
  const clean = parseMirrorWriteAudit(entries, max);
  try {
    storage.setItem(MIRROR_WRITE_AUDIT_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    /* private mode / quota */
  }
}

function notifyAuditChange(next: MirrorWriteAuditEvent[]): void {
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(MIRROR_WRITE_AUDIT_CHANGE_EVENT, { detail: next }),
      );
    } catch {
      /* ignore */
    }
  }
}

/**
 * Record a mirror write-ACL event: load → push → save → notify.
 * Never accepts or stores token values / public URLs.
 * Returns the updated list.
 */
export function recordMirrorWriteAudit(
  input: {
    type: MirrorWriteAuditType;
    note?: string | null;
    at?: string;
    id?: string;
  },
  storage: MirrorWriteAuditStorage = defaultStorage(),
  max = MIRROR_WRITE_AUDIT_MAX,
): MirrorWriteAuditEvent[] {
  if (!AUDIT_TYPES.has(input.type)) {
    return loadMirrorWriteAudit(storage, max);
  }
  const entry: MirrorWriteAuditEvent = {
    id: (input.id && String(input.id).trim()) || newAuditId(),
    type: input.type,
    at: input.at || new Date().toISOString(),
    ...(input.note != null && input.note !== undefined
      ? { note: String(input.note) }
      : {}),
  };
  // Re-parse to sanitize note and drop unsafe fields
  const clean = parseMirrorWriteAuditEvent(entry);
  if (!clean) return loadMirrorWriteAudit(storage, max);

  const next = pushMirrorWriteAudit(
    loadMirrorWriteAudit(storage, max),
    clean,
    max,
  );
  saveMirrorWriteAudit(next, storage, max);
  notifyAuditChange(next);
  return next;
}

/**
 * Clear the entire write audit log (local only).
 * Returns empty list.
 */
export function clearMirrorWriteAudit(
  storage: MirrorWriteAuditStorage = defaultStorage(),
): MirrorWriteAuditEvent[] {
  try {
    if (typeof storage.removeItem === "function") {
      storage.removeItem(MIRROR_WRITE_AUDIT_STORAGE_KEY);
    } else {
      storage.setItem(MIRROR_WRITE_AUDIT_STORAGE_KEY, "[]");
    }
  } catch {
    /* private mode */
  }
  notifyAuditChange([]);
  return [];
}

/** Stable i18n key suffix for an audit event type (`mirror.audit.type.*`). */
export function mirrorWriteAuditTypeKey(
  type: MirrorWriteAuditType,
): `mirror.audit.type.${MirrorWriteAuditType}` {
  return `mirror.audit.type.${type}`;
}
