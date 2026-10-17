import { describe, it, expect } from "vitest";
import { createScrollVelocityTracker } from "./scrollVelocity";

describe("createScrollVelocityTracker", () => {
  it("detects active motion when scrollTop changes", () => {
    const tracker = createScrollVelocityTracker();
    tracker.sample(100, 1000);
    const state = tracker.sample(150, 1016); // 50px in 16ms = ~3.125 px/ms
    expect(state.isMoving).toBe(true);
    expect(state.velocity).toBeCloseTo(3.125, 2);
  });

  it("settles to stopped when static across frames AND settle time elapsed", () => {
    const tracker = createScrollVelocityTracker({
      stopThresholdPxPerMs: 0.05,
      settleFrames: 3,
      settleTimeMs: 40,
    });
    tracker.sample(200, 1000);
    tracker.sample(200, 1016); // frame 1 (stillness began at 1000)
    tracker.sample(200, 1032); // frame 2
    const state = tracker.sample(200, 1048); // frame 3, still for 48ms >= 40ms
    expect(state.isMoving).toBe(false);
    expect(state.velocity).toBe(0);
  });

  it("does NOT settle during a brief lift-off event gap (frames ok, time not)", () => {
    // Default settleTimeMs = 160: a ~50ms contact→inertia gap at 120Hz used to
    // pass the 3-frame rule and fire settle work mid-gesture.
    const tracker = createScrollVelocityTracker({ settleFrames: 3 });
    tracker.sample(1000, 1000);
    tracker.sample(1100, 1008); // active drag
    // Lift-off gap: 6 static frames over ~50ms at 120Hz
    let state = tracker.sample(1100, 1016);
    for (let t = 1024; t <= 1056; t += 8) {
      state = tracker.sample(1100, t);
    }
    expect(state.isMoving).toBe(true);
    // Inertia resumes: motion continues seamlessly
    state = tracker.sample(1160, 1064);
    expect(state.isMoving).toBe(true);
    // True stop: stillness sustained past 160ms
    for (let t = 1072; t <= 1240; t += 8) {
      state = tracker.sample(1160, t);
    }
    expect(state.isMoving).toBe(false);
  });

  it("keeps isMoving=true immediately after reset until settle conditions elapse", () => {
    const tracker = createScrollVelocityTracker({ settleFrames: 3, settleTimeMs: 40 });
    tracker.sample(100, 1000);
    tracker.sample(500, 1016);
    // Gesture start reset
    tracker.reset(500, 1050);
    // First frame sampled after reset (even if dy=0) must NOT immediately declare stopped
    const frame1 = tracker.sample(500, 1066);
    expect(frame1.isMoving).toBe(true);
    const frame2 = tracker.sample(500, 1082);
    expect(frame2.isMoving).toBe(true);
    const frame3 = tracker.sample(500, 1098); // 3 frames + 48ms stillness
    expect(frame3.isMoving).toBe(false);
  });
});
