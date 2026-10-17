import { describe, expect, it } from "vitest";
import {
  beginPetSpin,
  bounceOffsetY,
  pickPetSpinKind,
  PET_SPIN_KINDS,
  petSpinWantsBurst,
  spinBounceDuration,
  stepPetSpin,
} from "./markSpin";
import { spinWildDuration } from "./markOrbit";
import { resolvePetEyeInk } from "./petIdentity";

describe("pickPetSpinKind", () => {
  it("never repeats the previous kind when more than one exists", () => {
    for (const prev of PET_SPIN_KINDS) {
      for (let i = 0; i < 12; i++) {
        expect(pickPetSpinKind(prev)).not.toBe(prev);
      }
    }
  });

  it("covers the full Grok Bot roster", () => {
    expect(PET_SPIN_KINDS).toEqual([
      "turn1",
      "turn2Wide",
      "spinBounce",
      "spinDizzy",
      "turn1Burst",
      "spinWild",
    ]);
    expect(petSpinWantsBurst("turn1Burst")).toBe(true);
    expect(petSpinWantsBurst("spinWild")).toBe(true);
    expect(petSpinWantsBurst("turn1")).toBe(false);
  });
});

describe("stepPetSpin", () => {
  it("settles a one-turn spring", () => {
    const run = beginPetSpin("turn1", 0, 1);
    let sample = stepPetSpin(run, 0, 1 / 60);
    expect(sample.done).toBe(false);
    for (let i = 0; i < 240; i++) sample = stepPetSpin(run, i * 16, 1 / 60);
    expect(sample.done).toBe(true);
    expect(Math.abs(sample.spinAngle)).toBeGreaterThan(6);
  });

  it("scripted bounce hop then finishes", () => {
    const run = beginPetSpin("spinBounce", 0, 1);
    const mid = stepPetSpin(run, 350, 0.016);
    expect(mid.done).toBe(false);
    expect(Math.abs(mid.spinAngle)).toBeGreaterThan(1);
    run.bounceAt = 700;
    const hop = stepPetSpin(run, 950, 0.016);
    expect(hop.bounceY).not.toBe(0);
    const end = stepPetSpin(run, 700 + spinBounceDuration() * 1000 + 10, 0.016);
    expect(end.done).toBe(true);
  });

  it("spinWild lasts the scripted settle", () => {
    const run = beginPetSpin("spinWild", 0, 1);
    const mid = stepPetSpin(run, 1200, 0.016);
    expect(mid.done).toBe(false);
    expect(mid.wideStyle).toBe(true);
    const end = stepPetSpin(run, spinWildDuration() * 1000 + 1, 0.016);
    expect(end.done).toBe(true);
  });
});

describe("bounceOffsetY", () => {
  it("is a downward parabola in the first hop", () => {
    expect(bounceOffsetY(0)).toBeCloseTo(0);
    expect(bounceOffsetY(0.25)).toBeLessThan(0);
    expect(bounceOffsetY(spinBounceDuration())).toBeCloseTo(0);
  });
});

describe("resolvePetEyeInk", () => {
  it("uses light eyes on a black body in auto mode", () => {
    const ink = resolvePetEyeInk("black", "auto");
    expect(ink.toLowerCase()).not.toBe("#111111");
    expect(ink.toLowerCase()).not.toBe("#161616");
    expect(ink.startsWith("#F") || ink.startsWith("#f")).toBe(true);
  });

  it("paints explicit black and white eyes as picked", () => {
    expect(resolvePetEyeInk("green", "black")).toBe("#111111");
    expect(resolvePetEyeInk("black", "black")).toBe("#111111");
    expect(resolvePetEyeInk("black", "white")).toBe("#F4F4F5");
    expect(resolvePetEyeInk("green", "blue")).toBe("#1084FE");
  });

  it("auto on a white body uses dark eyes", () => {
    expect(resolvePetEyeInk("white", "auto")).toBe("#161616");
  });
});
