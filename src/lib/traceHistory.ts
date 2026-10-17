/**
 * Recent session-trace export history (localStorage ring buffer).
 *
 * Stores **paths only** — never file contents (traces can be large).
 * Entries: { sessionId, title?, path, exportedAt, sizeBytes?, uploaded? }, max ~20, newest first.
 * Optional `uploaded=true` notes that the CLI reported a remote upload — never URLs/secrets.
 */

export type TraceHistoryEntry = {
  sessionId: string;
  title?: string;
  path: string;
  exportedAt: string;
  /** Optional file size in bytes (from host stat after export). Never load contents. */
  sizeBytes?: number;
  /**
   * True when export used network upload and CLI JSON indicated remote success.
   * Omitted / false for local-only exports. Never stores remote URLs or tokens.
   */
  uploaded?: boolean;
};

export const TRACE_HISTORY_STORAGE_KEY = "grok.traceHistory";
export const TRACE_HISTORY_MAX = 20;

/** Fired on `window` after a successful record (detail = entries). */
export const TRACE_HISTORY_CHANGE_EVENT = "grok-trace-history-change";

/** Minimal storage surface so unit tests need no jsdom. */
export interface TraceHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): TraceHistoryStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

function notifyTraceHistoryChange(entries: TraceHistoryEntry[]): void {
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(TRACE_HISTORY_CHANGE_EVENT, { detail: entries }),
      );
    } catch {
      /* ignore */
    }
  }
}

/**
 * Basename of a path for UI labels (no FS I/O).
 * Handles POSIX and Windows separators.
 */
export function traceHistoryFileName(path: string): string {
  const p = (path || "").trim();
  if (!p) return "";
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/**
 * Parse optional non-negative finite size (bytes). Rejects NaN / negative / non-finite.
 */
export function parseTraceHistorySizeBytes(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return undefined;
    return Math.floor(raw);
  }
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return Math.floor(n);
  }
  return undefined;
}

/**
 * Coerce a host/CLI-style boolean for the optional `uploaded` history flag.
 * Only true when clearly true — never invents upload from paths alone.
 */
export function parseTraceHistoryUploaded(raw: unknown): boolean | undefined {
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  return undefined;
}

/**
 * Pure: did host / CLI JSON report a successful remote upload?
 * Accepts the `session_trace_export` result or a subset of CLI `--json` fields.
 * Presence of remote *info* (not the URL values) may set uploaded — callers must
 * not persist those URL strings into history.
 */
export function parseTraceExportUploadedFlag(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;

  const direct = parseTraceHistoryUploaded(o.uploaded);
  if (direct === true) return true;
  if (direct === false) return false;

  const status =
    typeof o.status === "string" ? o.status.trim().toLowerCase() : "";
  if (
    status === "uploaded" ||
    status === "upload_complete" ||
    status === "upload-complete" ||
    status === "ok_uploaded"
  ) {
    return true;
  }

  // Remote info keys: non-empty string means upload path reported success.
  for (const key of ["remote_url", "upload_url", "share_url", "object_path"]) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return true;
  }
  return false;
}

/**
 * Human-readable size for list rows. Returns null when unknown.
 * Pure — no i18n (B/KB/MB/GB are universal unit abbreviations).
 */
