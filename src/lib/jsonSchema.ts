/**
 * Pure helpers for optional session JSON Schema structured output.
 *
 * Client-side: parse + light structural checks (object schema).
 * Agent path: best-effort CLI `--json-schema` on spawn (top-level `grok` flag)
 * plus an experimental prompt instruction when the flag is not available mid-session.
 */

export type JsonSchemaParseOk = {
  ok: true;
  /** Canonical pretty-printed schema text (stable for storage / CLI). */
  normalized: string;
  /** Parsed value (always a plain object). */
  value: Record<string, unknown>;
};

export type JsonSchemaParseErr = {
  ok: false;
  error: "empty" | "invalid_json" | "not_object" | "too_large";
  message: string;
};

export type JsonSchemaParseResult = JsonSchemaParseOk | JsonSchemaParseErr;

/** Soft cap so spawn argv / session index stay bounded (~256 KiB). */
export const JSON_SCHEMA_MAX_CHARS = 256 * 1024;

const ERR_EMPTY = "JSON Schema is empty.";
const ERR_INVALID = "Invalid JSON — fix syntax before applying.";
const ERR_NOT_OBJECT =
  "JSON Schema must be a JSON object (e.g. {\"type\":\"object\",…}).";
const ERR_TOO_LARGE = `JSON Schema is too large (max ${JSON_SCHEMA_MAX_CHARS} characters).`;

/**
 * Validate pasted schema text: non-empty JSON object, size-capped.
 * Does not run a full JSON Schema meta-validator — only parse + shape.
 */
export function parseJsonSchemaText(raw: string): JsonSchemaParseResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { ok: false, error: "empty", message: ERR_EMPTY };
  }
  if (trimmed.length > JSON_SCHEMA_MAX_CHARS) {
    return { ok: false, error: "too_large", message: ERR_TOO_LARGE };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "invalid_json", message: ERR_INVALID };
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return { ok: false, error: "not_object", message: ERR_NOT_OBJECT };
  }

  const value = parsed as Record<string, unknown>;
  let normalized: string;
  try {
    normalized = JSON.stringify(value, null, 2);
  } catch {
    return { ok: false, error: "invalid_json", message: ERR_INVALID };
  }
  if (normalized.length > JSON_SCHEMA_MAX_CHARS) {
    return { ok: false, error: "too_large", message: ERR_TOO_LARGE };
  }

  return { ok: true, normalized, value };
}

/** True when stored schema text is present and still valid. */
export function isActiveJsonSchema(raw: string | null | undefined): boolean {
  if (raw == null || !String(raw).trim()) return false;
  return parseJsonSchemaText(String(raw)).ok;
}

/**
 * Extract pretty JSON from an assistant reply for the structured-output panel.
 * Prefers whole-message JSON; falls back to a fenced ```json block.
 * Returns null when the reply is not parseable object/array JSON.
 */
export function extractStructuredJson(content: string): string | null {
  const parsed = parseStructuredJsonContent(content);
  return parsed.ok ? parsed.pretty : null;
}

export type StructuredJsonParseOk = {
  ok: true;
  value: unknown;
  pretty: string;
};

export type StructuredJsonParseErr = {
  ok: false;
  error: "empty" | "not_json";
  /** Stable English diagnostic for tests / logs (UI uses i18n). */
  message: string;
};

export type StructuredJsonParseResult =
  | StructuredJsonParseOk
  | StructuredJsonParseErr;

/**
 * Parse assistant reply as structured JSON (object or array root).
 * Honest failure — never throws.
 */
export function parseStructuredJsonContent(
  content: string,
): StructuredJsonParseResult {
  const text = (content ?? "").trim();
  if (!text) {
    return { ok: false, error: "empty", message: "Reply is empty." };
  }

  const candidates: string[] = [text];

  // Fenced code block (```json … ``` or bare ``` … ```)
  const fence =
    /```(?:json|JSON)?\s*\n([\s\S]*?)```/m.exec(text) ??
    /```(?:json|JSON)?\s*([\s\S]*?)```/m.exec(text);
  if (fence?.[1]) candidates.push(fence[1].trim());

  // Leading/trailing prose around a single top-level object/array
  const startObj = text.indexOf("{");
  const startArr = text.indexOf("[");
  let start = -1;
  if (startObj >= 0 && startArr >= 0) start = Math.min(startObj, startArr);
  else start = Math.max(startObj, startArr);
  if (start >= 0) {
    const slice = text.slice(start);
    candidates.push(slice);
    if (slice.startsWith("{")) {
      const balanced = extractBalanced(slice, "{", "}");
      if (balanced) candidates.push(balanced);
    } else if (slice.startsWith("[")) {
      const balanced = extractBalanced(slice, "[", "]");
      if (balanced) candidates.push(balanced);
    }
  }

  for (const raw of candidates) {
    const parsed = tryParseObjectOrArray(raw);
    if (parsed) return parsed;
  }

  return {
    ok: false,
    error: "not_json",
    message: "Not valid JSON.",
  };
}

