import { describe, expect, it } from "vitest";
import {
  assembleReliabilityCenter,
  buildReliabilityCenter,
  collectLiveStallSignals,
  collectReliabilityBusySessions,
  mergeErrorEntries,
  mergeStallSignals,
  prependReliabilityRing,
  reliabilityErrorFromDeck,
  reliabilityStallFromEvent,
  type ReliabilityErrorEntry,
  type ReliabilityStallSignal,
} from "./reliabilityCenter";
import {
  applyClearStallHistoryPlan,
  buildStallHistoryExport,
  buildStallTimelineSnapshot,
  clearStallHistory,
  filterStallHistory,
  hasActiveStallHistoryFilters,
  loadStallHistory,
  parseStallHistory,
  parseStallHistoryEntry,
  planClearStallHistory,
  recordStallHistory,
  recordStallHistoryFromSignal,
  serializeStallHistoryExport,
  serializeStallTimelineSnapshot,
  STALL_HISTORY_MAX,
  STALL_TIMELINE_FIELD_MAX,
  type StallHistoryEntry,
  type StallHistoryStorage,
} from "./reliabilityStallHistory";
import { emptyLiveSnapshot, type SessionLiveMap } from "./sessionLiveStore";

function memStorage(seed?: string): StallHistoryStorage & { store: Map<string, string> } {
  const store = new Map<string, string>();
  if (seed != null) store.set("grok.stallHistory", seed);
  return {
    store,
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("prependReliabilityRing", () => {
  it("prepends newest and caps length", () => {
    const a = { id: "a", n: 1 };
    const b = { id: "b", n: 2 };
    const c = { id: "c", n: 3 };
    expect(prependReliabilityRing([], a, 2)).toEqual([a]);
    expect(prependReliabilityRing([a], b, 2)).toEqual([b, a]);
    expect(prependReliabilityRing([b, a], c, 2)).toEqual([c, b]);
  });

  it("replaces same id instead of duplicating", () => {
    const a1 = { id: "a", n: 1 };
    const a2 = { id: "a", n: 2 };
    expect(prependReliabilityRing([a1], a2, 4)).toEqual([a2]);
  });

  it("returns empty when max is 0", () => {
    expect(prependReliabilityRing([{ id: "a" }], { id: "b" }, 0)).toEqual([]);
  });
});

describe("collectReliabilityBusySessions", () => {
  it("lists busy sessions with titles", () => {
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
    const rows = collectReliabilityBusySessions({
      liveMap,
      sessions: [
        { id: "a", title: "Fix CI" },
        { id: "b", title: "Review PR" },
      ],
      currentSessionId: "a",
      untitledLabel: "Untitled",
    });
    expect(rows.map((r) => r.sessionId)).toEqual(["a", "b"]);
    expect(rows[0]!.title).toBe("Fix CI");
    expect(rows[0]!.liveToolTitle).toBe("bash");
    expect(rows[0]!.isCurrent).toBe(true);
    expect(rows[1]!.status).toBe("awaiting_permission");
  });

  it("honors max cap", () => {
    const liveMap: SessionLiveMap = {
      a: { ...emptyLiveSnapshot("a", 3), state: "streaming" },
      b: { ...emptyLiveSnapshot("b", 2), state: "streaming" },
      c: { ...emptyLiveSnapshot("c", 1), state: "connecting" },
    };
    const rows = collectReliabilityBusySessions({
      liveMap,
      sessions: [],
      max: 2,
    });
    expect(rows).toHaveLength(2);
  });
});

describe("collectLiveStallSignals", () => {
  it("includes active soft stall and terminal stall reasons", () => {
    const liveMap: SessionLiveMap = {
      s1: {
        ...emptyLiveSnapshot("s1", 100),
        state: "ready",
        terminalReason: "stall",
      },
      s2: {
        ...emptyLiveSnapshot("s2", 50),
        state: "ready",
        terminalReason: "user_stop",
      },
    };
    const signals = collectLiveStallSignals({
      liveMap,
      sessions: [{ id: "s1", title: "Long run" }],
      activeStreamStall: {
        sessionId: "view",
        stallSeconds: 120,
        tier: "working_tools",
      },
      untitledLabel: "Untitled",
      nowMs: 1000,
    });
    expect(signals.some((s) => s.kind === "active" && s.stallSeconds === 120)).toBe(
      true,
    );
    expect(
      signals.some(
        (s) => s.kind === "terminal" && s.sessionId === "s1" && s.title === "Long run",
      ),
    ).toBe(true);
    expect(signals.some((s) => s.sessionId === "s2")).toBe(false);
  });

  it("returns empty when nothing stalled", () => {
    const liveMap: SessionLiveMap = {
      s1: { ...emptyLiveSnapshot("s1", 1), state: "ready", terminalReason: null },
    };
    expect(
      collectLiveStallSignals({
        liveMap,
        sessions: [],
        activeStreamStall: null,
      }),
    ).toEqual([]);
  });
});

describe("mergeStallSignals / mergeErrorEntries", () => {
  it("merges live first then recent with cap", () => {
    const live: ReliabilityStallSignal[] = [
      reliabilityStallFromEvent({
        kind: "active",
        sessionId: "a",
        stallSeconds: 90,
        at: 200,
      }),
    ];
    const recent: ReliabilityStallSignal[] = [
      reliabilityStallFromEvent({
        kind: "hard_end",
        sessionId: "b",
        stallSeconds: 300,
        at: 100,
      }),
      reliabilityStallFromEvent({
        kind: "hard_end",
        sessionId: "c",
        stallSeconds: 200,
        at: 50,
      }),
    ];
    const merged = mergeStallSignals(live, recent, 2);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.kind).toBe("active");
    expect(merged[1]!.kind).toBe("hard_end");
  });

  it("soft-dedupes error entries by code+problem", () => {
    const cur: ReliabilityErrorEntry[] = [
      reliabilityErrorFromDeck({
        code: "CLI_NOT_FOUND",
        problem: "CLI missing",
        at: 10,
      }),
    ];
    const recent: ReliabilityErrorEntry[] = [
      reliabilityErrorFromDeck({
        code: "CLI_NOT_FOUND",
        problem: "CLI missing",
        at: 5,
      }),
      reliabilityErrorFromDeck({
        code: "AUTH_FAILED",
        problem: "Auth failed",
        at: 1,
      }),
    ];
    const merged = mergeErrorEntries(cur, recent, 8);
    expect(merged.map((e) => e.code)).toEqual(["CLI_NOT_FOUND", "AUTH_FAILED"]);
  });
});

describe("assembleReliabilityCenter", () => {
  it("flags empty when no signals", () => {
    const view = assembleReliabilityCenter({});
    expect(view.empty).toBe(true);
    expect(view.hasBusy).toBe(false);
    expect(view.hasStalls).toBe(false);
    expect(view.hasErrors).toBe(false);
    expect(view.busy.count).toBe(0);
    expect(view.stalls.count).toBe(0);
    expect(view.errors.count).toBe(0);
  });

  it("aggregates counts from inputs", () => {
    const view = assembleReliabilityCenter({
      busySessions: [
        {
          sessionId: "a",
          title: "A",
          status: "streaming",
          liveToolTitle: null,
          isCurrent: true,
          updatedAt: 1,
        },
      ],
      stallSignals: [
        reliabilityStallFromEvent({ kind: "hard_end", sessionId: "a", at: 2 }),
      ],
      errorEntries: [
        reliabilityErrorFromDeck({ problem: "Boom", code: "AGENT_CRASHED", at: 3 }),
      ],
    });
    expect(view.empty).toBe(false);
    expect(view.hasBusy).toBe(true);
    expect(view.hasStalls).toBe(true);
    expect(view.hasErrors).toBe(true);
    expect(view.busy.count).toBe(1);
    expect(view.stalls.count).toBe(1);
    expect(view.errors.count).toBe(1);
  });
});

describe("buildReliabilityCenter", () => {
  it("full pipeline: busy + live stall + rings + honest empty parts", () => {
    const liveMap: SessionLiveMap = {
      a: {
        ...emptyLiveSnapshot("a", 30),
        state: "streaming",
        liveToolTitle: "npm test",
      },
      b: {
        ...emptyLiveSnapshot("b", 20),
        state: "ready",
        terminalReason: "stall",
      },
    };
    const view = buildReliabilityCenter({
      liveMap,
      sessions: [
        { id: "a", title: "CI fix" },
        { id: "b", title: "Stalled chat" },
      ],
      currentSessionId: "a",
      activeStreamStall: null,
      recentStalls: [
        reliabilityStallFromEvent({
          kind: "hard_end",
          sessionId: "b",
          stallSeconds: 600,
          title: "Stalled chat",
          at: 5,
        }),
      ],
      recentErrors: [],
      currentErrors: [],
      nowMs: 1000,
    });
    expect(view.hasBusy).toBe(true);
    expect(view.busy.sessions[0]!.title).toBe("CI fix");
    expect(view.hasStalls).toBe(true);
    expect(view.stalls.signals.some((s) => s.kind === "terminal")).toBe(true);
    expect(view.stalls.signals.some((s) => s.kind === "hard_end")).toBe(true);
    expect(view.hasErrors).toBe(false);
    expect(view.empty).toBe(false);
  });

  it("empty when idle map and no rings", () => {
    const view = buildReliabilityCenter({
      liveMap: {
        x: { ...emptyLiveSnapshot("x", 1), state: "ready" },
      },
      sessions: [{ id: "x", title: "Idle" }],
    });
    expect(view.empty).toBe(true);
  });
});

describe("stall history (localStorage ring)", () => {
  it("parseStallHistoryEntry keeps only known fields and caps title", () => {
    const e = parseStallHistoryEntry({
      id: "h1",
      sessionId: "s1",
      title: "  Fix CI  ",
      kind: "hard_end",
      stallSeconds: 120.6,
      reason: "stall",
      at: 1_700_000_000_000,
      secret: "should-drop",
      tier: "ignored",
    });
    expect(e).toEqual({
      id: "h1",
      sessionId: "s1",
      title: "Fix CI",
      kind: "hard_end",
      stallSeconds: 121,
      reason: "stall",
      at: 1_700_000_000_000,
    });
    expect(e && "secret" in e).toBe(false);
    expect(e && "tier" in e).toBe(false);
  });

  it("parseStallHistoryEntry rejects invalid kind / empty object", () => {
    expect(parseStallHistoryEntry(null)).toBeNull();
    expect(parseStallHistoryEntry({ kind: "nope" })).toBeNull();
    expect(parseStallHistoryEntry({ id: "x" })).toBeNull();
  });

  it("parseStallHistory tolerates corrupt JSON and caps length", () => {
    expect(parseStallHistory("not-json")).toEqual([]);
    expect(parseStallHistory(null)).toEqual([]);
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `id-${i}`,
      sessionId: `s${i}`,
      kind: "hard_end",
      at: 1000 - i,
      reason: "stall",
    }));
    const parsed = parseStallHistory(many, STALL_HISTORY_MAX);
    expect(parsed).toHaveLength(STALL_HISTORY_MAX);
    expect(parsed[0]!.id).toBe("id-0");
  });

  it("recordStallHistory prepends and caps at max", () => {
    const storage = memStorage();
    for (let i = 0; i < 5; i++) {
      recordStallHistory(
        {
          kind: "hard_end",
          sessionId: `s${i}`,
          title: `T${i}`,
          stallSeconds: 60 + i,
          at: 1000 + i,
        },
        storage,
        3,
      );
    }
    const list = loadStallHistory(storage, 3);
    expect(list).toHaveLength(3);
    // Newest first (highest at)
    expect(list[0]!.sessionId).toBe("s4");
    expect(list[1]!.sessionId).toBe("s3");
    expect(list[2]!.sessionId).toBe("s2");
  });

  it("soft active stalls replace by stable session id (no flood)", () => {
    const storage = memStorage();
    recordStallHistory(
      {
        kind: "active",
        sessionId: "a",
        stallSeconds: 90,
        at: 10,
      },
      storage,
    );
    recordStallHistory(
      {
        kind: "active",
        sessionId: "a",
        stallSeconds: 180,
        at: 20,
      },
      storage,
    );
    const list = loadStallHistory(storage);
    expect(list).toHaveLength(1);
    expect(list[0]!.stallSeconds).toBe(180);
    expect(list[0]!.id).toBe("hist:active:a");
  });

  it("recordStallHistoryFromSignal strips tier and records hard_end", () => {
    const storage = memStorage();
    const signal = reliabilityStallFromEvent({
      kind: "hard_end",
      sessionId: "x",
      title: "Long run",
      stallSeconds: 300,
      tier: "hard",
      reason: "stall",
      at: 42,
    });
    recordStallHistoryFromSignal(signal, storage);
    const list = loadStallHistory(storage);
    expect(list).toHaveLength(1);
    expect(list[0]!.kind).toBe("hard_end");
    expect(list[0]!.title).toBe("Long run");
    expect(list[0]!.stallSeconds).toBe(300);
    expect(list[0] && "tier" in list[0]).toBe(false);
  });

  it("filterStallHistory matches query and kind", () => {
    const rows: StallHistoryEntry[] = [
      {
        id: "1",
        sessionId: "s-oauth",
        title: "Fix OAuth",
        kind: "hard_end",
        stallSeconds: 120,
        reason: "stall",
        at: 3,
      },
      {
        id: "2",
        sessionId: "s-ui",
        title: "UI polish",
        kind: "active",
        stallSeconds: 60,
        reason: "stall",
        at: 2,
      },
      {
        id: "3",
        sessionId: "s-term",
        title: "Terminal",
        kind: "terminal",
        stallSeconds: null,
        reason: "stream_idle",
        at: 1,
      },
    ];
    expect(filterStallHistory(rows)).toHaveLength(3);
    expect(filterStallHistory(rows, { query: "  " })).toHaveLength(3);
    expect(
      filterStallHistory(rows, { query: "oauth" }).map((e) => e.id),
    ).toEqual(["1"]);
    expect(
      filterStallHistory(rows, { query: "S-UI" }).map((e) => e.id),
    ).toEqual(["2"]);
    expect(
      filterStallHistory(rows, { query: "stream_idle" }).map((e) => e.id),
    ).toEqual(["3"]);
    expect(
      filterStallHistory(rows, { kind: "hard_end" }).map((e) => e.kind),
    ).toEqual(["hard_end"]);
    expect(
      filterStallHistory(rows, { kind: "active", query: "polish" }).map(
        (e) => e.id,
      ),
    ).toEqual(["2"]);
    expect(filterStallHistory(rows, { query: "xyz" })).toEqual([]);
    expect(filterStallHistory(rows, { kind: "all" })).toHaveLength(3);
    expect(hasActiveStallHistoryFilters({ query: "  " })).toBe(false);
    expect(hasActiveStallHistoryFilters({ kind: "all" })).toBe(false);
    expect(hasActiveStallHistoryFilters({ kind: "active" })).toBe(true);
    expect(hasActiveStallHistoryFilters({ query: "oauth" })).toBe(true);
  });

  it("planClearStallHistory is pure and omits secrets from logMeta", () => {
    const rows: StallHistoryEntry[] = [
      {
        id: "1",
        sessionId: "s-a",
        title: "secret-title-sk-abc1234567890",
        kind: "hard_end",
        stallSeconds: 10,
        reason: "stall",
        at: 2,
      },
      {
        id: "2",
        sessionId: "s-b",
        title: "Other",
        kind: "active",
        stallSeconds: 5,
        reason: "stall",
        at: 1,
      },
      {
        id: "3",
        sessionId: "s-a",
        title: "Again",
        kind: "hard_end",
        stallSeconds: null,
        reason: "stall",
        at: 0,
      },
    ];
    const plan = planClearStallHistory(rows);
    expect(plan.ok).toBe(true);
    expect(plan.count).toBe(3);
    expect(plan.next).toEqual([]);
    expect(plan.sessionIds).toEqual(["s-a", "s-b"]);
    expect(plan.kindCounts).toEqual({ hard_end: 2, active: 1 });
    expect(plan.logMeta).toEqual({ clearedCount: 3 });
    expect(JSON.stringify(plan.logMeta)).not.toContain("secret");
    expect(JSON.stringify(plan.logMeta)).not.toContain("sk-");
    // Pure: input unchanged.
    expect(rows).toHaveLength(3);

    const empty = planClearStallHistory([]);
    expect(empty.count).toBe(0);
    expect(empty.logMeta).toBeNull();
    expect(empty.sessionIds).toEqual([]);
  });

  it("clearStallHistory / applyClearStallHistoryPlan wipe storage", () => {
    const storage = memStorage();
    recordStallHistory(
      { kind: "hard_end", sessionId: "a", at: 1 },
      storage,
    );
    expect(loadStallHistory(storage)).toHaveLength(1);
    const next = clearStallHistory(storage);
    expect(next).toEqual([]);
    expect(loadStallHistory(storage)).toEqual([]);

    recordStallHistory(
      { kind: "active", sessionId: "b", at: 2 },
      storage,
    );
    const plan = planClearStallHistory(loadStallHistory(storage));
    expect(plan.count).toBe(1);
    const applied = applyClearStallHistoryPlan(plan, storage);
    expect(applied).toEqual([]);
    expect(loadStallHistory(storage)).toEqual([]);
  });

  it("buildStallHistoryExport redacts secrets and keeps known fields", () => {
    const rows: StallHistoryEntry[] = [
      {
        id: "1",
        sessionId: "s1",
        title: "Fix with Bearer sk-abcdefghijklmnopqrstuv",
        kind: "hard_end",
        stallSeconds: 90,
        reason: "token sk-abcdefghijklmnopqrstuv leaked",
        at: 1000,
      },
      {
        id: "2",
        sessionId: "s2",
        title: "Soft quiet",
        kind: "active",
        stallSeconds: 45,
        reason: "stall",
        at: 2000,
      },
    ];
    const snap = buildStallHistoryExport(rows, {
      generatedAt: "2026-07-31T00:00:00.000Z",
      query: "quiet",
      kind: "active",
    });
    expect(snap.kind).toBe("stall_history");
    expect(snap.source).toBe("stall_timeline");
    expect(snap.generatedAt).toBe("2026-07-31T00:00:00.000Z");
    expect(snap.count).toBe(2);
    expect(snap.filter).toEqual({ query: "quiet", kind: "active" });
    expect(snap.signals[0]!.title).toContain("[REDACTED]");
    expect(snap.signals[0]!.reason).toContain("[REDACTED]");
    expect(snap.signals[0]!.title).not.toContain("sk-");
    expect(snap.signals[0]!.reason).not.toContain("sk-");
    for (const row of snap.signals) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "at",
          "id",
          "kind",
          "reason",
          "sessionId",
          "stallSeconds",
          "title",
        ].sort(),
      );
    }
    const json = serializeStallHistoryExport(snap);
    expect(json).toContain('"kind": "stall_history"');
    expect(json).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect(json).not.toContain("Bearer sk-");
  });

  it("buildStallHistoryExport honors max and empty", () => {
    expect(buildStallHistoryExport([], { max: 5 }).count).toBe(0);
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `h${i}`,
      sessionId: `s${i}`,
      title: `T${i}`,
      kind: "hard_end" as const,
      stallSeconds: i + 1,
      reason: "stall",
      at: i + 1,
    }));
    expect(buildStallHistoryExport(many, { max: 3 }).signals).toHaveLength(3);
    expect(buildStallHistoryExport(many, { kind: "all" }).filter.kind).toBe(
      "all",
    );
  });

  it("never stores free-form secret-like extra fields", () => {
    const storage = memStorage();
    recordStallHistory(
      {
        kind: "hard_end",
        sessionId: "s",
        title: "Safe title",
        reason: "stall",
        at: 1,
      },
      storage,
    );
    const raw = storage.getItem("grok.stallHistory");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as Record<string, unknown>[];
    expect(Object.keys(parsed[0]!).sort()).toEqual(
      ["at", "id", "kind", "reason", "sessionId", "stallSeconds", "title"].sort(),
    );
  });
});

