/**
 * PROCESS-BUDGET-PRO — pure helpers for process-pool empty honesty and
 * process_limit callout polish (Settings → Runtime → Process pool + Reliability).
 *
 * Builds on `processBudget` snapshot / reclaim plan helpers.
 * Never invents busy occupancy when the host soft-fails.
 * No DOM / Tauri side effects.
 */

import {
  DEFAULT_MAX_CONCURRENT_AGENTS,
  emptyProcessBudgetSnapshot,
  occupancyPercent,
  processBudgetCountVars,
  processLimitAgeMinutes,
  reclaimPlan,
  slotsFree,
  type ProcessBudgetReclaimPlan,
  type ProcessBudgetSnapshot,
  type ProcessLimitEvent,
} from "@/lib/processBudget";

// ── Error classification ─────────────────────────────────────────────────────

/** Stable failure modes for process-budget snapshot load. */
export type ProcessBudgetErrorKind =
  | "host_only"
  | "unavailable"
  | "timeout"
  | "permission"
  | "other";

export type ProcessBudgetErrorView = {
  kind: ProcessBudgetErrorKind;
  /** Soft-fail: capability / manager gap — warn, do not escalate. */
  softFail: boolean;
  /** Primary title i18n key under processBudget.error.* */
  titleKey:
    | "processBudget.error.hostOnly"
    | "processBudget.error.unavailable"
    | "processBudget.error.timeout"
    | "processBudget.error.permission"
    | "processBudget.error.other";
  /** Optional actionable hint key. */
  hintKey:
    | "processBudget.error.hostOnlyHint"
    | "processBudget.error.unavailableHint"
    | "processBudget.error.timeoutHint"
    | "processBudget.error.permissionHint"
    | "processBudget.error.otherHint"
    | null;
  /** Trimmed host detail (may be empty; never secrets). */
  detail: string;
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

function errCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "string") return c.trim().toLowerCase();
    if (typeof c === "number" && Number.isFinite(c)) return String(c);
  }
  return "";
}

/**
 * Classify a thrown value / host error from process budget snapshot load.
 * Prefer explicit `code` and known host phrases over free-form text.
 */
export function classifyProcessBudgetError(err: unknown): ProcessBudgetErrorKind {
  if (err == null || err === "") return "other";

  const code = errCode(err);
  if (
    code === "host_only" ||
    code === "host-only" ||
    code === "need_tauri" ||
    code === "need-tauri" ||
    code === "not_tauri"
  ) {
    return "host_only";
  }
  if (
    code === "unavailable" ||
    code === "not_ready" ||
    code === "not-ready" ||
    code === "manager_unavailable" ||
    code === "no_manager" ||
    code === "process_budget_unavailable"
  ) {
    return "unavailable";
  }
  if (
    code === "timeout" ||
    code === "timed_out" ||
    code === "timed-out" ||
    code === "deadline_exceeded"
  ) {
    return "timeout";
  }
  if (
    code === "permission" ||
    code === "permission_denied" ||
    code === "forbidden" ||
    code === "eacces"
  ) {
    return "permission";
  }

  const s = errText(err).toLowerCase();
  if (!s.trim()) return "other";

  if (
    s.includes("need tauri") ||
    s.includes("host only") ||
    s.includes("host-only") ||
    s.includes("not available in browser") ||
    s.includes("requires tauri")
  ) {
    return "host_only";
  }
  if (
    s.includes("timeout") ||
    s.includes("timed out") ||
    s.includes("deadline exceeded")
  ) {
    return "timeout";
  }
  if (
    s.includes("permission denied") ||
    s.includes("eacces") ||
    s.includes("not allowed") ||
    s.includes("forbidden")
  ) {
    return "permission";
  }
  if (
    s.includes("unavailable") ||
    s.includes("not ready") ||
    s.includes("no manager") ||
    s.includes("manager not") ||
    s.includes("process budget") ||
    s.includes("process_budget")
  ) {
    return "unavailable";
  }

  return "other";
}

/** Map a classified kind to title/hint keys + soft-fail flag. */
export function processBudgetErrorView(
  err: unknown,
): ProcessBudgetErrorView {
  const kind = classifyProcessBudgetError(err);
  const detail = errText(err).trim().slice(0, 240);
  switch (kind) {
    case "host_only":
      return {
        kind,
        softFail: true,
        titleKey: "processBudget.error.hostOnly",
        hintKey: "processBudget.error.hostOnlyHint",
        detail,
      };
    case "unavailable":
      return {
        kind,
        softFail: true,
        titleKey: "processBudget.error.unavailable",
        hintKey: "processBudget.error.unavailableHint",
        detail,
      };
    case "timeout":
      return {
        kind,
        softFail: true,
        titleKey: "processBudget.error.timeout",
        hintKey: "processBudget.error.timeoutHint",
        detail,
      };
    case "permission":
      return {
        kind,
        softFail: false,
        titleKey: "processBudget.error.permission",
        hintKey: "processBudget.error.permissionHint",
        detail,
      };
    case "other":
    default:
      return {
        kind: "other",
        softFail: true,
        titleKey: "processBudget.error.other",
        hintKey: "processBudget.error.otherHint",
        detail,
      };
  }
}

