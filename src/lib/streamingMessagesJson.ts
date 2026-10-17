/**
 * Pure helpers for Grok Build `--output-format streaming-messages-json`
 * (CLI 0.2.117+).
 *
 * NDJSON in the Anthropic Messages API wire format:
 * - Whole frames: `system` / `assistant` / `user` / `result`
 * - Optional partials (`--include-partial-messages`): `stream_event` with
 *   nested `event` (`message_start`, `content_block_delta`, …)
 *
 * Host probe soft-fails older CLIs; this module only parses / reconstructs.
 * Never logs secrets — callers should redact before any export surface.
 */

import { redact } from "./redact";

/** CLI flag value for headless output format. */
export const STREAMING_MESSAGES_JSON_FORMAT = "streaming-messages-json";

/** First CLI version that documents/accepts the format. */
export const STREAMING_MESSAGES_JSON_MIN_CLI = "0.2.117";

/** Probe prompt used by Host headless run (must stay deterministic). */
export const STREAMING_MESSAGES_JSON_PROBE_PROMPT = "Reply with exactly: SMJ_PROBE_OK";

/** Hard cap when materializing preview text / exports (bytes of source NDJSON). */
export const STREAMING_MESSAGES_JSON_MAX_SOURCE_CHARS = 512 * 1024;

/** Max content chars kept per reconstructed text/thinking block in previews. */
export const STREAMING_MESSAGES_JSON_PREVIEW_BLOCK_CHARS = 4_000;

export type SmjFrameType =
  | "system"
  | "assistant"
  | "user"
  | "result"
  | "stream_event"
  | "unknown"
  | "invalid";

export type SmjContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      toolUseId: string;
      content: string;
      isError?: boolean;
    }
  | { type: "other"; rawType: string; data: unknown };

export type SmjUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
};

export type SmjParsedLine = {
  ok: boolean;
  lineIndex: number;
  frameType: SmjFrameType;
  role?: "assistant" | "user" | "system";
  stopReason?: string | null;
  usage?: SmjUsage | null;
  blocks: SmjContentBlock[];
  sessionId?: string;
  uuid?: string;
  subtype?: string;
  streamEventType?: string;
  parentToolUseId?: string | null;
  model?: string;
  /** Result frame only. */
  resultText?: string;
  isError?: boolean;
  durationMs?: number;
  numTurns?: number;
  totalCostUsd?: number;
  error?: string;
  /** Original object when parse succeeded (may be large). */
  raw?: unknown;
};

export type SmjReconstructedMessage = {
  role: "assistant" | "user" | "system";
  blocks: SmjContentBlock[];
  stopReason?: string | null;
  usage?: SmjUsage | null;
  sessionId?: string;
  model?: string;
  toolUses: Array<{ id: string; name: string }>;
  toolResults: Array<{ toolUseId: string; isError?: boolean }>;
  /** Joined text blocks (preview-capped). */
  text: string;
  /** Joined thinking blocks (preview-capped, signature stripped). */
  thinking: string;
  sourceLineIndex: number;
};

export type SmjResultSummary = {
  subtype?: string;
  stopReason?: string | null;
  isError?: boolean;
  resultText?: string;
  usage?: SmjUsage | null;
  durationMs?: number;
  numTurns?: number;
  totalCostUsd?: number;
  sessionId?: string;
};

export type SmjDocument = {
  lines: SmjParsedLine[];
  messages: SmjReconstructedMessage[];
  result?: SmjResultSummary;
  sessionId?: string;
  model?: string;
  lineCount: number;
  validLineCount: number;
  parseErrors: number;
  streamEventCount: number;
  toolUseCount: number;
  toolResultCount: number;
  usageSummary?: SmjUsage | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v != null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

function clampText(s: string, max = STREAMING_MESSAGES_JSON_PREVIEW_BLOCK_CHARS): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/** Normalize Anthropic / CLI usage objects (snake or camel). */
export function parseSmjUsage(raw: unknown): SmjUsage | null {
  const o = asRecord(raw);
  if (!o) return null;
  const usage: SmjUsage = {
    inputTokens: num(o.input_tokens) ?? num(o.inputTokens),
    outputTokens: num(o.output_tokens) ?? num(o.outputTokens),
    cacheReadInputTokens:
      num(o.cache_read_input_tokens) ?? num(o.cacheReadInputTokens),
    cacheCreationInputTokens:
      num(o.cache_creation_input_tokens) ?? num(o.cacheCreationInputTokens),
  };
  if (
    usage.inputTokens == null &&
    usage.outputTokens == null &&
    usage.cacheReadInputTokens == null &&
    usage.cacheCreationInputTokens == null
  ) {
    return null;
  }
  return usage;
}

function toolResultContentToString(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const r = asRecord(b);
        if (!r) return typeof b === "string" ? b : JSON.stringify(b);
        if (typeof r.text === "string") return r.text;
        if (typeof r.content === "string") return r.content;
        return JSON.stringify(r);
      })
      .join("\n");
  }
  if (typeof content === "object") {
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  return String(content);
}

