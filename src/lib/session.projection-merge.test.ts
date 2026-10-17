import { describe, expect, it } from "vitest";
import {
  applyStreamChunk,
  messageSegments,
  preferSessionMessages,
  upgradeMessagesFromJournal,
  canLiftJournalLastTurn,
  settleStreamingOnHostReady,
  mergeSessionMessagesById,
  weaveToolsIntoAssistantSegments,
  mergeToolsIntoAssistantSegments,
  reorderSegmentsToHistoryLayout,
  mergeAssistantFragments,
  pickAssistantFragmentCarrierIdx,
  filterTranscriptMessages,
  toolSegmentFromFields,
  type ChatMessage,
} from "./session";


describe("session projection", () => {
  it("messageSegments compacts live multi thought rows", () => {
    const segs = messageSegments({
      id: "a1",
      role: "assistant",
      content: "done",
      segments: [
        { kind: "thought", text: "p1" },
        { kind: "thought", text: "p2" },
        { kind: "content", text: "done" },
        { kind: "thought", text: "p3" },
      ],
    });
    expect(segs).toEqual([
      { kind: "thought", text: "p1\n\np2" },
      { kind: "content", text: "done" },
      { kind: "thought", text: "p3" },
    ]);
  });

  it("filterTranscriptMessages drops inlined tool_step rows", () => {
    const woven = weaveToolsIntoAssistantSegments([
      { id: "u1", role: "user", content: "hi" },
      {
        id: "a1",
        role: "assistant",
        content: "done",
        thought: "think",
      },
      {
        id: "tool-call-1",
        role: "tool",
        content: "tool_step|completed||run",
        marker: "tool_step",
        toolCallId: "call-1",
      },
      {
        id: "tool-call-2",
        role: "tool",
        content: "tool_step|completed||run2",
        marker: "tool_step",
        toolCallId: "call-2",
      },
    ]);
    const asst = woven.find((m) => m.id === "a1")!;
    expect(
      asst.segments?.filter((s) => s.kind === "tool").length,
    ).toBeGreaterThanOrEqual(2);
    // All journal tools in the turn are woven → paint list is user+assistant only.
    const out = filterTranscriptMessages(woven);
    expect(out.map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(out).toHaveLength(2);
  });

  it("filterTranscriptMessages keeps standalone tools not on any assistant", () => {
    const rows = [
      { id: "u1", role: "user" as const, content: "hi" },
      {
        id: "tool-only",
        role: "tool" as const,
        content: "tool_step|completed||solo",
        marker: "tool_step",
        toolCallId: "solo",
      },
    ];
    expect(filterTranscriptMessages(rows).map((m) => m.id)).toEqual([
      "u1",
      "tool-only",
    ]);
  });

  it("mergeAssistantFragments folds per-fragment history into one message", () => {
    const rows: ChatMessage[] = [
      { id: "u1", role: "user", content: "做一张图" },
      {
        id: "a1",
        role: "assistant",
        content: "以素材编译并生成信息图。",
        thought: "读技能",
        createdAt: "2026-08-04T15:40:21.206529Z",
      },
      {
        id: "tool-call-16",
        role: "tool",
        content: "tool_step|completed|tool|tool",
        marker: "tool_step",
        toolCallId: "call-16",
      },
      {
        id: "a2",
        role: "assistant",
        content: "正在构建信息图，并渲染为图片。",
        createdAt: "2026-08-04T15:40:21.208529Z",
      },
      {
        id: "a3",
        role: "assistant",
        content: "检查生成图片的视觉效果与文字准确性。",
        createdAt: "2026-08-04T15:40:21.209529Z",
      },
      {
        id: "a4",
        role: "assistant",
        content: "中间留白偏多，收紧版式。",
        thought: "第二段思考",
        createdAt: "2026-08-04T15:40:21.210529Z",
      },
    ];
    const merged = mergeAssistantFragments(rows);
    const asst = merged.filter((m) => m.role === "assistant");
    expect(asst).toHaveLength(1);
    expect(asst[0]!.id).toBe("a4");
    expect(asst[0]!.content).toBe("中间留白偏多，收紧版式。");
    expect(asst[0]!.leadFragments).toEqual([
      "以素材编译并生成信息图。",
      "正在构建信息图，并渲染为图片。",
      "检查生成图片的视觉效果与文字准确性。",
    ]);
    // Thoughts from every fragment are preserved (phases joined).
    expect(asst[0]!.thought).toContain("读技能");
    expect(asst[0]!.thought).toContain("第二段思考");
    // Tool row survives (weave attaches it later).
    expect(merged.some((m) => m.id === "tool-call-16")).toBe(true);
    // Weaving a merged turn: tool lands on the single assistant message.
    const woven = weaveToolsIntoAssistantSegments(rows);
    const wAsst = woven.find((m) => m.role === "assistant")!;
    expect(
      wAsst.segments?.filter((s) => s.kind === "tool").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("mergeAssistantFragments folds a later finished fragment into a live sibling", () => {
    const rows: ChatMessage[] = [
      { id: "u1", role: "user", content: "pack it" },
      {
        id: "a-live",
        role: "assistant",
        content: "still working on the increment",
        streaming: true,
      },
      {
        id: "a-done",
        role: "assistant",
        content: "kernel rebuild failed; switching runtime",
        streaming: false,
      },
    ];
    const merged = mergeAssistantFragments(rows);
    const asst = merged.filter((m) => m.role === "assistant");
    expect(asst).toHaveLength(1);
    expect(asst[0]!.id).toBe("a-live");
    expect(asst[0]!.streaming).toBe(true);
    expect(asst[0]!.content).toContain("still working on the increment");
    expect(asst[0]!.content).toContain("kernel rebuild failed");
  });

  it("mergeAssistantFragments does not duplicate multi-segment finished bodies", () => {
    const rows: ChatMessage[] = [
      { id: "u1", role: "user", content: "go" },
      {
        id: "a-live",
        role: "assistant",
        content: "looking",
        streaming: true,
      },
      {
        id: "a-done",
        role: "assistant",
        content: "part one\n\npart two",
        streaming: false,
        segments: [
          { kind: "content", text: "part one" },
          { kind: "thought", text: "hmm" },
          { kind: "content", text: "part two" },
        ],
      },
    ];
    const merged = mergeAssistantFragments(rows);
    const asst = merged.filter((m) => m.role === "assistant");
    expect(asst).toHaveLength(1);
    const body = asst[0]!.content ?? "";
    expect(body.match(/part one/g)?.length).toBe(1);
    expect(body.match(/part two/g)?.length).toBe(1);
    const contentSegs = (asst[0]!.segments ?? []).filter((s) => s.kind === "content");
    const joined = contentSegs.map((s) => s.text).join("\n");
    expect(joined.match(/part one/g)?.length).toBe(1);
    expect(joined.match(/part two/g)?.length).toBe(1);
    expect(asst[0]!.segments?.some((s) => s.kind === "thought" && s.text === "hmm")).toBe(
      true,
    );
  });

  it("mergeAssistantFragments leaves live / single-row turns untouched", () => {
    const rows: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      {
        id: "a1",
        role: "assistant",
        content: "live answer",
        streaming: true,
      },
    ];
    const merged = mergeAssistantFragments(rows);
    expect(merged).toHaveLength(2);
    expect(merged[1]!.id).toBe("a1");
    expect(merged[1]!.leadFragments).toBeUndefined();
  });

  it("mergeAssistantFragments prefers full stream buffer over trailing mid-status", () => {
    // Session export f2789928: host stream row holds the full answer; mid-turn
    // reconcile injects a short "正在生成…" row after tools. Last-non-empty
    // would bury the real answer in leadFragments.
    const mid =
      "已识别画面：宇航员站在异星山脊，凝望巨大类木星。正在生成约 6 秒的电影感动画。";
    const full =
      `你要用图片生成视频。${mid}视频已生成完成。\n\n**文件位置：** [videos/1.mp4](videos/1.mp4)\n\n**效果说明：** 电影感缓慢推进。`;
    const rows: ChatMessage[] = [
      { id: "u1", role: "user", content: "使用这张图片生成视频" },
      {
        id: "a-full",
        role: "assistant",
        content: full,
        createdAt: "2026-08-05T05:00:43.090984Z",
      },
      {
        id: "tool-1",
        role: "tool",
        content: "tool_step|completed|image_to_video|Generate Video",
        marker: "tool_step",
        toolCallId: "call-vid",
      },
      {
        id: "a-mid",
        role: "assistant",
        content: mid,
        createdAt: "2026-08-05T05:00:36.746052Z",
      },
    ];
    expect(pickAssistantFragmentCarrierIdx(rows, [1, 3])).toBe(1);
    const merged = mergeAssistantFragments(rows);
    const asst = merged.filter((m) => m.role === "assistant");
    expect(asst).toHaveLength(1);
    expect(asst[0]!.id).toBe("a-full");
    expect(asst[0]!.content).toBe(full);
    // Mid-status already inside full body — not duplicated as a lead note.
    expect(asst[0]!.leadFragments ?? []).toEqual([]);
  });

  it("upgradeMessagesFromJournal heals last-turn body across different ids", () => {
    const ui: ChatMessage[] = [
      { id: "u1", role: "user", content: "生成视频" },
      {
        id: "stream-id",
        role: "assistant",
        content: "已识别画面：正在生成…",
        streaming: false,
      },
    ];
    const journal: ChatMessage[] = [
      { id: "u1", role: "user", content: "生成视频" },
      {
        id: "stream-id",
        role: "assistant",
        content: "已识别画面：正在生成…",
      },
      {
        id: "reconcile-mid",
        role: "assistant",
        content: "短状态",
      },
      {
        id: "other",
        role: "assistant",
        content:
          "已识别画面：正在生成…视频已生成完成。\n\n文件位置：videos/1.mp4",
      },
    ];
    // Weave folds fragments; upgrade still sees journal list with longer row.
    const out = upgradeMessagesFromJournal(ui, journal);
    expect(out.find((m) => m.id === "stream-id")?.content).toContain(
      "视频已生成完成",
    );
  });

  it("upgradeMessagesFromJournal lifts a tool-only empty bubble from disk", () => {
    const ui: ChatMessage[] = [
      { id: "u1", role: "user", content: "删 branch" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        streaming: false,
        segments: [
          toolSegmentFromFields({
            toolCallId: "t1",
            title: "git",
            status: "completed",
          }),
        ],
      },
    ];
    const journal: ChatMessage[] = [
      { id: "u1", role: "user", content: "删 branch" },
      {
        id: "a1",
        role: "assistant",
        content: "昨晚那批已经清掉了。",
      },
    ];
    const out = upgradeMessagesFromJournal(ui, journal);
    expect(out.find((m) => m.id === "a1")?.content).toBe("昨晚那批已经清掉了。");
  });

  it("upgradeMessagesFromJournal does not copy the previous turn onto a queued pending", () => {
    const turn1 =
      "LONG TURN1 REPLY ".repeat(20);
    const ui: ChatMessage[] = [
      { id: "u1", role: "user", content: "long task" },
      {
        id: "a1",
        role: "assistant",
        content: turn1,
        streaming: false,
      },
      { id: "u-queued", role: "user", content: "ok continue" },
      {
        id: "a-pending-1",
        role: "assistant",
        content: "",
        streaming: true,
      },
    ];
    const journal: ChatMessage[] = [
      { id: "u1", role: "user", content: "long task" },
      { id: "a1", role: "assistant", content: turn1 },
    ];
    expect(canLiftJournalLastTurn(ui, journal)).toBe(false);
    const out = upgradeMessagesFromJournal(ui, journal);
    const pending = out.find((m) => m.id === "a-pending-1");
    expect(pending?.content ?? "").toBe("");
    expect(pending?.streaming).toBe(true);
    expect(out.find((m) => m.id === "a1")?.content).toBe(turn1);
  });

  it("upgradeMessagesFromJournal still lifts the queued turn once disk has caught up", () => {
    const ui: ChatMessage[] = [
      { id: "u1", role: "user", content: "long task" },
      { id: "a1", role: "assistant", content: "turn 1 answer" },
      { id: "u-queued", role: "user", content: "ok continue" },
      {
        id: "a-pending-1",
        role: "assistant",
        content: "",
        streaming: true,
      },
    ];
    const journal: ChatMessage[] = [
      { id: "u1", role: "user", content: "long task" },
      { id: "a1", role: "assistant", content: "turn 1 answer" },
      { id: "host-u2", role: "user", content: "ok continue" },
      {
        id: "host-a2",
        role: "assistant",
        content: "short follow-up",
      },
    ];
    expect(canLiftJournalLastTurn(ui, journal)).toBe(true);
    const out = upgradeMessagesFromJournal(ui, journal);
    expect(out.find((m) => m.id === "a-pending-1")?.content).toBe(
      "short follow-up",
    );
    // Upgrade keeps the live flag; Host-ready settle then freezes a
    // filled pending so a replay chunk cannot append.
    expect(out.find((m) => m.id === "a-pending-1")?.streaming).toBe(true);
    const settled = settleStreamingOnHostReady(out);
    expect(settled.find((m) => m.id === "a-pending-1")?.streaming).toBe(
      false,
    );
    expect(settled.find((m) => m.id === "a-pending-1")?.content).toBe(
      "short follow-up",
    );
  });

  it("settleStreamingOnHostReady keeps a queued pending live", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "first" },
      {
        id: "a1",
        role: "assistant",
        content: "answer one",
        streaming: true,
      },
      { id: "u-queued", role: "user", content: "second" },
      {
        id: "a-pending-2",
        role: "assistant",
        content: "",
        streaming: true,
      },
    ];
    const next = settleStreamingOnHostReady(msgs);
    expect(next.find((m) => m.id === "a1")?.streaming).toBe(false);
    expect(next.find((m) => m.id === "a-pending-2")?.streaming).toBe(true);
  });

  it("settleStreamingOnHostReady still freezes the finished turn when nothing is queued", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "first" },
      {
        id: "host-a1",
        role: "assistant",
        content: "answer one",
        streaming: true,
      },
    ];
    const next = settleStreamingOnHostReady(msgs);
    expect(next.find((m) => m.id === "host-a1")?.streaming).toBe(false);
  });

  it("settleStreamingOnHostReady freezes a solo current-turn pending", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "first" },
      {
        id: "a-pending-1",
        role: "assistant",
        content: "",
        streaming: true,
      },
    ];
    const next = settleStreamingOnHostReady(msgs);
    expect(next.find((m) => m.id === "a-pending-1")?.streaming).toBe(false);
  });

  it("applyStreamChunk binds queued-turn tokens to the pending shell, not turn 1", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "long task" },
      {
        id: "a1",
        role: "assistant",
        content: "turn 1 answer",
        streaming: false,
      },
      { id: "u-queued", role: "user", content: "ok continue" },
      {
        id: "a-pending-1",
        role: "assistant",
        content: "",
        streaming: true,
      },
    ];
    const out = applyStreamChunk(msgs, {
      sessionId: "s1",
      messageId: "host-a2",
      text: "short follow-up",
      done: true,
      kind: "assistant",
    });
    expect(out.find((m) => m.id === "a1")?.content).toBe("turn 1 answer");
    expect(out.find((m) => m.id === "a-pending-1")).toBeUndefined();
    expect(out.find((m) => m.id === "host-a2")?.content).toBe("short follow-up");
  });

  it("applyStreamChunk attaches a late answer onto a settled empty assistant", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "删 branch" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        streaming: false,
      },
    ];
    const out = applyStreamChunk(msgs, {
      sessionId: "s1",
      messageId: "a1",
      text: "昨晚那批已经清掉了。",
      done: true,
      kind: "assistant",
    });
    expect(out.find((m) => m.id === "a1")?.content).toContain("清掉");
    expect(out.find((m) => m.id === "a1")?.streaming).toBe(false);
  });

  it("weaveToolsIntoAssistantSegments puts journal tools between thought and content", () => {
    // Host journal shape: U → A (final) → tools (tools ran mid-turn).
    const woven = weaveToolsIntoAssistantSegments([
      { id: "u1", role: "user", content: "q" },
      {
        id: "a1",
        role: "assistant",
        content: "answer",
        createdAt: "2026-07-26T01:11:32Z",
        segments: [
          { kind: "thought", text: "why" },
          { kind: "content", text: "answer" },
        ],
      },
      {
        id: "tool-t1",
        role: "tool",
        content: "Read x",
        marker: "tool_step",
        toolCallId: "t1",
        toolKind: "read_file",
        toolStatus: "completed",
        toolPath: "/x.ts",
        createdAt: "2026-07-26T01:10:47Z",
      },
      {
        id: "tool-t2",
        role: "tool",
        content: "Edit y",
        marker: "tool_step",
        toolCallId: "t2",
        toolKind: "search_replace",
        toolStatus: "failed",
        isError: true,
        createdAt: "2026-07-26T01:10:58Z",
      },
    ]);
    const segs = messageSegments(woven[1]!);
    // History reconstruction: thought → tools → content (not tools under the answer).
    expect(segs.map((s) => s.kind)).toEqual([
      "thought",
      "tool",
      "tool",
      "content",
    ]);
    expect(segs[2]).toMatchObject({
      kind: "tool",
      toolCallId: "t2",
      isError: true,
    });
  });

  it("weaveToolsIntoAssistantSegments attaches tools that appear before assistant in array", () => {
    // Broken createdAt-sort shape: U → tools → A
    const woven = weaveToolsIntoAssistantSegments([
      { id: "u1", role: "user", content: "q" },
      {
        id: "tool-t1",
        role: "tool",
        content: "Read x",
        marker: "tool_step",
        toolCallId: "t1",
        toolKind: "read_file",
        toolStatus: "completed",
      },
      {
        id: "tool-t2",
        role: "tool",
        content: "Read y",
        marker: "tool_step",
        toolCallId: "t2",
        toolKind: "read_file",
        toolStatus: "completed",
      },
      {
        id: "a1",
        role: "assistant",
        content: "answer",
        thought: "plan",
        segments: [
          { kind: "thought", text: "plan" },
          { kind: "content", text: "answer" },
        ],
      },
    ]);
    const segs = messageSegments(woven.find((m) => m.id === "a1")!);
    expect(segs.map((s) => s.kind)).toEqual([
      "thought",
      "tool",
      "tool",
      "content",
    ]);
  });

  it("mergeToolsIntoAssistantSegments completes live reads when later tools arrive", () => {
    // Live read still in_progress in segments; journal already completed it and
    // added a later bash. The weave used to append only the missing bash and
    // leave the read spinning at the top of 工作中.
    const segs = mergeToolsIntoAssistantSegments(
      [
        { kind: "thought", text: "plan" },
        {
          kind: "tool",
          toolCallId: "r1",
          title: "Read a",
          toolKind: "read_file",
          status: "in_progress",
          streaming: true,
        },
      ],
      [
        {
          kind: "tool",
          toolCallId: "r1",
          title: "Read a",
          toolKind: "read_file",
          status: "completed",
          streaming: false,
        },
        {
          kind: "tool",
          toolCallId: "b1",
          title: "Run",
          toolKind: "run_terminal_command",
          status: "in_progress",
          streaming: true,
        },
      ],
    );
    const tools = segs.filter(
      (s): s is Extract<typeof s, { kind: "tool" }> => s.kind === "tool",
    );
    expect(tools.map((t) => t.toolCallId)).toEqual(["r1", "b1"]);
    expect(tools[0]).toMatchObject({
      toolCallId: "r1",
      status: "completed",
      streaming: false,
    });
    expect(tools[1]).toMatchObject({
      toolCallId: "b1",
      status: "in_progress",
      streaming: true,
    });
  });

  it("weaveToolsIntoAssistantSegments settles inlined reads when the journal adds later tools", () => {
    const woven = weaveToolsIntoAssistantSegments([
      { id: "u1", role: "user", content: "q" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        streaming: true,
        segments: [
          { kind: "thought", text: "plan" },
          {
            kind: "tool",
            toolCallId: "r1",
            title: "Read a",
            toolKind: "read_file",
            status: "in_progress",
            streaming: true,
          },
        ],
      },
      {
        id: "tool-r1",
        role: "tool",
        content: "tool_step|completed|read_file|Read a",
        marker: "tool_step",
        toolCallId: "r1",
        toolKind: "read_file",
        toolStatus: "completed",
      },
      {
        id: "tool-b1",
        role: "tool",
        content: "tool_step|in_progress|run_terminal_command|Run",
        marker: "tool_step",
        toolCallId: "b1",
        toolKind: "run_terminal_command",
        toolStatus: "in_progress",
      },
    ]);
    const segs = messageSegments(woven.find((m) => m.id === "a1")!);
    const tools = segs.filter(
      (s): s is Extract<typeof s, { kind: "tool" }> => s.kind === "tool",
    );
    expect(tools.map((t) => t.toolCallId)).toEqual(["r1", "b1"]);
    expect(tools[0]).toMatchObject({
      status: "completed",
      streaming: false,
    });
  });

  it("reorderSegmentsToHistoryLayout keeps think/tool/body interleave", () => {
    const segs = reorderSegmentsToHistoryLayout([
      { kind: "thought", text: "plan A" },
      {
        kind: "tool",
        toolCallId: "t1",
        title: "Read x",
        status: "completed",
        streaming: false,
      },
      { kind: "content", text: "partial…" },
      { kind: "thought", text: "plan B" },
      {
        kind: "tool",
        toolCallId: "t2",
        title: "Edit y",
        status: "completed",
        streaming: true,
      },
      { kind: "content", text: " final" },
    ]);
    expect(segs.map((s) => s.kind)).toEqual([
      "thought",
      "tool",
      "content",
      "thought",
      "tool",
      "content",
    ]);
    expect(segs[0]).toMatchObject({ kind: "thought", text: "plan A" });
    expect(segs[1]).toMatchObject({ kind: "tool", toolCallId: "t1" });
    expect(segs[2]).toMatchObject({ kind: "content", text: "partial…" });
    expect(segs[3]).toMatchObject({ kind: "thought", text: "plan B" });
    expect(segs[4]).toMatchObject({
      kind: "tool",
      toolCallId: "t2",
      streaming: false,
    });
    expect(segs[5]).toMatchObject({ kind: "content", text: " final" });
  });

  it("weaveToolsIntoAssistantSegments keeps history row identity", () => {
    const user = { id: "u1", role: "user" as const, content: "q" };
    const asst = {
      id: "a1",
      role: "assistant" as const,
      content: "done",
      streaming: false,
      segments: [{ kind: "content" as const, text: "done" }],
    };
    const laterUser = { id: "u2", role: "user" as const, content: "next" };
    const woven = weaveToolsIntoAssistantSegments([user, asst, laterUser]);
    expect(woven[0]).toBe(user);
    expect(woven[2]).toBe(laterUser);
  });

  it("weaveToolsIntoAssistantSegments keeps finished live interleave without remount", () => {
    // Live turn left thought/tool interleaved with content; streaming=false.
    const woven = weaveToolsIntoAssistantSegments([
      { id: "u1", role: "user", content: "q" },
      {
        id: "a1",
        role: "assistant",
        content: "hello world",
        streaming: false,
        segments: [
          { kind: "thought", text: "think" },
          {
            kind: "tool",
            toolCallId: "t1",
            title: "Read",
            status: "completed",
          },
          { kind: "content", text: "hello " },
          {
            kind: "tool",
            toolCallId: "t2",
            title: "Shell",
            status: "completed",
          },
          { kind: "content", text: "world" },
        ],
      },
    ]);
    const segs = messageSegments(woven.find((m) => m.id === "a1")!);
    expect(segs.map((s) => s.kind)).toEqual([
      "thought",
      "tool",
      "content",
      "tool",
      "content",
    ]);
    expect(segs[2]).toMatchObject({ kind: "content", text: "hello " });
    expect(segs[4]).toMatchObject({ kind: "content", text: "world" });
  });

  it("weaveToolsIntoAssistantSegments keeps live interleave while streaming", () => {
    const woven = weaveToolsIntoAssistantSegments([
      { id: "u1", role: "user", content: "q" },
      {
        id: "a1",
        role: "assistant",
        content: "hello ",
        streaming: true,
        segments: [
          { kind: "thought", text: "think" },
          {
            kind: "tool",
            toolCallId: "t1",
            title: "Read",
            status: "completed",
          },
          { kind: "content", text: "hello " },
          {
            kind: "tool",
            toolCallId: "t2",
            title: "Shell",
            status: "in_progress",
            streaming: true,
          },
        ],
      },
    ]);
    const segs = messageSegments(woven.find((m) => m.id === "a1")!);
    expect(segs.map((s) => s.kind)).toEqual([
      "thought",
      "tool",
      "content",
      "tool",
    ]);
  });

  it("mergeSessionMessagesById keeps journal order (no createdAt re-sort)", () => {
    const primary: ChatMessage[] = [
      {
        id: "u1",
        role: "user",
        content: "q",
        createdAt: "2026-07-26T01:10:41Z",
      },
      {
        id: "a1",
        role: "assistant",
        content: "answer",
        createdAt: "2026-07-26T01:11:32Z",
      },
      {
        id: "tool-t1",
        role: "tool",
        content: "Read",
        marker: "tool_step",
        createdAt: "2026-07-26T01:10:47Z",
      },
    ];
    const merged = mergeSessionMessagesById(primary, []);
    expect(merged.map((m) => m.id)).toEqual(["u1", "a1", "tool-t1"]);
  });

  it("places journal-only rows at their turn position, not at the tail", () => {
    // Regression: a mid-turn session switch can leave the cache holding only
    // the streaming assistant. Appending disk-only rows rendered the user's
    // own prompt *after* the finished answer.
    const cached: ChatMessage[] = [
      { id: "a-host", role: "assistant", content: "…answer…", streaming: true },
    ];
    const stored: ChatMessage[] = [
      { id: "u-host", role: "user", content: "查看项目内的内容" },
      { id: "a-host", role: "assistant", content: "…answer…" },
      { id: "tool-1", role: "tool", content: "tool_step|completed", marker: "tool_step" },
      { id: "tool-2", role: "tool", content: "tool_step|completed", marker: "tool_step" },
    ];
    expect(mergeSessionMessagesById(cached, stored).map((m) => m.id)).toEqual([
      "u-host",
      "a-host",
      "tool-1",
      "tool-2",
    ]);
    // Same through the real entry point the workbench uses.
    expect(preferSessionMessages(cached, stored).map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
    ]);
  });
});
