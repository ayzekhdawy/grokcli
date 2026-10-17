/**
 * Persisted stall timeline (localStorage ring) and export snapshots.
 * Types for live signals live in reliabilityCenter.ts.
 */
import { redact } from "./redact";
import {
  prependReliabilityRing,
  type ReliabilityStallKind,
  type ReliabilityStallSignal,
} from "./reliabilityCenter";

/* ── Stall timeline history (localStorage ring) ─────────────────────────── */

/**
 * Persisted stall timeline row. Subset of {@link ReliabilityStallSignal}
 * without `tier` — ids/titles/reasons only; never secrets or log bodies.
 */
export type StallHistoryEntry = {
  id: string;
  sessionId: string | null;
  title: string | null;
  kind: ReliabilityStallKind;
  stallSeconds: number | null;
  reason: string | null;
  /** Epoch ms. */
  at: number;
};

export const STALL_HISTORY_STORAGE_KEY = "grok.stallHistory";
/** Cap for historical stall signals (localStorage ring, newest first). */
export const STALL_HISTORY_MAX = 40;
/** Cap stored title length — no multi-kb blobs. */
export const STALL_HISTORY_TITLE_MAX = 200;
/** Cap stored reason string. */
export const STALL_HISTORY_REASON_MAX = 120;

/** Fired on `window` after record / clear (detail = entries). */
export const STALL_HISTORY_CHANGE_EVENT = "grok-stall-history-change";

const STALL_KINDS = new Set<ReliabilityStallKind>([
  "active",
  "hard_end",
  "terminal",
  "end_of_turn",
]);

/** Minimal storage surface so unit tests need no jsdom. */
export interface StallHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStallHistoryStorage(): StallHistoryStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

function notifyStallHistoryChange(entries: StallHistoryEntry[]): void {
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(STALL_HISTORY_CHANGE_EVENT, { detail: entries }),
      );
    } catch {
      /* ignore */
    }
  }
}

function capTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\u0000/g, "").trim();
  if (!t) return null;
  return t.slice(0, STALL_HISTORY_TITLE_MAX);
}

function capReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\u0000/g, "").trim();
  if (!t) return null;
  return t.slice(0, STALL_HISTORY_REASON_MAX);
}

function parseAtMs(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }
  if (typeof raw === "string" && raw.trim()) {
    const n = Date.parse(raw);
    if (Number.isFinite(n) && n >= 0) return n;
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && asNum >= 0) return Math.floor(asNum);
  }
  return fallback;
}

/**
 * Normalize one raw object into a StallHistoryEntry, or null if invalid.
 * Only known fields; drops unknown keys that could carry secrets.
 */
export function parseStallHistoryEntry(raw: unknown): StallHistoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const kindRaw = typeof o.kind === "string" ? o.kind.trim() : "";
  if (!STALL_KINDS.has(kindRaw as ReliabilityStallKind)) return null;
  const kind = kindRaw as ReliabilityStallKind;

  const at = parseAtMs(o.at, 0);
  const sidRaw = o.sessionId;
  const sessionId =
    typeof sidRaw === "string"
      ? sidRaw.trim() || null
      : sidRaw == null
        ? null
        : null;

  const idRaw = typeof o.id === "string" ? o.id.trim() : "";
  const id =
    idRaw ||
    (kind === "active"
      ? `hist:active:${sessionId ?? "unknown"}`
      : `hist:${kind}:${sessionId ?? "unknown"}:${at || 0}`);

  let stallSeconds: number | null = null;
  if (typeof o.stallSeconds === "number" && Number.isFinite(o.stallSeconds)) {
    const n = Math.round(o.stallSeconds);
    if (n > 0) stallSeconds = n;
  }

  return {
    id,
    sessionId,
    title: capTitle(o.title),
    kind,
    stallSeconds,
    reason: capReason(o.reason) ?? "stall",
    at: at || 0,
  };
}

/**
 * Parse stored JSON into a clean, newest-first list (capped).
 * Tolerates corrupt / partial data.
 */
export function parseStallHistory(
  raw: unknown,
  max: number = STALL_HISTORY_MAX,
): StallHistoryEntry[] {
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

  const out: StallHistoryEntry[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const e = parseStallHistoryEntry(item);
    if (!e) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
    if (out.length >= Math.max(0, Math.floor(max))) break;
  }
  return out;
}

export function loadStallHistory(
  storage: StallHistoryStorage = defaultStallHistoryStorage(),
  max: number = STALL_HISTORY_MAX,
): StallHistoryEntry[] {
  try {
    return parseStallHistory(
      storage.getItem(STALL_HISTORY_STORAGE_KEY),
      max,
    );
  } catch {
    /* private mode */
    return [];
  }
}

