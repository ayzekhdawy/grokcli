/**
 * Pure helpers for MCP server health / auth status from Doctor reports.
 *
 * Never surfaces raw secrets or tokens — only redacted status tones and
 * short guidance for refresh. No fake auto-refresh; CLI has none.
 */

import { redact } from "@/lib/redact";

/** Status tones for MCP list lamps / badges. */
export type McpStatusTone =
  | "ok"
  | "warn"
  | "error"
  | "unknown"
  | "auth_expired"
  | "auth_required";

/** Normalized per-server status consumed by Extensions → MCP. */
export type McpServerStatus = {
  name: string;
  tone: McpStatusTone;
  /** Short redacted reason for UI (one line). */
  reason: string | null;
  /** True when tone is auth_expired or auth_required. */
  needsAuthRefresh: boolean;
  /** Redacted issue / check detail lines mapped to this server. */
  issues: string[];
  /** From doctor when present. */
  healthy: boolean | null;
};

/** Loose doctor server shape (host or fixture). */
export type McpDoctorServerLike = {
  name?: string | null;
  healthy?: boolean | null;
  status?: string | null;
  transport?: string | null;
  target?: string | null;
  checks?: Array<{
    label?: string | null;
    passed?: boolean | null;
    detail?: string | null;
    hint?: string | null;
    message?: string | null;
  }> | null;
  issues?: Array<string | Record<string, unknown>> | null;
  error?: string | null;
  message?: string | null;
  [key: string]: unknown;
};

/** Loose top-level issue entry. */
export type McpDoctorIssueLike = {
  name?: string | null;
  server?: string | null;
  serverName?: string | null;
  message?: string | null;
  detail?: string | null;
  summary?: string | null;
  level?: string | null;
  status?: string | null;
  [key: string]: unknown;
};

/** Loose doctor report envelope. */
export type McpDoctorReportLike = {
  ok?: boolean | null;
  servers?: McpDoctorServerLike[] | null;
  issues?: Array<string | McpDoctorIssueLike> | null;
  summary?:
    | string
    | {
        healthy?: number | null;
        unhealthy?: number | null;
        total?: number | null;
        message?: string | null;
        text?: string | null;
        [key: string]: unknown;
      }
    | null;
  message?: string | null;
  error?: string | null;
  rawText?: string | null;
  [key: string]: unknown;
};

/** Map of server name (trimmed, case-sensitive as reported) → status. */
export type McpStatusIndex = Map<string, McpServerStatus>;

const AUTH_EXPIRED_RE =
  /\b(expired|token\s+expir|credential[s]?\s+expir|session\s+expir|auth(?:entication)?\s+expir)\b/i;
const AUTH_REQUIRED_RE =
  /\b(unauthorized|unauthorised|401|403|auth(?:entication|orization)?\s+required|oauth\s+authorization\s+required|AuthorizationRequired|AuthRequired|not\s+authenticated|login\s+required|re[- ]?auth|invalid\s+token|missing\s+token|access\s+denied|forbidden)\b/i;
const AUTHISH_RE = /\b(token|auth(?:entication|orization)?|credential[s]?|bearer|oauth|api[_-]?key)\b/i;
const WARN_RE = /\b(warn(?:ing)?|degraded|slow|timeout|timed\s+out|retry)\b/i;
const ERROR_RE =
  /\b(error|fail(?:ed|ure)?|crash|unreachable|refused|econnrefused|enotfound|fatal)\b/i;

