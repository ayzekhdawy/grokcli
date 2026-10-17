import { describe, expect, it } from "vitest";
import {
  STREAMING_MESSAGES_JSON_FORMAT,
  STREAMING_MESSAGES_JSON_MIN_CLI,
  STREAMING_MESSAGES_JSON_PROBE_PROMPT,
  cliSupportsStreamingMessagesJson,
  countNdjsonLines,
  exportSmjPreviewText,
  formatSmjDocumentStats,
  formatSmjMessageSummary,
  parseSmjContentBlock,
  parseSmjUsage,
  parseStreamingMessagesJson,
  parseStreamingMessagesJsonLine,
  reconstructMessagesFromLines,
  redactStreamingMessagesJsonSource,
  streamingMessagesJsonOutputArgs,
  streamingMessagesJsonOutputArgsSoft,
} from "./streamingMessagesJson";

/** Minimal real-shape fixtures (from CLI 0.2.117 probe). */
const SYSTEM_INIT = JSON.stringify({
  type: "system",
  subtype: "init",
  session_id: "sess-1",
  apiKeySource: "oauth",
  model: "grok-4.5",
  cwd: "/tmp",
  permissionMode: "bypassPermissions",
  tools: ["list_dir"],
  uuid: "u-sys",
});

const ASSISTANT_TEXT = JSON.stringify({
  type: "assistant",
  message: {
    id: "msg_0",
    type: "message",
    role: "assistant",
    model: "grok-4.5",
    content: [
      {
        type: "thinking",
        thinking: "Simple ping.",
        signature: "sig-abc",
      },
      { type: "text", text: "PING_OK" },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 10,
      cache_read_input_tokens: 50,
      cache_creation_input_tokens: 0,
    },
  },
  parent_tool_use_id: null,
  session_id: "sess-1",
  uuid: "u-as",
});

const ASSISTANT_TOOL = JSON.stringify({
  type: "assistant",
  message: {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "grok-4.5",
    content: [
      {
        type: "tool_use",
        id: "call-1",
        name: "list_dir",
        input: { target_directory: "/tmp" },
      },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 200, output_tokens: 20 },
  },
  parent_tool_use_id: null,
  session_id: "sess-1",
  uuid: "u-tool",
});

const USER_TOOL_RESULT = JSON.stringify({
  type: "user",
  message: {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "call-1",
        content: "file_a\nfile_b",
        is_error: false,
      },
    ],
  },
  parent_tool_use_id: null,
  session_id: "sess-1",
  uuid: "u-res",
});

const RESULT_OK = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 1200,
  num_turns: 1,
  result: "PING_OK",
  stop_reason: "end_turn",
  total_cost_usd: 0.01,
  usage: {
    input_tokens: 300,
    output_tokens: 30,
    cache_read_input_tokens: 50,
    cache_creation_input_tokens: 0,
  },
  session_id: "sess-1",
  uuid: "u-result",
});

const STREAM_DELTA = JSON.stringify({
  type: "stream_event",
  event: {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "Hi" },
  },
  parent_tool_use_id: null,
  session_id: "sess-1",
  uuid: "u-delta",
});

describe("constants", () => {
  it("documents format flag and min CLI", () => {
    expect(STREAMING_MESSAGES_JSON_FORMAT).toBe("streaming-messages-json");
    expect(STREAMING_MESSAGES_JSON_MIN_CLI).toBe("0.2.117");
    expect(STREAMING_MESSAGES_JSON_PROBE_PROMPT).toContain("SMJ_PROBE_OK");
  });
});

describe("parseSmjUsage", () => {
  it("reads snake_case usage", () => {
    expect(
      parseSmjUsage({
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 4,
      }),
    ).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      cacheReadInputTokens: 3,
      cacheCreationInputTokens: 4,
    });
  });

  it("reads camelCase usage", () => {
    expect(
      parseSmjUsage({ inputTokens: 9, outputTokens: 8 }),
    ).toEqual({
      inputTokens: 9,
      outputTokens: 8,
      cacheReadInputTokens: undefined,
      cacheCreationInputTokens: undefined,
    });
  });

  it("returns null for empty", () => {
    expect(parseSmjUsage(null)).toBeNull();
    expect(parseSmjUsage({})).toBeNull();
  });
});

