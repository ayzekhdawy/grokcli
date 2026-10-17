/**
 * Pure helpers for structured JSON stream frames + validation status timeline.
 *
 * Deepens session JSON Schema structured output: progressive parse / validate
 * while the assistant streams (and offline replay of content samples).
 * No second runtime — reuses `jsonSchema` parse + light schema checks.
 */

import {
  assessStructuredReply,
  parseJsonSchemaText,
  parseStructuredJsonContent,
  validateJsonAgainstSchema,
  type SchemaValidationResult,
  type StructuredReplyStatus,
} from "./jsonSchema";

/** Progressive validation phase for a structured-output turn. */
export type StreamJsonPhase =
  | "empty"
  | "partial"
  | "valid"
  | "schema_mismatch"
  | "invalid_json";

/** Low-level stream frame: how much of a JSON value is available. */
export type StreamJsonFrame = {
  /** Frame completeness (independent of schema). */
  kind: "empty" | "partial" | "complete" | "invalid";
  /** Candidate object/array text when a JSON root was detected. */
  raw: string | null;
  /** Pretty-printed JSON when complete. */
  pretty: string | null;
  /** Parsed value when complete. */
  value: unknown | null;
  /** Unclosed `{`/`[` depth outside strings (0 when complete/empty). */
  openDepth: number;
  /** Best-effort top-level keys seen so far (partial or complete objects). */
  partialKeys: string[];
  /** Whether the caller marked the turn as still streaming. */
  streaming: boolean;
};

export type StreamStructuredAssessment = {
  phase: StreamJsonPhase;
  frame: StreamJsonFrame;
  schema: SchemaValidationResult | null;
  pretty: string | null;
  /**
   * Status compatible with finished-turn UI, plus `"partial"` while streaming
   * incomplete JSON.
   */
  status: StructuredReplyStatus | "partial";
  missingRequired: string[];
};

/** One status step on the progressive validation timeline. */
export type ValidationTimelineEntry = {
  phase: StreamJsonPhase;
  contentLength: number;
  missingRequired?: string[];
  partialKeys?: string[];
  /** Optional sample time (ms) for replay. */
  atMs?: number;
};

/** Known token usage from agent events (never invent zeros). */
export type StructuredUsageKnown = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
};

export type StructuredExportPayload = {
  json: string;
  filename: string;
  mime: "application/json";
};

export const VALIDATION_TIMELINE_MAX = 32;

function finiteNonNeg(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * Scan text for brace/bracket depth outside strings.
 * Returns open depth and whether a JSON root opener was seen.
 */
export function scanJsonOpenDepth(text: string): {
  openDepth: number;
  sawRoot: boolean;
  rootIndex: number;
} {
  const s = text ?? "";
  let startObj = s.indexOf("{");
  let startArr = s.indexOf("[");
  let rootIndex = -1;
  if (startObj >= 0 && startArr >= 0) rootIndex = Math.min(startObj, startArr);
  else rootIndex = Math.max(startObj, startArr);
  if (rootIndex < 0) {
    return { openDepth: 0, sawRoot: false, rootIndex: -1 };
  }

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = rootIndex; i < s.length; i++) {
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
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth = Math.max(0, depth - 1);
    }
  }
  return { openDepth: depth, sawRoot: true, rootIndex };
}

/**
 * Best-effort top-level object keys from complete or incomplete JSON text.
 * Skips nested objects/arrays by tracking depth.
 */
