import { describe, expect, it } from "vitest";
import {
  STREAM_EXPORT_ACP_FORMAT,
  STREAM_EXPORT_SMJ_FORMAT,
  STREAM_SESSION_EXPORT_FORMATS,
  buildStreamSessionNdjson,
  detectStreamNdjsonFormat,
  exportRawStreamNdjson,
  isStreamSessionExportFormat,
  redactStreamExportValue,
  redactStreamNdjson,
  redactStreamNdjsonLine,
  renderStreamSessionExport,
  streamSessionExportFilename,
  streamSessionExportMimeType,
} from "./streamSessionExport";
import { parseAcpNdjsonLine } from "./streamingAcpNdjson";
import { parseStreamingMessagesJsonLine } from "./streamingMessagesJson";

const SAMPLE_MSGS = [
  { role: "user" as const, content: "Hello agent", createdAt: "2026-01-01T00:00:00Z" },
  {
    role: "assistant" as const,
    content: "Hi there.",
    thought: "Be brief.",
    createdAt: "2026-01-01T00:00:01Z",
  },
  {
    role: "tool" as const,
    content: "tool_step|bash|completed|ran tests",
    marker: "tool_step",
  },
];

describe("format constants / guards", () => {
  it("matches CLI flag names", () => {
    expect(STREAM_EXPORT_ACP_FORMAT).toBe("streaming-json");
    expect(STREAM_EXPORT_SMJ_FORMAT).toBe("streaming-messages-json");
    expect(STREAM_SESSION_EXPORT_FORMATS).toContain("streaming-json");
    expect(STREAM_SESSION_EXPORT_FORMATS).toContain("streaming-messages-json");
  });

  it("isStreamSessionExportFormat", () => {
    expect(isStreamSessionExportFormat("streaming-json")).toBe(true);
    expect(isStreamSessionExportFormat("streaming-messages-json")).toBe(true);
    expect(isStreamSessionExportFormat("json")).toBe(false);
    expect(isStreamSessionExportFormat(null)).toBe(false);
  });
});

describe("filename / mime", () => {
  it("builds safe .ndjson names per format", () => {
    expect(
      streamSessionExportFilename("streaming-json", "Fix Doctor!", "abcdef12-xxxx"),
    ).toBe("grok-fix-doctor-abcdef12-streaming-json.ndjson");
    expect(
      streamSessionExportFilename(
        "streaming-messages-json",
        "Fix Doctor!",
        "abcdef12-xxxx",
      ),
    ).toBe("grok-fix-doctor-abcdef12-streaming-messages-json.ndjson");
  });

  it("falls back without title/id", () => {
    expect(streamSessionExportFilename("streaming-json", "", null)).toBe(
      "grok-session-streaming-json.ndjson",
    );
  });

  it("uses ndjson mime", () => {
    expect(streamSessionExportMimeType()).toContain("ndjson");
    expect(streamSessionExportMimeType("streaming-messages-json")).toContain(
      "ndjson",
    );
  });
});

describe("redact", () => {
  it("scrubs sk- tokens in lines", () => {
    const dirty = JSON.stringify({
      text: "key sk-abcdefghijklmnopqrstuvwxyz and ok",
    });
    const out = redactStreamNdjsonLine(dirty);
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });

  it("redacts sensitive keys deeply", () => {
    const clean = redactStreamExportValue({
      apiKey: "super-secret",
      nested: { token: "abc123token", note: "safe" },
      text: "Bearer abcdefghijklmnopqr",
    }) as Record<string, unknown>;
    expect(clean.apiKey).toBe("[REDACTED]");
    expect((clean.nested as { token: string }).token).toBe("[REDACTED]");
    expect((clean.nested as { note: string }).note).toBe("safe");
    expect(String(clean.text)).toContain("[REDACTED]");
  });

  it("redacts multi-line NDJSON bodies", () => {
    const body = [
      JSON.stringify({ type: "user", content: "hi sk-abcdefghijklmnop" }),
      "",
      JSON.stringify({ api_key: "leak-me-now" }),
    ].join("\n");
    const out = redactStreamNdjson(body);
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("sk-abcdefghijklmnop");
    expect(out).not.toContain("leak-me-now");
    expect(out.endsWith("\n")).toBe(true);
  });
});

describe("soft empty", () => {
  it("empty messages → soft empty", () => {
    const r = buildStreamSessionNdjson("streaming-json", {
      title: "T",
      sessionId: "s1",
      messages: [],
    });
    expect(r.empty).toBe(true);
    expect(r.emptyReason).toBe("no_messages");
    expect(r.body).toBe("");
    expect(r.lineCount).toBe(0);
  });

  it("empty shells only → soft empty", () => {
    const r = buildStreamSessionNdjson("streaming-json", {
      messages: [{ role: "assistant", content: "  ", thought: "" }],
    });
    expect(r.empty).toBe(true);
    expect(r.body).toBe("");
  });

  it("empty raw source → soft empty", () => {
    const r = exportRawStreamNdjson("  \n\n  ");
    expect(r.empty).toBe(true);
    expect(r.emptyReason).toBe("no_source");
  });

  it("render returns empty string when soft-empty", () => {
    expect(
      renderStreamSessionExport("streaming-json", { messages: [] }),
    ).toBe("");
  });
});

