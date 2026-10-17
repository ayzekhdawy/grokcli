/**
 * High-precision scroll velocity and motion state tracker.
 *
 * Replaces setTimeout heuristics with instantaneous velocity derivatives:
 * v = |dy| / dt (px/ms). Motion settles to stopped only when velocity
 * stays below threshold across consecutive VSync frames AND for a minimum
 * wall-clock duration.
 *
 * The time floor matters on Windows precision touchpads: between the last
 * finger-contact wheel event and the first OS inertia event there is a short
 * gap (tens of ms). A frames-only rule (3 frames ≈ 25ms at 120Hz) declared
 * "settled" inside that gap, firing the heavy settle work (anchor flush,
 * window rebuild, hover restore) exactly at lift-off — which split one
 * gesture into two visibly separate segments with a freeze in between.
 */

export type ScrollVelocityState = {
  velocity: number; // px/ms
  isMoving: boolean;
  scrollTop: number;
  timestamp: number;
};

export type ScrollVelocityTrackerOptions = {
  /** Stop threshold in px/ms. Default 0.02 px/ms (~20px/s) */
  stopThresholdPxPerMs?: number;
  /** Number of consecutive static frames before declaring stop. Default 3 */
  settleFrames?: number;
  /**
   * Minimum continuous stillness (wall-clock ms) before declaring stop.
   * Default 160ms — longer than the contact→inertia event gap at lift-off.
   */
  settleTimeMs?: number;
};

export function createScrollVelocityTracker(options?: ScrollVelocityTrackerOptions) {
  const stopThreshold = options?.stopThresholdPxPerMs ?? 0.02;
  const minSettleFrames = options?.settleFrames ?? 3;
  const settleTimeMs = options?.settleTimeMs ?? 160;
  let lastTop = 0;
  let lastTime = 0;
  let staticFrameCount = 0;
  /** Timestamp when continuous stillness began; -1 while moving. */
  let stillSince = -1;

  return {
    sample(scrollTop: number, nowMs: number): ScrollVelocityState {
      if (lastTime === 0) {
        lastTop = scrollTop;
        lastTime = nowMs;
        staticFrameCount = 0;
        stillSince = -1;
        return { velocity: 0, isMoving: false, scrollTop, timestamp: nowMs };
      }
      const dt = Math.max(1, nowMs - lastTime);
      const dy = Math.abs(scrollTop - lastTop);
      const velocity = dy / dt;

      if (velocity < stopThreshold) {
        staticFrameCount++;
        // Position has not changed since the previous sample, so stillness
        // began then — not now.
        if (stillSince < 0) stillSince = lastTime;
      } else {
        staticFrameCount = 0;
        stillSince = -1;
      }

      lastTop = scrollTop;
      lastTime = nowMs;

      const settled =
        staticFrameCount >= minSettleFrames &&
        stillSince >= 0 &&
        nowMs - stillSince >= settleTimeMs;
      return {
        velocity: velocity < stopThreshold ? 0 : velocity,
        isMoving: !settled,
        scrollTop,
        timestamp: nowMs,
      };
    },

    reset(scrollTop = 0, nowMs = 0) {
      lastTop = scrollTop;
      lastTime = nowMs;
      staticFrameCount = 0;
      stillSince = -1;
    },
  };
}