export function extractPartialObjectKeys(raw: string): string[] {
  const s = (raw ?? "").trim();
  if (!s.startsWith("{")) return [];

  const keys: string[] = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let i = 0;

  while (i < s.length) {
    const c = s[i]!;
    if (inStr) {
      if (esc) {
        esc = false;
        i++;
        continue;
      }
      if (c === "\\") {
        esc = true;
        i++;
        continue;
      }
      if (c === '"') inStr = false;
      i++;
      continue;
    }

    if (c === '"') {
      // Potential key only at depth 1 (inside root object).
      if (depth === 1) {
        let j = i + 1;
        let keyEsc = false;
        let key = "";
        while (j < s.length) {
          const kc = s[j]!;
          if (keyEsc) {
            key += kc;
            keyEsc = false;
            j++;
            continue;
          }
          if (kc === "\\") {
            keyEsc = true;
            j++;
            continue;
          }
          if (kc === '"') break;
          key += kc;
          j++;
        }
        if (j >= s.length) break;
        // Skip whitespace after closing quote
        let k = j + 1;
        while (k < s.length && /\s/.test(s[k]!)) k++;
        if (s[k] === ":") {
          keys.push(key);
          i = k + 1;
          continue;
        }
      }
      inStr = true;
      i++;
      continue;
    }

    if (c === "{" || c === "[") {
      depth++;
      i++;
      continue;
    }
    if (c === "}" || c === "]") {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    i++;
  }

  // Dedupe while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function keysOfValue(value: unknown): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value as Record<string, unknown>);
}

/**
 * Analyze assistant content as a structured JSON stream frame.
 * Never throws. When `streaming` is true, incomplete JSON is `"partial"`
 * rather than `"invalid"`.
 */
export function analyzeStreamJsonFrame(
  content: string,
  opts?: { streaming?: boolean },
): StreamJsonFrame {
  const streaming = !!opts?.streaming;
  const text = (content ?? "").trim();

  if (!text) {
    return {
      kind: "empty",
      raw: null,
      pretty: null,
      value: null,
      openDepth: 0,
      partialKeys: [],
      streaming,
    };
  }

  const parsed = parseStructuredJsonContent(content);
  if (parsed.ok) {
    return {
      kind: "complete",
      raw: parsed.pretty,
      pretty: parsed.pretty,
      value: parsed.value,
      openDepth: 0,
      partialKeys: keysOfValue(parsed.value),
      streaming,
    };
  }

  const scan = scanJsonOpenDepth(text);
  const raw =
    scan.sawRoot && scan.rootIndex >= 0 ? text.slice(scan.rootIndex) : null;
  const partialKeys = raw ? extractPartialObjectKeys(raw) : [];

  // Mid-stream: treat non-complete content as partial (never hard-fail early).
  if (streaming) {
    return {
      kind: "partial",
      raw,
      pretty: null,
      value: null,
      openDepth: scan.openDepth,
      partialKeys,
      streaming: true,
    };
  }

  // Finished turn with no parseable object/array.
  if (scan.sawRoot && scan.openDepth > 0) {
    // Truncated / unfinished JSON after stream end — still partial-looking,
    // but for finished turns report invalid.
    return {
      kind: "invalid",
      raw,
      pretty: null,
      value: null,
      openDepth: scan.openDepth,
      partialKeys,
      streaming: false,
    };
  }

  return {
    kind: "invalid",
    raw,
    pretty: null,
    value: null,
    openDepth: scan.openDepth,
    partialKeys,
    streaming: false,
  };
}

/**
 * Progressive structured-output assessment (stream + finished).
 * Reuses light schema validation when a complete JSON value is available.
 */
export function assessStreamStructured(
  content: string,
  schemaText: string | null | undefined,
  opts?: { streaming?: boolean },
): StreamStructuredAssessment {
  const streaming = !!opts?.streaming;
  const frame = analyzeStreamJsonFrame(content, { streaming });

  if (frame.kind === "empty") {
    return {
      phase: "empty",
      frame,
      schema: null,
      pretty: null,
      status: "empty",
      missingRequired: [],
    };
  }

  if (frame.kind === "partial") {
    return {
      phase: "partial",
      frame,
      schema: null,
      pretty: null,
      status: "partial",
      missingRequired: [],
    };
  }

  if (frame.kind === "complete" && frame.value !== null) {
    let schemaResult: SchemaValidationResult | null = null;
    if (schemaText && String(schemaText).trim()) {
      const schemaParsed = parseJsonSchemaText(String(schemaText));
      if (schemaParsed.ok) {
        schemaResult = validateJsonAgainstSchema(
          frame.value,
          schemaParsed.value,
        );
      }
    }
    if (schemaResult && !schemaResult.ok) {
      return {
        phase: "schema_mismatch",
        frame,
        schema: schemaResult,
        pretty: frame.pretty,
        status: "schema_mismatch",
        missingRequired: schemaResult.missingRequired,
      };
    }
    return {
      phase: "valid",
      frame,
      schema: schemaResult,
      pretty: frame.pretty,
      status: "valid",
      missingRequired: [],
    };
  }

  // invalid
  return {
    phase: "invalid_json",
    frame,
    schema: null,
    pretty: null,
    status: "invalid_json",
    missingRequired: [],
  };
}

/**
 * Append a timeline entry only when the phase (or notable missing fields) changes.
 * Newest last. Capped at `maxEntries` (default VALIDATION_TIMELINE_MAX).
 */
export function appendValidationTimeline(
  prev: ValidationTimelineEntry[],
  assessment: StreamStructuredAssessment,
  opts?: {
    contentLength?: number;
    atMs?: number;
    maxEntries?: number;
  },
): ValidationTimelineEntry[] {
  const max = opts?.maxEntries ?? VALIDATION_TIMELINE_MAX;
  const contentLength =
    opts?.contentLength ??
    (assessment.pretty?.length ??
      assessment.frame.raw?.length ??
      0);
  const next: ValidationTimelineEntry = {
    phase: assessment.phase,
    contentLength,
    ...(assessment.missingRequired.length
      ? { missingRequired: [...assessment.missingRequired] }
      : {}),
    ...(assessment.frame.partialKeys.length
      ? { partialKeys: [...assessment.frame.partialKeys] }
      : {}),
    ...(opts?.atMs != null && Number.isFinite(opts.atMs)
      ? { atMs: opts.atMs }
      : {}),
  };

  const last = prev.length ? prev[prev.length - 1]! : null;
  if (
    last &&
    last.phase === next.phase &&
    sameStringList(last.missingRequired, next.missingRequired)
  ) {
    // Update length / keys on same phase without growing the timeline.
    const updated = {
      ...last,
      contentLength: next.contentLength,
      ...(next.partialKeys ? { partialKeys: next.partialKeys } : {}),
      ...(next.atMs != null ? { atMs: next.atMs } : {}),
    };
    return [...prev.slice(0, -1), updated];
  }

  const out = [...prev, next];
  if (out.length > max) return out.slice(out.length - max);
  return out;
}

function sameStringList(a?: string[], b?: string[]): boolean {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

/**
 * Replay a validation status timeline from ordered content samples.
 * Intermediate samples are treated as streaming; the last sample uses
 * `finalStreaming` (default false) so finished turns can hard-fail invalid JSON.
 */
export function replayValidationTimeline(
  samples: Array<{ content: string; atMs?: number }>,
  schemaText: string | null | undefined,
  opts?: { finalStreaming?: boolean },
): ValidationTimelineEntry[] {
  const finalStreaming = !!opts?.finalStreaming;
  let timeline: ValidationTimelineEntry[] = [];
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]!;
    const isLast = i === samples.length - 1;
    const streaming = isLast ? finalStreaming : true;
    const assessment = assessStreamStructured(sample.content, schemaText, {
      streaming,
    });
    timeline = appendValidationTimeline(timeline, assessment, {
      contentLength: (sample.content ?? "").length,
      atMs: sample.atMs,
    });
  }
  return timeline;
}

