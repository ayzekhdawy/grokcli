import { describe, expect, it } from "vitest";
import {
  AUTOMATION_RUN_HISTORY_MAX,
  clearAutomationRunHistory,
  countAutomationRunOutcomes,
  filterAutomationRunHistory,
  loadAutomationRunHistory,
  parseAutomationRunHistory,
  parseAutomationRunRecord,
  pushAutomationRun,
  recordAutomationRun,
  redactAutomationRunError,
  type AutomationRunHistoryStorage,
  type AutomationRunRecord,
} from "./automationRunHistory";

function memStorage(seed?: string): AutomationRunHistoryStorage {
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

describe("parseAutomationRunRecord", () => {
  it("accepts valid records and aliases", () => {
    const e = parseAutomationRunRecord({
      id: "x",
      automationId: "a1",
      title: "T",
      at: "2026-01-01T00:00:00.000Z",
      outcome: "error",
      error: "boom",
      source: "run_now",
    });
    expect(e).toMatchObject({
      id: "x",
      scheduleId: "a1",
      name: "T",
      outcome: "error",
      source: "run_now",
      error: "boom",
    });
  });

  it("rejects unknown outcomes", () => {
    expect(parseAutomationRunRecord({ ...base, outcome: "pending" })).toBeNull();
    expect(parseAutomationRunRecord(null)).toBeNull();
    expect(parseAutomationRunRecord("nope")).toBeNull();
  });

  it("defaults source and strips error on non-error outcomes", () => {
    const e = parseAutomationRunRecord({
      scheduleId: "s",
      name: "N",
      at: "t",
      outcome: "ok",
      error: "should-drop",
    });
    expect(e?.source).toBe("unknown");
    expect(e?.error).toBeUndefined();
  });

  it("keeps optional sessionId / projectId when present", () => {
    const e = parseAutomationRunRecord({
      ...base,
      sessionId: "sess-1",
      project_id: "proj-9",
    });
    expect(e?.sessionId).toBe("sess-1");
    expect(e?.projectId).toBe("proj-9");
  });
});

describe("redactAutomationRunError", () => {
  it("redacts api keys and clamps", () => {
    const long = `fail sk-abcdefghijklmnop ${"x".repeat(400)}`;
    const r = redactAutomationRunError(long);
    expect(r).toBeTruthy();
    expect(r).not.toMatch(/sk-abcdefghijklmnop/);
    expect(r!.length).toBeLessThanOrEqual(280);
  });

  it("returns null for empty", () => {
    expect(redactAutomationRunError("   ")).toBeNull();
    expect(redactAutomationRunError(null)).toBeNull();
  });
});

describe("parseAutomationRunHistory / push", () => {
  it("soft-fails corrupt storage to empty", () => {
    expect(parseAutomationRunHistory("{not json")).toEqual([]);
    expect(parseAutomationRunHistory(undefined)).toEqual([]);
  });

  it("caps at max and keeps newest first", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...base,
      id: `ar-${i}`,
      at: `2026-07-31T12:${String(i).padStart(2, "0")}:00.000Z`,
    }));
    const list = parseAutomationRunHistory(many, 50);
    expect(list).toHaveLength(50);
    expect(list[0].id).toBe("ar-0");
  });

  it("push prepends and dedupes by id", () => {
    const a = pushAutomationRun([], base);
    const b = pushAutomationRun(a, { ...base, name: "Updated" });
    expect(b).toHaveLength(1);
    expect(b[0].name).toBe("Updated");
    const c = pushAutomationRun(b, { ...base, id: "ar-2", name: "Two" });
    expect(c.map((e) => e.id)).toEqual(["ar-2", "ar-1"]);
  });
});

describe("record / load / clear / filter", () => {
  it("records ok, error, skipped and filters by outcome chips", () => {
    const storage = memStorage();
    recordAutomationRun(
      {
        scheduleId: "s1",
        name: "A",
        outcome: "ok",
        source: "host",
        at: "2026-07-31T10:00:00.000Z",
      },
      storage,
    );
    recordAutomationRun(
      {
        scheduleId: "s2",
        title: "B",
        outcome: "error",
        error: "connect failed: sk-SECRETKEY1234567890",
        source: "run_now",
        at: "2026-07-31T11:00:00.000Z",
      },
      storage,
    );
    recordAutomationRun(
      {
        scheduleId: "s1",
        name: "A",
        outcome: "skipped",
        source: "run_now",
        at: "2026-07-31T12:00:00.000Z",
      },
      storage,
    );

    const all = loadAutomationRunHistory(storage);
    expect(all).toHaveLength(3);
    expect(all[0].outcome).toBe("skipped");
    expect(all[1].outcome).toBe("error");
    expect(all[1].error).not.toMatch(/sk-SECRETKEY/);

    expect(filterAutomationRunHistory(all, "error")).toHaveLength(1);
    expect(filterAutomationRunHistory(all, "ok")).toHaveLength(1);
    expect(filterAutomationRunHistory(all, "all")).toHaveLength(3);

    const counts = countAutomationRunOutcomes(all);
    expect(counts).toEqual({ all: 3, ok: 1, error: 1, skipped: 1 });

    clearAutomationRunHistory(storage);
    expect(loadAutomationRunHistory(storage)).toEqual([]);
  });

  it("never invents entries from empty storage", () => {
    expect(loadAutomationRunHistory(memStorage())).toEqual([]);
  });

  it("respects max ring size on record", () => {
    const storage = memStorage();
    for (let i = 0; i < AUTOMATION_RUN_HISTORY_MAX + 5; i++) {
      recordAutomationRun(
        {
          scheduleId: `s${i}`,
          name: `N${i}`,
          outcome: "ok",
          source: "host",
          at: new Date(1_700_000_000_000 + i * 1000).toISOString(),
        },
        storage,
      );
    }
    expect(loadAutomationRunHistory(storage)).toHaveLength(
      AUTOMATION_RUN_HISTORY_MAX,
    );
  });
});