export function formatTraceHistorySize(
  sizeBytes: number | null | undefined,
): string | null {
  if (sizeBytes == null) return null;
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return null;
  const n = sizeBytes;
  if (n < 1024) return `${Math.floor(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) {
    return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Normalize one raw object into a TraceHistoryEntry, or null if invalid.
 * Only known fields; no free-form payload that could carry secrets.
 */
export function parseTraceHistoryEntry(raw: unknown): TraceHistoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sessionId =
    typeof o.sessionId === "string" ? o.sessionId.trim() : "";
  const path = typeof o.path === "string" ? o.path.trim() : "";
  if (!sessionId || !path) return null;
  // Reject obviously empty / control-char only paths
  if (!path.replace(/[\s\u0000-\u001f]/g, "").length) return null;

  const exportedAt =
    typeof o.exportedAt === "string" && o.exportedAt.trim()
      ? o.exportedAt.trim()
      : new Date(0).toISOString();

  const titleRaw = o.title;
  let title: string | undefined;
  if (typeof titleRaw === "string") {
    const t = titleRaw.trim();
    // Cap title length for storage / UI; never store multi-kb blobs as "title"
    if (t) title = t.slice(0, 200);
  }

  const sizeBytes =
    parseTraceHistorySizeBytes(o.sizeBytes) ??
    parseTraceHistorySizeBytes(o.size_bytes);

  // Only persist true — omit false to keep history lean / local-default.
  const uploaded = parseTraceHistoryUploaded(o.uploaded) === true;

  return {
    sessionId,
    path,
    exportedAt,
    ...(title ? { title } : {}),
    ...(sizeBytes != null ? { sizeBytes } : {}),
    ...(uploaded ? { uploaded: true } : {}),
  };
}

/**
 * Parse stored JSON into a clean, newest-first list (capped).
 * Tolerates corrupt / partial data.
 */
export function parseTraceHistory(
  raw: unknown,
  max = TRACE_HISTORY_MAX,
): TraceHistoryEntry[] {
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

  const out: TraceHistoryEntry[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const e = parseTraceHistoryEntry(item);
    if (!e) continue;
    // Dedup by path (same file should appear once, keep first = newest)
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Pure ring-buffer push: newest first, max length, dedupe by path.
 * Does not touch storage.
 */
export function pushTraceHistory(
  existing: readonly TraceHistoryEntry[],
  entry: TraceHistoryEntry,
  max = TRACE_HISTORY_MAX,
): TraceHistoryEntry[] {
  const next = parseTraceHistoryEntry(entry);
  if (!next) return parseTraceHistory(existing, max);
  const rest = existing.filter((e) => e.path !== next.path);
  return parseTraceHistory([next, ...rest], max);
}

/**
 * Pure remove by path and/or sessionId.
 * - string → treated as path
 * - `{ path }` → exact path match
 * - `{ sessionId }` → drop all rows for that session
 * - both → path match preferred; if path set, only that path is removed
 */
export function removeTraceHistoryEntry(
  existing: readonly TraceHistoryEntry[],
  match: string | { path?: string; sessionId?: string },
): TraceHistoryEntry[] {
  let path = "";
  let sessionId = "";
  if (typeof match === "string") {
    path = match.trim();
  } else if (match && typeof match === "object") {
    path = typeof match.path === "string" ? match.path.trim() : "";
    sessionId =
      typeof match.sessionId === "string" ? match.sessionId.trim() : "";
  }
  if (!path && !sessionId) return [...existing];
  return existing.filter((e) => {
    if (path) return e.path !== path;
    return e.sessionId !== sessionId;
  });
}

/** Pure clear-all — returns empty list. */
export function clearTraceHistoryEntries(): TraceHistoryEntry[] {
  return [];
}

/**
 * Case-insensitive substring filter on title and path.
 * Empty query returns a shallow copy of the input (order preserved).
 */
export function filterTraceHistory(
  entries: readonly TraceHistoryEntry[],
  query: string,
): TraceHistoryEntry[] {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter((e) => {
    const title = (e.title || "").toLowerCase();
    const path = (e.path || "").toLowerCase();
    const file = traceHistoryFileName(e.path).toLowerCase();
    const sid = (e.sessionId || "").toLowerCase();
    return (
      title.includes(q) ||
      path.includes(q) ||
      file.includes(q) ||
      sid.includes(q)
    );
  });
}

export function loadTraceHistory(
  storage: TraceHistoryStorage = defaultStorage(),
  max = TRACE_HISTORY_MAX,
): TraceHistoryEntry[] {
  try {
    return parseTraceHistory(
      storage.getItem(TRACE_HISTORY_STORAGE_KEY),
      max,
    );
  } catch {
    /* private mode */
    return [];
  }
}

export function saveTraceHistory(
  entries: readonly TraceHistoryEntry[],
  storage: TraceHistoryStorage = defaultStorage(),
  max = TRACE_HISTORY_MAX,
): void {
  const clean = parseTraceHistory(entries, max);
  try {
    storage.setItem(TRACE_HISTORY_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    /* private mode / quota */
  }
}

/**
 * Record a successful export: load → push → save → notify.
 * Returns the updated list (paths only).
 */
export function recordTraceExport(
  input: {
    sessionId: string;
    path: string;
    title?: string | null;
    exportedAt?: string;
    /** Optional size from host `stat` after export — never file contents. */
    sizeBytes?: number | null;
    /**
     * Optional: CLI/host reported remote upload success.
     * Paths-only history still; never store URLs or secrets here.
     */
    uploaded?: boolean | null;
  },
  storage: TraceHistoryStorage = defaultStorage(),
  max = TRACE_HISTORY_MAX,
): TraceHistoryEntry[] {
  const sizeBytes = parseTraceHistorySizeBytes(input.sizeBytes ?? undefined);
  const uploaded = input.uploaded === true;
  const entry: TraceHistoryEntry = {
    sessionId: input.sessionId,
    path: input.path,
    exportedAt: input.exportedAt || new Date().toISOString(),
    ...(input.title && String(input.title).trim()
      ? { title: String(input.title).trim().slice(0, 200) }
      : {}),
    ...(sizeBytes != null ? { sizeBytes } : {}),
    ...(uploaded ? { uploaded: true } : {}),
  };
  const next = pushTraceHistory(loadTraceHistory(storage, max), entry, max);
  saveTraceHistory(next, storage, max);
  notifyTraceHistoryChange(next);
  return next;
}

/**
 * Remove one entry by path (or match object), persist, notify.
 * Returns the updated list.
 */
export function removeTraceHistory(
  match: string | { path?: string; sessionId?: string },
  storage: TraceHistoryStorage = defaultStorage(),
  max = TRACE_HISTORY_MAX,
): TraceHistoryEntry[] {
  const next = removeTraceHistoryEntry(loadTraceHistory(storage, max), match);
  saveTraceHistory(next, storage, max);
  notifyTraceHistoryChange(next);
  return next;
}

/**
 * Clear all history entries, persist, notify.
 * Does **not** delete archive files on disk — only the local path list.
 */
export function clearTraceHistory(
  storage: TraceHistoryStorage = defaultStorage(),
  max = TRACE_HISTORY_MAX,
): TraceHistoryEntry[] {
  const next = clearTraceHistoryEntries();
  saveTraceHistory(next, storage, max);
  notifyTraceHistoryChange(next);
  return next;
}

/** Short label for list rows: title, else session id prefix. */
export function traceHistoryLabel(entry: TraceHistoryEntry): string {
  const t = (entry.title || "").trim();
  if (t) return t;
  const id = entry.sessionId.trim();
  if (id.length <= 12) return id;
  return id.slice(0, 8) + "…";
}
