/**
 * Cross-session tool / permission audit ledger — pure types + parse/filter.
 *
 * Host persists append-only JSONL under `{app_data}/audit/tool_ledger.jsonl`.
 * This module normalizes host payloads for Reliability UI (no secrets).
 */

export type AuditLedgerEvent = "permission" | "tool_start" | "tool_end";

export type AuditLedgerOutcome = "ok" | "err";

export type AuditLedgerEntry = {
  /** ISO-8601 timestamp from host. */
  ts: string;
  sessionId?: string | null;
  projectPath?: string | null;
  toolName: string;
  event: AuditLedgerEvent;
  /** Permission decision when event === "permission". */
  permission?: string | null;
  /** Tool outcome when event === "tool_end". */
  outcome?: AuditLedgerOutcome | string | null;
  /** Redacted short summary. */
  summary?: string | null;
};

export const AUDIT_LEDGER_EVENTS = [
  "permission",
  "tool_start",
  "tool_end",
] as const satisfies readonly AuditLedgerEvent[];

export const AUDIT_LEDGER_DEFAULT_LIMIT = 200;
export const AUDIT_LEDGER_MAX_LIMIT = 1000;
/** Cap free-form summary in UI filters / export preview. */
export const AUDIT_LEDGER_SUMMARY_MAX = 240;
export const AUDIT_LEDGER_FIELD_MAX = 120;

/**
 * Retention presets (days). `0` = unlimited (keep until size rotate / clear).
 * Host applies on write/rotate and explicit prune.
 */
export const AUDIT_LEDGER_RETENTION_UNLIMITED = 0;
export const AUDIT_LEDGER_RETENTION_PRESETS = [7, 30, 90, 0] as const;
export type AuditLedgerRetentionDays =
  (typeof AUDIT_LEDGER_RETENTION_PRESETS)[number];

/** Normalize retention to a known preset; unknown → unlimited. */
export function normalizeAuditRetentionDays(
  raw: unknown,
): AuditLedgerRetentionDays {
  const n =
    typeof raw === "number"
      ? Math.floor(raw)
      : typeof raw === "string" && raw.trim()
        ? Math.floor(Number(raw))
        : NaN;
  if (n === 7 || n === 30 || n === 90) return n;
  return AUDIT_LEDGER_RETENTION_UNLIMITED;
}

/** Pure: drop entries older than retention window (unparseable ts kept). */
export function pruneAuditLedgerEntries(
  entries: readonly AuditLedgerEntry[],
  retentionDays: unknown,
  nowMs: number = Date.now(),
): AuditLedgerEntry[] {
  const days = normalizeAuditRetentionDays(retentionDays);
  if (days === AUDIT_LEDGER_RETENTION_UNLIMITED) return [...entries];
  const cutoff = nowMs - days * 86_400_000;
  return entries.filter((e) => {
    const ms = auditLedgerTsMs(e);
    if (ms === 0 && !Number.isFinite(Date.parse(e.ts))) return true;
    return ms >= cutoff;
  });
}

const EVENT_SET = new Set<string>(AUDIT_LEDGER_EVENTS);

/** Soft clamp for list limits (mirrors host). */
export function normalizeAuditLedgerLimit(
  raw: number | null | undefined,
  fallback = AUDIT_LEDGER_DEFAULT_LIMIT,
): number {
  if (raw == null || !Number.isFinite(raw)) return fallback;
  const n = Math.floor(raw);
  if (n < 1) return 1;
  if (n > AUDIT_LEDGER_MAX_LIMIT) return AUDIT_LEDGER_MAX_LIMIT;
  return n;
}

function scrubField(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  // Drop C0 controls except tab/newline; trim.
  let s = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  if (!s) return "";
  if (s.length > max) s = s.slice(0, max);
  return s;
}

/**
 * Normalize one raw host/object row into an AuditLedgerEntry, or null if invalid.
 * Only known events; drops free-form junk that could carry secrets.
 */