/** Parse a single content block from Anthropic message content[]. */
export function parseSmjContentBlock(raw: unknown): SmjContentBlock {
  const o = asRecord(raw);
  if (!o) {
    return { type: "other", rawType: typeof raw, data: raw };
  }
  const t = str(o.type) ?? "other";
  if (t === "text") {
    return { type: "text", text: str(o.text) ?? "" };
  }
  if (t === "thinking") {
    return {
      type: "thinking",
      thinking: str(o.thinking) ?? "",
      signature: str(o.signature),
    };
  }
  if (t === "tool_use") {
    return {
      type: "tool_use",
      id: str(o.id) ?? "",
      name: str(o.name) ?? "",
      input: o.input ?? {},
    };
  }
  if (t === "tool_result") {
    return {
      type: "tool_result",
      toolUseId: str(o.tool_use_id) ?? str(o.toolUseId) ?? "",
      content: toolResultContentToString(o.content),
      isError: bool(o.is_error) ?? bool(o.isError),
    };
  }
  return { type: "other", rawType: t, data: o };
}

function parseContentBlocks(raw: unknown): SmjContentBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseSmjContentBlock);
}

function messageFields(msg: Record<string, unknown> | null): {
  role?: "assistant" | "user" | "system";
  stopReason?: string | null;
  usage?: SmjUsage | null;
  blocks: SmjContentBlock[];
  model?: string;
} {
  if (!msg) return { blocks: [] };
  const roleRaw = str(msg.role);
  let role: "assistant" | "user" | "system" | undefined;
  if (roleRaw === "assistant" || roleRaw === "user" || roleRaw === "system") {
    role = roleRaw;
  }
  const stop =
    msg.stop_reason === null
      ? null
      : str(msg.stop_reason) ?? str(msg.stopReason) ?? undefined;
  return {
    role,
    stopReason: stop,
    usage: parseSmjUsage(msg.usage),
    blocks: parseContentBlocks(msg.content),
    model: str(msg.model),
  };
}

/**
 * Parse one NDJSON line (pure). Blank lines → null (caller skips).
 * Non-JSON → invalid frame with error.
 */
