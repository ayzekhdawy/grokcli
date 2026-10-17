/**
 * Parse Grok headless streaming-json / json event lines.
 */

export type GrokStreamEventType =
  | "text"
  | "thought"
  | "end"
  | "error"
  | "max_turns_reached"
  | "unknown";

export interface GrokStreamEvent {
  type: GrokStreamEventType;
  data?: string;
  message?: string;
  sessionId?: string;
  stopReason?: string;
  raw: Record<string, unknown>;
}

/** Parse a single NDJSON line into a typed event (pure). */
export function parseStreamingJsonLine(line: string): GrokStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Non-JSON line: treat as plain text chunk if non-empty
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return null; // log line
    return { type: "text", data: trimmed, raw: { text: trimmed } };
  }

  const typeRaw = String(obj.type || "").toLowerCase();
  if (typeRaw === "text" || typeRaw === "assistant" || typeRaw === "content") {
    const data =
      typeof obj.data === "string"
        ? obj.data
        : typeof obj.text === "string"
          ? obj.text
          : typeof obj.content === "string"
            ? obj.content
            : "";
    return {
      type: "text",
      data,
      sessionId: str(obj.sessionId) || str(obj.session_id),
      raw: obj,
    };
  }
  if (typeRaw === "thought" || typeRaw === "thinking" || typeRaw === "reasoning") {
    const data =
      typeof obj.data === "string"
        ? obj.data
        : typeof obj.thought === "string"
          ? obj.thought
          : "";
    return { type: "thought", data, raw: obj };
  }
  if (typeRaw === "end" || typeRaw === "result" || typeRaw === "done") {
    return {
      type: "end",
      data: typeof obj.text === "string" ? obj.text : undefined,
      sessionId: str(obj.sessionId) || str(obj.session_id),
      stopReason: str(obj.stopReason) || str(obj.stop_reason),
      raw: obj,
    };
  }
  if (typeRaw === "error") {
    return {
      type: "error",
      message: str(obj.message) || str(obj.error) || "unknown error",
      sessionId: str(obj.sessionId) || str(obj.session_id),
      raw: obj,
    };
  }
  if (typeRaw === "max_turns_reached") {
    return { type: "max_turns_reached", raw: obj };
  }

  // Final json object without type field (plain json format)
  if (typeof obj.text === "string" && !typeRaw) {
    return {
      type: "end",
      data: obj.text,
      sessionId: str(obj.sessionId) || str(obj.session_id),
      stopReason: str(obj.stopReason),
      raw: obj,
    };
  }

  return { type: "unknown", raw: obj };
}

/**
 * Reduce a stream of lines into accumulated assistant text + session id.
 */
export function reduceStreamingEvents(lines: string[]): {
  text: string;
  sessionId: string;
  error: string;
  events: GrokStreamEvent[];
} {
  let text = "";
  let sessionId = "";
  let error = "";
  const events: GrokStreamEvent[] = [];
  for (const line of lines) {
    const ev = parseStreamingJsonLine(line);
    if (!ev) continue;
    events.push(ev);
    if (ev.sessionId) sessionId = ev.sessionId;
    if (ev.type === "text" && ev.data) text += ev.data;
    if (ev.type === "end" && ev.data && !text) text = ev.data;
    if (ev.type === "error" && ev.message) error = ev.message;
  }
  return { text, sessionId, error, events };
}

/** Extract displayable text from mixed stdout (streaming-json preferred). */
export function extractTextFromGrokOutput(stdout: string): {
  text: string;
  sessionId: string;
  error: string;
} {
  const lines = stdout.split(/\r?\n/);
  const reduced = reduceStreamingEvents(lines);
  if (reduced.text || reduced.error) return reduced;

  // Fallback: strip ANSI and use last non-diagnostic block
  const clean = stripAnsi(stdout)
    .split("\n")
    .filter((l) => !isDiagnosticLine(l))
    .join("\n")
    .trim();
  return { text: clean, sessionId: reduced.sessionId, error: "" };
}

export function stripAnsi(text: string): string {
  return String(text || "")
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[PX^_][\s\S]*?\u001b\\/g, "")
    .replace(/\u001b[@-_]/g, "");
}

function isDiagnosticLine(line: string): boolean {
  const t = line.trim();
  return (
    /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+(WARN|ERROR|INFO|DEBUG)\b/i.test(t) ||
    /\b(repo_state\.git\.collect|Codebase upload failed)\b/i.test(t)
  );
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
