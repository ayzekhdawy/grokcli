/**
 * MCP-STATUS-PRO — pure helpers for the MCP status modal:
 * first-class ok / error / oauth / unknown / disabled chips, empty honesty,
 * redacted copy summary, soft-fail when doctor CLI is missing.
 *
 * Builds on `mcpStatus` + `mcpOauth`. No DOM / Tauri side effects.
 * Never invents servers; never surfaces raw secrets.
 */

import { isMcpOauthText } from "@/lib/mcpOauth";
import {
  classifyMcpRowHealth,
  redactMcpText,
  type McpRowLike,
  type McpServerStatus,
  type McpStatusIndex,
  type McpStatusTone,
} from "@/lib/mcpStatus";

// ── Pro status chips ─────────────────────────────────────────────────────────

/**
 * First-class modal chip buckets.
 * Warn collapses into `error`; auth tones collapse into `oauth`.
 */
export type McpProStatus =
  | "ok"
  | "error"
  | "oauth"
  | "unknown"
  | "disabled";

/** Chip filter values (includes `all`). */
export type McpProStatusFilter = "all" | McpProStatus;

/** Ordered chip list for the status modal. */
export const MCP_PRO_STATUS_FILTERS: readonly McpProStatusFilter[] = [
  "all",
  "ok",
  "error",
  "oauth",
  "disabled",
  "unknown",
] as const;

/** Inspect / list row shape for pro classification. */
export type McpProRowLike = McpRowLike & {
  /** App Extensions enable flag; `false` → disabled. Omitted → assume enabled. */
  enabled?: boolean | null;
};

const DISABLED_STATUS = new Set([
  "disabled",
  "off",
  "inactive",
  "disabled_by_user",
  "user_disabled",
  "skipped",
]);

/**
 * True when the row is disabled via enable flag or compatibilityStatus token.
 */
export function isMcpProRowDisabled(
  row: McpProRowLike | null | undefined,
): boolean {
  if (!row) return false;
  if (row.enabled === false) return true;
  const st = (row.compatibilityStatus ?? "").trim().toLowerCase();
  if (!st) return false;
  if (DISABLED_STATUS.has(st)) return true;
  if (/\bdisabled\b/i.test(st) && !/\benabled\b/i.test(st)) return true;
  return false;
}

/**
 * Map a doctor / auth tone into a pro chip bucket.
 * Auth tones → oauth; warn → error; unknown stays unknown.
 */
export function mcpProStatusFromTone(tone: McpStatusTone): McpProStatus {
  switch (tone) {
    case "ok":
      return "ok";
    case "warn":
    case "error":
      return "error";
    case "auth_expired":
    case "auth_required":
      return "oauth";
    case "unknown":
    default:
      return "unknown";
  }
}

/**
 * Classify one server for pro chips / lamps.
 *
 * Priority:
 * 1. disabled (enable flag / compatibilityStatus)
 * 2. doctor auth tones → oauth
 * 3. oauth-ish free text on doctor reason / issues / compatibilityStatus
 * 4. doctor non-auth tone (warn → error)
 * 5. inspect compatibilityStatus / transport health (warn → error)
 * 6. unknown
 */
export function classifyMcpProStatus(
  row: McpProRowLike | null | undefined,
  doctor?: McpServerStatus | null,
): McpProStatus {
  if (!row && !doctor) return "unknown";

  if (row && isMcpProRowDisabled(row)) return "disabled";

  if (doctor) {
    if (doctor.needsAuthRefresh) return "oauth";
    if (doctor.tone === "auth_expired" || doctor.tone === "auth_required") {
      return "oauth";
    }
    const bag = [doctor.reason, ...(doctor.issues ?? [])]
      .filter(Boolean)
      .join("\n");
    if (isMcpOauthText(bag) || looksLikeOauthAuth(bag)) {
      return "oauth";
    }
    if (doctor.tone === "ok") return "ok";
    if (doctor.tone === "warn" || doctor.tone === "error") return "error";
    // doctor.unknown falls through to inspect row
  }

  if (row) {
    const statusText = (row.compatibilityStatus ?? "").trim();
    if (statusText) {
      if (isMcpOauthText(statusText) || looksLikeOauthAuth(statusText)) {
        return "oauth";
      }
    }
    const health = classifyMcpRowHealth(row);
    if (health === "ok") return "ok";
    if (health === "warn" || health === "error") return "error";
    return "unknown";
  }

  if (doctor) return mcpProStatusFromTone(doctor.tone);
  return "unknown";
}

