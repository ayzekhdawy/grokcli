/**
 * Cost rollup — aggregate **known** token usage by project/day or session/day.
 *
 * Sources (honest, never invent):
 * - Live `session://usage` samples (client ring)
 * - Optional liveMap-adjacent usage map when callers pass it
 * - Session journal compact markers (`tokensAfter`) as last-known context
 *
 * Missing usage → explicit **unknown**, not $0.
 * Dollar figures use crude `estimateCostUsd` rates — **never invoice-grade**.
 * Export text is optional plain-text summary (clipboard / download).
 */

import {
  estimateCostUsd,
  formatCostUsd,
  type CostEstimateResult,
} from "./estimateCost";

// ── Types ──────────────────────────────────────────────────────────────

/** Where a known usage figure came from. */
export type CostRollupSource =
  | "usage"
  | "journal_compact"
  | "live"
  | "unknown";

/**
 * Rollup grain:
 * - `project` — project × day (default; sessions collapse into project totals)
 * - `session` — session × day (inspect per-chat known usage)
 */
export type CostRollupGroupBy = "project" | "session";

/** Dollar quality for a bucket or the whole view. */
export type CostRollupPrecision = "estimate" | "partial" | "none";

/**
 * One known usage observation for a session on a calendar day.
 * Prefer input+output when present; total alone is still known tokens.
 */
export type CostUsageSample = {
  sessionId: string;
  /** App project id; null = orphan / no project. */
  projectId: string | null;
  projectName?: string | null;
  /** YYYY-MM-DD (local or UTC — caller chooses consistently). */
  day: string;
  modelId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  source: CostRollupSource;
  /** ISO timestamp of observation. */
  at?: string;
};

export type CostRollupSessionMeta = {
  id: string;
  projectId?: string | null;
  title?: string | null;
  modelId?: string | null;
  /** ISO updated/created — used to place session on a day for unknown counts. */
  updatedAt?: string | null;
};

export type CostRollupProjectMeta = {
  id: string;
  name?: string | null;
};

export type CostRollupBucket = {
  projectId: string | null;
  projectName: string | null;
  /**
   * Session id when `groupBy === "session"`; always `null` for project grain.
   */
  sessionId: string | null;
  /** Session title when known (session grain only). */
  sessionTitle: string | null;
  day: string;
  /** Distinct sessions that contributed known token figures. */
  sessionsKnown: number;
  /**
   * Sessions on this project/day (or this session row when unknown) with no
   * known sample. Honest gap — do not treat as zero tokens.
   */
  sessionsUnknown: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  /** Crude estimate only; null when rates/tokens insufficient. */
  estimatedUsd: number | null;
  /**
   * `estimate` — all known sessions had rates;
   * `partial` — some tokens known but rates or sessions missing;
   * `none` — no dollars.
   */
  precision: CostRollupPrecision;
  sampleCount: number;
};

export type CostRollupView = {
  buckets: CostRollupBucket[];
  /** Sum of known totals across buckets (null if nothing known). */
  totalTokensKnown: number | null;
  totalEstimatedUsd: number | null;
  sessionsKnown: number;
  sessionsUnknown: number;
  /** True when there is nothing known and nothing unknown to report. */
  empty: boolean;
  /** Always false in product copy — never invoice-grade. */
  invoiceGrade: false;
  /** Grain used to build buckets. */
  groupBy: CostRollupGroupBy;
  /**
   * Aggregate dollar quality across buckets:
   * estimate if every $ bucket is estimate and no unknown sessions;
   * partial if any partial / unknown / rate gap;
   * none when no dollar figure at all.
   */
  precision: CostRollupPrecision;
};

export type LiveUsageMap = Record<
  string,
  {
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    modelId?: string | null;
    projectId?: string | null;
    projectName?: string | null;
    at?: string | number | null;
    source?: string | null;
  }
>;

// ── Storage ring (local only) ──────────────────────────────────────────

export const COST_USAGE_SAMPLES_STORAGE_KEY = "grok.costUsageSamples";
export const COST_USAGE_SAMPLES_MAX = 400;
/** Fired on `window` after record/clear (detail = samples). */
export const COST_USAGE_SAMPLES_CHANGE_EVENT = "grok-cost-usage-samples-change";

/** Minimal storage surface so unit tests need no jsdom. */
export interface CostUsageSamplesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function defaultStorage(): CostUsageSamplesStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

function notifySamplesChange(samples: CostUsageSample[]): void {
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(COST_USAGE_SAMPLES_CHANGE_EVENT, { detail: samples }),
      );
    } catch {
      /* ignore */
    }
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────

