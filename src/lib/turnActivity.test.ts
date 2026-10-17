import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./session";
import {
  buildTurnActivity,
  groupActivitySegments,
  turnNeedsActivityNarrative,
  type TurnActivityTool,
} from "./turnActivity";

function tool(
  id: string,
  opts: {
    kind?: string;
    status?: string;
    title?: string;
    path?: string;
    streaming?: boolean;
    isError?: boolean;
  } = {},
): ChatMessage {
  const kind = opts.kind || "read_file";
  const status = opts.status || "completed";
  const title = opts.title || kind;
  return {
    id: `tool-${id}`,
    role: "tool",
    content: title,
    marker: "tool_step",
    toolCallId: id,
    toolKind: kind,
    toolStatus: status,
    toolPath: opts.path,
    streaming: opts.streaming,
    isError: opts.isError,
    createdAt: new Date().toISOString(),
  };
}

describe("turnActivity", () => {
  it("collects tools after last user and counts errors", () => {
    const messages: ChatMessage[] = [
      { id: "u0", role: "user", content: "old" },
      tool("x", { kind: "read_file", title: "oldread" }),
      { id: "u1", role: "user", content: "now" },
      tool("a", { kind: "read_file", title: "A", path: "/p/a.ts" }),
      tool("b", {
        kind: "run_terminal_command",
        title: "ls",
        status: "failed",
        isError: true,
      }),
      tool("c", {
        kind: "search_replace",
        title: "edit",
        path: "/p/a.ts",
        status: "completed",
      }),
    ];
    const act = buildTurnActivity(messages);
    expect(act.stepCount).toBe(3);
    expect(act.errorCount).toBe(1);
    expect(act.shouldExpand).toBe(true);
    expect(act.modifiedPaths).toContain("/p/a.ts");
    expect(act.afterUserMessageId).toBe("u1");
  });

  it("groups ≥3 consecutive context tools", () => {
    const tools: TurnActivityTool[] = ["1", "2", "3", "4"].map((id) => ({
      id,
      name: `r${id}`,
      kind: "read_file",
      status: "completed" as const,
      summary: `r${id}`,
      isError: false,
      isContext: true,
      longRunning: false,
    }));
    tools.push({
      id: "e1",
      name: "edit",
      kind: "search_replace",
      status: "completed",
      summary: "edit",
      isError: false,
      isContext: false,
      longRunning: false,
    });
    const segs = groupActivitySegments(tools);
    expect(segs[0]?.kind).toBe("context");
    if (segs[0]?.kind === "context") {
      expect(segs[0].tools).toHaveLength(4);
    }
    expect(segs[1]?.kind).toBe("single");
  });

  it("does not group only 2 context tools", () => {
    const tools: TurnActivityTool[] = ["1", "2"].map((id) => ({
      id,
      name: `r${id}`,
      kind: "read_file",
      status: "completed" as const,
      summary: `r${id}`,
      isError: false,
      isContext: true,
      longRunning: false,
    }));
    const segs = groupActivitySegments(tools);
    expect(segs).toHaveLength(2);
    expect(segs.every((s) => s.kind === "single")).toBe(true);
  });

  it("turnNeedsActivityNarrative for tool-only turns", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "go" },
      tool("a", { kind: "read_file", title: "read" }),
    ];
    expect(turnNeedsActivityNarrative(messages)).toBe(true);
    messages.push({
      id: "a1",
      role: "assistant",
      content: "done",
    });
    expect(turnNeedsActivityNarrative(messages)).toBe(false);
  });
});
