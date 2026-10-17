import { describe, expect, it } from "vitest";
import shapes from "@/lib/pet/data/shapes.json";
import eyes from "@/lib/pet/data/eyes.json";
import { STATE_TOPOLOGIES, verbToMarkState } from "@/lib/pet/markTables";
import { PET_SHAPES } from "@/lib/pet/petIdentity";
import {
  gazeFromDelta,
  gazeFromPointer,
  lerpPts,
  polyPath,
  spring,
  stepSpring,
} from "@/lib/pet/markMath";

describe("ported Sand mark catalog", () => {
  it("ships official Jo paths for picker shapes", () => {
    expect(PET_SHAPES).toContain("bean");
    expect(PET_SHAPES).toContain("leaf");
    for (const id of PET_SHAPES) {
      const rec = (shapes as Record<string, { path: string }>)[id];
      expect(rec?.path.startsWith("M"), id).toBe(true);
      expect(rec.path.length).toBeGreaterThan(40);
    }
  });

  it("ships 25 eye topologies of two 48-point eyes", () => {
    expect(eyes).toHaveLength(25);
    const pair = eyes[0] as number[][][];
    expect(pair).toHaveLength(2);
    expect(pair[0]).toHaveLength(48);
    expect(pair[0][0]).toHaveLength(2);
  });

  it("maps waiting to listening (original expectant pose)", () => {
    expect(verbToMarkState("waiting")).toBe("listening");
    expect(STATE_TOPOLOGIES.listening.length).toBeGreaterThan(0);
  });

  it("gazeFromDelta looks along the cursor vector, not a tiny nudge", () => {
    const farRight = gazeFromDelta(400, 0, 60);
    expect(farRight.x).toBeGreaterThan(20);
    expect(Math.abs(farRight.y)).toBeLessThan(0.01);
    const down = gazeFromDelta(0, 300, 60);
    expect(down.y).toBeGreaterThan(14);
    const near = gazeFromDelta(10, 0, 60);
    expect(near.x).toBeGreaterThan(0);
    expect(near.x).toBeLessThan(farRight.x);
    const origin = gazeFromDelta(0, 0, 60);
    expect(origin).toEqual({ x: 0, y: 0 });
  });

  it("gazeFromPointer looks toward the cursor relative to the mark", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    const mid = gazeFromPointer(50, 50, rect);
    expect(mid.x).toBeCloseTo(0, 5);
    expect(mid.y).toBeCloseTo(0, 5);
    const right = gazeFromPointer(100, 50, rect);
    expect(right.x).toBeGreaterThan(10);
    expect(Math.abs(right.y)).toBeLessThan(1);
    const upLeft = gazeFromPointer(0, 0, rect);
    expect(upLeft.x).toBeLessThan(0);
    expect(upLeft.y).toBeLessThan(0);
  });

  it("spring + lerp are the original stepping primitives", () => {
    const s = spring(0);
    s.t = 1;
    for (let i = 0; i < 40; i++) stepSpring(s, 10, 0.8, 1 / 60);
    expect(s.x).toBeGreaterThan(0.8);
    const out = lerpPts([[0, 0], [2, 2]], [[4, 4], [6, 6]], 0.5);
    expect(out[0]).toEqual([2, 2]);
    expect(polyPath([[1, 2], [3, 4]])).toBe("M1.00 2.00L3.00 4.00Z");
  });
});