export function parseStreamingMessagesJsonLine(
  line: string,
  lineIndex = 0,
): SmjParsedLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      lineIndex,
      frameType: "invalid",
      blocks: [],
      error: "invalid_json",
    };
  }

  const root = asRecord(obj);
  if (!root) {
    return {
      ok: false,
      lineIndex,
      frameType: "invalid",
      blocks: [],
      error: "not_object",
      raw: obj,
    };
  }

  const typeRaw = (str(root.type) ?? "").toLowerCase();
  const sessionId = str(root.session_id) ?? str(root.sessionId);
  const uuid = str(root.uuid);
  const parentToolUseId =
    root.parent_tool_use_id === null
      ? null
      : str(root.parent_tool_use_id) ?? str(root.parentToolUseId) ?? null;

  if (typeRaw === "system") {
    return {
      ok: true,
      lineIndex,
      frameType: "system",
      role: "system",
      subtype: str(root.subtype),
      sessionId,
      uuid,
      model: str(root.model),
      blocks: [],
      raw: root,
    };
  }

  if (typeRaw === "assistant" || typeRaw === "user") {
    const msg = asRecord(root.message);
    const fields = messageFields(msg);
    const role =
      fields.role ??
      (typeRaw === "assistant" ? "assistant" : "user");
    return {
      ok: true,
      lineIndex,
      frameType: typeRaw,
      role,
      stopReason: fields.stopReason,
      usage: fields.usage,
      blocks: fields.blocks,
      sessionId,
      uuid,
      parentToolUseId,
      model: fields.model,
      raw: root,
    };
  }

  if (typeRaw === "result") {
    return {
      ok: true,
      lineIndex,
      frameType: "result",
      subtype: str(root.subtype),
      stopReason:
        root.stop_reason === null
          ? null
          : str(root.stop_reason) ?? str(root.stopReason) ?? undefined,
      usage: parseSmjUsage(root.usage),
      blocks: [],
      sessionId,
      uuid,
      resultText: str(root.result),
      isError: bool(root.is_error) ?? bool(root.isError),
      durationMs: num(root.duration_ms) ?? num(root.durationMs),
      numTurns: num(root.num_turns) ?? num(root.numTurns),
      totalCostUsd: num(root.total_cost_usd) ?? num(root.totalCostUsd),
      raw: root,
    };
  }

  if (typeRaw === "stream_event") {
    const event = asRecord(root.event);
    const streamEventType = event ? str(event.type) : undefined;
    return {
      ok: true,
      lineIndex,
      frameType: "stream_event",
      streamEventType,
      sessionId,
      uuid,
      parentToolUseId,
      blocks: [],
      raw: root,
    };
  }

  return {
    ok: true,
    lineIndex,
    frameType: "unknown",
    sessionId,
    uuid,
    blocks: [],
    raw: root,
  };
}

function blocksToPreviewFields(blocks: SmjContentBlock[]): {
  text: string;
  thinking: string;
  toolUses: Array<{ id: string; name: string }>;
  toolResults: Array<{ toolUseId: string; isError?: boolean }>;
} {
  const texts: string[] = [];
  const thoughts: string[] = [];
  const toolUses: Array<{ id: string; name: string }> = [];
  const toolResults: Array<{ toolUseId: string; isError?: boolean }> = [];
  for (const b of blocks) {
    if (b.type === "text" && b.text) texts.push(b.text);
    if (b.type === "thinking" && b.thinking) thoughts.push(b.thinking);
    if (b.type === "tool_use") {
      toolUses.push({ id: b.id, name: b.name });
    }
    if (b.type === "tool_result") {
      toolResults.push({ toolUseId: b.toolUseId, isError: b.isError });
    }
  }
  return {
    text: clampText(texts.join("\n")),
    thinking: clampText(thoughts.join("\n")),
    toolUses,
    toolResults,
  };
}

/** Rebuild whole assistant/user messages from parsed lines (skips stream_event). */
export function reconstructMessagesFromLines(
  lines: readonly SmjParsedLine[],
): SmjReconstructedMessage[] {
  const out: SmjReconstructedMessage[] = [];
  for (const line of lines) {
    if (!line.ok) continue;
    if (line.frameType !== "assistant" && line.frameType !== "user") continue;
    const role = line.role ?? (line.frameType === "assistant" ? "assistant" : "user");
    const preview = blocksToPreviewFields(line.blocks);
    out.push({
      role,
      blocks: line.blocks.map((b) => {
        if (b.type === "text") return { ...b, text: clampText(b.text) };
        if (b.type === "thinking") {
          return {
            type: "thinking" as const,
            thinking: clampText(b.thinking),
            // Drop signature from preview surfaces (not secret, but noisy).
          };
        }
        if (b.type === "tool_result") {
          return { ...b, content: clampText(b.content) };
        }
        return b;
      }),
      stopReason: line.stopReason,
      usage: line.usage ?? null,
      sessionId: line.sessionId,
      model: line.model,
      toolUses: preview.toolUses,
      toolResults: preview.toolResults,
      text: preview.text,
      thinking: preview.thinking,
      sourceLineIndex: line.lineIndex,
    });
  }
  return out;
}

function addOpt(a?: number, b?: number): number | undefined {
  if (a == null && b == null) return undefined;
  return (a ?? 0) + (b ?? 0);
}

function mergeUsage(a: SmjUsage | null | undefined, b: SmjUsage | null | undefined): SmjUsage | null {
  if (!a && !b) return null;
  if (!a) return b ?? null;
  if (!b) return a;
  return {
    inputTokens: addOpt(a.inputTokens, b.inputTokens),
    outputTokens: addOpt(a.outputTokens, b.outputTokens),
    cacheReadInputTokens: addOpt(a.cacheReadInputTokens, b.cacheReadInputTokens),
    cacheCreationInputTokens: addOpt(
      a.cacheCreationInputTokens,
      b.cacheCreationInputTokens,
    ),
  };
}

