import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_TURNS_CAP,
  MIN_AGENT_TURNS,
  hasSessionMaxAgentTurns,
  maxAgentTurnsSpawnArgs,
  normalizeMaxAgentTurns,
  resolveMaxAgentTurns,
} from "./sessionMaxAgentTurns";

describe("normalizeMaxAgentTurns", () => {
  it("returns null for nullish / empty / zero / invalid", () => {
    expect(normalizeMaxAgentTurns(null)).toBe(null);
    expect(normalizeMaxAgentTurns(undefined)).toBe(null);
    expect(normalizeMaxAgentTurns("")).toBe(null);
    expect(normalizeMaxAgentTurns("   ")).toBe(null);
    expect(normalizeMaxAgentTurns(0)).toBe(null);
    expect(normalizeMaxAgentTurns("0")).toBe(null);
    expect(normalizeMaxAgentTurns(-3)).toBe(null);
    expect(normalizeMaxAgentTurns(Number.NaN)).toBe(null);
    expect(normalizeMaxAgentTurns("nope")).toBe(null);
  });

  it("clamps to 1–200", () => {
    expect(normalizeMaxAgentTurns(1)).toBe(MIN_AGENT_TURNS);
    expect(normalizeMaxAgentTurns(50)).toBe(50);
    expect(normalizeMaxAgentTurns(200)).toBe(MAX_AGENT_TURNS_CAP);
    expect(normalizeMaxAgentTurns(999)).toBe(MAX_AGENT_TURNS_CAP);
    expect(normalizeMaxAgentTurns(0.4)).toBe(null); // rounds to 0 → inherit
    expect(normalizeMaxAgentTurns(1.6)).toBe(2);
    expect(normalizeMaxAgentTurns("  75  ")).toBe(75);
  });
});

describe("resolveMaxAgentTurns", () => {
  it("prefers session override over global", () => {
    expect(resolveMaxAgentTurns(40, 10)).toBe(40);
    expect(resolveMaxAgentTurns(null, 10)).toBe(10);
    expect(resolveMaxAgentTurns(0, 10)).toBe(10);
    expect(resolveMaxAgentTurns("", 10)).toBe(10);
    expect(resolveMaxAgentTurns(null, null)).toBe(null);
    expect(resolveMaxAgentTurns(0, 0)).toBe(null);
    expect(resolveMaxAgentTurns(999, 10)).toBe(200);
  });
});

describe("maxAgentTurnsSpawnArgs", () => {
  it("builds top-level --max-turns pair", () => {
    expect(maxAgentTurnsSpawnArgs(25)).toEqual(["--max-turns", "25"]);
  });

  it("omits the flag when empty after normalize", () => {
    expect(maxAgentTurnsSpawnArgs(null)).toEqual([]);
    expect(maxAgentTurnsSpawnArgs(0)).toEqual([]);
    expect(maxAgentTurnsSpawnArgs("")).toEqual([]);
  });

  it("does not place max-turns under agent/stdio flags", () => {
    const args = maxAgentTurnsSpawnArgs(12);
    expect(args[0]).toBe("--max-turns");
    expect(args).not.toContain("agent");
    expect(args).not.toContain("stdio");
  });
});

describe("hasSessionMaxAgentTurns", () => {
  it("is true only for a positive override", () => {
    expect(hasSessionMaxAgentTurns(10)).toBe(true);
    expect(hasSessionMaxAgentTurns(0)).toBe(false);
    expect(hasSessionMaxAgentTurns(null)).toBe(false);
  });
});