// ── Empty honesty ────────────────────────────────────────────────────────────

/**
 * Contextual empty / soft-fail surfaces for the process budget panel body.
 *
 * - `loading` — first load; do not claim the pool is empty.
 * - `unavailable` — host soft-fail (`available: false`); occupancy unknown.
 * - `error` — load threw; classified error copy.
 * - `empty_pool` — available snapshot with zero warm agents (honest empty).
 *
 * Returns `null` when the meter + bucket counts should render (real occupancy).
 */
export type ProcessBudgetEmptyKind =
  | "loading"
  | "unavailable"
  | "error"
  | "empty_pool";

export type ProcessBudgetEmptyState = {
  kind: ProcessBudgetEmptyKind;
  /** Primary title / plan i18n key. */
  titleKey: string;
  /** Optional secondary body / hint key. */
  bodyKey: string | null;
  /** Soft-fail: capability gap — warn, do not escalate. */
  softFail: boolean;
  /** Offer Refresh CTA. */
  showRetry: boolean;
  /** Meter / chrome tone. */
  tone: "muted" | "ok" | "warn" | "danger";
  /** Classified error (only when kind === "error"). */
  errorKind: ProcessBudgetErrorKind | null;
};

export type ProcessBudgetEmptyInput = {
  loading: boolean;
  snapshot: ProcessBudgetSnapshot | null | undefined;
  error?: unknown;
};

/**
 * Resolve which empty / honesty surface to show.
 *
 * Priority:
 * 1. loading + no available snapshot → loading
 * 2. error present + no available snapshot → error
 * 3. snapshot unavailable → unavailable
 * 4. available + totalWarm === 0 → empty_pool
 * 5. available + occupancy → null (render meter)
 */
export function resolveProcessBudgetEmptyState(
  input: ProcessBudgetEmptyInput,
): ProcessBudgetEmptyState | null {
  const loading = Boolean(input.loading);
  const snap = input.snapshot ?? null;
  const available = Boolean(snap?.available);
  const hasError =
    input.error != null &&
    input.error !== "" &&
    !(typeof input.error === "string" && !input.error.trim());

  if (loading && !available) {
    return {
      kind: "loading",
      titleKey: "processBudget.loading",
      bodyKey: "processBudget.loadingHint",
      softFail: true,
      showRetry: false,
      tone: "muted",
      errorKind: null,
    };
  }

  if (hasError && !available && !loading) {
    const view = processBudgetErrorView(input.error);
    return {
      kind: "error",
      titleKey: view.titleKey,
      bodyKey: view.hintKey,
      softFail: view.softFail,
      showRetry: true,
      tone: view.softFail ? "warn" : "danger",
      errorKind: view.kind,
    };
  }

  if (!available) {
    return {
      kind: "unavailable",
      titleKey: "processBudget.plan.unavailable",
      bodyKey: "processBudget.unavailableHint",
      softFail: true,
      showRetry: true,
      tone: "muted",
      errorKind: null,
    };
  }

  // Available snapshot.
  const totalWarm = Math.max(0, Number(snap!.totalWarm) || 0);
  if (totalWarm <= 0) {
    return {
      kind: "empty_pool",
      titleKey: "processBudget.plan.empty",
      bodyKey: "processBudget.emptyPoolHint",
      softFail: false,
      showRetry: false,
      tone: "muted",
      errorKind: null,
    };
  }

  return null;
}

// ── Occupancy summary ────────────────────────────────────────────────────────

/**
 * Structured occupancy summary for counts line / aria / plan vars.
 * Never invents non-zero busy counts when `available` is false.
 */
export type ProcessBudgetOccupancySummary = {
  available: boolean;
  live: number;
  background: number;
  parked: number;
  free: number;
  total: number;
  max: number;
  busy: number;
  percent: number;
  idleMinutes: number;
  plan: ProcessBudgetReclaimPlan;
  /**
   * Compact machine-readable ratio (`"4/8"`) when available;
   * empty string when occupancy is unknown.
   */
  ratio: string;
  /**
   * Short English-neutral token bag for diagnostics / tests
   * (`live=1 bg=0 parked=2 free=5`). Empty when unavailable.
   */
  tokenLine: string;
};

/**
 * Format occupancy into structured summary vars.
 * Soft-fails to zeros + plan `unavailable` when snapshot is missing / unavailable.
 */