export function parseAuditLedgerEntry(raw: unknown): AuditLedgerEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const eventRaw =
    typeof o.event === "string"
      ? o.event.trim()
      : typeof (o as { event_type?: unknown }).event_type === "string"
        ? String((o as { event_type: string }).event_type).trim()
        : "";
  if (!EVENT_SET.has(eventRaw)) return null;
  const event = eventRaw as AuditLedgerEvent;

  const toolName =
    scrubField(o.toolName ?? o.tool_name, AUDIT_LEDGER_FIELD_MAX) || "unknown";

  const tsRaw =
    typeof o.ts === "string"
      ? o.ts.trim()
      : typeof o.timestamp === "string"
        ? o.timestamp.trim()
        : "";
  const ts = tsRaw || new Date(0).toISOString();

  const sessionId =
    scrubField(o.sessionId ?? o.session_id, AUDIT_LEDGER_FIELD_MAX) || null;
  const projectPath =
    scrubField(o.projectPath ?? o.project_path, 512) || null;
  const permission =
    scrubField(o.permission, AUDIT_LEDGER_FIELD_MAX) || null;
  const outcomeRaw = scrubField(o.outcome, AUDIT_LEDGER_FIELD_MAX) || null;
  const summary =
    scrubField(o.summary, AUDIT_LEDGER_SUMMARY_MAX) || null;

  return {
    ts,
    toolName,
    event,
    ...(sessionId ? { sessionId } : {}),
    ...(projectPath ? { projectPath } : {}),
    ...(permission ? { permission } : {}),
    ...(outcomeRaw ? { outcome: outcomeRaw } : {}),
    ...(summary ? { summary } : {}),
  };
}

/** Parse a JSON array or JSONL string into newest-first entries (capped). */
export function parseAuditLedgerList(
  raw: unknown,
  max = AUDIT_LEDGER_DEFAULT_LIMIT,
): AuditLedgerEntry[] {
  const lim = normalizeAuditLedgerLimit(max);
  let list: unknown[] = [];

  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    // Prefer JSON array; fall back to JSONL.
    if (t.startsWith("[")) {
      try {
        const parsed = JSON.parse(t) as unknown;
        if (Array.isArray(parsed)) list = parsed;
      } catch {
        return [];
      }
    } else {
      list = t.split(/\r?\n/).filter((l) => l.trim());
      // JSONL is chronological; reverse to newest-first after parse.
      const out: AuditLedgerEntry[] = [];
      for (let i = list.length - 1; i >= 0; i--) {
        const line = list[i];
        if (typeof line !== "string") continue;
        try {
          const e = parseAuditLedgerEntry(JSON.parse(line));
          if (e) {
            out.push(e);
            if (out.length >= lim) break;
          }
        } catch {
          /* skip bad line */
        }
      }
      return out;
    }
  } else if (Array.isArray(raw)) {
    list = raw;
  } else {
    return [];
  }

  const out: AuditLedgerEntry[] = [];
  for (const item of list) {
    const e =
      typeof item === "string"
        ? (() => {
            try {
              return parseAuditLedgerEntry(JSON.parse(item));
            } catch {
              return null;
            }
          })()
        : parseAuditLedgerEntry(item);
    if (!e) continue;
    out.push(e);
    if (out.length >= lim) break;
  }
  return out;
}

export type AuditLedgerFilter = {
  query?: string;
  event?: AuditLedgerEvent | "all";
  sessionId?: string | null;
  toolName?: string | null;
  /**
   * Inclusive lower bound epoch ms, or date-only `YYYY-MM-DD` / RFC3339 string.
   * Date-only → start of that UTC day.
   */
  fromMs?: number | null;
  fromTs?: string | null;
  /**
   * Inclusive upper bound epoch ms, or date-only / RFC3339 string.
   * Date-only → end of that UTC day.
   */
  toMs?: number | null;
  toTs?: string | null;
};

/** Parse a filter bound into epoch ms. Date-only uses start-of-day UTC. */
export function parseAuditLedgerBoundMs(
  raw: string | number | null | undefined,
  endOfDay = false,
): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  const s = raw.trim();
  if (!s) return null;
  // Date-only YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const base = Date.parse(`${s}T00:00:00.000Z`);
    if (!Number.isFinite(base)) return null;
    return endOfDay ? base + 86_400_000 - 1 : base;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/**
 * Filter entries (already newest-first). Case-insensitive substring match on
 * toolName, summary, permission, sessionId, projectPath. Optional exact
 * sessionId, event kind, and inclusive date range.
 */
