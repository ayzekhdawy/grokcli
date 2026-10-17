import { describe, expect, it } from "vitest";
import type { StallHistoryEntry } from "./reliabilityStallHistory";
import {
  canOpenStallSession,
  formatStallDuration,
  planOpenStallSession,
  resolveStallTimelineEmptyState,
  stallEntrySessionId,
} from "./stallTimelinePro";

const entry = (
  overrides?: Partial<StallHistoryEntry>,
): StallHistoryEntry => ({
  id: "hist:hard_end:s-1:1",
  sessionId: "s-1",
  title: "Long run",
  kind: "hard_end",
  stallSeconds: 120,
  reason: "stall",
  at: 1_700_000_000_000,
  ...overrides,
});

describe("stallEntrySessionId / planOpenStallSession", () => {
  it("extracts trimmed session id or null", () => {
    expect(stallEntrySessionId(entry())).toBe("s-1");
    expect(stallEntrySessionId(entry({ sessionId: "  s-2  " }))).toBe("s-2");
    expect(stallEntrySessionId(entry({ sessionId: null }))).toBeNull();
    expect(stallEntrySessionId(entry({ sessionId: "   " }))).toBeNull();
    expect(stallEntrySessionId(null)).toBeNull();
    expect(stallEntrySessionId(undefined)).toBeNull();
    expect(stallEntrySessionId({ sessionId: "" })).toBeNull();
  });

  it("returns sessionId when present and no presence set", () => {
    const plan = planOpenStallSession(entry());
    expect(plan).toEqual({
      ok: true,
      sessionId: "s-1",
      sessionPresent: true,
    });
  });

  it("fails when session id is missing", () => {
    expect(planOpenStallSession(entry({ sessionId: null }))).toEqual({
      ok: false,
      reason: "no_session_id",
      sessionId: null,
    });
    expect(planOpenStallSession(entry({ sessionId: "  " }))).toEqual({
      ok: false,
      reason: "no_session_id",
      sessionId: null,
    });
    expect(planOpenStallSession(null)).toEqual({
      ok: false,
      reason: "no_session_id",
      sessionId: null,
    });
  });

  it("requires session still present when a presence set is supplied", () => {
    const present = new Set(["s-1", "s-other"]);
    expect(planOpenStallSession(entry(), present)).toEqual({
      ok: true,
      sessionId: "s-1",
      sessionPresent: true,
    });
    expect(planOpenStallSession(entry(), ["s-1"])).toEqual({
      ok: true,
      sessionId: "s-1",
      sessionPresent: true,
    });
    expect(planOpenStallSession(entry(), present)).toMatchObject({ ok: true });

    const missing = planOpenStallSession(entry({ sessionId: "gone" }), present);
    expect(missing).toEqual({
      ok: false,
      reason: "session_missing",
      sessionId: "gone",
    });

    expect(planOpenStallSession(entry(), [])).toEqual({
      ok: false,
      reason: "session_missing",
      sessionId: "s-1",
    });
  });

  it("never invents a session id from title or reason", () => {
    const plan = planOpenStallSession(
      entry({ sessionId: null, title: "s-fake", reason: "session-s-1" }),
      new Set(["s-1", "s-fake"]),
    );
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("no_session_id");
  });

  it("canOpenStallSession mirrors plan.ok", () => {
    expect(canOpenStallSession(entry())).toBe(true);
    expect(canOpenStallSession(entry(), new Set(["s-1"]))).toBe(true);
    expect(canOpenStallSession(entry(), new Set(["other"]))).toBe(false);
    expect(canOpenStallSession(entry({ sessionId: null }))).toBe(false);
  });
});

describe("resolveStallTimelineEmptyState", () => {
  it("returns null when filtered rows exist", () => {
    expect(
      resolveStallTimelineEmptyState({ total: 3, filtered: 2 }),
    ).toBeNull();
  });

  it("empty ring → empty honesty with hint (never invent rows)", () => {
    const empty = resolveStallTimelineEmptyState({ total: 0, filtered: 0 });
    expect(empty).toMatchObject({
      kind: "empty",
      titleKey: "reliability.timeline.empty",
      hintKey: "reliability.timeline.emptyHint",
      showClearFilters: false,
    });
  });

  it("filter empty with clear CTA", () => {
    const empty = resolveStallTimelineEmptyState({
      total: 4,
      filtered: 0,
      kind: "hard_end",
      query: "nope",
    });
    expect(empty).toMatchObject({
      kind: "filter_empty",
      titleKey: "reliability.timeline.emptyFilter",
      hintKey: "reliability.timeline.emptyFilterHint",
      showClearFilters: true,
    });
  });

  it("honors explicit hasFilters", () => {
    expect(
      resolveStallTimelineEmptyState({
        total: 2,
        filtered: 0,
        hasFilters: true,
      }),
    ).toMatchObject({ kind: "filter_empty", showClearFilters: true });

    // No filters + total > 0 + filtered 0 → soft empty fallback
    expect(
      resolveStallTimelineEmptyState({
        total: 2,
        filtered: 0,
        hasFilters: false,
      }),
    ).toMatchObject({
      kind: "empty",
      showClearFilters: false,
    });
  });

  it("infers filters from kind chip / query", () => {
    expect(
      resolveStallTimelineEmptyState({
        total: 1,
        filtered: 0,
        kind: "active",
      })?.showClearFilters,
    ).toBe(true);
    expect(
      resolveStallTimelineEmptyState({
        total: 1,
        filtered: 0,
        query: "oauth",
      })?.showClearFilters,
    ).toBe(true);
    expect(
      resolveStallTimelineEmptyState({
        total: 0,
        filtered: 0,
        kind: "all",
        query: "  ",
      })?.showClearFilters,
    ).toBe(false);
  });
});

describe("formatStallDuration", () => {
  it("returns null for missing / non-positive / non-finite", () => {
    expect(formatStallDuration(null)).toBeNull();
    expect(formatStallDuration(undefined)).toBeNull();
    expect(formatStallDuration(0)).toBeNull();
    expect(formatStallDuration(-1)).toBeNull();
    expect(formatStallDuration(Number.NaN)).toBeNull();
    expect(formatStallDuration(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("formats like Grok work duration (s / m / h)", () => {
    expect(formatStallDuration(1)).toBe("1s");
    expect(formatStallDuration(38)).toBe("38s");
    expect(formatStallDuration(60)).toBe("1m");
    expect(formatStallDuration(62)).toBe("1m 2s");
    expect(formatStallDuration(125)).toBe("2m 5s");
    expect(formatStallDuration(3600)).toBe("1h");
    expect(formatStallDuration(3661)).toBe("1h 1m 1s");
  });

  it("floors fractional seconds", () => {
    expect(formatStallDuration(1.9)).toBe("1s");
    expect(formatStallDuration(59.9)).toBe("59s");
  });
});