/** KEY=value / secret-like blobs that should never appear in UI. */
const ENV_PAIR_RE =
  /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|PASS|AUTH|CREDENTIAL)[A-Z0-9_]*)\s*=\s*([^\s"'`;]+)/gi;
const GENERIC_SECRET_RE =
  /\b((?:sk|xai|ghp|gho|ghu|ghs|ghr)-[A-Za-z0-9._-]{8,}|Bearer\s+[A-Za-z0-9\-._~+/]+=*)\b/gi;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t || null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return null;
}

/**
 * Redact secrets and env values from doctor detail text before display.
 * Safe to call on any free-form doctor string.
 */
export function redactMcpText(text: string | null | undefined): string {
  if (!text) return "";
  let out = String(text);
  out = out.replace(ENV_PAIR_RE, "$1=[REDACTED]");
  out = out.replace(GENERIC_SECRET_RE, "[REDACTED]");
  out = redact(out);
  return out;
}

/** Collect free-form text blobs from a value (string / object / array). */
function collectTextBlobs(v: unknown, into: string[], depth = 0): void {
  if (depth > 4 || v == null) return;
  if (typeof v === "string") {
    const t = v.trim();
    if (t) into.push(t);
    return;
  }
  if (typeof v === "number" || typeof v === "boolean") {
    into.push(String(v));
    return;
  }
  if (Array.isArray(v)) {
    for (const item of v) collectTextBlobs(item, into, depth + 1);
    return;
  }
  if (isRecord(v)) {
    for (const [k, val] of Object.entries(v)) {
      // Skip obvious secret containers by key name.
      if (/token|secret|password|api[_-]?key|credential|authorization/i.test(k)) {
        continue;
      }
      collectTextBlobs(val, into, depth + 1);
    }
  }
}

/**
 * Detect auth-related tone from free text (case-insensitive).
 * Priority: auth_expired > auth_required > null.
 */
export function detectAuthToneFromText(
  text: string | null | undefined,
): "auth_expired" | "auth_required" | null {
  if (!text) return null;
  if (AUTH_EXPIRED_RE.test(text)) return "auth_expired";
  if (AUTH_REQUIRED_RE.test(text)) return "auth_required";
  // Generic token/auth mention without explicit expired/required is still auth_required
  // when combined with failure language (caller may pass failed-check text only).
  if (AUTHISH_RE.test(text) && ERROR_RE.test(text)) return "auth_required";
  if (AUTHISH_RE.test(text) && /\b(invalid|missing|denied|reject)/i.test(text)) {
    return "auth_required";
  }
  return null;
}

/**
 * Infer tone from a bag of text fragments + optional healthy flag.
 */
export function inferMcpStatusTone(
  texts: string[],
  healthy?: boolean | null,
): McpStatusTone {
  const joined = texts.filter(Boolean).join(" \n ");
  const auth = detectAuthToneFromText(joined);
  if (auth) return auth;

  if (healthy === true) {
    if (WARN_RE.test(joined)) return "warn";
    return "ok";
  }
  if (healthy === false) {
    if (ERROR_RE.test(joined) || joined.length > 0) return "error";
    return "error";
  }

  // No healthy flag — derive from keywords only.
  if (ERROR_RE.test(joined)) return "error";
  if (WARN_RE.test(joined)) return "warn";
  if (joined.length === 0) return "unknown";
  return "unknown";
}

function issueServerName(issue: string | McpDoctorIssueLike): string | null {
  if (typeof issue === "string") return null;
  return (
    asString(issue.serverName) ||
    asString(issue.server) ||
    asString(issue.name) ||
    null
  );
}

function issueText(issue: string | McpDoctorIssueLike): string {
  if (typeof issue === "string") return issue.trim();
  const parts = [
    asString(issue.message),
    asString(issue.detail),
    asString(issue.summary),
    asString(issue.status),
    asString(issue.level),
  ].filter(Boolean) as string[];
  return parts.join(" — ");
}

/**
 * Map top-level doctor issues onto server names when possible.
 * Unscoped issues go under key `""`.
 */
export function mapIssuesToServers(
  issues: Array<string | McpDoctorIssueLike> | null | undefined,
  knownServerNames: string[] = [],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const push = (key: string, text: string) => {
    const t = redactMcpText(text).trim();
    if (!t) return;
    const list = out.get(key) ?? [];
    list.push(t);
    out.set(key, list);
  };

  const knownLower = new Map(
    knownServerNames
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => [n.toLowerCase(), n] as const),
  );

  for (const issue of issues ?? []) {
    const text = issueText(issue);
    if (!text) continue;
    let name = issueServerName(issue);
    if (!name && knownLower.size > 0) {
      // Best-effort: issue text mentions a known server name.
      const lower = text.toLowerCase();
      for (const [k, original] of knownLower) {
        if (lower.includes(k)) {
          name = original;
          break;
        }
      }
    }
    push(name?.trim() || "", text);
  }
  return out;
}

