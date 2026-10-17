import { describe, expect, it } from "vitest";
import type { AutomationRunRecord } from "./automationRunHistory";
import {
  buildAutomationsInbox,
  clearInboxSeenIds,
  countInboxByOutcome,
  filterInbox,
  isInboxItemUnread,
  loadInboxSeenIds,
  markAllInboxRead,
  markInboxItemRead,
  parseInboxSeenIds,
  planOpenInboxItem,
  planRetryAutomation,
  resolveInboxEmptyState,
  type AutomationsInboxStorage,
} from "./automationsInbox";

function memStorage(seed?: string): AutomationsInboxStorage {
  let val: string | null = seed ?? null;
  return {
    getItem: () => val,
    setItem: (_k, v) => {
      val = v;
    },
  };
}

const base: AutomationRunRecord = {
  id: "ar-1",
  scheduleId: "sched-1",
  name: "Morning digest",
  at: "2026-07-31T12:00:00.000Z",
  outcome: "ok",
  source: "host",
};

describe("buildAutomationsInbox", () => {
  it("maps history to display fields and never invents rows", () => {
    expect(buildAutomationsInbox([])).toEqual([]);
    expect(buildAutomationsInbox(undefined as unknown as [])).toEqual([]);

    const items = buildAutomationsInbox([
      {
        ...base,
        sessionId: "sess-9",
        projectId: "proj-1",
        error: "should-drop-on-ok",
      } as AutomationRunRecord & { sessionId: string; projectId: string },
      {
        id: "ar-2",
        scheduleId: "sched-2",
        name: "Fail job",
        at: "2026-07-31T11:00:00.000Z",
        outcome: "error",
        source: "run_now",
        error: "connect failed",
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "ar-1",
      title: "Morning digest",
      outcome: "ok",
      sessionId: "sess-9",
      projectId: "proj-1",
      error: null,
      unread: true,
      taskExists: false,
    });
    expect(items[1]).toMatchObject({
      id: "ar-2",
      error: "connect failed",
      unread: true,
    });
  });

  it("joins taskExists / projectId from live tasks and respects seen set", () => {
    const items = buildAutomationsInbox([base], {
      seenIds: ["ar-1"],
      tasks: [{ id: "sched-1", projectId: "p-live", title: "Live" }],
    });
    expect(items[0].unread).toBe(false);
    expect(items[0].taskExists).toBe(true);
    expect(items[0].projectId).toBe("p-live");
  });

  it("trackUnread false forces unread=false", () => {
    const items = buildAutomationsInbox([base], { trackUnread: false });
    expect(items[0].unread).toBe(false);
  });
});

describe("filterInbox / countInboxByOutcome", () => {
  const items = buildAutomationsInbox([
    base,
    {
      id: "ar-2",
      scheduleId: "s2",
      name: "Nightly",
      at: "t",
      outcome: "error",
      source: "host",
      error: "boom secret",
    },
    {
      id: "ar-3",
      scheduleId: "s3",
      name: "Busy",
      at: "t",
      outcome: "skipped",
      source: "run_now",
    },
  ]);

  it("filters by outcome and query", () => {
    expect(filterInbox(items, { outcome: "error" })).toHaveLength(1);
    expect(filterInbox(items, { query: "night" })[0].id).toBe("ar-2");
    expect(filterInbox(items, { query: "boom" })).toHaveLength(1);
    expect(filterInbox(items, { outcome: "ok", query: "night" })).toHaveLength(
      0,
    );
    expect(filterInbox(items, { outcome: "all", query: "  " })).toHaveLength(3);
  });

  it("counts outcomes", () => {
    expect(countInboxByOutcome(items)).toEqual({
      all: 3,
      ok: 1,
      error: 1,
      skipped: 1,
    });
  });
});

describe("resolveInboxEmptyState", () => {
  it("process_bound_hint when nothing observed", () => {
    expect(
      resolveInboxEmptyState({ totalCount: 0, filteredCount: 0 }),
    ).toBe("process_bound_hint");
  });

  it("filter when chips/query hide all rows", () => {
    expect(
      resolveInboxEmptyState({
        totalCount: 3,
        filteredCount: 0,
        outcomeFilter: "error",
      }),
    ).toBe("filter");
    expect(
      resolveInboxEmptyState({
        totalCount: 3,
        filteredCount: 0,
        query: "zzz",
      }),
    ).toBe("filter");
  });

  it("null when filtered list has rows", () => {
    expect(
      resolveInboxEmptyState({ totalCount: 2, filteredCount: 1 }),
    ).toBeNull();
  });

  it("empty fallback when total>0 but no active filter", () => {
    expect(
      resolveInboxEmptyState({
        totalCount: 2,
        filteredCount: 0,
        outcomeFilter: "all",
        query: "",
      }),
    ).toBe("empty");
  });
});

describe("planOpenInboxItem / planRetryAutomation", () => {
  it("prefers session, then project, else none", () => {
    expect(
      planOpenInboxItem({ sessionId: "s1", projectId: "p1" }),
    ).toEqual({ kind: "session", sessionId: "s1", projectId: "p1" });
    expect(planOpenInboxItem({ sessionId: "s1", projectId: null })).toEqual({
      kind: "session",
      sessionId: "s1",
    });
    expect(planOpenInboxItem({ sessionId: null, projectId: "p1" })).toEqual({
      kind: "project",
      projectId: "p1",
    });
    expect(planOpenInboxItem({ sessionId: null, projectId: null })).toEqual({
      kind: "none",
    });
    expect(planOpenInboxItem(null)).toEqual({ kind: "none" });
  });

  it("retry only when taskId present and task still exists", () => {
    expect(
      planRetryAutomation({ scheduleId: "sched-1", taskExists: true }),
    ).toEqual({ canRetry: true, taskId: "sched-1" });
    expect(
      planRetryAutomation({ scheduleId: "sched-1", taskExists: false }),
    ).toEqual({ canRetry: false, reason: "task_missing" });
    expect(
      planRetryAutomation({ scheduleId: "", taskExists: true }),
    ).toEqual({ canRetry: false, reason: "no_task_id" });
    expect(planRetryAutomation(null)).toEqual({
      canRetry: false,
      reason: "no_task_id",
    });
  });
});

describe("seen / mark-read helpers", () => {
  it("loads, marks one, marks all, clears", () => {
    const storage = memStorage();
    expect(loadInboxSeenIds(storage).size).toBe(0);
    expect(isInboxItemUnread("ar-1", new Set())).toBe(true);

    let seen = markInboxItemRead("ar-1", storage);
    expect(seen.has("ar-1")).toBe(true);
    expect(isInboxItemUnread("ar-1", seen)).toBe(false);

    seen = markAllInboxRead(["ar-1", "ar-2", "  "], storage);
    expect(seen.has("ar-2")).toBe(true);
    expect(loadInboxSeenIds(storage).size).toBe(2);

    clearInboxSeenIds(storage);
    expect(loadInboxSeenIds(storage).size).toBe(0);
  });

  it("soft-fails corrupt seen storage", () => {
    expect(parseInboxSeenIds("{not json")).toEqual(new Set());
    expect(parseInboxSeenIds(null)).toEqual(new Set());
    expect(parseInboxSeenIds(["a", 1, "b"])).toEqual(new Set(["a", "b"]));
  });
});
