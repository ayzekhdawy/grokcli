import { describe, expect, it } from "vitest";
import {
  analyzeStreamJsonFrame,
  appendValidationTimeline,
  assessStreamStructured,
  buildStructuredExport,
  extractPartialObjectKeys,
  formatValidationTimelinePath,
  hasKnownStructuredUsage,
  pickKnownStructuredUsage,
  replayValidationTimeline,
  scanJsonOpenDepth,
  streamPhaseTone,
} from "./streamJsonPipe";

const nameSchema = JSON.stringify({
  type: "object",
  required: ["name"],
  properties: { name: { type: "string" }, age: { type: "number" } },
});

describe("scanJsonOpenDepth", () => {
  it("reports no root when no braces", () => {
    expect(scanJsonOpenDepth("hello")).toEqual({
      openDepth: 0,
      sawRoot: false,
      rootIndex: -1,
    });
  });

  it("counts open braces outside strings", () => {
    const r = scanJsonOpenDepth('{"a":1');
    expect(r.sawRoot).toBe(true);
    expect(r.openDepth).toBe(1);
    expect(r.rootIndex).toBe(0);
  });

  it("ignores braces inside strings", () => {
    const r = scanJsonOpenDepth('{"a":"{x}"}');
    expect(r.openDepth).toBe(0);
  });

  it("handles nested objects", () => {
    expect(scanJsonOpenDepth('{"a":{"b":1}').openDepth).toBe(1);
    expect(scanJsonOpenDepth('{"a":{"b":1}}').openDepth).toBe(0);
  });
});

describe("extractPartialObjectKeys", () => {
  it("extracts keys from complete objects", () => {
    expect(extractPartialObjectKeys('{"name":"Ada","age":1}')).toEqual([
      "name",
      "age",
    ]);
  });

  it("extracts keys from incomplete objects", () => {
    expect(extractPartialObjectKeys('{"name":"Ada","age":')).toEqual([
      "name",
      "age",
    ]);
    expect(extractPartialObjectKeys('{"name":')).toEqual(["name"]);
  });

  it("skips nested keys", () => {
    expect(
      extractPartialObjectKeys('{"outer":{"inner":1},"tail":2}'),
    ).toEqual(["outer", "tail"]);
  });

  it("returns empty for arrays / non-objects", () => {
    expect(extractPartialObjectKeys("[1,2]")).toEqual([]);
    expect(extractPartialObjectKeys("nope")).toEqual([]);
  });
});

describe("analyzeStreamJsonFrame", () => {
  it("empty content", () => {
    const f = analyzeStreamJsonFrame("", { streaming: true });
    expect(f.kind).toBe("empty");
    expect(f.streaming).toBe(true);
  });

  it("marks incomplete JSON as partial while streaming", () => {
    const f = analyzeStreamJsonFrame('{"name":"A', { streaming: true });
    expect(f.kind).toBe("partial");
    expect(f.openDepth).toBeGreaterThan(0);
    expect(f.partialKeys).toContain("name");
    expect(f.pretty).toBeNull();
  });

  it("completes when full object arrives mid-stream", () => {
    const f = analyzeStreamJsonFrame('{"name":"Ada"}', { streaming: true });
    expect(f.kind).toBe("complete");
    expect(f.pretty).toContain('"name"');
    expect(f.partialKeys).toEqual(["name"]);
  });

  it("marks non-JSON as invalid when not streaming", () => {
    const f = analyzeStreamJsonFrame("Just prose.", { streaming: false });
    expect(f.kind).toBe("invalid");
  });

  it("keeps non-JSON as partial while streaming", () => {
    const f = analyzeStreamJsonFrame("Just prose.", { streaming: true });
    expect(f.kind).toBe("partial");
  });
});

