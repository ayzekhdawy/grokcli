/**
 * Session / diagnostics NDJSON export for ACP streaming formats.
 *
 * Formats (aligned with Grok Build CLI 0.2.117+ headless flags):
 * - `streaming-json` — agent-native ACP `session/update` NDJSON
 * - `streaming-messages-json` — Anthropic Messages wire NDJSON
 *
 * Sources:
 * - App session journal (user/assistant/tool rows) → synthesized lines
 * - Raw NDJSON from diagnostics paste/probe → redacted pass-through
 *
 * Always redacts secrets/tokens before copy/download. Soft-empty when no
 * messages and no source (never invents frames). Never logs secrets.
 */

import {
  isSensitiveKey,
  redactSensitiveValue,
} from "./managedSetup";
import { redact } from "./redact";
import {
  formatToolSummaryLine,
  type ExportableMessage,
} from "./sessionExport";
import { STREAMING_ACP_NDJSON_OUTPUT_FORMAT } from "./streamingAcpNdjson";
import { STREAMING_MESSAGES_JSON_FORMAT } from "./streamingMessagesJson";

/** CLI / export format ids. */
export type StreamSessionExportFormat =
  | "streaming-json"
  | "streaming-messages-json";

export const STREAM_SESSION_EXPORT_FORMATS: readonly StreamSessionExportFormat[] =
  ["streaming-json", "streaming-messages-json"] as const;

/** Re-export CLI flag constants for call sites. */
export const STREAM_EXPORT_ACP_FORMAT = STREAMING_ACP_NDJSON_OUTPUT_FORMAT;
export const STREAM_EXPORT_SMJ_FORMAT = STREAMING_MESSAGES_JSON_FORMAT;

export type StreamSessionExportOptions = {
  /** Include assistant thinking (default true). */
  includeThoughts?: boolean;
  /**
   * Include tool_step / tool rows (default true for stream diagnostics).
   * When false, tool shells are omitted.
   */
  includeToolSummary?: boolean;
};

export type StreamSessionExportInput = {
  title?: string | null;
  sessionId?: string | null;
  projectName?: string | null;
  projectPath?: string | null;
  exportedAt?: string;
  messages?: ExportableMessage[] | null;
  /**
   * Optional raw NDJSON (diagnostics paste / probe). When set and non-empty,
   * preferred over journal synthesis for that export path.
   */
  rawNdjson?: string | null;
  options?: StreamSessionExportOptions;
};

export type StreamSessionEmptyReason = "no_messages" | "no_source";

export type StreamSessionExportResult = {
  format: StreamSessionExportFormat;
  /** Full NDJSON body (redacted). Empty string when soft-empty. */
  body: string;
  lineCount: number;
  empty: boolean;
  emptyReason?: StreamSessionEmptyReason;
};

const MIME_NDJSON = "application/x-ndjson;charset=utf-8";

function isToolish(m: ExportableMessage): boolean {
  if (m.role === "tool") return true;
  if (
    m.marker === "tool_step" ||
    m.marker === "context_compact" ||
    m.marker === "turn_cancelled"
  ) {
    return true;
  }
  const c = (m.content || "").trim();
  return c.startsWith("tool_step|") || c.startsWith("tool_step");
}

function sessionIdOf(input: StreamSessionExportInput): string {
  const id = (input.sessionId || "").trim();
  return id || "app-session";
}

/** Safe download basename (no extension). */
function exportBasename(title: string, sessionId?: string | null): string {
  const base = (title || "session")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const id = (sessionId || "").slice(0, 8);
  const name = base || "session";
  return id ? `grok-${name}-${id}` : `grok-${name}`;
}

/** Whether a format string is a known stream export format. */
export function isStreamSessionExportFormat(
  v: string | null | undefined,
): v is StreamSessionExportFormat {
  return v === "streaming-json" || v === "streaming-messages-json";
}

/** MIME type for NDJSON blob downloads. */
export function streamSessionExportMimeType(
  _format?: StreamSessionExportFormat,
): string {
  return MIME_NDJSON;
}

/** Download filename for a stream format export. */
export function streamSessionExportFilename(
  format: StreamSessionExportFormat,
  title: string,
  sessionId?: string | null,
): string {
  const stem = exportBasename(title, sessionId);
  const suffix =
    format === "streaming-messages-json"
      ? "streaming-messages-json"
      : "streaming-json";
  return `${stem}-${suffix}.ndjson`;
}

/**
 * Redact secrets in a JSON-like value (keys + string token shapes).
 * Re-exported shape for tests / diagnostics.
 */
export function redactStreamExportValue(value: unknown): unknown {
  return redactSensitiveValue(value);
}

/**
 * Redact one NDJSON line. Invalid JSON → string-level `redact` only.
 * Sensitive object keys become `"[REDACTED]"`; sk-/Bearer tokens scrubbed.
 */
export function redactStreamNdjsonLine(line: string): string {
  const trimmed = (line ?? "").trimEnd();
  if (!trimmed.trim()) return "";
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const clean = redactSensitiveValue(parsed);
    return JSON.stringify(clean);
  } catch {
    return redact(trimmed);
  }
}