export function saveStallHistory(
  entries: readonly StallHistoryEntry[],
  storage: StallHistoryStorage = defaultStallHistoryStorage(),
  max: number = STALL_HISTORY_MAX,
): void {
  const clean = parseStallHistory(entries, max);
  try {
    storage.setItem(STALL_HISTORY_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    /* private mode / quota */
  }
}

/**
 * Pure ring push: newest first, max length, replace exact id.
 * Soft-active rows share a stable id so repeated soft stalls update in place.
 */
export function pushStallHistory(
  existing: readonly StallHistoryEntry[],
  entry: StallHistoryEntry,
  max: number = STALL_HISTORY_MAX,
): StallHistoryEntry[] {
  const next = parseStallHistoryEntry(entry);
  if (!next) return parseStallHistory(existing, max);
  return prependReliabilityRing(
    parseStallHistory(existing, max),
    next,
    max,
  );
}

/**
 * Record a stall signal into the localStorage ring.
 * Never stores secrets — only id, sessionId, title, kind, stallSeconds, reason, at.
 * Soft `active` stalls use a stable per-session id so the ring is not flooded.
 */
export function recordStallHistory(
  input: {
    id?: string;
    sessionId?: string | null;
    title?: string | null;
    kind: ReliabilityStallKind;
    stallSeconds?: number | null;
    reason?: string | null;
    at?: number;
  },
  storage: StallHistoryStorage = defaultStallHistoryStorage(),
  max: number = STALL_HISTORY_MAX,
): StallHistoryEntry[] {
  if (!STALL_KINDS.has(input.kind)) {
    return loadStallHistory(storage, max);
  }
  const at =
    typeof input.at === "number" && Number.isFinite(input.at)
      ? Math.floor(input.at)
      : Date.now();
  const sessionId =
    typeof input.sessionId === "string"
      ? input.sessionId.trim() || null
      : input.sessionId ?? null;

  const id =
    (typeof input.id === "string" && input.id.trim()) ||
    (input.kind === "active"
      ? `hist:active:${sessionId ?? "unknown"}`
      : `hist:${input.kind}:${sessionId ?? "unknown"}:${at}`);

  const entry = parseStallHistoryEntry({
    id,
    sessionId,
    title: input.title ?? null,
    kind: input.kind,
    stallSeconds: input.stallSeconds ?? null,
    reason: input.reason ?? "stall",
    at,
  });
  if (!entry) return loadStallHistory(storage, max);

  const next = pushStallHistory(loadStallHistory(storage, max), entry, max);
  saveStallHistory(next, storage, max);
  notifyStallHistoryChange(next);
  return next;
}

/**
 * Record from an existing in-memory reliability stall signal.
 * Strips `tier` and re-ids soft-active rows for stable ring replace.
 */
export function recordStallHistoryFromSignal(
  signal: ReliabilityStallSignal,
  storage: StallHistoryStorage = defaultStallHistoryStorage(),
  max: number = STALL_HISTORY_MAX,
): StallHistoryEntry[] {
  return recordStallHistory(
    {
      // Drop live/event ids; history uses its own stable scheme for active.
      sessionId: signal.sessionId,
      title: signal.title,
      kind: signal.kind,
      stallSeconds: signal.stallSeconds,
      reason: signal.reason,
      at: signal.at,
    },
    storage,
    max,
  );
}

/** Kind chip filter for stall history: `"all"` or a concrete kind. */
export type StallHistoryKindFilter = ReliabilityStallKind | "all";

/**
 * Filter history by free-text query and/or kind chip.
 * Empty / whitespace query matches all (still respects kind filter).
 * Query matches title, reason, kind, or session id (case-insensitive substring).
 * `kind` omitted / `"all"` / null means every kind.
 */
export function filterStallHistory(
  entries: readonly StallHistoryEntry[],
  opts?: {
    query?: string | null;
    kind?: StallHistoryKindFilter | null;
  },
): StallHistoryEntry[] {
  const q = (opts?.query ?? "").trim().toLowerCase();
  const kindFilter =
    opts?.kind && opts.kind !== "all" && STALL_KINDS.has(opts.kind)
      ? opts.kind
      : null;

  if (!q && !kindFilter) return entries.slice();

  return entries.filter((e) => {
    if (kindFilter && e.kind !== kindFilter) return false;
    if (!q) return true;
    const title = (e.title || "").toLowerCase();
    const reason = (e.reason || "").toLowerCase();
    const kind = e.kind.toLowerCase();
    const sessionId = (e.sessionId || "").toLowerCase();
    const secs =
      e.stallSeconds != null ? String(e.stallSeconds) : "";
    return (
      title.includes(q) ||
      reason.includes(q) ||
      kind.includes(q) ||
      sessionId.includes(q) ||
      secs.includes(q)
    );
  });
}

/** True when kind chip or free-text query would narrow the list. */
export function hasActiveStallHistoryFilters(opts?: {
  query?: string | null;
  kind?: StallHistoryKindFilter | null;
}): boolean {
  const q = (opts?.query ?? "").trim();
  if (q) return true;
  const kind = opts?.kind;
  return Boolean(kind && kind !== "all" && STALL_KINDS.has(kind));
}

/**
 * Pure clear-all plan for the stall history ring.
 * Never mutates storage; never includes titles/reasons in logMeta.
 */
export type ClearStallHistoryPlan = {
  ok: true;
  /** Rows that would be removed. */
  count: number;
  /** Distinct session ids present (sorted). No titles. */
  sessionIds: string[];
  /** Per-kind counts among rows being cleared. */
  kindCounts: Partial<Record<ReliabilityStallKind, number>>;
  /** Next list after clear (always empty). */
  next: StallHistoryEntry[];
  /** Safe meta for logs — count only. */
  logMeta: { clearedCount: number } | null;
};

/**
 * Plan wiping the stall history ring (pure).
 * Use {@link applyClearStallHistoryPlan} / {@link clearStallHistory} to commit.
 */
export function planClearStallHistory(
  entries: readonly StallHistoryEntry[] | null | undefined,
): ClearStallHistoryPlan {
  const list = Array.isArray(entries) ? parseStallHistory(entries) : [];
  const kindCounts: Partial<Record<ReliabilityStallKind, number>> = {};
  const sessionSet = new Set<string>();
  for (const e of list) {
    kindCounts[e.kind] = (kindCounts[e.kind] ?? 0) + 1;
    if (e.sessionId) sessionSet.add(e.sessionId);
  }
  const count = list.length;
  return {
    ok: true,
    count,
    sessionIds: [...sessionSet].sort(),
    kindCounts,
    next: [],
    logMeta: count > 0 ? { clearedCount: count } : null,
  };
}

/**
 * Apply a clear-all plan to storage and notify listeners.
 * Returns the empty list.
 */
export function applyClearStallHistoryPlan(
  plan: ClearStallHistoryPlan,
  storage: StallHistoryStorage = defaultStallHistoryStorage(),
): StallHistoryEntry[] {
  saveStallHistory(plan.next, storage);
  notifyStallHistoryChange([]);
  return [];
}

/**
 * Wipe the local stall timeline (empty list + notify listeners).
 * Returns the empty list. Safe no-op on storage failure.
 */
export function clearStallHistory(
  storage: StallHistoryStorage = defaultStallHistoryStorage(),
): StallHistoryEntry[] {
  const plan = planClearStallHistory(loadStallHistory(storage));
  return applyClearStallHistoryPlan(plan, storage);
}

/* ── Stall history export (redacted JSON download) ──────────────────────── */

/** One row in a stall-history export file (known fields only; no tier/secrets). */
export type StallHistoryExportSignal = {
  id: string;
  sessionId: string | null;
  title: string | null;
  kind: ReliabilityStallKind;
  stallSeconds: number | null;
  reason: string | null;
  at: number;
};

/**
 * Redacted stall history export (download / clipboard).
 * Structured fields only — titles/reasons re-run through {@link redact}.
 */
export type StallHistoryExport = {
  kind: "stall_history";
  generatedAt: string;
  source: "stall_timeline";
  count: number;
  /** Echo of filters used to select rows (never free-form secrets). */
  filter: {
    query: string | null;
    kind: StallHistoryKindFilter;
  };
  signals: StallHistoryExportSignal[];
};

function redactStallField(
  raw: string | null | undefined,
  max: number,
): string | null {
  if (typeof raw !== "string") return null;
  const t = redact(raw).replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.slice(0, Math.max(0, max));
}

/**
 * Build a download-ready redacted export from stall history rows.
 * Prefer filtered rows from {@link filterStallHistory}. Never invents data.
 */
export function buildStallHistoryExport(
  entries: readonly StallHistoryEntry[],
  opts?: {
    nowMs?: number;
    max?: number;
    generatedAt?: string;
    query?: string | null;
    kind?: StallHistoryKindFilter | null;
  },
): StallHistoryExport {
  const max = Math.max(
    0,
    Math.floor(opts?.max ?? STALL_HISTORY_MAX),
  );
  const generatedAt =
    opts?.generatedAt ??
    new Date(opts?.nowMs ?? Date.now()).toISOString();
  const queryRaw = (opts?.query ?? "").trim();
  const kindFilter: StallHistoryKindFilter =
    opts?.kind && opts.kind !== "all" && STALL_KINDS.has(opts.kind)
      ? opts.kind
      : "all";

  const out: StallHistoryExportSignal[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const parsed = parseStallHistoryEntry(e);
    if (!parsed) continue;
    if (seen.has(parsed.id)) continue;
    seen.add(parsed.id);

    out.push({
      id: parsed.id.slice(0, STALL_HISTORY_TITLE_MAX),
      sessionId: parsed.sessionId,
      title: redactStallField(parsed.title, STALL_HISTORY_TITLE_MAX),
      kind: parsed.kind,
      stallSeconds: parsed.stallSeconds,
      reason: redactStallField(parsed.reason, STALL_HISTORY_REASON_MAX) ?? "stall",
      at: parsed.at,
    });
    if (out.length >= max) break;
  }

  return {
    kind: "stall_history",
    generatedAt,
    source: "stall_timeline",
    count: out.length,
    filter: {
      query: queryRaw ? queryRaw.slice(0, STALL_HISTORY_TITLE_MAX) : null,
      kind: kindFilter,
    },
    signals: out,
  };
}

/** Pretty JSON for client download (known fields only). */
export function serializeStallHistoryExport(
  snapshot: StallHistoryExport,
): string {
  return JSON.stringify(snapshot, null, 2);
}

/** Cap for support-bundle stall timeline rows (UI view is smaller; allow a bit more headroom). */
export const STALL_TIMELINE_SNAPSHOT_MAX = 40;
/** Cap title/reason fields so the zip never carries multi-kb blobs. */
export const STALL_TIMELINE_FIELD_MAX = 200;

/** One row in the support-bundle stall timeline (known fields only). */
export type StallTimelineSnapshotSignal = {
  id: string;
  sessionId: string | null;
  title: string | null;
  kind: ReliabilityStallKind;
  stallSeconds: number | null;
  tier: string | null;
  reason: string | null;
  at: number;
};

/**
 * Redacted stall timeline for support zip export.
 * Never includes secrets, log bodies, or free-form diagnostic dumps —
 * only structured stall fields already shown in Reliability center.
 */
export type StallTimelineSnapshot = {
  kind: "stall_timeline";
  generatedAt: string;
  source: "reliability_center";
  count: number;
  signals: StallTimelineSnapshotSignal[];
};

const STALL_TIMELINE_KINDS = new Set<ReliabilityStallKind>([
  "active",
  "hard_end",
  "terminal",
  "end_of_turn",
]);

function capStallField(raw: unknown, max: number = STALL_TIMELINE_FIELD_MAX): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\u0000/g, "").trim();
  if (!t) return null;
  return t.slice(0, Math.max(0, max));
}

