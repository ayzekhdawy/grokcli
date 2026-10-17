import { describe, expect, it } from "vitest";
import {
  PARTIAL_STREAM_MIN_CLI,
  STREAMING_JSON,
  STREAMING_MESSAGES_JSON,
  cliSupportsIncludePartialMessages,
  includePartialMessagesNeedsFlag,
  includePartialMessagesSpawnArgs,
  includePartialMessagesSpawnArgsSoft,
  isStreamingMessagesJsonFormat,
  normalizeHeadlessOutputFormat,
  normalizeIncludePartialMessages,
  resolveHeadlessStreamForPartial,
} from "./partialStream";

describe("normalizeIncludePartialMessages", () => {
  it("only true for boolean true", () => {
    expect(normalizeIncludePartialMessages(true)).toBe(true);
    expect(normalizeIncludePartialMessages(false)).toBe(false);
    expect(normalizeIncludePartialMessages(null)).toBe(false);
    expect(normalizeIncludePartialMessages(undefined)).toBe(false);
  });
});

describe("normalizeHeadlessOutputFormat", () => {
  it("defaults and aliases", () => {
    expect(normalizeHeadlessOutputFormat(null)).toBe(STREAMING_JSON);
    expect(normalizeHeadlessOutputFormat("")).toBe(STREAMING_JSON);
    expect(normalizeHeadlessOutputFormat("nope")).toBe(STREAMING_JSON);
    expect(normalizeHeadlessOutputFormat("streaming-json")).toBe(STREAMING_JSON);
    expect(normalizeHeadlessOutputFormat("stream-json")).toBe(STREAMING_JSON);
    expect(normalizeHeadlessOutputFormat("STREAMING_MESSAGES_JSON")).toBe(
      STREAMING_MESSAGES_JSON,
    );
    expect(normalizeHeadlessOutputFormat("plain")).toBe("plain");
    expect(normalizeHeadlessOutputFormat("json")).toBe("json");
  });
});

describe("isStreamingMessagesJsonFormat", () => {
  it("true only for messages format", () => {
    expect(isStreamingMessagesJsonFormat(STREAMING_MESSAGES_JSON)).toBe(true);
    expect(isStreamingMessagesJsonFormat("streaming_messages_json")).toBe(true);
    expect(isStreamingMessagesJsonFormat(STREAMING_JSON)).toBe(false);
    expect(isStreamingMessagesJsonFormat("json")).toBe(false);
    expect(isStreamingMessagesJsonFormat("plain")).toBe(false);
  });
});

describe("includePartialMessagesSpawnArgs", () => {
  it("emits flag only when enabled AND streaming-messages-json", () => {
    expect(
      includePartialMessagesSpawnArgs(true, STREAMING_MESSAGES_JSON),
    ).toEqual(["--include-partial-messages"]);
    expect(includePartialMessagesNeedsFlag(true, STREAMING_MESSAGES_JSON)).toBe(
      true,
    );
  });

  it("empty when disabled even with correct format", () => {
    expect(
      includePartialMessagesSpawnArgs(false, STREAMING_MESSAGES_JSON),
    ).toEqual([]);
    expect(
      includePartialMessagesSpawnArgs(null, STREAMING_MESSAGES_JSON),
    ).toEqual([]);
  });

  it("empty when enabled but format is not streaming-messages-json", () => {
    expect(includePartialMessagesSpawnArgs(true, STREAMING_JSON)).toEqual([]);
    expect(includePartialMessagesSpawnArgs(true, "json")).toEqual([]);
    expect(includePartialMessagesSpawnArgs(true, "plain")).toEqual([]);
    expect(includePartialMessagesSpawnArgs(true, null)).toEqual([]);
    expect(includePartialMessagesNeedsFlag(true, STREAMING_JSON)).toBe(false);
  });

  it("places flag as top-level (not under agent/stdio)", () => {
    const args = includePartialMessagesSpawnArgs(true, STREAMING_MESSAGES_JSON);
    expect(args[0]).toBe("--include-partial-messages");
    expect(args).not.toContain("agent");
    expect(args).not.toContain("stdio");
  });
});

describe("includePartialMessagesSpawnArgsSoft", () => {
  it("emits when CLI ≥ 0.2.117 + enabled + correct format", () => {
    expect(
      includePartialMessagesSpawnArgsSoft(
        true,
        STREAMING_MESSAGES_JSON,
        "grok 0.2.117",
      ),
    ).toEqual(["--include-partial-messages"]);
    expect(
      includePartialMessagesSpawnArgsSoft(
        true,
        STREAMING_MESSAGES_JSON,
        "0.2.120",
      ),
    ).toEqual(["--include-partial-messages"]);
  });

  it("soft-fails older CLI (omit flag)", () => {
    expect(
      includePartialMessagesSpawnArgsSoft(
        true,
        STREAMING_MESSAGES_JSON,
        "0.2.112",
      ),
    ).toEqual([]);
    expect(
      includePartialMessagesSpawnArgsSoft(
        true,
        STREAMING_MESSAGES_JSON,
        "grok 0.2.100",
      ),
    ).toEqual([]);
  });

  it("soft-fails unknown / unparseable version", () => {
    expect(
      includePartialMessagesSpawnArgsSoft(true, STREAMING_MESSAGES_JSON, null),
    ).toEqual([]);
    expect(
      includePartialMessagesSpawnArgsSoft(true, STREAMING_MESSAGES_JSON, "nope"),
    ).toEqual([]);
  });

  it("empty when format wrong even on new CLI", () => {
    expect(
      includePartialMessagesSpawnArgsSoft(true, STREAMING_JSON, "0.2.117"),
    ).toEqual([]);
  });
});

describe("cliSupportsIncludePartialMessages", () => {
  it("semver gate at 0.2.117", () => {
    expect(PARTIAL_STREAM_MIN_CLI).toBe("0.2.117");
    expect(cliSupportsIncludePartialMessages("grok 0.2.117")).toBe(true);
    expect(cliSupportsIncludePartialMessages("0.2.116")).toBe(false);
    expect(cliSupportsIncludePartialMessages("1.0.0")).toBe(true);
    expect(cliSupportsIncludePartialMessages("")).toBe(null);
    expect(cliSupportsIncludePartialMessages(null)).toBe(null);
  });
});

describe("resolveHeadlessStreamForPartial", () => {
  it("upgrades to streaming-messages-json + flag when on and CLI ok", () => {
    expect(resolveHeadlessStreamForPartial(true, "0.2.117")).toEqual({
      format: STREAMING_MESSAGES_JSON,
      args: ["--include-partial-messages"],
    });
  });

  it("keeps streaming-json without flag when off or CLI old", () => {
    expect(resolveHeadlessStreamForPartial(false, "0.2.117")).toEqual({
      format: STREAMING_JSON,
      args: [],
    });
    expect(resolveHeadlessStreamForPartial(true, "0.2.112")).toEqual({
      format: STREAMING_JSON,
      args: [],
    });
    expect(resolveHeadlessStreamForPartial(true, null)).toEqual({
      format: STREAMING_JSON,
      args: [],
    });
  });
});