export function formatOccupancySummary(
  snapshot: ProcessBudgetSnapshot | null | undefined,
): ProcessBudgetOccupancySummary {
  if (!snapshot || !snapshot.available) {
    const max = snapshot?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_AGENTS;
    const idleMinutes = snapshot?.idleMinutes ?? 30;
    return {
      available: false,
      live: 0,
      background: 0,
      parked: 0,
      free: 0,
      total: 0,
      max,
      busy: 0,
      percent: 0,
      idleMinutes,
      plan: "unavailable",
      ratio: "",
      tokenLine: "",
    };
  }

  const vars = processBudgetCountVars(snapshot);
  const plan = reclaimPlan(snapshot);
  const free = slotsFree(snapshot.totalWarm, snapshot.maxConcurrent);
  const percent = occupancyPercent(snapshot.totalWarm, snapshot.maxConcurrent);
  return {
    available: true,
    live: vars.live,
    background: vars.background,
    parked: vars.parked,
    free,
    total: vars.total,
    max: vars.max,
    busy: vars.busy,
    percent,
    idleMinutes: vars.idleMinutes,
    plan,
    ratio: `${vars.total}/${vars.max}`,
    tokenLine: `live=${vars.live} bg=${vars.background} parked=${vars.parked} free=${free}`,
  };
}

// ── Process limit callout ────────────────────────────────────────────────────

/** Default max age for showing the last process_limit callout (24h). */
export const PROCESS_LIMIT_CALLOUT_MAX_AGE_MINUTES = 24 * 60;

/**
 * Whether to show the last PROCESS_LIMIT honesty callout.
 * Hides null/missing events and events older than `maxAgeMinutes` (default 24h).
 */
export function shouldShowProcessLimitCallout(opts: {
  event: ProcessLimitEvent | null | undefined;
  now?: number;
  /** Max age in minutes; default {@link PROCESS_LIMIT_CALLOUT_MAX_AGE_MINUTES}. */
  maxAgeMinutes?: number;
}): boolean {
  const event = opts.event;
  if (!event || !Number.isFinite(event.at)) return false;
  const now = Number.isFinite(opts.now) ? (opts.now as number) : Date.now();
  const maxAge =
    opts.maxAgeMinutes == null || !Number.isFinite(opts.maxAgeMinutes)
      ? PROCESS_LIMIT_CALLOUT_MAX_AGE_MINUTES
      : Math.max(0, Math.floor(opts.maxAgeMinutes));
  const age = processLimitAgeMinutes(event, now);
  if (age == null) return false;
  return age < maxAge;
}

/**
 * Limit-event empty / callout presentation for the panel footer.
 * - `none` — no recent PROCESS_LIMIT (honest empty).
 * - `active` — show explain callout.
 */
export type ProcessLimitCalloutKind = "none" | "active";

export type ProcessLimitCalloutState = {
  kind: ProcessLimitCalloutKind;
  /** Title i18n key. */
  titleKey: "processBudget.limit.title" | "processBudget.limit.noneTitle";
  /** Body i18n key. */
  bodyKey: "processBudget.limit.explain" | "processBudget.limit.noneBody";
  /** Show warn-styled callout chrome. */
  emphasized: boolean;
  /** Age in minutes when active; null when none. */
  ageMinutes: number | null;
  /** maxConcurrentAgents from the event, or null. */
  maxConcurrentAgents: number | null;
};

/**
 * Resolve limit-event callout vs honest empty (no recent PROCESS_LIMIT).
 */
export function resolveProcessLimitCalloutState(opts: {
  event: ProcessLimitEvent | null | undefined;
  now?: number;
  maxAgeMinutes?: number;
}): ProcessLimitCalloutState {
  const show = shouldShowProcessLimitCallout(opts);
  if (!show || !opts.event) {
    return {
      kind: "none",
      titleKey: "processBudget.limit.noneTitle",
      bodyKey: "processBudget.limit.noneBody",
      emphasized: false,
      ageMinutes: null,
      maxConcurrentAgents: null,
    };
  }
  const now = Number.isFinite(opts.now) ? (opts.now as number) : Date.now();
  return {
    kind: "active",
    titleKey: "processBudget.limit.title",
    bodyKey: "processBudget.limit.explain",
    emphasized: true,
    ageMinutes: processLimitAgeMinutes(opts.event, now),
    maxConcurrentAgents: opts.event.maxConcurrentAgents,
  };
}

/** Safe defaults when UI needs a placeholder snapshot. */
export function processBudgetProEmptySnapshot(
  overrides?: Partial<
    Pick<ProcessBudgetSnapshot, "maxConcurrent" | "idleMinutes">
  >,
): ProcessBudgetSnapshot {
  return emptyProcessBudgetSnapshot(overrides);
}
