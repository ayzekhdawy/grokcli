import { describe, expect, it } from "vitest";
import {
  cliSupportsStreamingAcpNdjson,
  formatAcpNdjsonSummaryText,
  isLegacySimplifiedStreamLine,
  parseAcpNdjsonLine,
  parseAcpNdjsonText,
  parseCliSemver,
  probeArgsIncludeStreamingJson,
  STREAMING_ACP_NDJSON_MIN_CLI,
  STREAMING_ACP_NDJSON_OUTPUT_FORMAT,
  STREAMING_MESSAGES_JSON_OUTPUT_FORMAT,
  streamingAcpNdjsonOutputFormatArgs,
  streamingAcpNdjsonOutputFormatArgsSoft,
  streamingAcpNdjsonProbeArgs,
  summarizeAcpNdjson,
  summarizeAcpNdjsonText,
} from "./streamingAcpNdjson";

const FIXTURE_NDJSON = [
  JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "agent-sess-1",
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Thinking…" },
        messageId: "msg-t",
      },
    },
  }),
  JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "agent-sess-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello " },
        messageId: "msg-1",
      },
    },
  }),
  JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "agent-sess-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "world." },
        messageId: "msg-1",
      },
    },
  }),
  JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "agent-sess-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "read",
        kind: "read",
        status: "pending",
      },
    },
  }),
  JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    result: { stopReason: "end_turn", sessionId: "agent-sess-1" },
  }),
].join("\n");

describe("streamingAcpNdjson constants", () => {
  it("keeps streaming-json distinct from streaming-messages-json", () => {
    expect(STREAMING_ACP_NDJSON_OUTPUT_FORMAT).toBe("streaming-json");
    expect(STREAMING_MESSAGES_JSON_OUTPUT_FORMAT).toBe(
      "streaming-messages-json",
    );
    expect(STREAMING_ACP_NDJSON_OUTPUT_FORMAT).not.toBe(
      STREAMING_MESSAGES_JSON_OUTPUT_FORMAT,
    );
    expect(STREAMING_ACP_NDJSON_MIN_CLI).toBe("0.2.117");
  });
});

describe("parseAcpNdjsonLine", () => {
  it("classifies JSON-RPC session/update chunks", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hi" },
        },
      },
    });
    const ev = parseAcpNdjsonLine(line, 7);
    expect(ev.line).toBe(7);
    expect(ev.kind).toBe("agent_message_chunk");
    expect(ev.isAcpShaped).toBe(true);
    expect(ev.sessionId).toBe("s1");
    expect(ev.preview).toBe("hi");
  });

  it("accepts bare update objects", () => {
    const ev = parseAcpNdjsonLine(
      JSON.stringify({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "hmm" },
      }),
    );
    expect(ev.kind).toBe("agent_thought_chunk");
    expect(ev.isAcpShaped).toBe(true);
    expect(ev.preview).toBe("hmm");
  });

  it("accepts bare params with update field", () => {
    const ev = parseAcpNdjsonLine(
      JSON.stringify({
        sessionId: "abc",
        update: {
          sessionUpdate: "plan",
          entries: [],
        },
      }),
    );
    expect(ev.kind).toBe("plan");
    expect(ev.sessionId).toBe("abc");
    expect(ev.isAcpShaped).toBe(true);
  });

  it("marks legacy simplified stream as non_acp", () => {
    const ev = parseAcpNdjsonLine(
      JSON.stringify({ type: "text", data: "hello from legacy" }),
    );
    expect(ev.kind).toBe("non_acp");
    expect(ev.isAcpShaped).toBe(false);
    expect(ev.preview).toBe("hello from legacy");
  });

  it("marks invalid JSON", () => {
    const ev = parseAcpNdjsonLine("not-json {");
    expect(ev.kind).toBe("invalid");
    expect(ev.isAcpShaped).toBe(false);
  });

  it("marks blank lines empty", () => {
    expect(parseAcpNdjsonLine("   ").kind).toBe("empty");
  });

  it("classifies rpc_result and prompt_complete", () => {
    const result = parseAcpNdjsonLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { stopReason: "end_turn" },
      }),
    );
    expect(result.kind).toBe("rpc_result");
    expect(result.preview).toBe("end_turn");

    const done = parseAcpNdjsonLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "_x.ai/session/prompt_complete",
        params: { sessionId: "s", stopReason: "end_turn" },
      }),
    );
    expect(done.kind).toBe("prompt_complete");
    expect(done.sessionId).toBe("s");
  });
});