describe("build streaming-json from journal", () => {
  it("emits export_meta + user + ACP assistant frames", () => {
    const r = buildStreamSessionNdjson("streaming-json", {
      title: "Demo",
      sessionId: "sess-abc",
      messages: SAMPLE_MSGS,
      options: { includeThoughts: true, includeToolSummary: true },
    });
    expect(r.empty).toBe(false);
    expect(r.lineCount).toBeGreaterThanOrEqual(3);
    expect(r.body).toContain("export_meta");
    expect(r.body).toContain("streaming-json");
    expect(r.body).toContain("sess-abc");
    expect(r.body).toContain("Hello agent");
    expect(r.body).toContain("agent_message_chunk");
    expect(r.body).toContain("agent_thought_chunk");
    expect(r.body).toContain("tool_call_update");

    // Assistant line is ACP-shaped
    const assistantLine = r.body
      .split("\n")
      .find((l) => l.includes("agent_message_chunk"));
    expect(assistantLine).toBeTruthy();
    const parsed = parseAcpNdjsonLine(assistantLine!);
    expect(parsed.isAcpShaped).toBe(true);
    expect(parsed.kind).toBe("agent_message_chunk");
    expect(parsed.preview).toContain("Hi there");
  });

  it("omits thoughts when includeThoughts false", () => {
    const r = buildStreamSessionNdjson("streaming-json", {
      sessionId: "s",
      messages: SAMPLE_MSGS,
      options: { includeThoughts: false, includeToolSummary: false },
    });
    expect(r.body).not.toContain("agent_thought_chunk");
    expect(r.body).not.toContain("Be brief");
    expect(r.body).not.toContain("tool_call_update");
  });

  it("redacts secrets in journal content", () => {
    const r = buildStreamSessionNdjson("streaming-json", {
      sessionId: "s",
      messages: [
        {
          role: "user",
          content: "use sk-abcdefghijklmnopqrstuvwxyz please",
        },
        { role: "assistant", content: "ok" },
      ],
    });
    expect(r.body).toContain("[REDACTED]");
    expect(r.body).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });
});

describe("build streaming-messages-json from journal", () => {
  it("emits user/assistant/result frames parseable by SMJ parser", () => {
    const r = buildStreamSessionNdjson("streaming-messages-json", {
      title: "Demo",
      sessionId: "sess-smj",
      messages: [
        { role: "user", content: "ping" },
        {
          role: "assistant",
          content: "pong",
          thought: "simple",
        },
      ],
      options: { includeThoughts: true },
    });
    expect(r.empty).toBe(false);
    expect(r.body).toContain("streaming-messages-json");
    expect(r.body).toContain('"type":"user"');
    expect(r.body).toContain('"type":"assistant"');
    expect(r.body).toContain('"type":"result"');

    const assistantLine = r.body
      .split("\n")
      .find((l) => l.includes('"type":"assistant"'));
    expect(assistantLine).toBeTruthy();
    const parsed = parseStreamingMessagesJsonLine(assistantLine!);
    expect(parsed?.ok).toBe(true);
    expect(parsed?.frameType).toBe("assistant");
    expect(parsed?.blocks.some((b) => b.type === "text")).toBe(true);
    expect(parsed?.blocks.some((b) => b.type === "thinking")).toBe(true);
  });

  it("includes tool_use when tools opted in", () => {
    const r = buildStreamSessionNdjson("streaming-messages-json", {
      sessionId: "s",
      messages: SAMPLE_MSGS,
      options: { includeToolSummary: true },
    });
    expect(r.body).toContain("tool_use");
    expect(r.body).toContain("bash");
  });
});

describe("raw NDJSON export", () => {
  it("prefers raw over messages when raw present", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "raw-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "from probe" },
        },
      },
    });
    const r = buildStreamSessionNdjson("streaming-json", {
      messages: SAMPLE_MSGS,
      rawNdjson: raw,
    });
    expect(r.body).toContain("from probe");
    expect(r.body).not.toContain("Hello agent");
  });

  it("redacts raw on export", () => {
    const raw = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "token sk-abcdefghijklmnopqrstuv" }],
      },
    });
    const r = exportRawStreamNdjson(raw, "streaming-messages-json");
    expect(r.empty).toBe(false);
    expect(r.body).toContain("[REDACTED]");
    expect(r.body).not.toContain("sk-abcdefghijklmnopqrstuv");
  });
});

describe("detectStreamNdjsonFormat", () => {
  it("detects ACP session/update", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "x" } },
      },
    });
    expect(detectStreamNdjsonFormat(raw)).toBe("streaming-json");
  });

  it("detects SMJ frames", () => {
    const raw = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "s" }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
        session_id: "s",
      }),
    ].join("\n");
    expect(detectStreamNdjsonFormat(raw)).toBe("streaming-messages-json");
  });

  it("returns null for empty / unknown", () => {
    expect(detectStreamNdjsonFormat("")).toBeNull();
    expect(detectStreamNdjsonFormat('{"foo":1}\n{"bar":2}')).toBeNull();
  });
});