/**
 * Parse a full NDJSON document (stdout or file body).
 * Caps source length for safety; excess is truncated with a synthetic error line.
 */
export function parseStreamingMessagesJson(source: string): SmjDocument {
  let text = source ?? "";
  let truncated = false;
  if (text.length > STREAMING_MESSAGES_JSON_MAX_SOURCE_CHARS) {
    text = text.slice(0, STREAMING_MESSAGES_JSON_MAX_SOURCE_CHARS);
    truncated = true;
  }

  const lines: SmjParsedLine[] = [];
  const rawLines = text.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const parsed = parseStreamingMessagesJsonLine(rawLines[i] ?? "", i);
    if (parsed) lines.push(parsed);
  }
  if (truncated) {
    lines.push({
      ok: false,
      lineIndex: rawLines.length,
      frameType: "invalid",
      blocks: [],
      error: "source_truncated",
    });
  }

  const messages = reconstructMessagesFromLines(lines);
  let result: SmjResultSummary | undefined;
  let sessionId: string | undefined;
  let model: string | undefined;
  let streamEventCount = 0;
  let toolUseCount = 0;
  let toolResultCount = 0;
  let parseErrors = 0;
  let validLineCount = 0;
  let usageSummary: SmjUsage | null = null;

  for (const line of lines) {
    if (!line.ok) {
      parseErrors += 1;
      continue;
    }
    validLineCount += 1;
    if (line.sessionId && !sessionId) sessionId = line.sessionId;
    if (line.model && !model) model = line.model;
    if (line.frameType === "stream_event") streamEventCount += 1;
    if (line.frameType === "result") {
      result = {
        subtype: line.subtype,
        stopReason: line.stopReason,
        isError: line.isError,
        resultText: line.resultText,
        usage: line.usage ?? null,
        durationMs: line.durationMs,
        numTurns: line.numTurns,
        totalCostUsd: line.totalCostUsd,
        sessionId: line.sessionId,
      };
      if (line.usage) usageSummary = line.usage;
    }
    for (const b of line.blocks) {
      if (b.type === "tool_use") toolUseCount += 1;
      if (b.type === "tool_result") toolResultCount += 1;
    }
    if (line.frameType === "assistant" && line.usage) {
      usageSummary = mergeUsage(usageSummary, line.usage);
    }
  }

  // Prefer result usage when present (authoritative rollup).
  if (result?.usage) usageSummary = result.usage;

  return {
    lines,
    messages,
    result,
    sessionId,
    model,
    lineCount: lines.length,
    validLineCount,
    parseErrors,
    streamEventCount,
    toolUseCount,
    toolResultCount,
    usageSummary,
  };
}

/**
 * Pure: does a CLI version string look new enough for streaming-messages-json?
 * Unparseable → `null` (caller soft-fails / omit flag).
 */
export function cliSupportsStreamingMessagesJson(
  rawVersion: string | null | undefined,
): boolean | null {
  if (rawVersion == null) return null;
  const m = String(rawVersion)
    .trim()
    .match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (![major, minor, patch].every(Number.isFinite)) return null;
  const [rm, rn, rp] = STREAMING_MESSAGES_JSON_MIN_CLI.split(".").map(Number);
  if (major > rm!) return true;
  if (major < rm!) return false;
  if (minor > rn!) return true;
  if (minor < rn!) return false;
  return patch >= rp!;
}

/** Headless argv fragment for the format flag. */
export function streamingMessagesJsonOutputArgs(
  includePartial = false,
): string[] {
  const args = ["--output-format", STREAMING_MESSAGES_JSON_FORMAT];
  if (includePartial) args.push("--include-partial-messages");
  return args;
}

/**
 * Soft-fail gate: only emit format flags when CLI is known ≥ 0.2.117.
 * Unknown version → empty (safer than AGENT_CRASHED on older clap).
 */
export function streamingMessagesJsonOutputArgsSoft(
  rawCliVersion: string | null | undefined,
  includePartial = false,
): string[] {
  const ok = cliSupportsStreamingMessagesJson(rawCliVersion);
  if (ok !== true) return [];
  return streamingMessagesJsonOutputArgs(includePartial);
}