export function finiteTokenCount(
  n: number | null | undefined,
): number | null {
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * Calendar day key YYYY-MM-DD.
 * Uses local timezone when `utc` is false (default).
 */
export function dayKeyFromMs(
  ms: number,
  utc: boolean = false,
): string | null {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  if (utc) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dayKeyFromIso(
  iso: string | null | undefined,
  utc: boolean = false,
): string | null {
  if (iso == null || typeof iso !== "string") return null;
  const t = Date.parse(iso.trim());
  if (!Number.isFinite(t)) {
    // Already a day key?
    const m = iso.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1]! : null;
  }
  return dayKeyFromMs(t, utc);
}

/** Coarse token display (e.g. 12.3k). Returns "—" when unknown. */
export function formatRollupTokens(
  n: number | null | undefined,
): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return String(Math.floor(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`;
}

export { formatCostUsd };

/**
 * Honest dollar label for rollup UI.
 * - `none` or missing/invalid → "—"
 * - otherwise always `~$…` (never invoice-grade exact dollars)
 */
export function formatRollupEstimatedCost(
  usd: number | null | undefined,
  precision: CostRollupPrecision = "estimate",
): string {
  if (
    precision === "none" ||
    usd == null ||
    !Number.isFinite(usd) ||
    usd < 0
  ) {
    return "—";
  }
  return formatCostUsd(usd, true);
}

/** Merge bucket dollar qualities into a single view-level precision. */
export function mergeCostRollupPrecision(
  parts: readonly CostRollupPrecision[],
  opts?: { hasUnknownSessions?: boolean },
): CostRollupPrecision {
  let sawEstimate = false;
  let sawPartial = false;
  let sawNone = false;
  for (const p of parts) {
    if (p === "partial") sawPartial = true;
    else if (p === "estimate") sawEstimate = true;
    else sawNone = true;
  }
  const anyUsd = sawEstimate || sawPartial;
  // Unknown sessions, mixed rate coverage, or any partial bucket → incomplete $.
  if (anyUsd && (opts?.hasUnknownSessions || sawPartial || sawNone)) {
    return "partial";
  }
  if (sawEstimate) return "estimate";
  if (sawPartial) return "partial";
  return "none";
}

/**
 * Normalize a usage event / map entry into a sample, or null when no usable tokens.
 * Does **not** invent zeros.
 */
export function sampleFromUsageEvent(opts: {
  sessionId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  modelId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  source?: CostRollupSource | string | null;
  at?: string | number | null;
  nowMs?: number;
  utc?: boolean;
}): CostUsageSample | null {
  const sessionId =
    typeof opts.sessionId === "string" ? opts.sessionId.trim() : "";
  if (!sessionId) return null;

  const inputTokens = finiteTokenCount(opts.inputTokens);
  const outputTokens = finiteTokenCount(opts.outputTokens);
  let totalTokens = finiteTokenCount(opts.totalTokens);
  if (totalTokens == null && inputTokens != null && outputTokens != null) {
    totalTokens = inputTokens + outputTokens;
  }
  if (inputTokens == null && outputTokens == null && totalTokens == null) {
    return null;
  }

  const nowMs = opts.nowMs ?? Date.now();
  let atIso: string | undefined;
  if (typeof opts.at === "number" && Number.isFinite(opts.at)) {
    atIso = new Date(opts.at).toISOString();
  } else if (typeof opts.at === "string" && opts.at.trim()) {
    atIso = opts.at.trim();
  } else {
    atIso = new Date(nowMs).toISOString();
  }
  const day = dayKeyFromIso(atIso, opts.utc) ?? dayKeyFromMs(nowMs, opts.utc);
  if (!day) return null;

  const srcRaw =
    typeof opts.source === "string" ? opts.source.trim().toLowerCase() : "";
  let source: CostRollupSource = "usage";
  if (srcRaw === "journal_compact" || srcRaw === "compact") {
    source = "journal_compact";
  } else if (srcRaw === "live") {
    source = "live";
  } else if (srcRaw === "unknown") {
    source = "unknown";
  } else if (srcRaw === "usage" || !srcRaw) {
    source = "usage";
  } else {
    // ACP kind strings (turn_usage, context_usage, …) still count as live usage.
    source = "usage";
  }

  const projectId =
    opts.projectId == null || opts.projectId === ""
      ? null
      : String(opts.projectId);
  const projectName =
    opts.projectName == null || opts.projectName === ""
      ? null
      : String(opts.projectName);
  const modelId =
    opts.modelId == null || String(opts.modelId).trim() === ""
      ? null
      : String(opts.modelId).trim();

  return {
    sessionId,
    projectId,
    projectName,
    day,
    modelId,
    inputTokens,
    outputTokens,
    totalTokens,
    source,
    at: atIso,
  };
}

/**
 * Extract last-known usage from journal messages.
 * Uses context_compact `tokensAfter` only (honest snapshot — not cumulative spend).
 * Returns null when no known figure is present (never invents).
 */
export function extractKnownUsageFromJournalMessages(
  messages: ReadonlyArray<{
    id?: string;
    role?: string;
    content?: string;
    marker?: string | null;
    compactMeta?: {
      tokensBefore?: number;
      tokensAfter?: number;
      trigger?: string;
    } | null;
    createdAt?: string | null;
  }>,
  opts: {
    sessionId: string;
    projectId?: string | null;
    projectName?: string | null;
    modelId?: string | null;
    utc?: boolean;
  },
): CostUsageSample | null {
  if (!opts.sessionId || !messages?.length) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    const isCompact =
      m.marker === "context_compact" ||
      (m.role === "tool" &&
        !!(
          m.compactMeta ||
          (typeof m.content === "string" &&
            m.content.startsWith("context_compact"))
        ));
    if (!isCompact) continue;
    const tokensAfter = finiteTokenCount(m.compactMeta?.tokensAfter);
    if (tokensAfter == null) continue;
    return sampleFromUsageEvent({
      sessionId: opts.sessionId,
      projectId: opts.projectId,
      projectName: opts.projectName,
      modelId: opts.modelId,
      totalTokens: tokensAfter,
      source: "journal_compact",
      at: m.createdAt ?? undefined,
      utc: opts.utc,
    });
  }
  return null;
}

/** Convert a live usage map into samples (one per session with known tokens). */
export function samplesFromLiveUsageMap(
  map: LiveUsageMap | null | undefined,
  opts?: {
    sessionMeta?: ReadonlyArray<CostRollupSessionMeta>;
    projectMeta?: ReadonlyArray<CostRollupProjectMeta>;
    nowMs?: number;
    utc?: boolean;
  },
): CostUsageSample[] {
  if (!map) return [];
  const sessions = opts?.sessionMeta ?? [];
  const projects = opts?.projectMeta ?? [];
  const projectNameById = new Map(
    projects.map((p) => [p.id, (p.name || "").trim() || p.id]),
  );
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const out: CostUsageSample[] = [];
  for (const [sessionId, row] of Object.entries(map)) {
    if (!row) continue;
    const meta = sessionById.get(sessionId);
    const projectId =
      row.projectId !== undefined
        ? row.projectId
        : (meta?.projectId ?? null);
    const projectName =
      row.projectName ??
      (projectId ? projectNameById.get(projectId) ?? null : null);
    const sample = sampleFromUsageEvent({
      sessionId,
      projectId,
      projectName,
      modelId: row.modelId ?? meta?.modelId,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      source: row.source === "live" ? "live" : "usage",
      at: row.at ?? opts?.nowMs,
      nowMs: opts?.nowMs,
      utc: opts?.utc,
    });
    if (sample) out.push(sample);
  }
  return out;
}

/**
 * Keep one sample per session+day: prefer richer I/O split, then newer `at`.
 * Used when merging ring + live + journal extracts.
 */
export function dedupeUsageSamples(
  samples: readonly CostUsageSample[],
): CostUsageSample[] {
  const best = new Map<string, CostUsageSample>();
  for (const s of samples) {
    if (!s?.sessionId || !s.day) continue;
    const key = `${s.sessionId}\0${s.day}`;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, s);
      continue;
    }
    const score = (x: CostUsageSample) => {
      let n = 0;
      if (finiteTokenCount(x.inputTokens) != null) n += 2;
      if (finiteTokenCount(x.outputTokens) != null) n += 2;
      if (finiteTokenCount(x.totalTokens) != null) n += 1;
      // Prefer live usage over compact snapshot.
      if (x.source === "usage" || x.source === "live") n += 3;
      if (x.source === "journal_compact") n += 1;
      return n;
    };
    const sa = score(s);
    const sb = score(prev);
    if (sa > sb) {
      best.set(key, s);
      continue;
    }
    if (sa < sb) continue;
    const ta = s.at ? Date.parse(s.at) : 0;
    const tb = prev.at ? Date.parse(prev.at) : 0;
    if (ta >= tb) best.set(key, s);
  }
  return [...best.values()];
}

function addNullable(
  a: number | null,
  b: number | null,
): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

function estimateSampleUsd(sample: CostUsageSample): CostEstimateResult {
  return estimateCostUsd(
    {
      inputTokens: sample.inputTokens,
      outputTokens: sample.outputTokens,
      totalTokens: sample.totalTokens,
    },
    sample.modelId,
  );
}

/**
 * Aggregate known samples by project × day or session × day.
 * Optional `sessions` list marks sessions without samples as **unknown**.
 */
export function aggregateCostRollup(opts: {
  samples: readonly CostUsageSample[];
  sessions?: readonly CostRollupSessionMeta[];
  projects?: readonly CostRollupProjectMeta[];
  /** Only include days on/after this YYYY-MM-DD (inclusive). */
  sinceDay?: string | null;
  /** Only include days on/before this YYYY-MM-DD (inclusive). */
  untilDay?: string | null;
  /** Restrict to one project id (`""` / null = no filter). */
  projectId?: string | null;
  /**
   * When true with no `projectId`, keep only samples with `projectId == null`
   * (orphan / no project).
   */
  noProject?: boolean;
  /** Restrict to one session id. */
  sessionId?: string | null;
  /** Cap number of buckets returned (newest days first). */
  maxBuckets?: number;
  utc?: boolean;
  /**
   * `project` (default) — collapse sessions into project × day.
   * `session` — one row per session × day.
   */
  groupBy?: CostRollupGroupBy;
}): CostRollupView {
  const groupBy: CostRollupGroupBy =
    opts.groupBy === "session" ? "session" : "project";
  const projects = opts.projects ?? [];
  const projectNameById = new Map(
    projects.map((p) => [p.id, (p.name || "").trim() || p.id]),
  );
  const sessionById = new Map(
    (opts.sessions ?? []).map((s) => [s.id, s]),
  );

  const samples = filterCostUsageSamples(dedupeUsageSamples(opts.samples), {
    sinceDay: opts.sinceDay,
    untilDay: opts.untilDay,
    projectId: opts.projectId,
    noProject: opts.noProject,
    sessionId: opts.sessionId,
  });

  type Acc = {
    projectId: string | null;
    projectName: string | null;
    sessionId: string | null;
    sessionTitle: string | null;
    day: string;
    sessionIds: Set<string>;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    estimatedUsd: number | null;
    rateKnown: number;
    rateMissing: number;
    sampleCount: number;
  };

  const bucketKeyForSample = (s: CostUsageSample): string => {
    if (groupBy === "session") {
      return `s\0${s.sessionId}\0${s.day}`;
    }
    return `p\0${s.projectId ?? ""}\0${s.day}`;
  };

  const bucketKeyForUnknown = (
    projectId: string | null,
    sessionId: string,
    day: string,
  ): string => {
    if (groupBy === "session") {
      return `s\0${sessionId}\0${day}`;
    }
    return `p\0${projectId ?? ""}\0${day}`;
  };

  const buckets = new Map<string, Acc>();

  const ensureAcc = (
    key: string,
    seed: {
      projectId: string | null;
      projectName: string | null;
      sessionId: string | null;
      sessionTitle: string | null;
      day: string;
    },
  ): Acc => {
    let acc = buckets.get(key);
    if (!acc) {
      acc = {
        projectId: seed.projectId,
        projectName: seed.projectName,
        sessionId: seed.sessionId,
        sessionTitle: seed.sessionTitle,
        day: seed.day,
        sessionIds: new Set(),
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        estimatedUsd: null,
        rateKnown: 0,
        rateMissing: 0,
        sampleCount: 0,
      };
      buckets.set(key, acc);
    }
    return acc;
  };

  for (const s of samples) {
    const key = bucketKeyForSample(s);
    const meta = sessionById.get(s.sessionId);
    const projectId = s.projectId;
    const projectName =
      s.projectName ??
      (projectId ? projectNameById.get(projectId) ?? null : null);
    const sessionTitle =
      groupBy === "session"
        ? (meta?.title?.trim() || null)
        : null;
    const acc = ensureAcc(key, {
      projectId,
      projectName,
      sessionId: groupBy === "session" ? s.sessionId : null,
      sessionTitle,
      day: s.day,
    });
    if (
      !acc.projectName &&
      projectId &&
      projectNameById.has(projectId)
    ) {
      acc.projectName = projectNameById.get(projectId)!;
    }
    if (groupBy === "session" && !acc.sessionTitle && sessionTitle) {
      acc.sessionTitle = sessionTitle;
    }
    acc.sessionIds.add(s.sessionId);
    acc.sampleCount += 1;
    acc.inputTokens = addNullable(
      acc.inputTokens,
      finiteTokenCount(s.inputTokens),
    );
    acc.outputTokens = addNullable(
      acc.outputTokens,
      finiteTokenCount(s.outputTokens),
    );
    const tot =
      finiteTokenCount(s.totalTokens) ??
      (finiteTokenCount(s.inputTokens) != null &&
      finiteTokenCount(s.outputTokens) != null
        ? (s.inputTokens as number) + (s.outputTokens as number)
        : null);
    acc.totalTokens = addNullable(acc.totalTokens, tot);

    const est = estimateSampleUsd(s);
    if (est.totalUsd != null) {
      acc.estimatedUsd = (acc.estimatedUsd ?? 0) + est.totalUsd;
      acc.rateKnown += 1;
    } else if (tot != null || s.inputTokens != null || s.outputTokens != null) {
      acc.rateMissing += 1;
    }
  }

  // Unknown sessions: present on meta for a day but no known sample that day.
  const knownSessionDays = new Set(
    samples.map((s) => `${s.sessionId}\0${s.day}`),
  );
  const unknownByBucket = new Map<string, Set<string>>();

  for (const sess of opts.sessions ?? []) {
    if (!sess?.id) continue;
    const day = dayKeyFromIso(sess.updatedAt, opts.utc) ?? null;
    if (!day) continue;
    if (opts.sinceDay && day < opts.sinceDay) continue;
    if (opts.untilDay && day > opts.untilDay) continue;
    if (
      opts.sessionId != null &&
      String(opts.sessionId).trim() !== "" &&
      sess.id !== String(opts.sessionId).trim()
    ) {
      continue;
    }
    const projectId =
      sess.projectId == null || sess.projectId === ""
        ? null
        : String(sess.projectId);
    if (opts.noProject) {
      if (projectId != null) continue;
    } else if (
      opts.projectId != null &&
      String(opts.projectId).trim() !== ""
    ) {
      if (projectId !== String(opts.projectId).trim()) continue;
    }
    if (knownSessionDays.has(`${sess.id}\0${day}`)) continue;
    const key = bucketKeyForUnknown(projectId, sess.id, day);
    let set = unknownByBucket.get(key);
    if (!set) {
      set = new Set();
      unknownByBucket.set(key, set);
    }
    set.add(sess.id);
    // Ensure bucket exists for pure-unknown rows.
    ensureAcc(key, {
      projectId,
      projectName: projectId
        ? projectNameById.get(projectId) ?? null
        : null,
      sessionId: groupBy === "session" ? sess.id : null,
      sessionTitle:
        groupBy === "session"
          ? sess.title?.trim() || null
          : null,
      day,
    });
  }

  let list: CostRollupBucket[] = [...buckets.values()].map((acc) => {
    const key =
      groupBy === "session"
        ? `s\0${acc.sessionId ?? ""}\0${acc.day}`
        : `p\0${acc.projectId ?? ""}\0${acc.day}`;
    const unk = unknownByBucket.get(key)?.size ?? 0;
    // precision describes **dollar** quality only (tokens may still be known).
    let precision: CostRollupPrecision = "none";
    if (acc.estimatedUsd != null) {
      precision =
        acc.rateMissing > 0 || unk > 0 || acc.rateKnown < acc.sampleCount
          ? "partial"
          : "estimate";
    } else if (unk > 0 && acc.totalTokens != null) {
      // Tokens known for some sessions, unknown for others — still no $ figure.
      precision = "partial";
    } else if (
      acc.totalTokens != null &&
      acc.rateMissing > 0 &&
      acc.estimatedUsd == null
    ) {
      // Tokens known, rates missing entirely.
      precision = "none";
    }
    return {
      projectId: acc.projectId,
      projectName: acc.projectName,
      sessionId: acc.sessionId,
      sessionTitle: acc.sessionTitle,
      day: acc.day,
      sessionsKnown: acc.sessionIds.size,
      sessionsUnknown: unk,
      inputTokens: acc.inputTokens,
      outputTokens: acc.outputTokens,
      totalTokens: acc.totalTokens,
      estimatedUsd: acc.estimatedUsd,
      precision,
      sampleCount: acc.sampleCount,
    };
  });

  // Newest day first, then label (project or session title).
  list.sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? 1 : -1;
    const an =
      groupBy === "session"
        ? a.sessionTitle || a.sessionId || a.projectName || ""
        : a.projectName || a.projectId || "";
    const bn =
      groupBy === "session"
        ? b.sessionTitle || b.sessionId || b.projectName || ""
        : b.projectName || b.projectId || "";
    return an.localeCompare(bn);
  });

  const max = opts.maxBuckets;
  if (max != null && Number.isFinite(max) && max >= 0) {
    list = list.slice(0, Math.floor(max));
  }

  let totalTokensKnown: number | null = null;
  let totalEstimatedUsd: number | null = null;
  let sessionsKnown = 0;
  let sessionsUnknown = 0;
  const precisions: CostRollupPrecision[] = [];
  for (const b of list) {
    totalTokensKnown = addNullable(totalTokensKnown, b.totalTokens);
    totalEstimatedUsd = addNullable(totalEstimatedUsd, b.estimatedUsd);
    sessionsKnown += b.sessionsKnown;
    sessionsUnknown += b.sessionsUnknown;
    precisions.push(b.precision);
  }

  const empty =
    list.length === 0 ||
    (sessionsKnown === 0 &&
      sessionsUnknown === 0 &&
      totalTokensKnown == null);

  return {
    buckets: list,
    totalTokensKnown,
    totalEstimatedUsd,
    sessionsKnown,
    sessionsUnknown,
    empty,
    invoiceGrade: false,
    groupBy,
    precision: mergeCostRollupPrecision(precisions, {
      hasUnknownSessions: sessionsUnknown > 0,
    }),
  };
}

/**
 * Build a full view from ring samples + optional live map + journal samples.
 */
export function buildCostRollupView(opts: {
  samples?: readonly CostUsageSample[];
  liveMap?: LiveUsageMap | null;
  journalSamples?: readonly CostUsageSample[];
  sessions?: readonly CostRollupSessionMeta[];
  projects?: readonly CostRollupProjectMeta[];
  sinceDay?: string | null;
  untilDay?: string | null;
  projectId?: string | null;
  noProject?: boolean;
  sessionId?: string | null;
  maxBuckets?: number;
  nowMs?: number;
  utc?: boolean;
  groupBy?: CostRollupGroupBy;
}): CostRollupView {
  const fromLive = samplesFromLiveUsageMap(opts.liveMap, {
    sessionMeta: opts.sessions,
    projectMeta: opts.projects,
    nowMs: opts.nowMs,
    utc: opts.utc,
  });
  const merged = dedupeUsageSamples([
    ...(opts.samples ?? []),
    ...fromLive,
    ...(opts.journalSamples ?? []),
  ]);
  return aggregateCostRollup({
    samples: merged,
    sessions: opts.sessions,
    projects: opts.projects,
    sinceDay: opts.sinceDay,
    untilDay: opts.untilDay,
    projectId: opts.projectId,
    noProject: opts.noProject,
    sessionId: opts.sessionId,
    maxBuckets: opts.maxBuckets,
    utc: opts.utc,
    groupBy: opts.groupBy,
  });
}

/** Day key N calendar days ago from `nowMs` (inclusive window start). */
export function sinceDayDaysAgo(
  days: number,
  nowMs: number = Date.now(),
  utc: boolean = false,
): string {
  const n = Math.max(0, Math.floor(days));
  const d = new Date(nowMs);
  if (utc) {
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - (n > 0 ? n - 1 : 0));
  } else {
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (n > 0 ? n - 1 : 0));
  }
  return dayKeyFromMs(d.getTime(), utc) ?? "1970-01-01";
}

// ── Optional plain-text export summary ─────────────────────────────────

/**
 * Labels for `formatCostRollupExport`. English defaults keep the helper pure
 * and unit-testable without the i18n runtime; UI passes localized strings.
 */
export type CostRollupExportLabels = {
  title: string;
  disclaimer: string;
  groupByProject: string;
  groupBySession: string;
  /** Include `{days}` placeholder when a window is provided. */
  windowDays: string;
  knownTokens: string;
  estCost: string;
  sessionsKnown: string;
  sessionsUnknown: string;
  tokens: string;
  noProject: string;
  untitledSession: string;
  costUnknown: string;
  precisionEstimate: string;
  precisionPartial: string;
  precisionNone: string;
  /** Include `{count}` for unknown session note on a row. */
  unknownCount: string;
  empty: string;
  invoiceNote: string;
};

export const DEFAULT_COST_ROLLUP_EXPORT_LABELS: CostRollupExportLabels = {
  title: "Cost rollup summary",
  disclaimer:
    "Rough estimate from a static rates table — never invoice-grade. Missing usage is Unknown, not $0.",
  groupByProject: "Group by: project × day",
  groupBySession: "Group by: session × day",
  windowDays: "Window: last {days} day(s)",
  knownTokens: "Known tokens",
  estCost: "Est. cost",
  sessionsKnown: "Sessions known",
  sessionsUnknown: "Sessions unknown",
  tokens: "Tokens",
  noProject: "No project",
  untitledSession: "Untitled session",
  costUnknown: "—",
  precisionEstimate: "estimate",
  precisionPartial: "partial",
  precisionNone: "none",
  unknownCount: "{count} unknown",
  empty: "No known usage in this window.",
  invoiceNote: "Not invoice-grade.",
};

function applyTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    return v == null ? "" : String(v);
  });
}

function precisionLabel(
  precision: CostRollupPrecision,
  labels: CostRollupExportLabels,
): string {
  if (precision === "partial") return labels.precisionPartial;
  if (precision === "estimate") return labels.precisionEstimate;
  return labels.precisionNone;
}

/**
 * Format a cost rollup view as plain text (clipboard / download).
 * Pure — no DOM. Always states that figures are estimates.
 */
export function formatCostRollupExport(
  view: CostRollupView,
  opts?: {
    days?: number | null;
    labels?: Partial<CostRollupExportLabels> | null;
    generatedAt?: string | null;
  },
): string {
  const labels: CostRollupExportLabels = {
    ...DEFAULT_COST_ROLLUP_EXPORT_LABELS,
    ...(opts?.labels ?? {}),
  };
  const lines: string[] = [];
  lines.push(labels.title);
  if (opts?.generatedAt) {
    lines.push(`Generated: ${opts.generatedAt}`);
  }
  lines.push(
    view.groupBy === "session"
      ? labels.groupBySession
      : labels.groupByProject,
  );
  if (opts?.days != null && Number.isFinite(opts.days) && opts.days > 0) {
    lines.push(
      applyTemplate(labels.windowDays, { days: Math.floor(opts.days) }),
    );
  }
  lines.push(labels.disclaimer);
  lines.push(labels.invoiceNote);
  lines.push("");

  if (view.empty) {
    lines.push(labels.empty);
    return lines.join("\n").trimEnd() + "\n";
  }

  const totalCost =
    view.totalEstimatedUsd != null
      ? formatRollupEstimatedCost(view.totalEstimatedUsd, view.precision)
      : labels.costUnknown;
  lines.push(
    `${labels.knownTokens}: ${formatRollupTokens(view.totalTokensKnown)}`,
  );
  lines.push(
    `${labels.estCost}: ${totalCost} (${precisionLabel(view.precision, labels)})`,
  );
  lines.push(`${labels.sessionsKnown}: ${view.sessionsKnown}`);
  lines.push(`${labels.sessionsUnknown}: ${view.sessionsUnknown}`);
  lines.push("");

  for (const b of view.buckets) {
    const projectLabel =
      b.projectName || b.projectId || labels.noProject;
    const head =
      view.groupBy === "session"
        ? [
            b.day,
            b.sessionTitle || b.sessionId || labels.untitledSession,
            projectLabel,
          ].join(" · ")
        : `${b.day} · ${projectLabel}`;
    const cost =
      b.estimatedUsd != null
        ? formatRollupEstimatedCost(b.estimatedUsd, b.precision)
        : labels.costUnknown;
    const parts = [
      head,
      `${labels.tokens}: ${formatRollupTokens(b.totalTokens)}`,
      `${labels.estCost}: ${cost} (${precisionLabel(b.precision, labels)})`,
    ];
    if (b.sessionsKnown > 0 && view.groupBy === "project") {
      parts.push(`${labels.sessionsKnown}: ${b.sessionsKnown}`);
    }
    if (b.sessionsUnknown > 0) {
      parts.push(
        applyTemplate(labels.unknownCount, { count: b.sessionsUnknown }),
      );
    }
    lines.push(parts.join(" | "));
  }

  return lines.join("\n").trimEnd() + "\n";
}

// ── Parse / load / save ring ───────────────────────────────────────────

export function parseCostUsageSample(raw: unknown): CostUsageSample | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return sampleFromUsageEvent({
    sessionId: typeof o.sessionId === "string" ? o.sessionId : null,
    projectId:
      o.projectId == null
        ? null
        : typeof o.projectId === "string"
          ? o.projectId
          : null,
    projectName:
      typeof o.projectName === "string" ? o.projectName : null,
    modelId: typeof o.modelId === "string" ? o.modelId : null,
    inputTokens:
      typeof o.inputTokens === "number" ? o.inputTokens : null,
    outputTokens:
      typeof o.outputTokens === "number" ? o.outputTokens : null,
    totalTokens:
      typeof o.totalTokens === "number" ? o.totalTokens : null,
    source: typeof o.source === "string" ? o.source : "usage",
    at: typeof o.at === "string" ? o.at : undefined,
  });
}

export function loadCostUsageSamples(
  storage: CostUsageSamplesStorage = defaultStorage(),
): CostUsageSample[] {
  try {
    const raw = storage.getItem(COST_USAGE_SAMPLES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: CostUsageSample[] = [];
    for (const item of parsed) {
      const s = parseCostUsageSample(item);
      if (s) out.push(s);
    }
    return dedupeUsageSamples(out).slice(0, COST_USAGE_SAMPLES_MAX);
  } catch {
    return [];
  }
}

export function saveCostUsageSamples(
  samples: readonly CostUsageSample[],
  storage: CostUsageSamplesStorage = defaultStorage(),
): void {
  const deduped = dedupeUsageSamples(samples)
    .sort((a, b) => {
      const ta = a.at ? Date.parse(a.at) : 0;
      const tb = b.at ? Date.parse(b.at) : 0;
      return tb - ta;
    })
    .slice(0, COST_USAGE_SAMPLES_MAX);
  try {
    storage.setItem(
      COST_USAGE_SAMPLES_STORAGE_KEY,
      JSON.stringify(deduped),
    );
  } catch {
    /* private mode / quota */
  }
  notifySamplesChange(deduped);
}

/**
 * Upsert one sample into the ring (session+day dedupe). Returns new list.
 */
export function recordCostUsageSample(
  sample: CostUsageSample | null | undefined,
  storage: CostUsageSamplesStorage = defaultStorage(),
): CostUsageSample[] {
  if (!sample) return loadCostUsageSamples(storage);
  const prev = loadCostUsageSamples(storage);
  const next = dedupeUsageSamples([sample, ...prev]);
  saveCostUsageSamples(next, storage);
  return next;
}

export function clearCostUsageSamples(
  storage: CostUsageSamplesStorage = defaultStorage(),
): void {
  const plan = planClearCostUsageSamples(loadCostUsageSamples(storage));
  applyClearCostUsageSamplesPlan(plan, storage);
}

// ── COST-USAGE-PRO — filters · empty honesty · clear plan · export soft-fail ─

/**
 * Sample filter for project / session / calendar window.
 * Empty / null fields are no-ops. `noProject` keeps only orphan samples.
 */
export type CostRollupSampleFilter = {
  sessionId?: string | null;
  projectId?: string | null;
  /** When true, keep samples with null/empty projectId (orphans). */
  noProject?: boolean;
  /** Inclusive lower day bound YYYY-MM-DD. */
  sinceDay?: string | null;
  /** Inclusive upper day bound YYYY-MM-DD. */
  untilDay?: string | null;
};

/**
 * Pure filter of known samples by session / project / day window.
 * Does not invent samples; preserves order of input after filter.
 */
export function filterCostUsageSamples(
  samples: readonly CostUsageSample[],
  filter?: CostRollupSampleFilter | null,
): CostUsageSample[] {
  if (!samples?.length) return [];
  if (!filter) return [...samples];
  const sessionId =
    typeof filter.sessionId === "string" && filter.sessionId.trim()
      ? filter.sessionId.trim()
      : null;
  const projectId =
    !filter.noProject &&
    typeof filter.projectId === "string" &&
    filter.projectId.trim()
      ? filter.projectId.trim()
      : null;
  const noProject = Boolean(filter.noProject);
  const sinceDay =
    typeof filter.sinceDay === "string" && filter.sinceDay.trim()
      ? filter.sinceDay.trim()
      : null;
  const untilDay =
    typeof filter.untilDay === "string" && filter.untilDay.trim()
      ? filter.untilDay.trim()
      : null;

  return samples.filter((s) => {
    if (!s?.sessionId || !s.day) return false;
    if (sessionId && s.sessionId !== sessionId) return false;
    if (noProject) {
      if (s.projectId != null && s.projectId !== "") return false;
    } else if (projectId) {
      if (s.projectId !== projectId) return false;
    }
    if (sinceDay && s.day < sinceDay) return false;
    if (untilDay && s.day > untilDay) return false;
    return true;
  });
}

/** True when project or session filter would narrow the list (not time alone). */
export function hasActiveCostRollupScopeFilter(opts?: {
  projectId?: string | null;
  noProject?: boolean;
  sessionId?: string | null;
}): boolean {
  if (opts?.noProject) return true;
  if (typeof opts?.projectId === "string" && opts.projectId.trim()) return true;
  if (typeof opts?.sessionId === "string" && opts.sessionId.trim()) return true;
  return false;
}

/** One chip for project (or all / no-project) filter UIs. */
export type CostRollupProjectChip = {
  /** Stable id: `"all"` | `"noproject"` | project id. */
  id: string;
  /** Display label (caller may localize `"all"` / `"noproject"`). */
  label: string;
  projectId: string | null;
  noProject: boolean;
  /** Sample count in the (time-windowed) set that feed this chip. */
  count: number;
};

/** One chip for session filter UIs. */
export type CostRollupSessionChip = {
  id: string;
  label: string;
  sessionId: string;
  projectId: string | null;
  count: number;
};

/**
 * Build project filter chips from samples (optional time window already applied).
 * Always includes an `"all"` chip first. Includes `"noproject"` when orphans exist.
 */
export function listCostRollupProjectChips(
  samples: readonly CostUsageSample[],
  projects?: readonly CostRollupProjectMeta[] | null,
): CostRollupProjectChip[] {
  const projectNameById = new Map(
    (projects ?? []).map((p) => [p.id, (p.name || "").trim() || p.id]),
  );
  const counts = new Map<string, { projectId: string | null; count: number; name: string | null }>();
  let orphanCount = 0;
  for (const s of samples) {
    if (!s?.sessionId) continue;
    if (s.projectId == null || s.projectId === "") {
      orphanCount += 1;
      continue;
    }
    const prev = counts.get(s.projectId);
    if (prev) {
      prev.count += 1;
      if (!prev.name && s.projectName) prev.name = s.projectName;
    } else {
      counts.set(s.projectId, {
        projectId: s.projectId,
        count: 1,
        name: s.projectName ?? projectNameById.get(s.projectId) ?? null,
      });
    }
  }
  const chips: CostRollupProjectChip[] = [
    {
      id: "all",
      label: "all",
      projectId: null,
      noProject: false,
      count: samples.length,
    },
  ];
  const rows = [...counts.values()].sort((a, b) => {
    const an = a.name || a.projectId || "";
    const bn = b.name || b.projectId || "";
    return an.localeCompare(bn);
  });
  for (const r of rows) {
    chips.push({
      id: r.projectId!,
      label: r.name || r.projectId || "project",
      projectId: r.projectId,
      noProject: false,
      count: r.count,
    });
  }
  if (orphanCount > 0) {
    chips.push({
      id: "noproject",
      label: "noproject",
      projectId: null,
      noProject: true,
      count: orphanCount,
    });
  }
  return chips;
}

/**
 * Build session filter chips from samples. Always includes `"all"` first.
 * Labels prefer session title meta, then id.
 */
export function listCostRollupSessionChips(
  samples: readonly CostUsageSample[],
  sessions?: readonly CostRollupSessionMeta[] | null,
  max = 24,
): CostRollupSessionChip[] {
  const sessionById = new Map((sessions ?? []).map((s) => [s.id, s]));
  const counts = new Map<
    string,
    { sessionId: string; projectId: string | null; count: number }
  >();
  for (const s of samples) {
    if (!s?.sessionId) continue;
    const prev = counts.get(s.sessionId);
    if (prev) {
      prev.count += 1;
      if (prev.projectId == null && s.projectId != null) {
        prev.projectId = s.projectId;
      }
    } else {
      counts.set(s.sessionId, {
        sessionId: s.sessionId,
        projectId: s.projectId ?? null,
        count: 1,
      });
    }
  }
  const rows = [...counts.values()].sort((a, b) => {
    const at = sessionById.get(a.sessionId)?.title?.trim() || a.sessionId;
    const bt = sessionById.get(b.sessionId)?.title?.trim() || b.sessionId;
    return at.localeCompare(bt);
  });
  const cap = Math.max(0, Math.floor(max));
  const chips: CostRollupSessionChip[] = [
    {
      id: "all",
      label: "all",
      sessionId: "",
      projectId: null,
      count: samples.length,
    },
  ];
  for (const r of rows.slice(0, cap)) {
    const meta = sessionById.get(r.sessionId);
    chips.push({
      id: r.sessionId,
      label: meta?.title?.trim() || r.sessionId,
      sessionId: r.sessionId,
      projectId: r.projectId ?? meta?.projectId ?? null,
      count: r.count,
    });
  }
  return chips;
}

/** Honest empty-state kinds for the cost rollup hub. */
export type CostRollupEmptyKind =
  | "no_samples"
  | "empty_window"
  | "no_matches";

export type CostRollupEmptyState = {
  kind: CostRollupEmptyKind;
  /** i18n key for the empty title. */
  titleKey:
    | "costRollup.emptyTitle"
    | "costRollup.emptyWindowTitle"
    | "costRollup.emptyFilterTitle";
  /** i18n key for the empty body. */
  bodyKey:
    | "costRollup.emptyBody"
    | "costRollup.emptyWindowBody"
    | "costRollup.emptyFilterBody";
};

/**
 * Resolve contextual empty copy.
 * - `no_samples` — ring/live/journal produced zero known samples at all
 * - `empty_window` — samples exist outside the day window (or only unknown sessions)
 * - `no_matches` — project/session scope filter excluded everything in-window
 * Returns null when the view is not empty.
 */
export function resolveCostRollupEmptyState(opts: {
  viewEmpty: boolean;
  /** Total known samples before time/scope filters (ring + live + journal). */
  rawSampleCount: number;
  /** Known samples after time window only. */
  windowSampleCount: number;
  /** Known samples after time + project/session filters. */
  filteredSampleCount: number;
  hasScopeFilter?: boolean;
}): CostRollupEmptyState | null {
  if (!opts.viewEmpty) return null;
  const raw = Math.max(0, Math.floor(opts.rawSampleCount || 0));
  const win = Math.max(0, Math.floor(opts.windowSampleCount || 0));
  const filtered = Math.max(0, Math.floor(opts.filteredSampleCount || 0));
  if (raw === 0) {
    return {
      kind: "no_samples",
      titleKey: "costRollup.emptyTitle",
      bodyKey: "costRollup.emptyBody",
    };
  }
  if (opts.hasScopeFilter && win > 0 && filtered === 0) {
    return {
      kind: "no_matches",
      titleKey: "costRollup.emptyFilterTitle",
      bodyKey: "costRollup.emptyFilterBody",
    };
  }
  if (win === 0 || filtered === 0) {
    return {
      kind: "empty_window",
      titleKey: "costRollup.emptyWindowTitle",
      bodyKey: "costRollup.emptyWindowBody",
    };
  }
  // View empty but samples present (e.g. only unknown session markers with no tokens)
  return {
    kind: "empty_window",
    titleKey: "costRollup.emptyWindowTitle",
    bodyKey: "costRollup.emptyWindowBody",
  };
}

/**
 * Pure clear-all plan for the local sample ring.
 * Never mutates storage; never includes token totals in logMeta.
 */
export type ClearCostUsageSamplesPlan = {
  ok: true;
  /** Samples that would be removed. */
  count: number;
  /** Distinct session ids present (sorted). */
  sessionIds: string[];
  /** Distinct project ids present (sorted; orphans omitted). */
  projectIds: string[];
  /** Next list after clear (always empty). */
  next: CostUsageSample[];
  /** True when UI should confirm before applying. */
  confirmNeeded: boolean;
  /** Safe meta for logs — count only. */
  logMeta: { clearedCount: number } | null;
};

/**
 * Plan wiping the local cost usage sample ring (pure).
 * Use {@link applyClearCostUsageSamplesPlan} / {@link clearCostUsageSamples} to commit.
 */
export function planClearCostUsageSamples(
  samples: readonly CostUsageSample[] | null | undefined,
): ClearCostUsageSamplesPlan {
  const list = Array.isArray(samples) ? dedupeUsageSamples(samples) : [];
  const sessionSet = new Set<string>();
  const projectSet = new Set<string>();
  for (const s of list) {
    if (s.sessionId) sessionSet.add(s.sessionId);
    if (s.projectId) projectSet.add(s.projectId);
  }
  const count = list.length;
  return {
    ok: true,
    count,
    sessionIds: [...sessionSet].sort(),
    projectIds: [...projectSet].sort(),
    next: [],
    confirmNeeded: count > 0,
    logMeta: count > 0 ? { clearedCount: count } : null,
  };
}

/**
 * Apply a clear-all plan to storage and notify listeners.
 * Returns the empty list.
 */
export function applyClearCostUsageSamplesPlan(
  plan: ClearCostUsageSamplesPlan,
  storage: CostUsageSamplesStorage = defaultStorage(),
): CostUsageSample[] {
  try {
    storage.setItem(COST_USAGE_SAMPLES_STORAGE_KEY, "[]");
  } catch {
    /* private mode / quota */
  }
  notifySamplesChange([]);
  return plan.next;
}

/* ── Export soft-fail honesty ─────────────────────────────────────────── */

/** Export channel for cost rollup summary. */
export type CostRollupExportChannel = "copy" | "download";

/**
 * Soft-fail kinds for copy / download of the plain-text summary.
 * Never invents success from empty views.
 */
export type CostRollupExportSoftFailKind =
  | "empty"
  | "clipboard"
  | "download_failed"
  | "other";

export type CostRollupExportOutcome =
  | { ok: true; channel: CostRollupExportChannel }
  | {
      ok: false;
      kind: CostRollupExportSoftFailKind;
      channel: CostRollupExportChannel;
    };

function costRollupExportErrText(err: unknown): string {
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
    const o = err as { code?: unknown; message?: unknown; reason?: unknown };
    const parts = [o.code, o.message, o.reason]
      .filter((x) => x != null && String(x).trim())
      .map(String);
    if (parts.length) return parts.join(" ");
  }
  return String(err);
}

/**
 * Classify a thrown value into a stable export soft-fail kind.
 * Prefer explicit `code` over free-form text.
 */
export function classifyCostRollupExportError(
  err: unknown,
): CostRollupExportSoftFailKind {
  if (err == null || err === "") return "other";
  const code =
    typeof err === "object" &&
    err != null &&
    typeof (err as { code?: unknown }).code === "string"
      ? String((err as { code: string }).code).trim().toLowerCase()
      : "";
  if (code === "empty" || code === "empty_view" || code === "nothing") {
    return "empty";
  }
  if (code === "clipboard" || code === "clipboard_failed") return "clipboard";
  if (
    code === "download_failed" ||
    code === "download-failed" ||
    code === "write_failed" ||
    code === "save_failed"
  ) {
    return "download_failed";
  }

  const s = costRollupExportErrText(err).toLowerCase();
  if (!s.trim()) return "other";
  if (
    s.includes("nothing to export") ||
    s.includes("no known usage") ||
    s.includes("empty view") ||
    /^empty(\s+error)?$/.test(s.trim()) ||
    s.trim() === "error: empty"
  ) {
    return "empty";
  }
  if (
    s.includes("clipboard") ||
    s.includes("write text") ||
    s.includes("copy failed") ||
    s.includes("notallowed") ||
    s.includes("permission denied")
  ) {
    return "clipboard";
  }
  if (
    s.includes("download") ||
    s.includes("save failed") ||
    s.includes("write failed") ||
    s.includes("createobjecturl") ||
    s.includes("blob")
  ) {
    return "download_failed";
  }
  return "other";
}

/**
 * Resolve copy/download outcome for toast honesty.
 * Empty views always soft-fail as `empty` (never claim success).
 */
export function resolveCostRollupExportOutcome(opts: {
  channel: CostRollupExportChannel;
  /** True when the rollup view has nothing known to export. */
  empty: boolean;
  /** For copy: false when clipboard API failed without throwing. */
  copyOk?: boolean;
  /** Thrown error from clipboard / download path. */
  error?: unknown;
}): CostRollupExportOutcome {
  const channel = opts.channel === "download" ? "download" : "copy";
  if (opts.empty) {
    return { ok: false, kind: "empty", channel };
  }
  if (opts.error != null) {
    return {
      ok: false,
      kind: classifyCostRollupExportError(opts.error),
      channel,
    };
  }
  if (channel === "copy" && opts.copyOk === false) {
    return { ok: false, kind: "clipboard", channel };
  }
  return { ok: true, channel };
}

/**
 * i18n message key for an export outcome (success or soft-fail).
 * Keys must exist under `costRollup.*` in messages.
 */
export function costRollupExportOutcomeMessageKey(
  outcome: CostRollupExportOutcome,
):
  | "costRollup.exportCopied"
  | "costRollup.exportDownloaded"
  | "costRollup.exportEmpty"
  | "costRollup.exportCopyFailed"
  | "costRollup.exportDownloadFailed"
  | "costRollup.exportFailed" {
  if (outcome.ok) {
    return outcome.channel === "download"
      ? "costRollup.exportDownloaded"
      : "costRollup.exportCopied";
  }
  switch (outcome.kind) {
    case "empty":
      return "costRollup.exportEmpty";
    case "clipboard":
      return "costRollup.exportCopyFailed";
    case "download_failed":
      return "costRollup.exportDownloadFailed";
    default:
      return "costRollup.exportFailed";
  }
}
