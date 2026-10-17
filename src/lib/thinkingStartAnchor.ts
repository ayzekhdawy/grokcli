/**
 * Live “思考中 / Thinking for” wall-clock.
 *
 * The workbench turn clock can briefly (or leftover) be an older session’s
 * start. Thinking.tsx used to only pull the anchor *earlier*, so a stale
 * 50-minute clock stuck, and a later correction (this turn’s real start)
 * was ignored. After remount the same block showed the honest duration.
 */

export function parseCreatedAtMs(
  value: string | number | null | undefined,
): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Date.parse(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Next live-timer origin.
 *
 * - Trust `startedAt` whenever it is a finite number (earlier *or* later).
 * - If `startedAt` is missing, keep the previous origin so a remount flicker
 *   does not reset to “1s”.
 * - First paint with no clock: `nowMs`.
 */
export function nextThinkingStartAnchor(opts: {
  prevAnchor: number | null;
  startedAt: number | null | undefined;
  nowMs: number;
}): number {
  const incoming =
    typeof opts.startedAt === "number" && Number.isFinite(opts.startedAt)
      ? opts.startedAt
      : null;
  if (incoming != null) return incoming;
  if (opts.prevAnchor != null) return opts.prevAnchor;
  return opts.nowMs;
}

/**
 * Do not start the live timer before this assistant bubble existed.
 * A leftover previous-session `turnStartedAt` is older than `createdAt`
 * and would show “思考中 51分…”.
 */
export function clampThinkingStartToMessage(opts: {
  turnStartedAt: number | null | undefined;
  messageCreatedAtMs: number | null | undefined;
}): number | null {
  const turn =
    typeof opts.turnStartedAt === "number" &&
    Number.isFinite(opts.turnStartedAt)
      ? opts.turnStartedAt
      : null;
  const created =
    typeof opts.messageCreatedAtMs === "number" &&
    Number.isFinite(opts.messageCreatedAtMs)
      ? opts.messageCreatedAtMs
      : null;
  if (turn == null) return created;
  if (created == null) return turn;
  return Math.max(turn, created);
}

/** Minimal timeline unit shape for episode-clock decisions. */
export type TimelineClockUnit = {
  kind: string;
  si?: number;
};

/**
 * First bare thought in the bubble (placeholder → first CoT tokens).
 * A thought after a work phase or mid-turn body is a *new* episode and
 * must not inherit the turn clock.
 */
export function isLeadingThoughtUnit(
  units: TimelineClockUnit[],
  unitSi: number,
): boolean {
  for (const u of units) {
    if (u.kind === "thought" || u.kind === "thought-group") {
      return u.si === unitSi;
    }
    if (u.kind === "phase" || u.kind === "content" || u.kind === "tool") {
      return false;
    }
  }
  return false;
}

/**
 * Wall-clock origin for a thinking row.
 *
 * Only the leading live episode may use the turn send clock (so placeholder
 * → tokens does not reset to “1s”). Later episodes return null and start
 * from `Date.now()` on mount.
 */
export function thinkingUnitStartedAt(opts: {
  turnStartedAt: number | null | undefined;
  leading: boolean;
  unitStreaming: boolean;
}): number | null {
  if (!opts.unitStreaming || !opts.leading) return null;
  const turn = opts.turnStartedAt;
  return typeof turn === "number" && Number.isFinite(turn) ? turn : null;
}

/**
 * Freeze a finished thinking row from the episode origin that was ticking.
 * Do not fall back to a leftover turn clock — that painted “思考了 51分”
 * for a 10s thought after remount.
 */
export function freezeThinkingDurationMs(opts: {
  originMs: number | null | undefined;
  nowMs: number;
}): number | null {
  if (
    typeof opts.originMs !== "number" ||
    !Number.isFinite(opts.originMs)
  ) {
    return null;
  }
  return Math.max(0, opts.nowMs - opts.originMs);
}
