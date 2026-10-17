import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./session";
import { buildSessionMessageNodes } from "./sessionMessageNodes";
import {
  formatMessageDeepLink,
  isValidMessageId,
  messageDeepLinkPathOnly,
  parseMessageDeepLink,
  parseMessageDeepLinkQuery,
  planScrollToMessage,
} from "./messageNodeDeepLink";

const SID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const MID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

function msg(
  partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role">,
): ChatMessage {
  return {
    content: partial.content ?? "hi",
    ...partial,
  };
}

describe("isValidMessageId", () => {
  it("accepts UUID and host-style slugs", () => {
    expect(isValidMessageId(MID)).toBe(true);
    expect(isValidMessageId("a-1710000000000")).toBe(true);
    expect(isValidMessageId("u-pending-1")).toBe(true);
    expect(isValidMessageId("tool-call.abc")).toBe(true);
  });

  it("rejects empty, path junk, and overlong", () => {
    expect(isValidMessageId("")).toBe(false);
    expect(isValidMessageId("   ")).toBe(false);
    expect(isValidMessageId(null)).toBe(false);
    expect(isValidMessageId("a/b")).toBe(false);
    expect(isValidMessageId("a?b")).toBe(false);
    expect(isValidMessageId("a b")).toBe(false);
    expect(isValidMessageId("x".repeat(300))).toBe(false);
  });
});

describe("messageDeepLinkPathOnly / parseMessageDeepLinkQuery", () => {
  it("strips hash, slash, query", () => {
    expect(messageDeepLinkPathOnly(`#/session/${SID}/m/${MID}?x=1`)).toBe(
      `session/${SID}/m/${MID}`,
    );
    expect(messageDeepLinkPathOnly(`session/${SID}/`)).toBe(`session/${SID}`);
  });

  it("parses query aliases", () => {
    expect(parseMessageDeepLinkQuery(`#/session/${SID}?m=${MID}`)).toEqual({
      m: MID,
    });
    expect(
      parseMessageDeepLinkQuery(`#/session/${SID}?messageId=${MID}&x=1`),
    ).toEqual({ messageId: MID, x: "1" });
  });
});

describe("formatMessageDeepLink / parseMessageDeepLink", () => {
  it("round-trips preferred path form", () => {
    const link = formatMessageDeepLink(SID, MID);
    expect(link).toBe(`#/session/${SID}/m/${MID}`);
    expect(parseMessageDeepLink(link)).toEqual({
      sessionId: SID,
      messageId: MID,
    });
  });

  it("parses without leading # or /", () => {
    expect(parseMessageDeepLink(`session/${SID}/m/${MID}`)).toEqual({
      sessionId: SID,
      messageId: MID,
    });
    expect(parseMessageDeepLink(`/session/${SID}/m/${MID}`)).toEqual({
      sessionId: SID,
      messageId: MID,
    });
  });

  it("parses query form m / message / messageId", () => {
    expect(parseMessageDeepLink(`#/session/${SID}?m=${MID}`)).toEqual({
      sessionId: SID,
      messageId: MID,
    });
    expect(
      parseMessageDeepLink(`#/session/${SID}?message=${MID}`),
    ).toEqual({ sessionId: SID, messageId: MID });
    expect(
      parseMessageDeepLink(`#/session/${SID}?messageId=${MID}`),
    ).toEqual({ sessionId: SID, messageId: MID });
  });

  it("returns null without message id (session-only still multi-window)", () => {
    expect(parseMessageDeepLink(`#/session/${SID}`)).toBeNull();
    expect(parseMessageDeepLink(`#/session/${SID}?x=1`)).toBeNull();
    expect(parseMessageDeepLink("#/settings/general")).toBeNull();
    expect(parseMessageDeepLink("")).toBeNull();
  });

  it("rejects invalid session or message segments", () => {
    expect(formatMessageDeepLink("bad id", MID)).toBe("");
    expect(formatMessageDeepLink(SID, "bad/id")).toBe("");
    expect(parseMessageDeepLink(`#/session/bad id/m/${MID}`)).toBeNull();
    expect(parseMessageDeepLink(`#/session/${SID}/m/bad/id`)).toBeNull();
    expect(parseMessageDeepLink(`#/session/${SID}/m/`)).toBeNull();
    // Extra path after message id
    expect(
      parseMessageDeepLink(`#/session/${SID}/m/${MID}/extra`),
    ).toBeNull();
  });

  it("trims and accepts local slug ids", () => {
    const link = formatMessageDeepLink(`  ${SID}  `, "a-123");
    expect(link).toBe(`#/session/${SID}/m/a-123`);
    expect(parseMessageDeepLink(link)?.messageId).toBe("a-123");
  });
});

describe("planScrollToMessage", () => {
  const messages: ChatMessage[] = [
    msg({ id: "u1", role: "user", content: "hello" }),
    msg({ id: "a1", role: "assistant", content: "world" }),
    msg({
      id: "t1",
      role: "tool",
      content: "tool_step|x",
      marker: "tool_step",
    }),
  ];
  const nodes = buildSessionMessageNodes(messages);

  it("finds node candidates with nodeId", () => {
    expect(planScrollToMessage({ messageId: "u1", nodes, messages })).toEqual({
      ok: true,
      messageIndex: 0,
      nodeId: "u1",
    });
    expect(planScrollToMessage({ messageId: "a1", nodes, messages })).toEqual({
      ok: true,
      messageIndex: 1,
      nodeId: "a1",
    });
  });

  it("falls back to messages[] when not a node (soft nodeId null)", () => {
    expect(planScrollToMessage({ messageId: "t1", nodes, messages })).toEqual({
      ok: true,
      messageIndex: 2,
      nodeId: null,
    });
  });

  it("soft-misses when id absent", () => {
    expect(
      planScrollToMessage({ messageId: "nope", nodes, messages }),
    ).toEqual({ ok: false, reason: "missing" });
  });

  it("soft-fails empty id", () => {
    expect(planScrollToMessage({ messageId: "", nodes, messages })).toEqual({
      ok: false,
      reason: "empty_id",
    });
    expect(planScrollToMessage({ messageId: null, nodes, messages })).toEqual({
      ok: false,
      reason: "empty_id",
    });
  });
});