/** Broader auth signal than pure OAuth keyword (401 / expired token). */
function looksLikeOauthAuth(text: string): boolean {
  if (!text.trim()) return false;
  // Reuse oauth classifier when possible; also catch generic auth for pro chip.
  if (/\b(401|403|unauthorized|unauthorised|token\s+expir|auth(?:entication|orization)?\s+required|invalid\s+token|missing\s+token)\b/i.test(
    text,
  )) {
    return true;
  }
  return false;
}

/** Per-status counts plus total under `all`. */
export type McpProStatusCounts = Record<McpProStatusFilter, number>;

/** Count rows per pro status (and total under `all`). */
export function countMcpProByStatus(
  rows: readonly McpProRowLike[],
  doctorIndex?: McpStatusIndex | null,
): McpProStatusCounts {
  const counts: McpProStatusCounts = {
    all: rows.length,
    ok: 0,
    error: 0,
    oauth: 0,
    disabled: 0,
    unknown: 0,
  };
  for (const r of rows) {
    const name = (r.name ?? "").trim();
    const doctor = name && doctorIndex ? doctorIndex.get(name) ?? lookupCi(doctorIndex, name) : null;
    counts[classifyMcpProStatus(r, doctor)] += 1;
  }
  return counts;
}

function lookupCi(
  index: McpStatusIndex,
  name: string,
): McpServerStatus | null {
  if (index.has(name)) return index.get(name) ?? null;
  const lower = name.toLowerCase();
  for (const [k, v] of index) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

/** Combined pro list filters (status chip + free text). */
export interface McpProRowFilter {
  query?: string;
  status?: McpProStatusFilter;
}

/**
 * Filter inspect rows by free-text query and/or pro status chip.
 * Filters combine with AND. Does not invent rows.
 */
export function filterMcpProRows<T extends McpProRowLike>(
  rows: readonly T[],
  filter: McpProRowFilter | string = {},
  doctorIndex?: McpStatusIndex | null,
): T[] {
  const opts: McpProRowFilter =
    typeof filter === "string" ? { query: filter } : filter ?? {};
  const status = opts.status ?? "all";
  let out: T[] = rows as T[];

  if (status !== "all") {
    out = out.filter((r) => {
      const name = (r.name ?? "").trim();
      const doctor =
        name && doctorIndex
          ? doctorIndex.get(name) ?? lookupCi(doctorIndex, name)
          : null;
      return classifyMcpProStatus(r, doctor) === status;
    });
  }

  const q = (opts.query ?? "").trim().toLowerCase();
  if (!q) return out;
  return out.filter((r) => {
    const name = (r.name ?? "").trim();
    const doctor =
      name && doctorIndex
        ? doctorIndex.get(name) ?? lookupCi(doctorIndex, name)
        : null;
    const pro = classifyMcpProStatus(r, doctor);
    const hay = [
      r.name ?? "",
      r.transport ?? "",
      r.target ?? "",
      r.vendor ?? "",
      r.compatibilityStatus ?? "",
      pro,
      doctor?.reason ?? "",
      doctor?.tone ?? "",
    ]
      .join("\n")
      .toLowerCase();
    return hay.includes(q);
  });
}

/** i18n key for a pro status badge / chip label. */
export function mcpProStatusLabelKey(status: McpProStatus): string {
  switch (status) {
    case "ok":
      return "ext.mcp.status.ok";
    case "error":
      return "ext.mcp.status.error";
    case "oauth":
      return "ext.mcp.status.oauth";
    case "disabled":
      return "ext.mcp.status.disabled";
    case "unknown":
    default:
      return "ext.mcp.status.unknown";
  }
}

/** CSS modifier for lamp / badge: ok | fail | auth | muted | disabled */
export function mcpProStatusBadgeMod(
  status: McpProStatus,
): "ok" | "fail" | "auth" | "muted" | "disabled" {
  switch (status) {
    case "ok":
      return "ok";
    case "error":
      return "fail";
    case "oauth":
      return "auth";
    case "disabled":
      return "disabled";
    case "unknown":
    default:
      return "muted";
  }
}

// ── Empty honesty ────────────────────────────────────────────────────────────

/** Contextual empty / loading / error surfaces for the server list. */
export type McpProEmptyKind =
  | "loading"
  | "error"
  | "empty"
  | "filter_empty";

export type McpProEmptyPresentation = {
  kind: McpProEmptyKind;
  /** Primary title i18n key under mcpModal.*. */
  titleKey: string;
  /** Optional hint i18n key. */
  hintKey: string | null;
  /** Offer clear-filters CTA. */
  showClearFilters: boolean;
  /**
   * Soft-fail empty (e.g. load error from missing CLI) vs hard empty catalog.
   * UI should not escalate soft-fail to a crash banner.
   */
  softFail: boolean;
};

export type McpProEmptyInput = {
  loading?: boolean;
  /** Inspect / list error string (already redacted preferred). */
  error?: string | null;
  /** Total servers from host (pre-filter). */
  total: number;
  /** Visible after filter. */
  filtered: number;
  /** Status chip or free-text active. */
  hasFilters?: boolean;
};

/**
 * Resolve which empty / loading / error surface to show for the server list.
 * Returns `null` when the list should render rows.
 *
 * Priority: loading (empty only) → hard error with empty list → empty catalog
 * → filter empty. When rows exist and error is set, returns null so the list
 * can still show (error banner is caller-owned).
 */
export function resolveMcpProEmptyState(
  input: McpProEmptyInput,
): McpProEmptyPresentation | null {
  const total = Math.max(0, Number(input.total) || 0);
  const filtered = Math.max(0, Number(input.filtered) || 0);
  const loading = Boolean(input.loading);
  const err = (input.error ?? "").trim();
  const hasFilters = Boolean(input.hasFilters);

  if (loading && total === 0) {
    return {
      kind: "loading",
      titleKey: "mcpModal.loading",
      hintKey: null,
      showClearFilters: false,
      softFail: true,
    };
  }

  if (err && total === 0 && !loading) {
    const soft = isMcpProSoftFailError(err);
    return {
      kind: "error",
      titleKey: soft
        ? "mcpModal.emptyErrorSoft"
        : "mcpModal.emptyError",
      hintKey: soft ? "mcpModal.emptyErrorSoftHint" : "mcpModal.emptyErrorHint",
      showClearFilters: false,
      softFail: soft,
    };
  }

  if (!loading && total === 0) {
    return {
      kind: "empty",
      titleKey: "mcpModal.empty",
      hintKey: "mcpModal.emptyHint",
      showClearFilters: false,
      softFail: false,
    };
  }

  if (!loading && total > 0 && filtered === 0 && hasFilters) {
    return {
      kind: "filter_empty",
      titleKey: "mcpModal.filterEmpty",
      hintKey: "mcpModal.filterEmptyHint",
      showClearFilters: true,
      softFail: false,
    };
  }

  return null;
}

/** Detect CLI / capability gaps that should soft-fail (not hard crash). */
export function isMcpProSoftFailError(err: string | null | undefined): boolean {
  const kind = classifyMcpDoctorOpError(err).kind;
  return (
    kind === "cli_missing" ||
    kind === "cli_too_old" ||
    kind === "host_only" ||
    kind === "timeout"
  );
}

// ── Doctor op soft-fail ──────────────────────────────────────────────────────

/** Stable failure kinds for `mcp doctor` host invoke. */
export type McpDoctorOpErrorKind =
  | "cli_missing"
  | "cli_too_old"
  | "timeout"
  | "host_only"
  | "parse"
  | "host_error"
  | "other";

export type McpDoctorOpErrorView = {
  kind: McpDoctorOpErrorKind;
  /** Soft-fail: capability gap — warn, do not escalate. */
  softFail: boolean;
  /** Redacted detail excerpt for UI. */
  detail: string;
  /** i18n title key under mcpModal.doctor.err.*. */
  titleKey: string;
  /** i18n hint key under mcpModal.doctor.err.*. */
  hintKey: string;
};

function errText(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const code =
      typeof (err as Error & { code?: unknown }).code === "string"
        ? String((err as Error & { code?: string }).code)
        : "";
    return `${code} ${err.message} ${err.name}`.trim();
  }
  if (typeof err === "object") {
    const o = err as {
      code?: unknown;
      message?: unknown;
      reason?: unknown;
      error?: unknown;
    };
    const parts = [o.code, o.message, o.reason, o.error]
      .filter((x) => x != null && String(x).trim())
      .map(String);
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * Classify a doctor invoke / host error for soft-fail presentation.
 * Secrets in free-form detail are redacted.
 */
export function classifyMcpDoctorOpError(
  err: unknown,
): McpDoctorOpErrorView {
  const raw = errText(err);
  const detail = redactMcpText(raw).trim().slice(0, 400);
  const s = raw.toLowerCase();

  let kind: McpDoctorOpErrorKind = "other";

  if (
    /need[_\s-]?tauri|desktop\s+app|host[_\s-]?only|not\s+available\s+in\s+browser/i.test(
      s,
    )
  ) {
    kind = "host_only";
  } else if (
    /cli[_\s-]?missing|grok\s+build\s+(cli\s+)?not\s+found|cli\s+not\s+found|command\s+not\s+found|enoent|no\s+such\s+file|not\s+found\s+on\s+path|failed\s+to\s+run\s+grok/i.test(
      s,
    ) ||
    (s.includes("not found") && (s.includes("cli") || s.includes("grok")))
  ) {
    kind = "cli_missing";
  } else if (
    /cli[_\s-]?too[_\s-]?old|unsupported\s+cli|unknown\s+(flag|option|command).*mcp|unrecognized\s+subcommand.*mcp|requires?\s+cli/i.test(
      s,
    )
  ) {
    kind = "cli_too_old";
  } else if (/timed?\s*out|timeout/i.test(s)) {
    kind = "timeout";
  } else if (/parse|invalid\s+json|not\s+json|json\s+error/i.test(s)) {
    kind = "parse";
  } else if (
    /invoke|host\s+error|ipc|tauri/i.test(s) &&
    /fail|error/i.test(s)
  ) {
    kind = "host_error";
  } else if (raw.trim()) {
    kind = "other";
  }

  const softFail =
    kind === "cli_missing" ||
    kind === "cli_too_old" ||
    kind === "host_only" ||
    kind === "timeout";

  const titleKey = `mcpModal.doctor.err.${kind}` as const;
  const hintKey = `mcpModal.doctor.err.${kind}Hint` as const;

  return {
    kind,
    softFail,
    detail,
    titleKey,
    hintKey,
  };
}

// ── Redacted copy summary ────────────────────────────────────────────────────

export type McpProCopySummaryLabels = {
  /** Header when total known, e.g. "MCP servers (3)". */
  header?: string;
  /** Status label overrides (English fallbacks used otherwise). */
  statusLabels?: Partial<Record<McpProStatus, string>>;
  /** Separator between rows (default newline). */
  sep?: string;
};

const DEFAULT_STATUS_LABEL: Record<McpProStatus, string> = {
  ok: "ok",
  error: "error",
  oauth: "oauth",
  disabled: "disabled",
  unknown: "unknown",
};

/**
 * Build a clipboard-safe multi-line summary of MCP servers.
 * Targets / reasons pass through {@link redactMcpText}; never includes secrets.
 */
export function buildMcpProCopySummary(
  rows: readonly McpProRowLike[],
  doctorIndex?: McpStatusIndex | null,
  labels?: McpProCopySummaryLabels,
): string {
  const statusLabels = {
    ...DEFAULT_STATUS_LABEL,
    ...(labels?.statusLabels ?? {}),
  };
  const sep = labels?.sep ?? "\n";
  const lines: string[] = [];

  const header =
    labels?.header?.trim() ||
    `MCP servers (${rows.length})`;
  lines.push(header);

  if (rows.length === 0) {
    lines.push("(none)");
    return lines.join(sep);
  }

  for (const r of rows) {
    const name = redactMcpText((r.name ?? "").trim() || "?");
    const doctor = name && doctorIndex
      ? doctorIndex.get(name) ?? lookupCi(doctorIndex, name)
      : null;
    // Re-lookup with original name when redaction changed nothing for keys
    const doctorByOrig =
      doctor ??
      (r.name && doctorIndex
        ? doctorIndex.get(r.name.trim()) ??
          lookupCi(doctorIndex, r.name.trim())
        : null);
    const pro = classifyMcpProStatus(r, doctorByOrig);
    const st = statusLabels[pro] ?? pro;
    const target = redactMcpText((r.target ?? "").trim());
    const transport = redactMcpText((r.transport ?? "").trim());
    const reason = redactMcpText(
      (doctorByOrig?.reason ?? r.compatibilityStatus ?? "").trim(),
    ).slice(0, 160);

    let line = `- ${name} [${st}]`;
    if (transport) line += ` ${transport}`;
    if (target) line += ` → ${target}`;
    if (reason && pro !== "ok") line += ` — ${reason}`;
    lines.push(line);
  }

  return lines.join(sep);
}

/**
 * Redact a free-form detail string for display / clipboard.
 * Thin alias so UI can import a single pro module.
 */
export function redactMcpProDetail(
  text: string | null | undefined,
): string {
  return redactMcpText(text);
}