/**
 * Build a support-bundle-ready stall timeline from Reliability center signals.
 * Drops unknown kinds / empty ids; caps title/reason/tier; never invents data.
 */
export function buildStallTimelineSnapshot(
  signals: readonly ReliabilityStallSignal[],
  opts?: {
    nowMs?: number;
    max?: number;
    generatedAt?: string;
  },
): StallTimelineSnapshot {
  const max = Math.max(
    0,
    Math.floor(opts?.max ?? STALL_TIMELINE_SNAPSHOT_MAX),
  );
  const generatedAt =
    opts?.generatedAt ??
    new Date(opts?.nowMs ?? Date.now()).toISOString();

  const out: StallTimelineSnapshotSignal[] = [];
  const seen = new Set<string>();
  for (const s of signals) {
    if (!s || typeof s !== "object") continue;
    const kind = s.kind;
    if (!STALL_TIMELINE_KINDS.has(kind)) continue;
    const id = typeof s.id === "string" ? s.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const sidRaw = s.sessionId;
    const sessionId =
      typeof sidRaw === "string"
        ? sidRaw.trim() || null
        : sidRaw == null
          ? null
          : null;

    let stallSeconds: number | null = null;
    if (typeof s.stallSeconds === "number" && Number.isFinite(s.stallSeconds)) {
      const n = Math.round(s.stallSeconds);
      if (n > 0) stallSeconds = n;
    }

    const at =
      typeof s.at === "number" && Number.isFinite(s.at) && s.at >= 0
        ? Math.floor(s.at)
        : 0;

    out.push({
      id: id.slice(0, STALL_TIMELINE_FIELD_MAX),
      sessionId,
      title: capStallField(s.title),
      kind,
      stallSeconds,
      tier: capStallField(s.tier, 64),
      reason: capStallField(s.reason, 120) ?? "stall",
      at,
    });
    if (out.length >= max) break;
  }

  return {
    kind: "stall_timeline",
    generatedAt,
    source: "reliability_center",
    count: out.length,
    signals: out,
  };
}

/** JSON string for Host `export_support_bundle` (pretty, known fields only). */
export function serializeStallTimelineSnapshot(
  snapshot: StallTimelineSnapshot,
): string {
  return JSON.stringify(snapshot, null, 2);
}