describe("buildStallTimelineSnapshot", () => {
  it("builds a redacted support-bundle snapshot from stall signals", () => {
    const signals: ReliabilityStallSignal[] = [
      reliabilityStallFromEvent({
        kind: "hard_end",
        sessionId: "s1",
        title: "Long run",
        stallSeconds: 120,
        tier: "hard",
        reason: "stall",
        at: 1000,
      }),
      {
        id: "active:s2:45",
        sessionId: "s2",
        title: "Soft quiet",
        kind: "active",
        stallSeconds: 45,
        tier: "soft",
        reason: "stall",
        at: 2000,
      },
    ];
    const snap = buildStallTimelineSnapshot(signals, {
      generatedAt: "2026-07-30T12:00:00.000Z",
    });
    expect(snap.kind).toBe("stall_timeline");
    expect(snap.source).toBe("reliability_center");
    expect(snap.generatedAt).toBe("2026-07-30T12:00:00.000Z");
    expect(snap.count).toBe(2);
    expect(snap.signals).toHaveLength(2);
    expect(snap.signals[0]).toMatchObject({
      sessionId: "s1",
      title: "Long run",
      kind: "hard_end",
      stallSeconds: 120,
      tier: "hard",
      reason: "stall",
      at: 1000,
    });
    // Only known keys — no accidental secret-bearing fields.
    for (const row of snap.signals) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "at",
          "id",
          "kind",
          "reason",
          "sessionId",
          "stallSeconds",
          "tier",
          "title",
        ].sort(),
      );
    }
    const json = serializeStallTimelineSnapshot(snap);
    expect(json).toContain('"kind": "stall_timeline"');
    expect(json).not.toContain("sk-");
  });

  it("caps title length and drops invalid kinds / duplicate ids", () => {
    const long = "t".repeat(STALL_TIMELINE_FIELD_MAX + 40);
    const signals = [
      reliabilityStallFromEvent({
        kind: "terminal",
        sessionId: "a",
        title: long,
        at: 1,
      }),
      reliabilityStallFromEvent({
        kind: "terminal",
        sessionId: "a",
        title: "dup-id-will-lose",
        at: 1,
      }),
      {
        id: "bad",
        sessionId: null,
        title: null,
        kind: "not_a_kind" as ReliabilityStallSignal["kind"],
        stallSeconds: null,
        tier: null,
        reason: null,
        at: 2,
      },
    ];
    // Force same id on second row
    signals[1] = { ...signals[1]!, id: signals[0]!.id };
    const snap = buildStallTimelineSnapshot(signals, { max: 10 });
    expect(snap.count).toBe(1);
    expect(snap.signals[0]!.title!.length).toBe(STALL_TIMELINE_FIELD_MAX);
  });

  it("honors max and empty input", () => {
    expect(buildStallTimelineSnapshot([], { max: 5 }).count).toBe(0);
    const many = Array.from({ length: 8 }, (_, i) =>
      reliabilityStallFromEvent({
        kind: "hard_end",
        sessionId: `s${i}`,
        at: i + 1,
      }),
    );
    expect(buildStallTimelineSnapshot(many, { max: 3 }).signals).toHaveLength(
      3,
    );
  });
});