describe("parseSmjContentBlock", () => {
  it("parses text / thinking / tool_use / tool_result", () => {
    expect(parseSmjContentBlock({ type: "text", text: "hi" })).toEqual({
      type: "text",
      text: "hi",
    });
    expect(
      parseSmjContentBlock({
        type: "thinking",
        thinking: "t",
        signature: "s",
      }),
    ).toEqual({ type: "thinking", thinking: "t", signature: "s" });
    expect(
      parseSmjContentBlock({
        type: "tool_use",
        id: "c1",
        name: "list_dir",
        input: { a: 1 },
      }),
    ).toEqual({
      type: "tool_use",
      id: "c1",
      name: "list_dir",
      input: { a: 1 },
    });
    expect(
      parseSmjContentBlock({
        type: "tool_result",
        tool_use_id: "c1",
        content: "ok",
        is_error: true,
      }),
    ).toEqual({
      type: "tool_result",
      toolUseId: "c1",
      content: "ok",
      isError: true,
    });
  });
});

describe("parseStreamingMessagesJsonLine", () => {
  it("skips blank lines", () => {
    expect(parseStreamingMessagesJsonLine("")).toBeNull();
    expect(parseStreamingMessagesJsonLine("   \n")).toBeNull();
  });

  it("marks invalid JSON", () => {
    const p = parseStreamingMessagesJsonLine("{nope", 3);
    expect(p?.ok).toBe(false);
    expect(p?.frameType).toBe("invalid");
    expect(p?.error).toBe("invalid_json");
    expect(p?.lineIndex).toBe(3);
  });

  it("parses system init", () => {
    const p = parseStreamingMessagesJsonLine(SYSTEM_INIT, 0)!;
    expect(p.ok).toBe(true);
    expect(p.frameType).toBe("system");
    expect(p.subtype).toBe("init");
    expect(p.sessionId).toBe("sess-1");
    expect(p.model).toBe("grok-4.5");
  });

  it("parses assistant with usage + stop_reason + tool_use", () => {
    const text = parseStreamingMessagesJsonLine(ASSISTANT_TEXT, 1)!;
    expect(text.frameType).toBe("assistant");
    expect(text.role).toBe("assistant");
    expect(text.stopReason).toBe("end_turn");
    expect(text.usage?.inputTokens).toBe(100);
    expect(text.usage?.outputTokens).toBe(10);
    expect(text.blocks.map((b) => b.type)).toEqual(["thinking", "text"]);

    const tool = parseStreamingMessagesJsonLine(ASSISTANT_TOOL, 2)!;
    expect(tool.stopReason).toBe("tool_use");
    expect(tool.blocks[0]).toMatchObject({
      type: "tool_use",
      id: "call-1",
      name: "list_dir",
    });
  });

  it("parses user tool_result", () => {
    const p = parseStreamingMessagesJsonLine(USER_TOOL_RESULT, 3)!;
    expect(p.frameType).toBe("user");
    expect(p.blocks[0]).toMatchObject({
      type: "tool_result",
      toolUseId: "call-1",
      isError: false,
    });
  });

  it("parses result frame", () => {
    const p = parseStreamingMessagesJsonLine(RESULT_OK, 4)!;
    expect(p.frameType).toBe("result");
    expect(p.subtype).toBe("success");
    expect(p.stopReason).toBe("end_turn");
    expect(p.resultText).toBe("PING_OK");
    expect(p.usage?.inputTokens).toBe(300);
    expect(p.durationMs).toBe(1200);
  });

  it("parses stream_event", () => {
    const p = parseStreamingMessagesJsonLine(STREAM_DELTA, 5)!;
    expect(p.frameType).toBe("stream_event");
    expect(p.streamEventType).toBe("content_block_delta");
  });
});