describe("isLegacySimplifiedStreamLine", () => {
  it("detects type-based simplified events only", () => {
    expect(isLegacySimplifiedStreamLine({ type: "text", data: "x" })).toBe(
      true,
    );
    expect(
      isLegacySimplifiedStreamLine({
        sessionUpdate: "agent_message_chunk",
        content: { text: "x" },
      }),
    ).toBe(false);
  });
});

describe("summarizeAcpNdjson", () => {
  it("counts types and joins assistant text from fixture", () => {
    const summary = summarizeAcpNdjsonText(FIXTURE_NDJSON);
    expect(summary.acpShapedCount).toBe(5);
    expect(summary.nonAcpCount).toBe(0);
    expect(summary.assistantText).toBe("Hello world.");
    expect(summary.thoughtText).toBe("Thinking…");
    expect(summary.sessionIds).toEqual(["agent-sess-1"]);
    const kinds = Object.fromEntries(
      summary.typeCounts.map((r) => [r.kind, r.count]),
    );
    expect(kinds.agent_message_chunk).toBe(2);
    expect(kinds.agent_thought_chunk).toBe(1);
    expect(kinds.tool_call).toBe(1);
    expect(kinds.rpc_result).toBe(1);
  });

  it("formats a copyable summary", () => {
    const text = formatAcpNdjsonSummaryText(summarizeAcpNdjsonText(FIXTURE_NDJSON));
    expect(text).toContain("Streaming ACP NDJSON summary");
    expect(text).toContain("streaming-json");
    expect(text).toContain("streaming-messages-json");
    expect(text).toContain("agent_message_chunk: 2");
    expect(text).toContain("Hello world.");
  });

  it("tracks non-acp and invalid counts", () => {
    const events = parseAcpNdjsonText(
      [
        JSON.stringify({ type: "text", data: "legacy" }),
        "not json",
        "",
        JSON.stringify({
          sessionUpdate: "agent_message_chunk",
          content: { text: "ok" },
        }),
      ].join("\n"),
    );
    const s = summarizeAcpNdjson(events);
    expect(s.nonAcpCount).toBe(1);
    expect(s.invalidCount).toBe(1);
    expect(s.emptyCount).toBe(1);
    expect(s.acpShapedCount).toBe(1);
  });
});

describe("version soft-gate", () => {
  it("parses common version banners", () => {
    expect(parseCliSemver("grok 0.2.117")).toEqual([0, 2, 117]);
    expect(parseCliSemver("0.2.116")).toEqual([0, 2, 116]);
    expect(parseCliSemver("")).toBeNull();
  });

  it("gates at 0.2.117", () => {
    expect(cliSupportsStreamingAcpNdjson("grok 0.2.117")).toBe(true);
    expect(cliSupportsStreamingAcpNdjson("0.2.200")).toBe(true);
    expect(cliSupportsStreamingAcpNdjson("0.2.116")).toBe(false);
    expect(cliSupportsStreamingAcpNdjson("0.1.999")).toBe(false);
    expect(cliSupportsStreamingAcpNdjson("")).toBeNull();
    expect(cliSupportsStreamingAcpNdjson(null)).toBeNull();
  });

  it("soft output-format args omit on old/unknown", () => {
    expect(streamingAcpNdjsonOutputFormatArgs()).toEqual([
      "--output-format",
      "streaming-json",
    ]);
    expect(streamingAcpNdjsonOutputFormatArgsSoft("0.2.117")).toEqual([
      "--output-format",
      "streaming-json",
    ]);
    expect(streamingAcpNdjsonOutputFormatArgsSoft("0.2.116")).toEqual([]);
    expect(streamingAcpNdjsonOutputFormatArgsSoft(null)).toEqual([]);
  });

  it("builds probe args with soft gate", () => {
    const ok = streamingAcpNdjsonProbeArgs({
      rawCliVersion: "grok 0.2.117",
      prompt: "ping",
    });
    expect(ok).toContain("-p");
    expect(ok).toContain("ping");
    expect(ok).toContain("--always-approve");
    expect(probeArgsIncludeStreamingJson(ok)).toBe(true);

    const old = streamingAcpNdjsonProbeArgs({
      rawCliVersion: "0.2.100",
    });
    expect(probeArgsIncludeStreamingJson(old)).toBe(false);
    expect(old).not.toContain("streaming-json");
  });
});
