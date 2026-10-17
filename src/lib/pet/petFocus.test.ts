import { describe, expect, it } from "vitest";
import { emptyLiveSnapshot, type SessionLiveMap } from "@/lib/sessionLiveStore";
import {
  kindForSession,
  pickPetFocus,
  resolvePetFocus,
  type PetFocus,
  type PetFocusInput,
} from "./petFocus";

function snap(
  id: string,
  patch: Partial<SessionLiveMap[string]> & { state: SessionLiveMap[string]["state"] },
): SessionLiveMap[string] {
  return {
    ...emptyLiveSnapshot(id, patch.updatedAt ?? 1_000),
    ...patch,
    sessionId: id,
    awaitingPermission:
      patch.awaitingPermission ?? patch.state === "awaiting_permission",
  };
}

function input(partial: Partial<PetFocusInput> & { liveMap: SessionLiveMap }): PetFocusInput {
  return {
    unreadIds: new Set(),
    finishedTurns: {},
    sessions: Object.keys(partial.liveMap).map((id) => ({ id, title: id })),
    now: 10_000,
    ...partial,
  };
}

describe("resolvePetFocus (shipped picker)", () => {
  it("connecting handshake is not a shown focus", () => {
    const liveMap: SessionLiveMap = {
      next: snap("next", { state: "connecting", updatedAt: 9_000 }),
    };
    const got = resolvePetFocus(null, input({ liveMap }));
    expect(got.kind).toBe("idle");
    expect(got.sessionId).toBeNull();
  });

  it("permission beats streaming", () => {
    const liveMap: SessionLiveMap = {
      a: snap("a", { state: "streaming", liveToolTitle: "npm test", updatedAt: 9_000 }),
      b: snap("b", { state: "awaiting_permission", updatedAt: 1_000 }),
    };
    const got = resolvePetFocus(null, input({ liveMap }));
    expect(got.kind).toBe("needs_you");
    expect(got.sessionId).toBe("b");
    expect(got.rank).toBeLessThan(3);
  });

  it("unread finished turn is ready", () => {
    const liveMap: SessionLiveMap = {
      done: snap("done", { state: "idle", updatedAt: 2_000 }),
    };
    const got = resolvePetFocus(
      null,
      input({
        liveMap,
        unreadIds: new Set(["done"]),
        finishedTurns: { done: 8_000 },
        sessions: [{ id: "done", title: "Ship pet" }],
      }),
    );
    expect(got.kind).toBe("ready");
    expect(got.sessionId).toBe("done");
    expect(got.title).toBe("Ship pet");
  });

  it("finished but read is not ready", () => {
    const liveMap: SessionLiveMap = {
      done: snap("done", { state: "idle", updatedAt: 2_000 }),
    };
    const got = resolvePetFocus(
      null,
      input({
        liveMap,
        unreadIds: new Set(),
        finishedTurns: { done: 8_000 },
      }),
    );
    expect(got.kind).toBe("idle");
    expect(got.sessionId).toBeNull();
  });

  it("permission beats disconnected", () => {
    const liveMap: SessionLiveMap = {
      dead: snap("dead", { state: "disconnected", updatedAt: 9_000 }),
      ask: snap("ask", { state: "awaiting_permission", updatedAt: 100 }),
    };
    const got = resolvePetFocus(null, input({ liveMap }));
    expect(got.kind).toBe("needs_you");
    expect(got.sessionId).toBe("ask");
  });

  it("streaming peer beats a ready unread so live work keeps the body", () => {
    const liveMap: SessionLiveMap = {
      busy: snap("busy", { state: "streaming", updatedAt: 9_000 }),
      done: snap("done", { state: "idle", updatedAt: 1_000 }),
    };
    const got = resolvePetFocus(
      null,
      input({
        liveMap,
        unreadIds: new Set(["done"]),
        finishedTurns: { done: 8_000 },
        sessions: [
          { id: "busy", title: "busy" },
          { id: "done", title: "done" },
        ],
      }),
    );
    expect(got.kind).toBe("working");
    expect(got.sessionId).toBe("busy");
  });

  it("error beats ready and working", () => {
    const liveMap: SessionLiveMap = {
      busy: snap("busy", { state: "streaming", updatedAt: 5_000 }),
      dead: snap("dead", { state: "disconnected", updatedAt: 1_000 }),
      done: snap("done", { state: "idle", updatedAt: 4_000 }),
    };
    const got = resolvePetFocus(
      null,
      input({
        liveMap,
        unreadIds: new Set(["done"]),
        finishedTurns: { done: 4_000 },
      }),
    );
    expect(got.kind).toBe("error");
    expect(got.sessionId).toBe("dead");
  });

  it("tool-title chatter does not flip the chosen session or kind", () => {
    const liveMap1: SessionLiveMap = {
      a: snap("a", {
        state: "streaming",
        liveToolTitle: "read file",
        startedAt: 100,
        updatedAt: 200,
      }),
      b: snap("b", {
        state: "streaming",
        liveToolTitle: "search",
        startedAt: 90,
        updatedAt: 150,
      }),
    };
    const first = resolvePetFocus(null, input({ liveMap: liveMap1 }));
    expect(first.kind).toBe("working");
    expect(first.sessionId).toBe("a");

    const liveMap2: SessionLiveMap = {
      a: snap("a", {
        state: "streaming",
        liveToolTitle: "read file 2",
        startedAt: 100,
        updatedAt: 400,
      }),
      b: snap("b", {
        state: "streaming",
        liveToolTitle: "web_search now",
        startedAt: 90,
        updatedAt: 9_999,
      }),
    };
    const stuck = resolvePetFocus(first, input({ liveMap: liveMap2 }));
    expect(stuck.kind).toBe("working");
    expect(stuck.sessionId).toBe("a");
    expect(stuck.toolTitle).toBe("read file 2");
  });

  it("upgrades from working to needs_you when permission appears", () => {
    const prev: PetFocus = {
      kind: "working",
      sessionId: "a",
      title: "a",
      toolTitle: "npm",
      rank: 2,
      updatedAt: 100,
    };
    const liveMap: SessionLiveMap = {
      a: snap("a", { state: "streaming", updatedAt: 200 }),
      b: snap("b", { state: "awaiting_permission", updatedAt: 50 }),
    };
    const got = resolvePetFocus(prev, input({ liveMap }));
    expect(got.kind).toBe("needs_you");
    expect(got.sessionId).toBe("b");
  });

  it("kindForSession uses the shipped dashboard mapper", () => {
    expect(
      kindForSession(
        "x",
        input({
          liveMap: { x: snap("x", { state: "awaiting_permission" }) },
        }),
      ),
    ).toBe("needs_you");
    expect(
      kindForSession(
        "x",
        input({
          liveMap: { x: snap("x", { state: "streaming" }) },
        }),
      ),
    ).toBe("working");
  });
});

describe("pickPetFocus", () => {
  it("returns idle when nothing is live", () => {
    const got = pickPetFocus(input({ liveMap: {} }));
    expect(got.kind).toBe("idle");
    expect(got.sessionId).toBeNull();
  });
});
