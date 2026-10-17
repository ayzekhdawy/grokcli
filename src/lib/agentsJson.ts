/**
 * Pure helpers for optional Settings → Agents JSON (`grok --agents <JSON>`).
 *
 * CLI: top-level `grok --agents <JSON> agent … stdio` — inline subagent
 * definitions as a JSON **object** (name → definition map). Empty / invalid
 * values omit the flag. Does not write agent defs into shared `~/.grok`.
 */

export type AgentsJsonParseOk = {
  ok: true;
  /** True when input is blank — caller should omit the spawn flag. */
  empty: boolean;
  /**
   * Canonical compact JSON for storage / CLI when non-empty.
   * Empty string when `empty` is true.
   */
  normalized: string;
  /** Parsed object when non-empty; null when empty. */
  value: Record<string, unknown> | null;
};

export type AgentsJsonParseErr = {
  ok: false;
  error: "invalid_json" | "not_object" | "too_large";
  message: string;
};

export type AgentsJsonParseResult = AgentsJsonParseOk | AgentsJsonParseErr;

/** Soft cap so spawn argv / settings stay bounded (~64 KiB). */
export const AGENTS_JSON_MAX_CHARS = 64 * 1024;

const ERR_INVALID = "Invalid JSON — fix syntax before saving.";
const ERR_NOT_OBJECT =
  'Agents JSON must be a JSON object map (e.g. {"reviewer":{"description":"…","prompt":"…"}}).';
const ERR_TOO_LARGE = `Agents JSON is too large (max ${AGENTS_JSON_MAX_CHARS} characters).`;

/**
 * Validate pasted agents JSON: empty ok; otherwise a size-capped JSON object.
 * Does not fully schema-validate agent fields — only parse + map shape.
 * CLI currently expects a map (not array/null/primitive).
 */
export function parseAgentsJson(
  raw: string | null | undefined,
): AgentsJsonParseResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { ok: true, empty: true, normalized: "", value: null };
  }
  if (trimmed.length > AGENTS_JSON_MAX_CHARS) {
    return { ok: false, error: "too_large", message: ERR_TOO_LARGE };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "invalid_json", message: ERR_INVALID };
  }

  // CLI: "expected a map" — reject arrays / null / primitives for honest UX.
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
    normalized = JSON.stringify(value);
  } catch {
    return { ok: false, error: "invalid_json", message: ERR_INVALID };
  }
  if (normalized.length > AGENTS_JSON_MAX_CHARS) {
    return { ok: false, error: "too_large", message: ERR_TOO_LARGE };
  }

  return { ok: true, empty: false, normalized, value };
}

/**
 * Normalize for persistence: empty → `""`; valid object → compact JSON;
 * invalid → null (caller blocks save and surfaces error).
 */
export function normalizeAgentsJson(
  raw: string | null | undefined,
): string | null {
  const r = parseAgentsJson(raw);
  if (!r.ok) return null;
  return r.normalized;
}

/**
 * Top-level CLI args when agents JSON is set: `["--agents", json]`.
 * Empty / invalid → `null` (omit flag).
 */
export function agentsJsonSpawnArgs(
  raw: string | null | undefined,
): string[] | null {
  const r = parseAgentsJson(raw);
  if (!r.ok || r.empty) return null;
  return ["--agents", r.normalized];
}

/** True when stored value is non-empty and still valid. */
export function hasAgentsJson(raw: string | null | undefined): boolean {
  const r = parseAgentsJson(raw);
  return r.ok && !r.empty;
}