/**
 * Compact phase path for UI (“empty → partial → valid”).
 */
export function formatValidationTimelinePath(
  entries: ValidationTimelineEntry[],
): string {
  if (!entries.length) return "";
  const phases: StreamJsonPhase[] = [];
  for (const e of entries) {
    if (!phases.length || phases[phases.length - 1] !== e.phase) {
      phases.push(e.phase);
    }
  }
  return phases.join(" → ");
}

/**
 * Keep only usage with at least one known finite token count.
 * Never invents zeros from missing fields.
 */
export function pickKnownStructuredUsage(
  u: StructuredUsageKnown | null | undefined,
): StructuredUsageKnown | null {
  if (!u) return null;
  const inputTokens = finiteNonNeg(u.inputTokens);
  const outputTokens = finiteNonNeg(u.outputTokens);
  let totalTokens = finiteNonNeg(u.totalTokens);
  if (totalTokens == null && inputTokens != null && outputTokens != null) {
    totalTokens = inputTokens + outputTokens;
  }
  if (inputTokens == null && outputTokens == null && totalTokens == null) {
    return null;
  }
  return { inputTokens, outputTokens, totalTokens };
}

/** True when at least one token field is known. */
export function hasKnownStructuredUsage(
  u: StructuredUsageKnown | null | undefined,
): boolean {
  return pickKnownStructuredUsage(u) != null;
}

/**
 * Build export payload for a complete pretty JSON result.
 * Returns null when there is nothing exportable.
 */
export function buildStructuredExport(
  pretty: string | null | undefined,
  opts?: { basename?: string },
): StructuredExportPayload | null {
  const json = (pretty ?? "").trim();
  if (!json) return null;
  const base = (opts?.basename ?? "structured-output").replace(
    /\.json$/i,
    "",
  );
  return {
    json,
    filename: `${base || "structured-output"}.json`,
    mime: "application/json",
  };
}

/**
 * Bridge finished-turn assessment into stream phases (for shared UI mapping).
 */
export function phaseFromFinishedAssessment(
  assessment: ReturnType<typeof assessStructuredReply>,
): StreamJsonPhase {
  return assessment.status;
}

/** Map stream phase → bar tone for the Structured panel. */
export function streamPhaseTone(
  phase: StreamJsonPhase,
): "ok" | "warn" | "err" | "stream" {
  switch (phase) {
    case "valid":
      return "ok";
    case "schema_mismatch":
      return "warn";
    case "partial":
    case "empty":
      return "stream";
    case "invalid_json":
    default:
      return "err";
  }
}