function tryParseObjectOrArray(raw: string): StructuredJsonParseOk | null {
  try {
    const v = JSON.parse(raw);
    if (v === null || typeof v !== "object") return null;
    return { ok: true, value: v, pretty: JSON.stringify(v, null, 2) };
  } catch {
    return null;
  }
}

export type SchemaValidationIssue = {
  /** Dot-path; empty string means root. */
  path: string;
  kind: "missing_required" | "type_mismatch" | "not_object";
  message: string;
  /** Field name when kind is missing_required. */
  field?: string;
};

export type SchemaValidationResult = {
  ok: boolean;
  issues: SchemaValidationIssue[];
  /** Missing required property names (convenience for UI). */
  missingRequired: string[];
};

/**
 * Lightweight client-side check of a parsed value against a JSON Schema object.
 * Supports: root `type` (object/array/string/number/boolean/null), and
 * top-level `required` field presence when the value is a plain object.
 * Does not run a full draft validator.
 */
export function validateJsonAgainstSchema(
  value: unknown,
  schema: Record<string, unknown> | null | undefined,
): SchemaValidationResult {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { ok: true, issues: [], missingRequired: [] };
  }

  const issues: SchemaValidationIssue[] = [];

  const typeSpec = schema.type;
  if (typeof typeSpec === "string") {
    if (!matchesJsonSchemaType(value, typeSpec)) {
      issues.push({
        path: "",
        kind: "type_mismatch",
        message: `Expected type "${typeSpec}", got ${jsonTypeName(value)}.`,
      });
    }
  } else if (Array.isArray(typeSpec)) {
    const allowed = typeSpec.filter((t): t is string => typeof t === "string");
    if (allowed.length && !allowed.some((t) => matchesJsonSchemaType(value, t))) {
      issues.push({
        path: "",
        kind: "type_mismatch",
        message: `Expected type ${allowed.join(" | ")}, got ${jsonTypeName(value)}.`,
      });
    }
  }

  const required = Array.isArray(schema.required)
    ? schema.required.filter((k): k is string => typeof k === "string" && k.length > 0)
    : [];

  const missingRequired: string[] = [];
  if (required.length > 0) {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      issues.push({
        path: "",
        kind: "not_object",
        message: "Expected a JSON object to check required fields.",
      });
      for (const field of required) {
        missingRequired.push(field);
        issues.push({
          path: field,
          kind: "missing_required",
          field,
          message: `Missing required field "${field}".`,
        });
      }
    } else {
      const obj = value as Record<string, unknown>;
      for (const field of required) {
        if (!Object.prototype.hasOwnProperty.call(obj, field)) {
          missingRequired.push(field);
          issues.push({
            path: field,
            kind: "missing_required",
            field,
            message: `Missing required field "${field}".`,
          });
        }
      }
    }
  }

  return { ok: issues.length === 0, issues, missingRequired };
}

function matchesJsonSchemaType(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
}

function jsonTypeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export type StructuredReplyStatus =
  | "valid"
  | "invalid_json"
  | "schema_mismatch"
  | "empty";

export type StructuredReplyAssessment = {
  parse: StructuredJsonParseResult;
  schema: SchemaValidationResult | null;
  status: StructuredReplyStatus;
  pretty: string | null;
};

/**
 * Combined parse + optional schema check for an assistant reply.
 * Never throws; safe for render paths.
 */
export function assessStructuredReply(
  content: string,
  schemaText: string | null | undefined,
): StructuredReplyAssessment {
  const parse = parseStructuredJsonContent(content);
  if (!parse.ok) {
    return {
      parse,
      schema: null,
      status: parse.error === "empty" ? "empty" : "invalid_json",
      pretty: null,
    };
  }

  let schemaResult: SchemaValidationResult | null = null;
  if (schemaText && String(schemaText).trim()) {
    const schemaParsed = parseJsonSchemaText(String(schemaText));
    if (schemaParsed.ok) {
      schemaResult = validateJsonAgainstSchema(parse.value, schemaParsed.value);
    }
  }

  if (schemaResult && !schemaResult.ok) {
    return {
      parse,
      schema: schemaResult,
      status: "schema_mismatch",
      pretty: parse.pretty,
    };
  }

  return {
    parse,
    schema: schemaResult,
    status: "valid",
    pretty: parse.pretty,
  };
}

function extractBalanced(
  s: string,
  open: string,
  close: string,
): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return s.slice(0, i + 1);
    }
  }
  return null;
}

/**
 * Experimental prompt wrapper when structured output is active.
 * Used always so mid-session schema changes work without respawn;
 * spawn also passes `--json-schema` when connecting with a stored schema.
 */
export function wrapAgentTextWithJsonSchema(
  agentText: string,
  schemaNormalized: string,
): string {
  const schema = schemaNormalized.trim();
  if (!schema) return agentText;
  const header = [
    "[Structured output — experimental]",
    "Your final answer MUST be valid JSON that conforms to this JSON Schema.",
    "Do not wrap the JSON in markdown fences unless the user asks.",
    "JSON Schema:",
    schema,
    "---",
  ].join("\n");
  const body = (agentText ?? "").trim();
  return body ? `${header}\n${body}` : header;
}
