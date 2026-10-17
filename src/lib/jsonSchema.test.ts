import { describe, expect, it } from "vitest";
import {
  assessStructuredReply,
  extractStructuredJson,
  isActiveJsonSchema,
  JSON_SCHEMA_MAX_CHARS,
  parseJsonSchemaText,
  parseStructuredJsonContent,
  validateJsonAgainstSchema,
  wrapAgentTextWithJsonSchema,
} from "./jsonSchema";

describe("parseJsonSchemaText", () => {
  it("rejects empty / whitespace", () => {
    expect(parseJsonSchemaText("").ok).toBe(false);
    expect(parseJsonSchemaText("   \n").ok).toBe(false);
    const empty = parseJsonSchemaText("");
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toBe("empty");
  });

  it("rejects invalid JSON", () => {
    const r = parseJsonSchemaText("{type: object}");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_json");
  });

  it("rejects arrays and primitives", () => {
    expect(parseJsonSchemaText("[]").ok).toBe(false);
    expect(parseJsonSchemaText('"string"').ok).toBe(false);
    expect(parseJsonSchemaText("42").ok).toBe(false);
    expect(parseJsonSchemaText("null").ok).toBe(false);
    expect(parseJsonSchemaText("true").ok).toBe(false);
    for (const raw of ["[]", '"x"', "1", "null", "true"]) {
      const r = parseJsonSchemaText(raw);
      if (!r.ok) expect(r.error).toBe("not_object");
    }
  });

  it("accepts a minimal object schema and normalizes", () => {
    const r = parseJsonSchemaText(
      '{"type":"object","properties":{"name":{"type":"string"}}}',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("object");
      expect(r.normalized).toContain('"type": "object"');
      expect(JSON.parse(r.normalized)).toEqual(r.value);
    }
  });

  it("accepts nested schemas with $defs", () => {
    const raw = `{
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": { "items": { "type": "array", "items": { "type": "string" } } }
    }`;
    const r = parseJsonSchemaText(raw);
    expect(r.ok).toBe(true);
  });

  it("rejects oversized input", () => {
    const huge = `{"x":"${"a".repeat(JSON_SCHEMA_MAX_CHARS)}"}`;
    const r = parseJsonSchemaText(huge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("too_large");
  });
});

describe("isActiveJsonSchema", () => {
  it("is false for null/empty/invalid", () => {
    expect(isActiveJsonSchema(null)).toBe(false);
    expect(isActiveJsonSchema(undefined)).toBe(false);
    expect(isActiveJsonSchema("")).toBe(false);
    expect(isActiveJsonSchema("not-json")).toBe(false);
  });

  it("is true for valid object schema", () => {
    expect(isActiveJsonSchema('{"type":"object"}')).toBe(true);
  });
});

describe("extractStructuredJson", () => {
  it("pretty-prints whole-message JSON objects", () => {
    const out = extractStructuredJson('{"a":1,"b":[true]}');
    expect(out).toBe('{\n  "a": 1,\n  "b": [\n    true\n  ]\n}');
  });

  it("extracts fenced json blocks", () => {
    const out = extractStructuredJson(
      'Here you go:\n```json\n{"ok": true}\n```\nThanks.',
    );
    expect(out).toBe('{\n  "ok": true\n}');
  });

  it("extracts balanced object from prose", () => {
    const out = extractStructuredJson('Result: {"x": 1} end');
    expect(out).toBe('{\n  "x": 1\n}');
  });

  it("returns null for non-JSON assistant text", () => {
    expect(extractStructuredJson("Just a normal reply.")).toBeNull();
    expect(extractStructuredJson("")).toBeNull();
  });

  it("rejects primitive JSON roots", () => {
    expect(extractStructuredJson("42")).toBeNull();
    expect(extractStructuredJson('"hi"')).toBeNull();
  });
});

describe("wrapAgentTextWithJsonSchema", () => {
  it("prefixes user body with experimental instruction + schema", () => {
    const schema = '{\n  "type": "object"\n}';
    const out = wrapAgentTextWithJsonSchema("List names", schema);
    expect(out).toContain("[Structured output — experimental]");
    expect(out).toContain('"type": "object"');
    expect(out.endsWith("List names")).toBe(true);
  });

  it("works with empty body", () => {
    const out = wrapAgentTextWithJsonSchema("", '{"type":"object"}');
    expect(out).toContain("[Structured output — experimental]");
    expect(out).toContain('{"type":"object"}');
  });

  it("is a no-op when schema empty", () => {
    expect(wrapAgentTextWithJsonSchema("hi", "  ")).toBe("hi");
  });
});

describe("parseStructuredJsonContent", () => {
  it("returns empty for blank replies", () => {
    const r = parseStructuredJsonContent("  \n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("empty");
  });

  it("reports not_json honestly without throwing", () => {
    expect(() => parseStructuredJsonContent("Just prose.")).not.toThrow();
    const r = parseStructuredJsonContent("Just prose.");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("not_json");
      expect(r.message).toMatch(/not valid json/i);
    }
  });

  it("parses object and array roots", () => {
    const obj = parseStructuredJsonContent('{"a":1}');
    expect(obj.ok).toBe(true);
    if (obj.ok) {
      expect(obj.value).toEqual({ a: 1 });
      expect(obj.pretty).toContain('"a": 1');
    }
    const arr = parseStructuredJsonContent("[1, 2]");
    expect(arr.ok).toBe(true);
    if (arr.ok) expect(arr.value).toEqual([1, 2]);
  });
});

describe("validateJsonAgainstSchema", () => {
  it("is a no-op with no schema", () => {
    expect(validateJsonAgainstSchema({ a: 1 }, null).ok).toBe(true);
    expect(validateJsonAgainstSchema({ a: 1 }, undefined).ok).toBe(true);
  });

  it("checks root type object vs array", () => {
    const schema = { type: "object" };
    expect(validateJsonAgainstSchema({ a: 1 }, schema).ok).toBe(true);
    const bad = validateJsonAgainstSchema([1], schema);
    expect(bad.ok).toBe(false);
    expect(bad.issues.some((i) => i.kind === "type_mismatch")).toBe(true);
  });

  it("reports missing required fields", () => {
    const schema = {
      type: "object",
      required: ["name", "age"],
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
    };
    const ok = validateJsonAgainstSchema({ name: "Ada", age: 36 }, schema);
    expect(ok.ok).toBe(true);
    expect(ok.missingRequired).toEqual([]);

    const miss = validateJsonAgainstSchema({ name: "Ada" }, schema);
    expect(miss.ok).toBe(false);
    expect(miss.missingRequired).toEqual(["age"]);
    expect(miss.issues.some((i) => i.field === "age")).toBe(true);
  });

  it("treats missing required on non-object as all missing", () => {
    // type mismatch + required fields all reported missing
    const r = validateJsonAgainstSchema([1], {
      type: "object",
      required: ["x"],
    });
    expect(r.ok).toBe(false);
    expect(r.missingRequired).toEqual(["x"]);
    expect(r.issues.some((i) => i.kind === "type_mismatch")).toBe(true);
  });

  it("accepts multi-type root", () => {
    const schema = { type: ["object", "array"] };
    expect(validateJsonAgainstSchema({}, schema).ok).toBe(true);
    expect(validateJsonAgainstSchema([], schema).ok).toBe(true);
    expect(validateJsonAgainstSchema("x", schema).ok).toBe(false);
  });
});

describe("assessStructuredReply", () => {
  const schema = JSON.stringify({
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } },
  });

  it("marks valid replies that satisfy required fields", () => {
    const a = assessStructuredReply('{"name":"Ada"}', schema);
    expect(a.status).toBe("valid");
    expect(a.pretty).toContain('"name"');
    expect(a.schema?.ok).toBe(true);
  });

  it("marks schema_mismatch when required field absent", () => {
    const a = assessStructuredReply('{"other":1}', schema);
    expect(a.status).toBe("schema_mismatch");
    expect(a.pretty).not.toBeNull();
    expect(a.schema?.missingRequired).toEqual(["name"]);
  });

  it("marks invalid_json without crashing", () => {
    expect(() => assessStructuredReply("nope", schema)).not.toThrow();
    const a = assessStructuredReply("nope", schema);
    expect(a.status).toBe("invalid_json");
    expect(a.pretty).toBeNull();
    expect(a.schema).toBeNull();
  });

  it("works without a schema (parse only)", () => {
    const a = assessStructuredReply('{"ok":true}', null);
    expect(a.status).toBe("valid");
    expect(a.schema).toBeNull();
  });
});
