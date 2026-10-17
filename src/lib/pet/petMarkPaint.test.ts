import { describe, expect, it } from "vitest";
import {
  PET_LOOK_NEAR_SCALE,
  PET_PAINT_IDLE_MS,
  PET_PAINT_LIVE_MS,
  PET_PAINT_REST_AFTER_MS,
  PET_PAINT_REST_MS,
  PET_PAINT_SPIN_MS,
  petLocalLookAxes,
  petLookIsNear,
  petPaintMinMs,
} from "./petMarkPaint";

describe("petPaintMinMs", () => {
  it("keeps celebrate spin at full cadence", () => {
    expect(
      petPaintMinMs({
        spinning: true,
        morphing: false,
        trackingLook: false,
        idleMs: 60_000,
      }),
    ).toBe(PET_PAINT_SPIN_MS);
  });

  it("raises the floor while morphing or looking at the pointer", () => {
    expect(
      petPaintMinMs({
        spinning: false,
        morphing: true,
        trackingLook: false,
        idleMs: 0,
      }),
    ).toBe(PET_PAINT_SPIN_MS);
    expect(
      petPaintMinMs({
        spinning: false,
        morphing: false,
        trackingLook: true,
        idleMs: 0,
      }),
    ).toBe(PET_PAINT_LIVE_MS);
    expect(
      petPaintMinMs({
        spinning: false,
        morphing: false,
        trackingLook: false,
        catalogLive: true,
        idleMs: 60_000,
      }),
    ).toBe(PET_PAINT_LIVE_MS);
  });

  it("drops to a rest cadence after a long idle", () => {
    expect(
      petPaintMinMs({
        spinning: false,
        morphing: false,
        trackingLook: false,
        idleMs: 0,
      }),
    ).toBe(PET_PAINT_IDLE_MS);
    expect(
      petPaintMinMs({
        spinning: false,
        morphing: false,
        trackingLook: false,
        idleMs: PET_PAINT_REST_AFTER_MS,
      }),
    ).toBe(PET_PAINT_REST_MS);
  });
});

describe("petLookIsNear", () => {
  it("keeps a moving screen-space cursor near the mark", () => {
    expect(
      petLookIsNear({
        fromScreen: true,
        at: 9_500,
        now: 10_000,
        dx: 8,
        dy: 4,
        localR: 64,
      }),
    ).toBe(true);
    expect(
      petLookIsNear({
        fromScreen: true,
        at: 9_500,
        now: 10_000,
        dx: 200,
        dy: 200,
        localR: 64,
      }),
    ).toBe(false);
  });

  it("expires a parked screen-space cursor so idle paint tiers resume", () => {
    expect(
      petLookIsNear({
        fromScreen: true,
        at: 1,
        now: 10_000,
        dx: 8,
        dy: 4,
        localR: 64,
      }),
    ).toBe(false);
    expect(
      petLookIsNear({
        fromScreen: true,
        at: 9_500,
        now: 10_000,
        dx: 8,
        dy: 4,
        localR: 64,
      }),
    ).toBe(true);
  });

  it("maps a near screen-space cursor onto radius-normalized look axes", () => {
    expect(
      petLocalLookAxes({
        fromScreen: true,
        at: 9_500,
        now: 10_000,
        dx: 16,
        dy: -8,
        localR: 64,
      }),
    ).toEqual({ nx: 16 / 64, ny: -8 / 64 });
    expect(
      petLocalLookAxes({
        fromScreen: true,
        at: 9_500,
        now: 10_000,
        dx: 200,
        dy: 200,
        localR: 64,
      }),
    ).toBeNull();
  });

  it("treats in-window pointer as local only while it stays near the mark", () => {
    const box = { left: 100, top: 100, width: 128, height: 128 };
    expect(
      petLocalLookAxes({
        fromScreen: false,
        at: 1000,
        now: 1100,
        dx: 164,
        dy: 164,
        localR: 0,
        box,
      }),
    ).toEqual({ nx: 0, ny: 0 });
    const onCheek = petLocalLookAxes({
      fromScreen: false,
      at: 1000,
      now: 1100,
      dx: 100 + 128 * 0.75,
      dy: 164,
      localR: 0,
      box,
    });
    expect(onCheek).not.toBeNull();
    expect(onCheek!.nx).toBeGreaterThan(0);
    expect(Math.abs(onCheek!.ny)).toBeLessThan(0.05);
    expect(
      petLocalLookAxes({
        fromScreen: false,
        at: 1000,
        now: 1100,
        dx: 800,
        dy: 164,
        localR: 0,
        box,
      }),
    ).toBeNull();
    expect(
      petLocalLookAxes({
        fromScreen: false,
        at: 1000,
        now: 2000,
        dx: 164,
        dy: 164,
        localR: 0,
        box,
      }),
    ).toBeNull();
  });

  it("keeps the local look ring at PET_LOOK_NEAR_SCALE radii", () => {
    expect(PET_LOOK_NEAR_SCALE).toBeGreaterThan(1);
    const atBoundary = petLocalLookAxes({
      fromScreen: true,
      at: 9_500,
      now: 10_000,
      dx: 64 * PET_LOOK_NEAR_SCALE,
      dy: 0,
      localR: 64,
    });
    expect(atBoundary).toEqual({ nx: PET_LOOK_NEAR_SCALE, ny: 0 });
  });

  it("expires overlay pointer events after a short hold", () => {
    expect(
      petLookIsNear({
        fromScreen: false,
        at: 1000,
        now: 1100,
        dx: 0,
        dy: 0,
        localR: 64,
      }),
    ).toBe(true);
    expect(
      petLookIsNear({
        fromScreen: false,
        at: 1000,
        now: 2000,
        dx: 0,
        dy: 0,
        localR: 64,
      }),
    ).toBe(false);
  });
});