function textsFromServer(server: McpDoctorServerLike): string[] {
  const texts: string[] = [];
  if (server.status) texts.push(String(server.status));
  if (server.error) texts.push(String(server.error));
  if (server.message) texts.push(String(server.message));
  for (const c of server.checks ?? []) {
    if (!c) continue;
    if (c.label) texts.push(String(c.label));
    if (c.detail) texts.push(String(c.detail));
    if (c.hint) texts.push(String(c.hint));
    if (c.message) texts.push(String(c.message));
    // Failed checks matter more for keyword scan — still include all text.
  }
  for (const issue of server.issues ?? []) {
    if (typeof issue === "string") texts.push(issue);
    else collectTextBlobs(issue, texts);
  }
  return texts;
}

function issuesFromServer(server: McpDoctorServerLike): string[] {
  const out: string[] = [];
  for (const c of server.checks ?? []) {
    if (!c || c.passed === true) continue;
    const line = [c.label, c.detail, c.hint, c.message]
      .map((x) => (x == null ? "" : String(x).trim()))
      .filter(Boolean)
      .join(" — ");
    const redacted = redactMcpText(line).trim();
    if (redacted) out.push(redacted);
  }
  for (const issue of server.issues ?? []) {
    const t =
      typeof issue === "string"
        ? redactMcpText(issue)
        : redactMcpText(issueText(issue as McpDoctorIssueLike));
    if (t.trim()) out.push(t.trim());
  }
  if (server.error) {
    const t = redactMcpText(String(server.error)).trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * Derive status for one doctor server row.
 */
export function statusFromDoctorServer(
  server: McpDoctorServerLike | null | undefined,
  extraIssues: string[] = [],
): McpServerStatus | null {
  if (!server) return null;
  const name = asString(server.name);
  if (!name) return null;

  const texts = [...textsFromServer(server), ...extraIssues];
  const healthy =
    typeof server.healthy === "boolean" ? server.healthy : null;
  // Also accept status string "ok" / "healthy" / "error" etc.
  let healthyFlag = healthy;
  if (healthyFlag == null && server.status) {
    const st = String(server.status).trim().toLowerCase();
    if (["ok", "healthy", "pass", "passed", "up"].includes(st)) {
      healthyFlag = true;
    } else if (
      ["error", "fail", "failed", "unhealthy", "down", "bad"].includes(st)
    ) {
      healthyFlag = false;
    }
  }

  const tone = inferMcpStatusTone(texts, healthyFlag);
  const issues = [
    ...issuesFromServer(server),
    ...extraIssues.map((x) => redactMcpText(x).trim()).filter(Boolean),
  ];
  // Deduplicate while preserving order.
  const seen = new Set<string>();
  const uniqueIssues: string[] = [];
  for (const i of issues) {
    if (seen.has(i)) continue;
    seen.add(i);
    uniqueIssues.push(i);
  }

  const reason =
    uniqueIssues[0] ??
    (tone === "ok"
      ? null
      : tone === "auth_expired"
        ? "Auth expired"
        : tone === "auth_required"
          ? "Auth required"
          : tone === "error"
            ? "Unhealthy"
            : tone === "warn"
              ? "Warning"
              : null);

  return {
    name,
    tone,
    reason: reason ? redactMcpText(reason).slice(0, 240) : null,
    needsAuthRefresh: tone === "auth_expired" || tone === "auth_required",
    issues: uniqueIssues.slice(0, 12),
    healthy: healthyFlag,
  };
}

/**
 * Build a name → status index from a full doctor report.
 * Maps top-level issues onto servers by name when possible.
 */
export function indexDoctorServerStatuses(
  report: McpDoctorReportLike | null | undefined,
): McpStatusIndex {
  const index: McpStatusIndex = new Map();
  if (!report) return index;

  const servers = Array.isArray(report.servers) ? report.servers : [];
  const knownNames = servers
    .map((s) => asString(s?.name) ?? "")
    .filter(Boolean);

  // Summary / envelope text for unscoped keyword detection.
  const summaryTexts: string[] = [];
  if (typeof report.summary === "string") {
    summaryTexts.push(report.summary);
  } else if (isRecord(report.summary)) {
    collectTextBlobs(report.summary, summaryTexts);
  }
  if (report.message) summaryTexts.push(String(report.message));
  if (report.error) summaryTexts.push(String(report.error));
  if (report.rawText) summaryTexts.push(String(report.rawText));

  const issueMap = mapIssuesToServers(report.issues ?? null, knownNames);

  for (const server of servers) {
    const name = asString(server?.name);
    if (!name) continue;
    const extra = [
      ...(issueMap.get(name) ?? []),
      // Case-insensitive issue map fallback
      ...[...issueMap.entries()]
        .filter(
          ([k]) => k && k !== name && k.toLowerCase() === name.toLowerCase(),
        )
        .flatMap(([, v]) => v),
    ];
    const status = statusFromDoctorServer(server, extra);
    if (status) index.set(name, status);
  }

  // Issues for unknown servers → synthetic error/auth rows.
  for (const [name, texts] of issueMap) {
    if (!name || index.has(name)) continue;
    const tone = inferMcpStatusTone(texts, false);
    index.set(name, {
      name,
      tone,
      reason: texts[0] ? redactMcpText(texts[0]).slice(0, 240) : null,
      needsAuthRefresh: tone === "auth_expired" || tone === "auth_required",
      issues: texts.map((t) => redactMcpText(t)).filter(Boolean).slice(0, 12),
      healthy: false,
    });
  }

  // If report has only summary-level auth problems and a single server, fold in.
  if (index.size === 1 && summaryTexts.length > 0) {
    const only = [...index.values()][0]!;
    const auth = detectAuthToneFromText(summaryTexts.join("\n"));
    if (auth && only.tone !== "auth_expired" && only.tone !== "auth_required") {
      index.set(only.name, {
        ...only,
        tone: auth,
        needsAuthRefresh: true,
        reason: only.reason ?? (auth === "auth_expired" ? "Auth expired" : "Auth required"),
      });
    }
  }

  return index;
}

/**
 * Lookup status for a list server name (exact then case-insensitive).
 */
export function lookupServerStatus(
  index: McpStatusIndex | null | undefined,
  name: string | null | undefined,
): McpServerStatus | null {
  if (!index || !name?.trim()) return null;
  const n = name.trim();
  if (index.has(n)) return index.get(n) ?? null;
  const lower = n.toLowerCase();
  for (const [k, v] of index) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

/** i18n key for a status tone badge label. */
export function mcpStatusLabelKey(tone: McpStatusTone): string {
  switch (tone) {
    case "ok":
      return "ext.mcp.status.ok";
    case "warn":
      return "ext.mcp.status.warn";
    case "error":
      return "ext.mcp.status.error";
    case "auth_expired":
      return "ext.mcp.status.authExpired";
    case "auth_required":
      return "ext.mcp.status.authRequired";
    case "unknown":
    default:
      return "ext.mcp.status.unknown";
  }
}

/** CSS modifier for ext-badge / lamp: ok | warn | fail | auth | muted */
export function mcpStatusBadgeMod(
  tone: McpStatusTone,
): "ok" | "warn" | "fail" | "auth" | "muted" {
  switch (tone) {
    case "ok":
      return "ok";
    case "warn":
      return "warn";
    case "error":
      return "fail";
    case "auth_expired":
    case "auth_required":
      return "auth";
    case "unknown":
    default:
      return "muted";
  }
}

/**
 * Short guidance key for auth tones (inline under the row).
 */
export function mcpAuthGuidanceKey(
  tone: McpStatusTone,
): "ext.mcp.auth.expiredHint" | "ext.mcp.auth.requiredHint" | null {
  if (tone === "auth_expired") return "ext.mcp.auth.expiredHint";
  if (tone === "auth_required") return "ext.mcp.auth.requiredHint";
  return null;
}

// ---------------------------------------------------------------------------
// Inspect-row health (McpStatusModal) — from compatibilityStatus / transport
// Never invents servers; empty list stays empty. Auth-ish tones collapse to
// "error" for the four-chip filter bar (all / ok / warn / error / unknown).
// ---------------------------------------------------------------------------

/** Coarse health for inspect MCP rows (chips in the status modal). */
export type McpRowHealth = "ok" | "warn" | "error" | "unknown";

/** Inspect-shaped server row (name + optional meta). */
export type McpRowLike = {
  name?: string | null;
  transport?: string | null;
  target?: string | null;
  vendor?: string | null;
  compatibilityStatus?: string | null;
};

/** Status chip filter values for the MCP modal. */
export type McpRowStatusFilter = "all" | McpRowHealth;

/** Ordered chip list: all · ok · warn · error · unknown. */
export const MCP_ROW_STATUS_FILTERS: readonly McpRowStatusFilter[] = [
  "all",
  "ok",
  "warn",
  "error",
  "unknown",
] as const;

const COMPAT_OK = new Set([
  "ok",
  "healthy",
  "compatible",
  "pass",
  "passed",
  "up",
  "supported",
  "ready",
  "good",
  "success",
  "available",
]);
const COMPAT_WARN = new Set([
  "warn",
  "warning",
  "degraded",
  "partial",
  "slow",
  "limited",
]);
const COMPAT_ERROR = new Set([
  "error",
  "fail",
  "failed",
  "unhealthy",
  "down",
  "bad",
  "incompatible",
  "broken",
  "unsupported",
  "disabled",
  "offline",
  "unreachable",
]);

/** Collapse doctor/auth tones into the four modal chip buckets. */
export function mcpRowHealthFromTone(tone: McpStatusTone): McpRowHealth {
  switch (tone) {
    case "ok":
      return "ok";
    case "warn":
      return "warn";
    case "error":
    case "auth_expired":
    case "auth_required":
      return "error";
    case "unknown":
    default:
      return "unknown";
  }
}

/**
 * Classify one inspect MCP row for modal lamps / chips.
 *
 * Priority: `compatibilityStatus` tokens → free-text tone on status →
 * free-text tone on `transport` → `unknown`. Presence of transport alone
 * does **not** imply healthy (no invented ok).
 */
export function classifyMcpRowHealth(
  row: McpRowLike | null | undefined,
): McpRowHealth {
  if (!row) return "unknown";
  const status = (row.compatibilityStatus ?? "").trim();
  if (status) {
    const lower = status.toLowerCase();
    if (COMPAT_OK.has(lower)) return "ok";
    if (COMPAT_WARN.has(lower)) return "warn";
    if (COMPAT_ERROR.has(lower)) return "error";
    // Multi-word / free-form compatibility strings.
    return mcpRowHealthFromTone(inferMcpStatusTone([status], null));
  }
  const transport = (row.transport ?? "").trim();
  if (transport) {
    const tone = inferMcpStatusTone([transport], null);
    // Transport labels like "stdio" / "http" yield unknown — keep that.
    // Only promote when transport string itself carries health keywords.
    if (tone !== "unknown") return mcpRowHealthFromTone(tone);
  }
  return "unknown";
}

/** Per-health counts plus total under `all`. */
export type McpRowHealthCounts = Record<McpRowStatusFilter, number>;

/** Count rows per health tone (and total under `all`). */
export function countMcpRowsByHealth(
  rows: readonly McpRowLike[],
): McpRowHealthCounts {
  const counts: McpRowHealthCounts = {
    all: rows.length,
    ok: 0,
    warn: 0,
    error: 0,
    unknown: 0,
  };
  for (const r of rows) {
    counts[classifyMcpRowHealth(r)] += 1;
  }
  return counts;
}

/** Combined MCP modal list filters (status chip + free text). */
export interface McpRowFilter {
  /** Free-text over name, transport, target, vendor, status, health. */
  query?: string;
  /** Status chip; default `"all"`. */
  status?: McpRowStatusFilter;
}

/**
 * Match a row against a free-text query (case-insensitive substring).
 * Empty query matches everything.
 */
export function matchMcpRowQuery(
  row: McpRowLike,
  query: string | null | undefined,
): boolean {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return true;
  const health = classifyMcpRowHealth(row);
  const hay = [
    row.name ?? "",
    row.transport ?? "",
    row.target ?? "",
    row.vendor ?? "",
    row.compatibilityStatus ?? "",
    health,
  ]
    .join("\n")
    .toLowerCase();
  return hay.includes(q);
}

/**
 * Filter inspect MCP rows by free-text query and/or status chip.
 * Filters combine with AND. Does not invent rows.
 */
export function filterMcpRows<T extends McpRowLike>(
  rows: readonly T[],
  filter: McpRowFilter | string = {},
): T[] {
  const opts: McpRowFilter =
    typeof filter === "string" ? { query: filter } : filter ?? {};
  const status = opts.status ?? "all";
  let out: T[] = rows as T[];
  if (status !== "all") {
    out = out.filter((r) => classifyMcpRowHealth(r) === status);
  }
  const q = (opts.query ?? "").trim();
  if (!q) return out;
  return out.filter((r) => matchMcpRowQuery(r, q));
}

/** Preferred clipboard text for a row: target when present, else name. */
export function mcpRowCopyText(
  row: McpRowLike | null | undefined,
  field: "name" | "target" | "auto" = "auto",
): string {
  if (!row) return "";
  const name = (row.name ?? "").trim();
  const target = (row.target ?? "").trim();
  if (field === "name") return name;
  if (field === "target") return target;
  return target || name;
}

// ── Flat doctor finding rows (McpStatusModal / Extensions findings list) ─────

/** Finding severity for MCP doctor rows. */
export type McpDoctorFindingLevel = "ok" | "warn" | "fail";

/**
 * One normalized finding for UI lists.
 * Built only from CLI/host report data — never invents servers.
 */
export type McpDoctorFindingRow = {
  id: string;
  level: McpDoctorFindingLevel;
  title: string;
  detail: string;
  /** Server name when the finding is scoped; omit/null for global. */
  server?: string | null;
};

function levelFromPassed(passed: boolean | null | undefined): McpDoctorFindingLevel {
  if (passed === true) return "ok";
  if (passed === false) return "fail";
  return "warn";
}

function levelFromIssueLike(
  issue: string | McpDoctorIssueLike,
  text: string,
): McpDoctorFindingLevel {
  if (typeof issue !== "string") {
    const raw =
      asString(issue.level) ||
      asString(issue.status) ||
      "";
    const l = raw.trim().toLowerCase();
    if (["ok", "pass", "passed", "healthy", "info", "note"].includes(l)) {
      return "ok";
    }
    if (["warn", "warning", "degraded", "recommend", "recommendation"].includes(l)) {
      return "warn";
    }
    if (
      ["fail", "failed", "error", "critical", "issue", "unhealthy", "bad"].includes(l)
    ) {
      return "fail";
    }
  }
  const auth = detectAuthToneFromText(text);
  if (auth) return "fail";
  if (ERROR_RE.test(text)) return "fail";
  if (WARN_RE.test(text)) return "warn";
  // Unscoped free-text issues default to warn (not inventing hard fail).
  return "warn";
}

function slugIdPart(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Normalize a doctor report into flat finding rows.
 *
 * Sources (in order):
 * 1. Per-server `checks[]` (label/passed/detail/hint)
 * 2. Per-server `issues[]` / error / message
 * 3. Top-level `issues[]`
 *
 * Does **not** invent servers — only emits rows for names present in the report.
 * Optional `server` filter keeps rows for that name (case-insensitive) plus
 * unscoped rows when `includeUnscoped` is true (default false when filtering).
 */
export function normalizeMcpDoctorFindings(
  report: McpDoctorReportLike | null | undefined,
  opts?: {
    /** When set, only rows for this server (and optional unscoped). */
    server?: string | null;
    /** Include unscoped (no server) rows when filtering. Default false. */
    includeUnscoped?: boolean;
  },
): McpDoctorFindingRow[] {
  if (!report) return [];

  const filterName = opts?.server?.trim() || null;
  const filterLower = filterName ? filterName.toLowerCase() : null;
  const includeUnscoped =
    opts?.includeUnscoped ?? (filterLower == null ? true : false);

  const rows: McpDoctorFindingRow[] = [];
  const seen = new Set<string>();

  const push = (row: McpDoctorFindingRow) => {
    const title = redactMcpText(row.title).trim();
    if (!title) return;
    const detail = redactMcpText(row.detail).trim();
    const server = row.server?.trim() || null;

    if (filterLower) {
      const sLower = server?.toLowerCase() ?? null;
      if (sLower == null) {
        if (!includeUnscoped) return;
      } else if (sLower !== filterLower) {
        return;
      }
    }

    const id = row.id || `finding-${rows.length}`;
    // Dedupe by id+title+server to avoid double-mapping the same check.
    const dedupeKey = `${id}|${title}|${server ?? ""}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    rows.push({
      id,
      level: row.level,
      title: title.slice(0, 200),
      detail: detail.slice(0, 600),
      server,
    });
  };

  const servers = Array.isArray(report.servers) ? report.servers : [];
  for (const server of servers) {
    if (!server) continue;
    const name = asString(server.name);
    if (!name) continue; // never invent a server name

    const checks = Array.isArray(server.checks) ? server.checks : [];
    checks.forEach((c, i) => {
      if (!c) return;
      const label = asString(c.label) ?? `check-${i + 1}`;
      const detailParts = [asString(c.detail), asString(c.hint), asString(c.message)]
        .filter(Boolean) as string[];
      const passed =
        typeof c.passed === "boolean" ? c.passed : null;
      push({
        id: `${slugIdPart(name)}.check.${i}.${slugIdPart(label) || i}`,
        level: levelFromPassed(passed),
        title: label,
        detail: detailParts.join(" — "),
        server: name,
      });
    });

    // Server-level issues / error when no structured checks (or extra signal).
    const serverIssues = Array.isArray(server.issues) ? server.issues : [];
    serverIssues.forEach((issue, i) => {
      const text =
        typeof issue === "string"
          ? issue
          : issueText(issue as McpDoctorIssueLike);
      if (!text.trim()) return;
      push({
        id: `${slugIdPart(name)}.issue.${i}`,
        level: levelFromIssueLike(issue as string | McpDoctorIssueLike, text),
        title: text.slice(0, 120),
        detail: text,
        server: name,
      });
    });

    if (server.error) {
      const text = String(server.error);
      push({
        id: `${slugIdPart(name)}.error`,
        level: "fail",
        title: "Server error",
        detail: text,
        server: name,
      });
    } else if (server.message && checks.length === 0 && serverIssues.length === 0) {
      const text = String(server.message);
      const healthy =
        typeof server.healthy === "boolean" ? server.healthy : null;
      push({
        id: `${slugIdPart(name)}.message`,
        level:
          healthy === true
            ? "ok"
            : healthy === false
              ? "fail"
              : levelFromIssueLike(text, text),
        title: text.slice(0, 120),
        detail: text,
        server: name,
      });
    }

    // Healthy server with zero checks → one synthetic ok row so the list
    // still shows the server was examined (name still comes from CLI).
    if (
      checks.length === 0 &&
      serverIssues.length === 0 &&
      !server.error &&
      !server.message &&
      server.healthy === true
    ) {
      push({
        id: `${slugIdPart(name)}.healthy`,
        level: "ok",
        title: "Healthy",
        detail: "",
        server: name,
      });
    }
  }

  // Top-level issues (may reference servers by name or be unscoped).
  const topIssues = Array.isArray(report.issues) ? report.issues : [];
  topIssues.forEach((issue, i) => {
    const text = issueText(issue);
    if (!text.trim()) return;
    const server = issueServerName(issue);
    push({
      id: `issue.${i}.${slugIdPart(server || text) || i}`,
      level: levelFromIssueLike(issue, text),
      title: text.slice(0, 120),
      detail: text,
      server,
    });
  });

  // Raw non-JSON fallback excerpt (unscoped fail).
  if (rows.length === 0 && report.rawText) {
    const excerpt = redactMcpText(String(report.rawText)).trim();
    if (excerpt) {
      push({
        id: "raw",
        level: "fail",
        title: "Doctor output",
        detail: excerpt.slice(0, 600),
        server: null,
      });
    }
  }

  return rows;
}

/** Count finding rows by level (for summary chips). */
export function countMcpDoctorFindings(
  rows: McpDoctorFindingRow[],
): { ok: number; warn: number; fail: number; total: number } {
  let ok = 0;
  let warn = 0;
  let fail = 0;
  for (const r of rows) {
    if (r.level === "ok") ok += 1;
    else if (r.level === "warn") warn += 1;
    else fail += 1;
  }
  return { ok, warn, fail, total: rows.length };
}

/** Filter finding rows by free-text query (title / detail / server). */
export function filterMcpDoctorFindings(
  rows: McpDoctorFindingRow[],
  query: string | null | undefined,
): McpDoctorFindingRow[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    const hay = `${r.title} ${r.detail} ${r.server ?? ""} ${r.id}`.toLowerCase();
    return hay.includes(q);
  });
}

/** CSS / badge level → tone for existing badge helpers. */
export function mcpDoctorFindingTone(
  level: McpDoctorFindingLevel,
): McpStatusTone {
  if (level === "ok") return "ok";
  if (level === "warn") return "warn";
  return "error";
}
