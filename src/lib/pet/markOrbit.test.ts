import { describe, expect, it } from "vitest";
import {
  ORBIT_PALETTE,
  SPIN_WILD,
  STAR_PATH,
  ribbonPaths,
  spinWildAt,
  spinWildDuration,
} from "./markOrbit";
import { shouldTriggerPetSpin } from "./petCelebrate";

describe("spinWildAt (Sand Or(\"spinWild\"))", () => {
  it("winds up slightly backward then finishes after the scripted settle", () => {
    const midWind = spinWildAt(0.12, 1);
    expect(midWind.done).toBe(false);
    expect(midWind.angle).toBeLessThan(0);

    const cruise = spinWildAt(SPIN_WILD.windup + SPIN_WILD.accel + 1, 1);
    expect(cruise.angle).toBeGreaterThan(Math.PI);
    expect(cruise.bodyRotDeg).toBeGreaterThan(100);

    const end = spinWildAt(spinWildDuration(), 1);
    expect(end.done).toBe(true);
    expect(end.angle).toBe(0);
  });

  it("mirrors when dir is negative", () => {
    const a = spinWildAt(1.2, 1);
    const b = spinWildAt(1.2, -1);
    expect(b.angle).toBeCloseTo(-a.angle, 8);
    expect(b.bodyRotDeg).toBeCloseTo(-a.bodyRotDeg, 8);
  });

  it("body rotation is three turns across the nine-orbit spin", () => {
    const sample = spinWildAt(
      SPIN_WILD.windup + SPIN_WILD.accel + SPIN_WILD.cruise + SPIN_WILD.decel,
      1,
    );
    expect(sample.bodyRotDeg).toBeCloseTo(3 * 360, 5);
    expect(sample.angle).toBeCloseTo(SPIN_WILD.turns * Math.PI * 2, 8);
  });
});

describe("ribbonPaths", () => {
  it("splits a tilted arc into front and back capsules", () => {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 7) * 1.2;
      pts.push({
        x: 114 + Math.sin(a) * 80,
        y: 114 - Math.cos(a) * 40,
        l: a,
        z: Math.cos(a),
      });
    }
    const { front, back } = ribbonPaths(pts, 8);
    expect(front.startsWith("M") || back.startsWith("M")).toBe(true);
    expect(front.includes("Z") || back.includes("Z")).toBe(true);
  });
});

describe("orbit catalog constants", () => {
  it("keeps the Sand six-hue belt palette and star path", () => {
    expect(ORBIT_PALETTE).toHaveLength(6);
    expect(STAR_PATH.startsWith("M")).toBe(true);
    expect(STAR_PATH.endsWith("Z")).toBe(true);
  });
});

describe("shouldTriggerPetSpin", () => {
  it("ignores the first snapshot", () => {
    expect(
      shouldTriggerPetSpin({
        primed: false,
        prevKind: null,
        nextKind: "ready",
      }),
    ).toBe(false);
  });

  it("fires when focus becomes ready", () => {
    expect(
      shouldTriggerPetSpin({
        primed: true,
        prevKind: "working",
        nextKind: "ready",
      }),
    ).toBe(true);
  });

  it("stays quiet while another session is still working", () => {
    expect(
      shouldTriggerPetSpin({
        primed: true,
        prevKind: "working",
        nextKind: "working",
      }),
    ).toBe(false);
  });

  it("stays quiet while the same ready chip remains", () => {
    expect(
      shouldTriggerPetSpin({
        primed: true,
        prevKind: "ready",
        nextKind: "ready",
      }),
    ).toBe(false);
  });

  it("fires when live work ends even if the chat is already in view", () => {
    expect(
      shouldTriggerPetSpin({
        primed: true,
        prevKind: "working",
        nextKind: "idle",
      }),
    ).toBe(true);
  });

  it("fires when a done chip appears after live work", () => {
    expect(
      shouldTriggerPetSpin({
        primed: true,
        prevKind: "idle",
        nextKind: "idle",
        prevDoneIds: new Set(),
        nextDoneIds: new Set(["s1"]),
      }),
    ).toBe(true);
  });

  it("does not celebrate a peer chip while another session is still live", () => {
    expect(
      shouldTriggerPetSpin({
        primed: true,
        prevKind: "working",
        nextKind: "working",
        prevDoneIds: new Set(),
        nextDoneIds: new Set(["peer"]),
      }),
    ).toBe(false);
  });
});
