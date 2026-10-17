import { describe, expect, it } from "vitest";
import {
  AGENTS_JSON_MAX_CHARS,
  agentsJsonSpawnArgs,
  hasAgentsJson,
  normalizeAgentsJson,
  parseAgentsJson,
} from "./agentsJson";

describe("parseAgentsJson", () => {
  it("treats empty as ok empty", () => {
    expect(parseAgentsJson(null)).toEqual({
      ok: true,
      empty: true,
      normalized: "",
      value: null,
    });
    const blank = parseAgentsJson("");
    expect(blank.ok && blank.empty).toBe(true);
    const ws = parseAgentsJson("   \n");
    expect(ws.ok && ws.empty).toBe(true);
  });

  it("accepts object maps and compact-normalizes", () => {
    const r = parseAgentsJson(
      '  {\n  "reviewer": { "description": "d", "prompt": "p" }\n}  ',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.empty).toBe(false);
    expect(r.normalized).toBe(
      '{"reviewer":{"description":"d","prompt":"p"}}',
    );
    expect(r.value).toEqual({
      reviewer: { description: "d", prompt: "p" },
    });
  });

  it("accepts empty object {}", () => {
    const r = parseAgentsJson("{}");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.empty).toBe(false);
    expect(r.normalized).toBe("{}");
  });

  it("rejects invalid JSON", () => {
    const r = parseAgentsJson("{not json");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("invalid_json");
  });

  it("rejects arrays, null, and primitives (CLI expects a map)", () => {
    for (const raw of ["[]", "null", '"x"', "1", "true"]) {
      const r = parseAgentsJson(raw);
      expect(r.ok, raw).toBe(false);
      if (r.ok) continue;
      expect(r.error).toBe("not_object");
    }
  });

  it("rejects oversized input", () => {
    const big = `{"a":"${"x".repeat(AGENTS_JSON_MAX_CHARS)}}`;
    const r = parseAgentsJson(big);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("too_large");
  });
});

describe("normalizeAgentsJson", () => {
  it("returns empty string for blank", () => {
    expect(normalizeAgentsJson("")).toBe("");
    expect(normalizeAgentsJson("  ")).toBe("");
  });

  it("returns compact JSON for valid objects", () => {
    expect(normalizeAgentsJson(' { "a": 1 } ')).toBe('{"a":1}');
  });

  it("returns null for invalid", () => {
    expect(normalizeAgentsJson("[1]")).toBeNull();
    expect(normalizeAgentsJson("{")).toBeNull();
  });
});

describe("agentsJsonSpawnArgs", () => {
  it("omits flag when empty or invalid", () => {
    expect(agentsJsonSpawnArgs("")).toBeNull();
    expect(agentsJsonSpawnArgs(null)).toBeNull();
    expect(agentsJsonSpawnArgs("   ")).toBeNull();
    expect(agentsJsonSpawnArgs("[1]")).toBeNull();
    expect(agentsJsonSpawnArgs("{")).toBeNull();
  });

  it("builds top-level --agents JSON", () => {
    expect(agentsJsonSpawnArgs('  {"x":{"prompt":"hi"}}  ')).toEqual([
      "--agents",
      '{"x":{"prompt":"hi"}}',
    ]);
    expect(agentsJsonSpawnArgs("{}")).toEqual(["--agents", "{}"]);
  });
});

describe("hasAgentsJson", () => {
  it("is true only for valid non-empty", () => {
    expect(hasAgentsJson("")).toBe(false);
    expect(hasAgentsJson("{}")).toBe(true);
    expect(hasAgentsJson("[]")).toBe(false);
  });
});
