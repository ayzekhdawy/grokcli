/**
 * Process budget pro — pure occupancy / reclaim honesty helpers.
 *
 * Host exposes live / background / parked warm agent counts vs
 * `maxConcurrentAgents`. UI maps reclaim plan copy via i18n keys.
 * Never invents occupancy when the host soft-fails (`available: false`).
 */

/** Defaults mirror host `process_limits` (DEFAULT_MAX / DEFAULT_IDLE). */
export const DEFAULT_MAX_CONCURRENT_AGENTS = 8;
export const DEFAULT_AGENT_IDLE_MINUTES = 30;
export const MAX_CONCURRENT_AGENTS_CAP = 32;
export const MIN_CONCURRENT_AGENTS = 1;
export const MAX_IDLE_MINUTES_CAP = 24 * 60;
export const MIN_IDLE_MINUTES = 1;

/** Poll interval for Settings / Reliability live occupancy (ms). */
export const PROCESS_BUDGET_POLL_MS = 2500;

export type ProcessBudgetSnapshot = {
  live: number;
  background: number;
  parked: number;
  totalWarm: number;
  busy: number;
  maxConcurrent: number;
  idleMinutes: number;
  liveSessionIds: string[];
  backgroundSessionIds: string[];
  parkedSessionIds: string[];
  /** False when host/manager soft-failed — treat counts as unknown, not zero busy. */
  available: boolean;
};

/** Last `session://process_limit` event remembered for UI explanation. */
export type ProcessLimitEvent = {
  at: number;
  maxConcurrentAgents: number | null;
  sessionId: string | null;
  message: string | null;
  code: string | null;
};

/**
 * Reclaim / occupancy plan for honest copy.
 *
 * - `unavailable` — host soft-fail; do not claim the pool is empty.
 * - `empty` — no warm agents.
 * - `headroom` — free slots remain.
 * - `at_cap_with_parked` — full, but idle parked can be reclaimed on next spawn.
 * - `at_cap_busy` — full of busy work; matches process_limit toast honesty.
 * - `over_cap` — total warm exceeds max (should be rare after reclaim).
 */
export type ProcessBudgetReclaimPlan =
  | "unavailable"
  | "empty"
  | "headroom"
  | "at_cap_with_parked"
  | "at_cap_busy"
  | "over_cap";

/** Soft non-negative integer from host/UI input. */
export function normalizeProcessCount(
  raw: unknown,
  fallback = 0,
): number {
  if (raw == null || raw === "") return fallback;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

export function normalizeMaxConcurrent(
  raw: unknown,
  fallback = DEFAULT_MAX_CONCURRENT_AGENTS,
): number {
  const n = normalizeProcessCount(raw, fallback);
  if (n < MIN_CONCURRENT_AGENTS) return MIN_CONCURRENT_AGENTS;
  if (n > MAX_CONCURRENT_AGENTS_CAP) return MAX_CONCURRENT_AGENTS_CAP;
  return n;
}

export function normalizeIdleMinutes(
  raw: unknown,
  fallback = DEFAULT_AGENT_IDLE_MINUTES,
): number {
  const n = normalizeProcessCount(raw, fallback);
  if (n < MIN_IDLE_MINUTES) return MIN_IDLE_MINUTES;
  if (n > MAX_IDLE_MINUTES_CAP) return MAX_IDLE_MINUTES_CAP;
  return n;
}

/** Occupancy 0–100 (clamped). Over-cap still reports 100. */
export function occupancyPercent(
  totalWarm: number,
  maxConcurrent: number,
): number {
  const max = normalizeMaxConcurrent(maxConcurrent);
  const total = normalizeProcessCount(totalWarm);
  if (max <= 0) return 0;
  return Math.min(100, Math.round((total / max) * 100));
}

export function isOverCap(totalWarm: number, maxConcurrent: number): boolean {
  return (
    normalizeProcessCount(totalWarm) > normalizeMaxConcurrent(maxConcurrent)
  );
}

export function isAtOrOverCap(
  totalWarm: number,
  maxConcurrent: number,
): boolean {
  return (
    normalizeProcessCount(totalWarm) >= normalizeMaxConcurrent(maxConcurrent)
  );
}

export function slotsFree(totalWarm: number, maxConcurrent: number): number {
  const max = normalizeMaxConcurrent(maxConcurrent);
  const total = normalizeProcessCount(totalWarm);
  return Math.max(0, max - total);
}

/**
 * Normalize bucket counts so totalWarm / busy stay consistent with parts.
 * Prefer explicit total/busy when they match; otherwise recompute.
 */
export function normalizeProcessBudgetCounts(input: {
  live?: unknown;
  background?: unknown;
  parked?: unknown;
  totalWarm?: unknown;
  busy?: unknown;
  maxConcurrent?: unknown;
  idleMinutes?: unknown;
}): {
  live: number;
  background: number;
  parked: number;
  totalWarm: number;
  busy: number;
  maxConcurrent: number;
  idleMinutes: number;
} {
  const live = normalizeProcessCount(input.live);
  const background = normalizeProcessCount(input.background);
  const parked = normalizeProcessCount(input.parked);
  const recomputedTotal = live + background + parked;
  const recomputedBusy = live + background;
  const totalWarm = normalizeProcessCount(input.totalWarm, recomputedTotal);
  const busy = normalizeProcessCount(input.busy, recomputedBusy);
  // Prefer sum of buckets when host omitted totals or they disagree wildly.
  const useTotal =
    input.totalWarm == null || Math.abs(totalWarm - recomputedTotal) > 0
      ? recomputedTotal
      : totalWarm;
  const useBusy =
    input.busy == null || Math.abs(busy - recomputedBusy) > 0
      ? recomputedBusy
      : busy;
  return {
    live,
    background,
    parked,
    totalWarm: useTotal,
    busy: useBusy,
    maxConcurrent: normalizeMaxConcurrent(input.maxConcurrent),
    idleMinutes: normalizeIdleMinutes(input.idleMinutes),
  };
}

function asIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
    } else if (item != null && typeof item !== "object") {
      const s = String(item).trim();
      if (s) out.push(s);
    }
  }
  return out;
}