/**
 * Redact a full NDJSON body line-by-line (preserve blank lines as empty skips).
 * Always returns trailing newline when non-empty.
 */
export function redactStreamNdjson(source: string): string {
  if (!source) return "";
  const lines: string[] = [];
  for (const raw of source.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    lines.push(redactStreamNdjsonLine(raw));
  }
  if (lines.length === 0) return "";
  return lines.join("\n") + "\n";
}

function countNonEmptyLines(body: string): number {
  if (!body) return 0;
  let n = 0;
  for (const line of body.split(/\r?\n/)) {
    if (line.trim()) n += 1;
  }
  return n;
}

function ensureTrailingNewline(body: string): string {
  if (!body) return "";
  return body.endsWith("\n") ? body : `${body}\n`;
}

function exportMetaLine(
  format: StreamSessionExportFormat,
  input: StreamSessionExportInput,
  source: "app-journal" | "raw-ndjson",
): Record<string, unknown> {
  return {
    type: "export_meta",
    format,
    title: (input.title || "Untitled").trim() || "Untitled",
    sessionId: input.sessionId || undefined,
    projectName: input.projectName || undefined,
    projectPath: input.projectPath || undefined,
    exportedAt: input.exportedAt || new Date().toISOString(),
    source,
  };
}

function pushRedactedJson(
  lines: string[],
  value: unknown,
): void {
  const clean = redactSensitiveValue(value);
  lines.push(JSON.stringify(clean));
}

function isEmptyMessageShell(m: ExportableMessage, opts: {
  includeThoughts: boolean;
  includeToolSummary: boolean;
}): boolean {
  if (isToolish(m)) {
    if (!opts.includeToolSummary) return true;
    const line = formatToolSummaryLine((m.content || "").trim(), m.marker);
    return !line;
  }
  const body = (m.content || "").trim();
  const thought = (m.thought || "").trim();
  if (opts.includeThoughts) return !body && !thought;
  return !body;
}

/** Build ACP-shaped `streaming-json` NDJSON from journal messages. */
function buildAcpFromJournal(
  input: StreamSessionExportInput,
  opts: { includeThoughts: boolean; includeToolSummary: boolean },
): string[] {
  const sid = sessionIdOf(input);
  const lines: string[] = [];
  pushRedactedJson(lines, exportMetaLine("streaming-json", input, "app-journal"));

  const messages = input.messages ?? [];
  for (const m of messages) {
    if (isEmptyMessageShell(m, opts)) continue;

    if (isToolish(m)) {
      const summary =
        formatToolSummaryLine((m.content || "").trim(), m.marker) || "tool";
      pushRedactedJson(lines, {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: sid,
          update: {
            sessionUpdate: "tool_call_update",
            status: "completed",
            title: summary,
            content: { type: "text", text: summary },
            ...(m.createdAt ? { createdAt: m.createdAt } : {}),
          },
        },
      });
      continue;
    }

    const body = (m.content || "").trim();
    const thought = (m.thought || "").trim();
    const role = (m.role || "").toLowerCase();

    if (role === "user") {
      // User turns are not ACP sessionUpdate kinds; emit a clear journal frame.
      pushRedactedJson(lines, {
        type: "user",
        role: "user",
        sessionId: sid,
        content: body,
        source: "app-journal",
        ...(m.createdAt ? { createdAt: m.createdAt } : {}),
      });
      continue;
    }

    // assistant / other → ACP thought + message chunks (whole text per message)
    if (opts.includeThoughts && thought) {
      pushRedactedJson(lines, {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: sid,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: thought },
            ...(m.createdAt ? { createdAt: m.createdAt } : {}),
          },
        },
      });
    }
    if (body) {
      pushRedactedJson(lines, {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: sid,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: body },
            ...(m.createdAt ? { createdAt: m.createdAt } : {}),
          },
        },
      });
    }
  }

  // Only meta → treat as soft-empty of real content (caller may still want meta).
  return lines;
}

