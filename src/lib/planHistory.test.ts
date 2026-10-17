import { describe, expect, it } from "vitest";
import {
  PLAN_HISTORY_BODY_PREVIEW_MAX,
  PLAN_HISTORY_MAX,
  clearPlanHistory,
  filterPlanHistory,
  loadPlanHistory,
  parsePlanHistory,
  parsePlanHistoryEntry,
  planHistoryBodyPreview,
  planHistoryEntryKey,
  planHistoryLabel,
  planHistoryListSnippet,
  pushPlanHistory,
  recordPlanHistory,
  savePlanHistory,
  type PlanHistoryEntry,
  type PlanHistoryStorage,
} from "./planHistory";

function memStorage(seed?: Record<string, string>): PlanHistoryStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

const sample = (
  n: number,
  overrides?: Partial<PlanHistoryEntry>,
): PlanHistoryEntry => ({
  sessionId: `sess-${n}`,
  bodyPreview: `## Plan ${n}\n\nDo the thing.`,
  decision: "approved",
  at: new Date(1_700_000_000_000 + n * 1000).toISOString(),
  title: `Chat ${n}`,
  ...overrides,
});

describe("planHistoryBodyPreview", () => {
  it("trims, redacts secrets, and caps length", () => {
    expect(planHistoryBodyPreview("  hello  ")).toBe("hello");
    expect(planHistoryBodyPreview("key sk-abcdefghijklmnop tail")).toContain(
      "[REDACTED]",
    );
    expect(planHistoryBodyPreview("key sk-abcdefghijklmnop tail")).not.toContain(
      "sk-abcdefghijklmnop",
    );
    const long = "x".repeat(PLAN_HISTORY_BODY_PREVIEW_MAX + 50);
    const preview = planHistoryBodyPreview(long);
    expect(preview.length).toBeLessThanOrEqual(PLAN_HISTORY_BODY_PREVIEW_MAX);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("returns empty for blank input", () => {
    expect(planHistoryBodyPreview("")).toBe("");
    expect(planHistoryBodyPreview("   ")).toBe("");
    expect(planHistoryBodyPreview(null)).toBe("");
  });
});

describe("parsePlanHistoryEntry", () => {
  it("accepts valid entries and drops unknown fields", () => {
    expect(
      parsePlanHistoryEntry({
        sessionId: "  abc  ",
        title: "  Hello  ",
        bodyPreview: "  steps  ",
        decision: "approved",
        at: "2026-01-01T00:00:00.000Z",
        secret: "should-drop",
        apiKey: "sk-xyz",
      }),
    ).toEqual({
      sessionId: "abc",
      title: "Hello",
      bodyPreview: "steps",
      decision: "approved",
      at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("rejects missing sessionId or invalid decision", () => {
    expect(
      parsePlanHistoryEntry({
        decision: "approved",
        bodyPreview: "x",
        at: "t",
      }),
    ).toBeNull();
    expect(
      parsePlanHistoryEntry({
        sessionId: "s",
        decision: "nope",
        bodyPreview: "x",
      }),
    ).toBeNull();
    expect(parsePlanHistoryEntry(null)).toBeNull();
    expect(parsePlanHistoryEntry("nope")).toBeNull();
  });

  it("accepts abandoned and completed decisions", () => {
    expect(
      parsePlanHistoryEntry({
        sessionId: "s",
        decision: "abandoned",
        bodyPreview: "a",
      })?.decision,
    ).toBe("abandoned");
    expect(
      parsePlanHistoryEntry({
        sessionId: "s",
        decision: "COMPLETED",
        bodyPreview: "a",
      })?.decision,
    ).toBe("completed");
  });

  it("caps title and redacts body preview", () => {
    const long = "t".repeat(500);
    const e = parsePlanHistoryEntry({
      sessionId: "s",
      decision: "approved",
      title: long,
      bodyPreview: "token sk-abcdefghijklmnop here",
    });
    expect(e?.title?.length).toBe(200);
    expect(e?.bodyPreview).toContain("[REDACTED]");
  });
});

describe("parsePlanHistory", () => {
  it("parses JSON string and array, newest-first order preserved", () => {
    const a = sample(1);
    const b = sample(2);
    expect(parsePlanHistory(JSON.stringify([a, b]))).toEqual([a, b]);
    expect(parsePlanHistory([a, b])).toEqual([a, b]);
  });

  it("returns empty on corrupt input", () => {
    expect(parsePlanHistory("{not json")).toEqual([]);
    expect(parsePlanHistory(42)).toEqual([]);
    expect(parsePlanHistory(undefined)).toEqual([]);
  });

  it("caps at max", () => {
    const many = Array.from({ length: 40 }, (_, i) => sample(i));
    expect(parsePlanHistory(many, 5)).toHaveLength(5);
    expect(parsePlanHistory(many).length).toBeLessThanOrEqual(PLAN_HISTORY_MAX);
  });
});

describe("pushPlanHistory (ring buffer)", () => {
  it("prepends newest and trims to max 30", () => {
    const existing = Array.from({ length: 3 }, (_, i) => sample(i));
    const next = pushPlanHistory(existing, sample(99), 3);
    expect(next).toHaveLength(3);
    expect(next[0]!.sessionId).toBe("sess-99");
    expect(next.map((e) => e.sessionId)).toEqual([
      "sess-99",
      "sess-0",
      "sess-1",
    ]);
  });

  it("keeps multiple rows for same session (no path-style dedupe)", () => {
    const a = sample(1, { decision: "approved" });
    const b = sample(1, {
      decision: "completed",
      at: "2026-02-01T00:00:00.000Z",
    });
    const next = pushPlanHistory([a], b, 20);
    expect(next).toHaveLength(2);
    expect(next[0]!.decision).toBe("completed");
    expect(next[1]!.decision).toBe("approved");
  });

  it("ignores invalid entry", () => {
    const existing = [sample(1)];
    expect(
      pushPlanHistory(existing, {
        sessionId: "",
        bodyPreview: "",
        decision: "approved",
        at: "",
      }),
    ).toEqual(existing);
  });

  it("enforces default max of 30", () => {
    let list: PlanHistoryEntry[] = [];
    for (let i = 0; i < 35; i++) {
      list = pushPlanHistory(list, sample(i));
    }
    expect(list).toHaveLength(PLAN_HISTORY_MAX);
    expect(list[0]!.sessionId).toBe("sess-34");
    expect(list[list.length - 1]!.sessionId).toBe("sess-5");
  });
});

describe("load / save / recordPlanHistory", () => {
  it("round-trips via storage", () => {
    const storage = memStorage();
    const entries = [sample(1), sample(2)];
    savePlanHistory(entries, storage);
    expect(loadPlanHistory(storage)).toEqual(entries);
  });

  it("recordPlanHistory prepends and persists", () => {
    const storage = memStorage();
    savePlanHistory([sample(1)], storage);
    const next = recordPlanHistory(
      {
        sessionId: "sess-new",
        decision: "abandoned",
        title: "New chat",
        body: "# Steps\n\n1. Go",
      },
      storage,
    );
    expect(next[0]).toMatchObject({
      sessionId: "sess-new",
      decision: "abandoned",
      title: "New chat",
      bodyPreview: "# Steps\n\n1. Go",
    });
    expect(next).toHaveLength(2);
    expect(loadPlanHistory(storage)[0]!.decision).toBe("abandoned");
  });

  it("recordPlanHistory prefers bodyPreview over body", () => {
    const storage = memStorage();
    const next = recordPlanHistory(
      {
        sessionId: "s",
        decision: "completed",
        body: "ignored",
        bodyPreview: "from entries",
      },
      storage,
    );
    expect(next[0]!.bodyPreview).toBe("from entries");
  });

  it("load returns empty when storage throws or missing", () => {
    expect(loadPlanHistory(memStorage())).toEqual([]);
    const bad: PlanHistoryStorage = {
      getItem: () => {
        throw new Error("quota");
      },
      setItem: () => {},
    };
    expect(loadPlanHistory(bad)).toEqual([]);
  });

  it("record ignores empty sessionId", () => {
    const storage = memStorage();
    const next = recordPlanHistory(
      { sessionId: "  ", decision: "approved", body: "x" },
      storage,
    );
    expect(next).toEqual([]);
  });
});

describe("display helpers", () => {
  it("planHistoryLabel prefers title then short id", () => {
    expect(
      planHistoryLabel({
        sessionId: "abcdefghijklmnop",
        bodyPreview: "",
        decision: "approved",
        at: "",
        title: "My plan",
      }),
    ).toBe("My plan");
    expect(
      planHistoryLabel({
        sessionId: "abcdefghijklmnop",
        bodyPreview: "",
        decision: "approved",
        at: "",
      }),
    ).toBe("abcdefgh…");
    expect(
      planHistoryLabel({
        sessionId: "short",
        bodyPreview: "",
        decision: "approved",
        at: "",
      }),
    ).toBe("short");
  });

  it("planHistoryListSnippet collapses whitespace", () => {
    expect(
      planHistoryListSnippet({
        sessionId: "s",
        decision: "approved",
        at: "",
        bodyPreview: "line1\n\nline2",
      }),
    ).toBe("line1 line2");
  });

  it("planHistoryEntryKey is stable", () => {
    const e = sample(1);
    expect(planHistoryEntryKey(e)).toBe(
      `${e.sessionId}|${e.decision}|${e.at}`,
    );
  });
});

describe("filterPlanHistory", () => {
  const rows: PlanHistoryEntry[] = [
    sample(1, {
      title: "Auth rewrite",
      bodyPreview: "Add OAuth and session cookies",
      decision: "approved",
    }),
    sample(2, {
      title: "UI polish",
      bodyPreview: "Tighten spacing on the plan bar",
      decision: "abandoned",
    }),
    sample(3, {
      title: "Ship release",
      bodyPreview: "Tag and publish 0.2.2",
      decision: "completed",
    }),
  ];

  it("returns a copy when no filters", () => {
    const out = filterPlanHistory(rows);
    expect(out).toEqual(rows);
    expect(out).not.toBe(rows);
  });

  it("matches title, preview, and session id (case-insensitive)", () => {
    expect(filterPlanHistory(rows, { query: "oauth" }).map((e) => e.sessionId)).toEqual([
      "sess-1",
    ]);
    expect(filterPlanHistory(rows, { query: "UI" }).map((e) => e.sessionId)).toEqual([
      "sess-2",
    ]);
    expect(filterPlanHistory(rows, { query: "SESS-3" }).map((e) => e.sessionId)).toEqual([
      "sess-3",
    ]);
    expect(filterPlanHistory(rows, { query: "  " })).toHaveLength(3);
  });

  it("filters by decision chips", () => {
    expect(
      filterPlanHistory(rows, { decisions: ["approved"] }).map((e) => e.decision),
    ).toEqual(["approved"]);
    expect(
      filterPlanHistory(rows, { decisions: ["abandoned", "completed"] }).map(
        (e) => e.decision,
      ),
    ).toEqual(["abandoned", "completed"]);
    expect(filterPlanHistory(rows, { decisions: "all" })).toHaveLength(3);
    expect(filterPlanHistory(rows, { decisions: [] })).toHaveLength(3);
  });

  it("combines query and decision", () => {
    expect(
      filterPlanHistory(rows, {
        query: "plan",
        decisions: ["abandoned"],
      }).map((e) => e.sessionId),
    ).toEqual(["sess-2"]);
    expect(
      filterPlanHistory(rows, {
        query: "oauth",
        decisions: ["completed"],
      }),
    ).toEqual([]);
  });
});

describe("clearPlanHistory", () => {
  it("wipes storage and returns empty", () => {
    const storage = memStorage();
    savePlanHistory([sample(1), sample(2)], storage);
    expect(loadPlanHistory(storage)).toHaveLength(2);
    const next = clearPlanHistory(storage);
    expect(next).toEqual([]);
    expect(loadPlanHistory(storage)).toEqual([]);
  });
});