export function filterAuditLedger(
  entries: readonly AuditLedgerEntry[],
  filter: AuditLedgerFilter = {},
): AuditLedgerEntry[] {
  const event = filter.event && filter.event !== "all" ? filter.event : null;
  const q = (filter.query ?? "").trim().toLowerCase();
  const sid = (filter.sessionId ?? "").trim().toLowerCase();
  const tool = (filter.toolName ?? "").trim().toLowerCase();
  const fromMs =
    filter.fromMs != null && Number.isFinite(filter.fromMs)
      ? filter.fromMs
      : parseAuditLedgerBoundMs(filter.fromTs, false);
  const toMs =
    filter.toMs != null && Number.isFinite(filter.toMs)
      ? filter.toMs
      : parseAuditLedgerBoundMs(filter.toTs, true);

  return entries.filter((e) => {
    if (event && e.event !== event) return false;
    if (sid && (e.sessionId ?? "").toLowerCase() !== sid) return false;
    if (tool && !e.toolName.toLowerCase().includes(tool)) return false;
    if (fromMs != null || toMs != null) {
      const ms = auditLedgerTsMs(e);
      if (ms === 0 && !Number.isFinite(Date.parse(e.ts))) return false;
      if (fromMs != null && ms < fromMs) return false;
      if (toMs != null && ms > toMs) return false;
    }
    if (!q) return true;
    const hay = [
      e.toolName,
      e.summary ?? "",
      e.permission ?? "",
      e.outcome ?? "",
      e.sessionId ?? "",
      e.projectPath ?? "",
      e.event,
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

/** Host export filter payload (camelCase). */
export type AuditLedgerExportFilter = {
  event?: string | null;
  sessionId?: string | null;
  fromTs?: string | null;
  toTs?: string | null;
};

/** Build host filter from UI filter (omits empty / all). */
export function toAuditLedgerExportFilter(
  filter: AuditLedgerFilter = {},
): AuditLedgerExportFilter {
  const out: AuditLedgerExportFilter = {};
  if (filter.event && filter.event !== "all") out.event = filter.event;
  const sid = (filter.sessionId ?? "").trim();
  if (sid) out.sessionId = sid;
  const from =
    (filter.fromTs ?? "").trim() ||
    (filter.fromMs != null && Number.isFinite(filter.fromMs)
      ? new Date(filter.fromMs).toISOString()
      : "");
  const to =
    (filter.toTs ?? "").trim() ||
    (filter.toMs != null && Number.isFinite(filter.toMs)
      ? new Date(filter.toMs).toISOString()
      : "");
  if (from) out.fromTs = from;
  if (to) out.toTs = to;
  return out;
}

/** True when export filter has any constraint. */
export function auditLedgerExportFilterActive(
  filter: AuditLedgerExportFilter,
): boolean {
  return !!(
    (filter.event && filter.event !== "all") ||
    (filter.sessionId && filter.sessionId.trim()) ||
    (filter.fromTs && filter.fromTs.trim()) ||
    (filter.toTs && filter.toTs.trim())
  );
}

/** Stable sort key: epoch ms from ts (0 on parse fail). */
export function auditLedgerTsMs(entry: AuditLedgerEntry): number {
  const t = Date.parse(entry.ts);
  return Number.isFinite(t) ? t : 0;
}

/** One-line preview for list rows (no secrets — summary already redacted). */
export function formatAuditLedgerRow(entry: AuditLedgerEntry): string {
  const parts: string[] = [entry.event, entry.toolName];
  if (entry.permission) parts.push(entry.permission);
  if (entry.outcome) parts.push(entry.outcome);
  if (entry.summary) parts.push(entry.summary);
  return parts.join(" · ");
}

/** Serialize entries as redacted JSONL (chronological: oldest first). */
export function serializeAuditLedgerJsonl(
  entries: readonly AuditLedgerEntry[],
): string {
  // UI lists newest first; export chronological.
  const chrono = [...entries].sort(
    (a, b) => auditLedgerTsMs(a) - auditLedgerTsMs(b),
  );
  const lines: string[] = [];
  for (const e of chrono) {
    const clean = parseAuditLedgerEntry(e);
    if (!clean) continue;
    lines.push(JSON.stringify(clean));
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}

/** i18n key suffix for event type (`reliability.audit.event.*`). */
export function auditLedgerEventKey(
  event: AuditLedgerEvent,
):
  | "reliability.audit.event.permission"
  | "reliability.audit.event.toolStart"
  | "reliability.audit.event.toolEnd" {
  switch (event) {
    case "permission":
      return "reliability.audit.event.permission";
    case "tool_start":
      return "reliability.audit.event.toolStart";
    case "tool_end":
      return "reliability.audit.event.toolEnd";
    default:
      return "reliability.audit.event.toolEnd";
  }
}