describe("parseStreamingMessagesJson / reconstruct", () => {
  const DOC = [
    SYSTEM_INIT,
    ASSISTANT_TOOL,
    USER_TOOL_RESULT,
    ASSISTANT_TEXT,
    RESULT_OK,
    STREAM_DELTA,
  ].join("\n");

  it("rebuilds assistant/user messages and stats", () => {
    const doc = parseStreamingMessagesJson(DOC);
    expect(doc.validLineCount).toBe(6);
    expect(doc.parseErrors).toBe(0);
    expect(doc.messages).toHaveLength(3);
    expect(doc.toolUseCount).toBe(1);
    expect(doc.toolResultCount).toBe(1);
    expect(doc.streamEventCount).toBe(1);
    expect(doc.sessionId).toBe("sess-1");
    expect(doc.model).toBe("grok-4.5");
    expect(doc.result?.stopReason).toBe("end_turn");
    expect(doc.result?.resultText).toBe("PING_OK");
    // Result usage wins as rollup
    expect(doc.usageSummary?.inputTokens).toBe(300);
    expect(doc.usageSummary?.outputTokens).toBe(30);

    const toolMsg = doc.messages[0]!;
    expect(toolMsg.role).toBe("assistant");
    expect(toolMsg.toolUses).toEqual([{ id: "call-1", name: "list_dir" }]);
    expect(toolMsg.stopReason).toBe("tool_use");

    const userMsg = doc.messages[1]!;
    expect(userMsg.toolResults[0]?.toolUseId).toBe("call-1");

    const final = doc.messages[2]!;
    expect(final.text).toBe("PING_OK");
    expect(final.thinking).toBe("Simple ping.");
    // signature stripped from reconstructed thinking blocks
    expect(
      final.blocks.find((b) => b.type === "thinking") &&
        "signature" in (final.blocks.find((b) => b.type === "thinking") as object)
        ? (final.blocks.find((b) => b.type === "thinking") as { signature?: string })
            .signature
        : undefined,
    ).toBeUndefined();
  });

  it("counts parse errors for bad lines", () => {
    const doc = parseStreamingMessagesJson(`${ASSISTANT_TEXT}\n{bad\n${RESULT_OK}`);
    expect(doc.parseErrors).toBe(1);
    expect(doc.messages).toHaveLength(1);
  });

  it("reconstructMessagesFromLines skips non-message frames", () => {
    const lines = DOC.split("\n")
      .map((l, i) => parseStreamingMessagesJsonLine(l, i))
      .filter(Boolean);
    const msgs = reconstructMessagesFromLines(lines as NonNullable<(typeof lines)[0]>[]);
    expect(msgs.every((m) => m.role === "assistant" || m.role === "user")).toBe(
      true,
    );
  });
});

describe("cliSupportsStreamingMessagesJson", () => {
  it("gates on 0.2.117", () => {
    expect(cliSupportsStreamingMessagesJson("grok 0.2.116")).toBe(false);
    expect(cliSupportsStreamingMessagesJson("0.2.117")).toBe(true);
    expect(cliSupportsStreamingMessagesJson("grok 0.2.200")).toBe(true);
    expect(cliSupportsStreamingMessagesJson("1.0.0")).toBe(true);
    expect(cliSupportsStreamingMessagesJson("nope")).toBeNull();
    expect(cliSupportsStreamingMessagesJson(null)).toBeNull();
  });
});

describe("streamingMessagesJsonOutputArgs", () => {
  it("builds format flags", () => {
    expect(streamingMessagesJsonOutputArgs()).toEqual([
      "--output-format",
      "streaming-messages-json",
    ]);
    expect(streamingMessagesJsonOutputArgs(true)).toEqual([
      "--output-format",
      "streaming-messages-json",
      "--include-partial-messages",
    ]);
  });

  it("soft-fails older / unknown CLI", () => {
    expect(streamingMessagesJsonOutputArgsSoft("0.2.100")).toEqual([]);
    expect(streamingMessagesJsonOutputArgsSoft(null, true)).toEqual([]);
    expect(streamingMessagesJsonOutputArgsSoft("0.2.117", true)).toEqual([
      "--output-format",
      "streaming-messages-json",
      "--include-partial-messages",
    ]);
  });
});

describe("preview / export / redact", () => {
  it("formats message summary and document stats", () => {
    const doc = parseStreamingMessagesJson(
      [ASSISTANT_TOOL, USER_TOOL_RESULT, RESULT_OK].join("\n"),
    );
    const sum = formatSmjMessageSummary(doc.messages[0]!);
    expect(sum).toContain("assistant");
    expect(sum).toContain("list_dir");
    const stats = formatSmjDocumentStats(doc);
    expect(stats.messages).toBe(2);
    expect(stats.tools).toBe(1);
    expect(stats.stopReason).toBe("end_turn");
    expect(stats.usageLabel).toContain("in 300");
  });

  it("redacts secrets in source and export", () => {
    const dirty = `${ASSISTANT_TEXT}\nkey sk-abcdefghijklmnop\n`;
    expect(redactStreamingMessagesJsonSource(dirty)).toContain("[REDACTED]");
    const doc = parseStreamingMessagesJson(
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "token sk-abcdefghijklmnop here",
            },
          ],
          stop_reason: "end_turn",
        },
        session_id: "s",
      }),
    );
    const exp = exportSmjPreviewText(doc);
    expect(exp).toContain("[REDACTED]");
    expect(exp).not.toContain("sk-abcdefghijklmnop");
  });

  it("countNdjsonLines ignores blanks", () => {
    expect(countNdjsonLines("a\n\nb\n")).toBe(2);
    expect(countNdjsonLines("")).toBe(0);
  });
});
