import { describe, expect, it } from "vitest";
import {
  applyControlCommand,
  bindingAfterProjectSelect,
  bindingAfterResumeSelect,
  emptyBinding,
  isValidProjectScope,
  parseControlInput,
  remoteSessionSource,
  resolveMessageMode,
} from "./controlPlane";
import type { ControlState } from "./controlPlane";

const projects = [
  { id: "p1", name: "Alpha", path: "/tmp/alpha" },
  { id: "p2", name: "Beta App", path: "/tmp/beta" },
];

function baseState(over: Partial<ControlState> = {}): ControlState {
  return {
    binding: emptyBinding("feishu:u1:c1", "feishu"),
    uiMode: "idle",
    projects,
    sessions: [
      {
        id: "s1",
        title: "First chat",
        projectId: "p1",
        agentSessionId: "agent-s1",
        updatedAt: "2026-01-01T00:00:00Z",
        source: "remote:feishu",
      },
      {
        id: "s2",
        title: "Second",
        projectId: "p1",
        agentSessionId: "agent-s2",
        updatedAt: "2026-01-02T00:00:00Z",
      },
    ],
    projectScope: "all_trusted",
    platformUserId: "ou_123",
    ...over,
  };
}

describe("remoteIm control plane", () => {
  it("rejects agent turns without project binding", () => {
    const mode = resolveMessageMode(emptyBinding("k", "feishu"));
    expect(mode).toBe("reject");
    const r = applyControlCommand(baseState(), {
      type: "user_message",
      text: "hello",
    });
    expect(r.effects.some((e) => e.kind === "agent_turn" && e.mode === "reject")).toBe(
      true,
    );
  });

  it("/p then message implies mode=new and remote source", () => {
    let state = baseState();
    const list = applyControlCommand(state, { type: "project_list" });
    expect(list.state.uiMode).toBe("pick_project");
    state = list.state;

    const pick = applyControlCommand(state, {
      type: "project_select",
      query: "1",
    });
    expect(pick.state.binding.projectId).toBe("p1");
    expect(pick.state.binding.pendingMode).toBe("new");
    expect(pick.state.binding.agentSessionId).toBeNull();
    expect(
      pick.effects.some((e) => e.kind === "bind_project" && e.mode === "new"),
    ).toBe(true);

    const msg = applyControlCommand(pick.state, {
      type: "user_message",
      text: "build the feature",
    });
    const turn = msg.effects.find((e) => e.kind === "agent_turn");
    expect(turn).toMatchObject({ kind: "agent_turn", mode: "new" });
    expect(remoteSessionSource("feishu")).toBe("remote:feishu");
  });

  it("/r selects session → mode=resume with agentSessionId", () => {
    let state = baseState({
      binding: bindingAfterProjectSelect(
        emptyBinding("k", "feishu"),
        "p1",
      ),
    });
    // Clear pending new so resume list works after project bind
    state = {
      ...state,
      binding: { ...state.binding, pendingMode: null },
    };

    const list = applyControlCommand(state, { type: "resume_list" });
    expect(list.state.uiMode).toBe("pick_session");

    const pick = applyControlCommand(list.state, {
      type: "resume_select",
      query: "1",
    });
    expect(pick.state.binding.agentSessionId).toBe("agent-s1");
    expect(pick.state.binding.pendingMode).toBe("resume");
    expect(
      pick.effects.some(
        (e) => e.kind === "bind_session" && e.mode === "resume",
      ),
    ).toBe(true);

    const msg = applyControlCommand(pick.state, {
      type: "user_message",
      text: "continue",
    });
    const turn = msg.effects.find((e) => e.kind === "agent_turn");
    expect(turn).toMatchObject({ kind: "agent_turn", mode: "resume" });
  });

  it("parses slash commands and pick-mode numbers", () => {
    expect(parseControlInput("/p", "idle")).toEqual({ type: "project_list" });
    expect(parseControlInput("/p Alpha", "idle")).toEqual({
      type: "project_select",
      query: "Alpha",
    });
    expect(parseControlInput("/r", "idle")).toEqual({ type: "resume_list" });
    expect(parseControlInput("2", "pick_project")).toEqual({
      type: "project_select",
      query: "2",
    });
    expect(parseControlInput("0", "pick_session")).toEqual({ type: "cancel" });
  });

  it("project scope whitelist blocks free paths and unknown ids", () => {
    const trusted = new Set(["p1", "p2"]);
    expect(isValidProjectScope("all_trusted", trusted)).toBe(true);
    expect(isValidProjectScope({ allow: ["p1"] }, trusted)).toBe(true);
    expect(isValidProjectScope({ allow: ["/etc/passwd"] }, trusted)).toBe(
      false,
    );
    expect(isValidProjectScope({ allow: ["p99"] }, trusted)).toBe(false);
  });

  it("whitelist scope only lists allowed projects in /p", () => {
    const state = baseState({ projectScope: { allow: ["p2"] } });
    const r = applyControlCommand(state, { type: "project_list" });
    const reply = r.effects.find((e) => e.kind === "reply");
    expect(reply && reply.kind === "reply" && reply.text).toContain("Beta App");
    expect(reply && reply.kind === "reply" && reply.text).not.toContain("Alpha");
  });

  it("binding helpers set modes for sessions_index integration", () => {
    const b = bindingAfterProjectSelect(emptyBinding("c", "telegram"), "p1");
    expect(resolveMessageMode(b)).toBe("new");
    const r = bindingAfterResumeSelect(b, {
      id: "sess",
      title: "t",
      projectId: "p1",
      agentSessionId: "ag-1",
      updatedAt: "",
    });
    expect(resolveMessageMode(r)).toBe("resume");
  });
});