/** Build Anthropic Messages wire NDJSON from journal messages. */
function buildSmjFromJournal(
  input: StreamSessionExportInput,
  opts: { includeThoughts: boolean; includeToolSummary: boolean },
): string[] {
  const sid = sessionIdOf(input);
  const lines: string[] = [];
  pushRedactedJson(
    lines,
    exportMetaLine("streaming-messages-json", input, "app-journal"),
  );

  const messages = input.messages ?? [];
  let lastAssistantText = "";

  for (const m of messages) {
    if (isEmptyMessageShell(m, opts)) continue;

    if (isToolish(m)) {
      const summary =
        formatToolSummaryLine((m.content || "").trim(), m.marker) || "tool";
      // Represent tool steps as assistant tool_use frames (summary-only input).
      pushRedactedJson(lines, {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: `tool_${lines.length}`,
              name: summary.split(" ")[0] || "tool",
              input: { summary },
            },
          ],
          stop_reason: "tool_use",
        },
        session_id: sid,
        parent_tool_use_id: null,
        ...(m.createdAt ? { createdAt: m.createdAt } : {}),
      });
      continue;
    }

    const body = (m.content || "").trim();
    const thought = (m.thought || "").trim();
    const role = (m.role || "").toLowerCase();

    if (role === "user") {
      pushRedactedJson(lines, {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: body }],
        },
        session_id: sid,
        parent_tool_use_id: null,
        ...(m.createdAt ? { createdAt: m.createdAt } : {}),
      });
      continue;
    }

    const content: Array<Record<string, unknown>> = [];
    if (opts.includeThoughts && thought) {
      content.push({ type: "thinking", thinking: thought });
    }
    if (body) {
      content.push({ type: "text", text: body });
      lastAssistantText = body;
    }
    if (content.length === 0) continue;

    pushRedactedJson(lines, {
      type: "assistant",
      message: {
        role: "assistant",
        content,
        stop_reason: "end_turn",
      },
      session_id: sid,
      parent_tool_use_id: null,
      ...(m.createdAt ? { createdAt: m.createdAt } : {}),
    });
  }

  // Terminal result frame when we had at least one non-meta line content.
  if (lines.length > 1) {
    pushRedactedJson(lines, {
      type: "result",
      subtype: "success",
      is_error: false,
      result: lastAssistantText || undefined,
      stop_reason: "end_turn",
      session_id: sid,
    });
  }

  return lines;
}

/**
 * Export redacted raw NDJSON (diagnostics paste / probe).
 * Soft-empty when source has no non-empty lines.
 */
export function exportRawStreamNdjson(
  source: string | null | undefined,
  format: StreamSessionExportFormat = "streaming-json",
): StreamSessionExportResult {
  const redacted = redactStreamNdjson(source ?? "");
  const lineCount = countNonEmptyLines(redacted);
  if (lineCount === 0) {
    return {
      format,
      body: "",
      lineCount: 0,
      empty: true,
      emptyReason: "no_source",
    };
  }
  return {
    format,
    body: ensureTrailingNewline(redacted),
    lineCount,
    empty: false,
  };
}

/**
 * Build NDJSON for a session journal and/or raw source.
 *
 * Priority: non-empty `rawNdjson` → redacted pass-through; else synthesize
 * from `messages`. Soft-empty when both are absent/empty.
 */
export function buildStreamSessionNdjson(
  format: StreamSessionExportFormat,
  input: StreamSessionExportInput,
): StreamSessionExportResult {
  const raw = (input.rawNdjson ?? "").trim();
  if (raw) {
    return exportRawStreamNdjson(raw, format);
  }

  const opts = {
    includeThoughts: input.options?.includeThoughts !== false,
    includeToolSummary: input.options?.includeToolSummary !== false,
  };

  const messages = input.messages ?? [];
  const hasContent = messages.some((m) => !isEmptyMessageShell(m, opts));
  if (!hasContent) {
    return {
      format,
      body: "",
      lineCount: 0,
      empty: true,
      emptyReason: "no_messages",
    };
  }

  const lines =
    format === "streaming-messages-json"
      ? buildSmjFromJournal(input, opts)
      : buildAcpFromJournal(input, opts);

  // Meta-only (all messages filtered) → soft empty
  if (lines.length <= 1) {
    // still have export_meta only
    const onlyMeta = lines.length === 1;
    if (onlyMeta) {
      return {
        format,
        body: "",
        lineCount: 0,
        empty: true,
        emptyReason: "no_messages",
      };
    }
  }

  const body = ensureTrailingNewline(lines.join("\n"));
  return {
    format,
    body,
    lineCount: countNonEmptyLines(body),
    empty: false,
  };
}

/**
 * Convenience: render NDJSON string only (empty string when soft-empty).
 */
export function renderStreamSessionExport(
  format: StreamSessionExportFormat,
  input: StreamSessionExportInput,
): string {
  return buildStreamSessionNdjson(format, input).body;
}

/**
 * Detect whether a raw NDJSON body looks more like SMJ frames than ACP.
 * Pure heuristic for diagnostics default format choice.
 */
export function detectStreamNdjsonFormat(
  source: string | null | undefined,
): StreamSessionExportFormat | null {
  const text = (source ?? "").trim();
  if (!text) return null;
  let smj = 0;
  let acp = 0;
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    n += 1;
    if (n > 40) break;
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      if (obj == null || typeof obj !== "object") continue;
      const type = typeof obj.type === "string" ? obj.type : "";
      if (
        type === "assistant" ||
        type === "user" ||
        type === "system" ||
        type === "result" ||
        type === "stream_event"
      ) {
        smj += 1;
      }
      if (
        obj.method === "session/update" ||
        obj.sessionUpdate != null ||
        obj.session_update != null ||
        (obj.params != null &&
          typeof obj.params === "object" &&
          (obj.params as { update?: unknown }).update != null)
      ) {
        acp += 1;
      }
    } catch {
      // ignore
    }
  }
  if (smj === 0 && acp === 0) return null;
  return smj >= acp ? "streaming-messages-json" : "streaming-json";
}

/** True when a key name is treated as secret-bearing (for tests / UI). */
export function streamExportIsSensitiveKey(key: string): boolean {
  return isSensitiveKey(key);
}