export function emptyProcessBudgetSnapshot(
  overrides?: Partial<
    Pick<ProcessBudgetSnapshot, "maxConcurrent" | "idleMinutes">
  >,
): ProcessBudgetSnapshot {
  return {
    live: 0,
    background: 0,
    parked: 0,
    totalWarm: 0,
    busy: 0,
    maxConcurrent: normalizeMaxConcurrent(
      overrides?.maxConcurrent,
      DEFAULT_MAX_CONCURRENT_AGENTS,
    ),
    idleMinutes: normalizeIdleMinutes(
      overrides?.idleMinutes,
      DEFAULT_AGENT_IDLE_MINUTES,
    ),
    liveSessionIds: [],
    backgroundSessionIds: [],
    parkedSessionIds: [],
    available: false,
  };
}

/**
 * Parse host `process_budget_snapshot` payload (camelCase or snake_case).
 * Soft-fail → empty unavailable snapshot.
 */
export function parseProcessBudgetSnapshot(
  raw: unknown,
): ProcessBudgetSnapshot {
  if (raw == null || typeof raw !== "object") {
    return emptyProcessBudgetSnapshot();
  }
  const o = raw as Record<string, unknown>;
  const counts = normalizeProcessBudgetCounts({
    live: o.live,
    background: o.background,
    parked: o.parked,
    totalWarm: o.totalWarm ?? o.total_warm,
    busy: o.busy,
    maxConcurrent: o.maxConcurrent ?? o.max_concurrent,
    idleMinutes: o.idleMinutes ?? o.idle_minutes,
  });
  const availableRaw = o.available;
  const available =
    availableRaw === false || availableRaw === 0 || availableRaw === "false"
      ? false
      : availableRaw == null
        ? true
        : Boolean(availableRaw);

  if (!available) {
    return {
      ...emptyProcessBudgetSnapshot({
        maxConcurrent: counts.maxConcurrent,
        idleMinutes: counts.idleMinutes,
      }),
      available: false,
    };
  }

  return {
    ...counts,
    liveSessionIds: asIdList(o.liveSessionIds ?? o.live_session_ids),
    backgroundSessionIds: asIdList(
      o.backgroundSessionIds ?? o.background_session_ids,
    ),
    parkedSessionIds: asIdList(o.parkedSessionIds ?? o.parked_session_ids),
    available: true,
  };
}

