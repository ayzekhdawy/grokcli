import { describe, expect, it } from "vitest";
import {
  collectActivitySessions,
  countBusyLiveMapSessions,
  countQuitBlockingSessions,
  isActiveSessionSnapshot,
  isQuitBlockingSnapshot,
  otherBusySessions,
  stoppableActivitySessions,
} from "./agentActivity";
import { emptyLiveSnapshot, type SessionLiveMap } from "./sessionLiveStore";

describe("isActiveSessionSnapshot", () => {
  it("flags streaming / permission / connecting", () => {
    const base = emptyLiveSnapshot("s1", 1);
    expect(isActiveSessionSnapshot({ ...base, state: "streaming" })).toBe(true);
    expect(
      isActiveSessionSnapshot({
        ...base,
        state: "ready",
        awaitingPermission: true,
      }),
    ).toBe(true);
    expect(isActiveSessionSnapshot({ ...base, state: "connecting" })).toBe(
      true,
    );
    expect(isActiveSessionSnapshot({ ...base, state: "ready" })).toBe(false);
    expect(isActiveSessionSnapshot(null)).toBe(false);
  });
});

describe("collectActivitySessions", () => {
  it("aggregates busy sessions with titles", () => {
    const liveMap: SessionLiveMap = {
      a: {
        ...emptyLiveSnapshot("a", 10),
        state: "streaming",
        liveToolTitle: "bash",
      },
      b: {
        ...emptyLiveSnapshot("b", 20),
        state: "awaiting_permission",
        awaitingPermission: true,
      },
      c: { ...emptyLiveSnapshot("c", 5), state: "ready" },
    };
    const rows = collectActivitySessions({
      liveMap,
      sessions: [
        { id: "a", title: "Fix CI" },
        { id: "b", title: "Review PR" },
      ],
      currentSessionId: "a",
      untitledLabel: "Untitled",
    });
    expect(rows.map((r) => r.sessionId)).toEqual(["a", "b"]);
    expect(rows[0]!.isCurrent).toBe(true);
    expect(rows[0]!.liveToolTitle).toBe("bash");
    expect(rows[1]!.status).toBe("awaiting_permission");
    expect(otherBusySessions(rows).map((r) => r.sessionId)).toEqual(["b"]);
    expect(stoppableActivitySessions(rows).map((r) => r.sessionId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("stoppableActivitySessions keeps only stream / permission / connecting", () => {
    const rows = [
      {
        sessionId: "a",
        title: "A",
        status: "streaming" as const,
        liveToolTitle: null,
        isCurrent: false,
        updatedAt: 1,
      },
      {
        sessionId: "b",
        title: "B",
        status: "ready" as const,
        liveToolTitle: null,
        isCurrent: false,
        updatedAt: 2,
      },
      {
        sessionId: "c",
        title: "C",
        status: "connecting" as const,
        liveToolTitle: null,
        isCurrent: true,
        updatedAt: 3,
      },
    ];
    expect(stoppableActivitySessions(rows).map((r) => r.sessionId)).toEqual([
      "a",
      "c",
    ]);
  });
});

describe("countBusyLiveMapSessions", () => {
  it("counts streaming / permission / connecting only", () => {
    const liveMap: SessionLiveMap = {
      a: { ...emptyLiveSnapshot("a", 1), state: "streaming" },
      b: {
        ...emptyLiveSnapshot("b", 2),
        state: "ready",
        awaitingPermission: true,
      },
      c: { ...emptyLiveSnapshot("c", 3), state: "connecting" },
      d: { ...emptyLiveSnapshot("d", 4), state: "ready" },
      e: { ...emptyLiveSnapshot("e", 5), state: "idle" },
    };
    expect(countBusyLiveMapSessions(liveMap)).toBe(3);
  });

  it("returns 0 for empty / idle maps", () => {
    expect(countBusyLiveMapSessions({})).toBe(0);
    expect(
      countBusyLiveMapSessions({
        x: { ...emptyLiveSnapshot("x", 1), state: "ready" },
      }),
    ).toBe(0);
  });
});

describe("isQuitBlockingSnapshot / countQuitBlockingSessions", () => {
  it("blocks on streaming and permission, not connecting", () => {
    const base = emptyLiveSnapshot("s1", 1);
    expect(isQuitBlockingSnapshot({ ...base, state: "streaming" })).toBe(true);
    expect(
      isQuitBlockingSnapshot({
        ...base,
        state: "ready",
        awaitingPermission: true,
      }),
    ).toBe(true);
    expect(isQuitBlockingSnapshot({ ...base, state: "connecting" })).toBe(
      false,
    );
    expect(isQuitBlockingSnapshot({ ...base, state: "ready" })).toBe(false);
    expect(isQuitBlockingSnapshot(null)).toBe(false);
  });

  it("does not count connecting toward quit-busy", () => {
    const liveMap: SessionLiveMap = {
      a: { ...emptyLiveSnapshot("a", 1), state: "streaming" },
      b: { ...emptyLiveSnapshot("b", 2), state: "connecting" },
      c: {
        ...emptyLiveSnapshot("c", 3),
        state: "ready",
        awaitingPermission: true,
      },
      d: { ...emptyLiveSnapshot("d", 4), state: "ready" },
    };
    // Activity still sees connecting; quit does not.
    expect(countBusyLiveMapSessions(liveMap)).toBe(3);
    expect(countQuitBlockingSessions(liveMap)).toBe(2);
  });
});