/** Human one-line summary of a reconstructed message (no secrets). */
export function formatSmjMessageSummary(msg: SmjReconstructedMessage): string {
  const parts: string[] = [msg.role];
  if (msg.stopReason) parts.push(`stop=${msg.stopReason}`);
  if (msg.toolUses.length) {
    parts.push(
      `tools=${msg.toolUses.map((t) => t.name || t.id || "?").join(",")}`,
    );
  }
  if (msg.toolResults.length) {
    parts.push(`results=${msg.toolResults.length}`);
  }
  if (msg.text) {
    const t = msg.text.replace(/\s+/g, " ").trim();
    parts.push(t.length > 80 ? `${t.slice(0, 80)}…` : t);
  } else if (msg.thinking) {
    parts.push("(thinking)");
  }
  return parts.join(" · ");
}

/** Compact document stats for UI badges. */
export function formatSmjDocumentStats(doc: SmjDocument): {
  lines: number;
  messages: number;
  tools: number;
  errors: number;
  streamEvents: number;
  stopReason?: string | null;
  usageLabel?: string;
} {
  const u = doc.usageSummary;
  let usageLabel: string | undefined;
  if (u) {
    const bits: string[] = [];
    if (u.inputTokens != null) bits.push(`in ${u.inputTokens}`);
    if (u.outputTokens != null) bits.push(`out ${u.outputTokens}`);
    if (bits.length) usageLabel = bits.join(" / ");
  }
  return {
    lines: doc.lineCount,
    messages: doc.messages.length,
    tools: doc.toolUseCount,
    errors: doc.parseErrors,
    streamEvents: doc.streamEventCount,
    stopReason: doc.result?.stopReason ?? null,
    usageLabel,
  };
}

/**
 * Redact a raw NDJSON body before copy/export/log.
 * Strips common token shapes; does not invent structure.
 */
export function redactStreamingMessagesJsonSource(source: string): string {
  return redact(source ?? "");
}

/**
 * Build a safe plain-text preview of reconstructed messages for export.
 * Signatures omitted; tool inputs JSON-stringified and redacted.
 */
export function exportSmjPreviewText(doc: SmjDocument): string {
  const lines: string[] = [];
  if (doc.sessionId) lines.push(`session_id: ${doc.sessionId}`);
  if (doc.model) lines.push(`model: ${doc.model}`);
  if (doc.result?.stopReason) lines.push(`stop_reason: ${doc.result.stopReason}`);
  if (doc.usageSummary) {
    lines.push(`usage: ${JSON.stringify(doc.usageSummary)}`);
  }
  lines.push("");
  for (let i = 0; i < doc.messages.length; i++) {
    const m = doc.messages[i]!;
    lines.push(`--- ${i + 1}. ${m.role} (line ${m.sourceLineIndex}) ---`);
    if (m.stopReason) lines.push(`stop_reason: ${m.stopReason}`);
    if (m.usage) lines.push(`usage: ${JSON.stringify(m.usage)}`);
    for (const b of m.blocks) {
      if (b.type === "text") {
        lines.push(redact(b.text));
      } else if (b.type === "thinking") {
        lines.push(`[thinking]\n${redact(b.thinking)}`);
      } else if (b.type === "tool_use") {
        let input = "";
        try {
          input = JSON.stringify(b.input);
        } catch {
          input = String(b.input);
        }
        lines.push(`[tool_use] ${b.name} id=${b.id}\n${redact(input)}`);
      } else if (b.type === "tool_result") {
        lines.push(
          `[tool_result] id=${b.toolUseId} error=${b.isError === true}\n${redact(b.content)}`,
        );
      } else {
        lines.push(`[${b.rawType}]`);
      }
    }
    lines.push("");
  }
  if (doc.result?.resultText) {
    lines.push(`result: ${redact(doc.result.resultText)}`);
  }
  return lines.join("\n").trimEnd() + "\n";
}

/** Count non-empty lines (for progress UI without full parse). */
export function countNdjsonLines(source: string): number {
  if (!source) return 0;
  let n = 0;
  for (const line of source.split(/\r?\n/)) {
    if (line.trim()) n += 1;
  }
  return n;
}