/** Decide reclaim plan from a normalized snapshot. */
export function reclaimPlan(
  snap: ProcessBudgetSnapshot | null | undefined,
): ProcessBudgetReclaimPlan {
  if (!snap || !snap.available) return "unavailable";
  const { totalWarm, parked, maxConcurrent } = snap;
  if (totalWarm <= 0) return "empty";
  if (totalWarm > maxConcurrent) return "over_cap";
  if (totalWarm < maxConcurrent) return "headroom";
  // At cap: parked slots can still free capacity on next spawn.
  if (parked > 0) return "at_cap_with_parked";
  return "at_cap_busy";
}

/**
 * i18n MessageKey for reclaim plan body copy.
 * Keys live under `processBudget.plan.*` / `settings.processBudget.*`.
 */
export function reclaimPlanCopyKey(
  plan: ProcessBudgetReclaimPlan,
):
  | "processBudget.plan.unavailable"
  | "processBudget.plan.empty"
  | "processBudget.plan.headroom"
  | "processBudget.plan.atCapWithParked"
  | "processBudget.plan.atCapBusy"
  | "processBudget.plan.overCap" {
  switch (plan) {
    case "unavailable":
      return "processBudget.plan.unavailable";
    case "empty":
      return "processBudget.plan.empty";
    case "headroom":
      return "processBudget.plan.headroom";
    case "at_cap_with_parked":
      return "processBudget.plan.atCapWithParked";
    case "at_cap_busy":
      return "processBudget.plan.atCapBusy";
    case "over_cap":
      return "processBudget.plan.overCap";
    default:
      return "processBudget.plan.unavailable";
  }
}

/** Meter tone for bar fill styling. */
export function occupancyTone(
  plan: ProcessBudgetReclaimPlan,
): "ok" | "warn" | "danger" | "muted" {
  switch (plan) {
    case "unavailable":
    case "empty":
      return "muted";
    case "headroom":
      return "ok";
    case "at_cap_with_parked":
      return "warn";
    case "at_cap_busy":
    case "over_cap":
      return "danger";
    default:
      return "muted";
  }
}

/**
 * Parse / record a `session://process_limit` payload for last-event UI.
 */
export function parseProcessLimitEvent(
  raw: unknown,
  at: number = Date.now(),
): ProcessLimitEvent | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const maxRaw = o.maxConcurrentAgents ?? o.max_concurrent_agents;
  let maxConcurrentAgents: number | null = null;
  if (maxRaw != null && maxRaw !== "") {
    const n = Number(maxRaw);
    if (Number.isFinite(n) && n > 0) {
      maxConcurrentAgents = normalizeMaxConcurrent(n);
    }
  }
  const sessionId =
    typeof o.sessionId === "string"
      ? o.sessionId
      : typeof o.session_id === "string"
        ? o.session_id
        : null;
  const message =
    typeof o.message === "string"
      ? o.message
      : o.message == null
        ? null
        : String(o.message);
  const code =
    typeof o.code === "string"
      ? o.code
      : o.code == null
        ? "PROCESS_LIMIT"
        : String(o.code);
  return {
    at: Number.isFinite(at) ? at : Date.now(),
    maxConcurrentAgents,
    sessionId: sessionId && sessionId.trim() ? sessionId.trim() : null,
    message: message && message.trim() ? message.trim() : null,
    code: code || "PROCESS_LIMIT",
  };
}

/** i18n key explaining the last process_limit toast (honest "all busy" path). */
export function processLimitExplainKey(): "processBudget.limit.explain" {
  return "processBudget.limit.explain";
}

/** Relative age label helper — returns minutes since event (min 0). */
export function processLimitAgeMinutes(
  event: ProcessLimitEvent | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!event || !Number.isFinite(event.at)) return null;
  const ms = Math.max(0, now - event.at);
  return Math.floor(ms / 60_000);
}

/** Short counts line variables for i18n (`{live}` `{background}` …). */
export function processBudgetCountVars(snap: ProcessBudgetSnapshot): {
  live: number;
  background: number;
  parked: number;
  total: number;
  max: number;
  busy: number;
  free: number;
  percent: number;
  idleMinutes: number;
} {
  return {
    live: snap.live,
    background: snap.background,
    parked: snap.parked,
    total: snap.totalWarm,
    max: snap.maxConcurrent,
    busy: snap.busy,
    free: slotsFree(snap.totalWarm, snap.maxConcurrent),
    percent: occupancyPercent(snap.totalWarm, snap.maxConcurrent),
    idleMinutes: snap.idleMinutes,
  };
}