describe("assessStreamStructured", () => {
  it("reports partial while streaming incomplete JSON", () => {
    const a = assessStreamStructured('{"name":', nameSchema, {
      streaming: true,
    });
    expect(a.phase).toBe("partial");
    expect(a.status).toBe("partial");
    expect(a.pretty).toBeNull();
  });

  it("validates complete JSON against schema during stream", () => {
    const a = assessStreamStructured('{"name":"Ada"}', nameSchema, {
      streaming: true,
    });
    expect(a.phase).toBe("valid");
    expect(a.pretty).toContain("Ada");
  });

  it("schema_mismatch when required field missing", () => {
    const a = assessStreamStructured('{"other":1}', nameSchema, {
      streaming: false,
    });
    expect(a.phase).toBe("schema_mismatch");
    expect(a.missingRequired).toEqual(["name"]);
    expect(a.pretty).not.toBeNull();
  });

  it("invalid_json only when finished and not parseable", () => {
    const a = assessStreamStructured("nope", nameSchema, {
      streaming: false,
    });
    expect(a.phase).toBe("invalid_json");
  });

  it("empty phase for blank content", () => {
    expect(
      assessStreamStructured("  ", null, { streaming: true }).phase,
    ).toBe("empty");
  });
});

describe("validation timeline", () => {
  it("appends only on phase change", () => {
    let t = appendValidationTimeline(
      [],
      assessStreamStructured("", null, { streaming: true }),
      { contentLength: 0 },
    );
    expect(t).toHaveLength(1);
    expect(t[0]!.phase).toBe("empty");

    t = appendValidationTimeline(
      t,
      assessStreamStructured('{"a"', null, { streaming: true }),
      { contentLength: 4 },
    );
    expect(t.map((e) => e.phase)).toEqual(["empty", "partial"]);

    // Same phase → update in place
    t = appendValidationTimeline(
      t,
      assessStreamStructured('{"a":1', null, { streaming: true }),
      { contentLength: 6 },
    );
    expect(t).toHaveLength(2);
    expect(t[1]!.contentLength).toBe(6);

    t = appendValidationTimeline(
      t,
      assessStreamStructured('{"a":1}', null, { streaming: true }),
      { contentLength: 7 },
    );
    expect(t.map((e) => e.phase)).toEqual(["empty", "partial", "valid"]);
  });

  it("replays samples into a path", () => {
    const samples = [
      { content: "", atMs: 0 },
      { content: "{", atMs: 10 },
      { content: '{"name":"A"', atMs: 20 },
      { content: '{"name":"Ada"}', atMs: 30 },
    ];
    const t = replayValidationTimeline(samples, nameSchema);
    expect(formatValidationTimelinePath(t)).toBe("empty → partial → valid");
    expect(t[t.length - 1]!.phase).toBe("valid");
  });

  it("final sample can stay streaming", () => {
    const t = replayValidationTimeline(
      [{ content: '{"x":' }, { content: '{"x":1' }],
      null,
      { finalStreaming: true },
    );
    expect(t[t.length - 1]!.phase).toBe("partial");
  });
});

describe("usage + export", () => {
  it("pickKnownStructuredUsage ignores empty / non-finite", () => {
    expect(pickKnownStructuredUsage(null)).toBeNull();
    expect(pickKnownStructuredUsage({})).toBeNull();
    expect(pickKnownStructuredUsage({ inputTokens: NaN })).toBeNull();
    expect(
      pickKnownStructuredUsage({ inputTokens: 10, outputTokens: 5 }),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
    expect(pickKnownStructuredUsage({ totalTokens: 42 })).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: 42,
    });
    expect(hasKnownStructuredUsage({ totalTokens: 1 })).toBe(true);
    expect(hasKnownStructuredUsage({})).toBe(false);
  });

  it("buildStructuredExport requires pretty JSON", () => {
    expect(buildStructuredExport(null)).toBeNull();
    expect(buildStructuredExport("  ")).toBeNull();
    const p = buildStructuredExport('{"a":1}', { basename: "result.json" });
    expect(p).toEqual({
      json: '{"a":1}',
      filename: "result.json",
      mime: "application/json",
    });
  });
});

describe("streamPhaseTone", () => {
  it("maps phases to bar tones", () => {
    expect(streamPhaseTone("valid")).toBe("ok");
    expect(streamPhaseTone("schema_mismatch")).toBe("warn");
    expect(streamPhaseTone("partial")).toBe("stream");
    expect(streamPhaseTone("empty")).toBe("stream");
    expect(streamPhaseTone("invalid_json")).toBe("err");
  });
});
