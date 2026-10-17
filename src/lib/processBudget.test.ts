import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_IDLE_MINUTES,
  DEFAULT_MAX_CONCURRENT_AGENTS,
  emptyProcessBudgetSnapshot,
  isAtOrOverCap,
  isOverCap,
  normalizeIdleMinutes,
  normalizeMaxConcurrent,
  normalizeProcessBudgetCounts,
  normalizeProcessCount,
  occupancyPercent,
  occupancyTone,
  parseProcessBudgetSnapshot,
  parseProcessLimitEvent,
  processBudgetCountVars,
  processLimitAgeMinutes,
  processLimitExplainKey,
  reclaimPlan,
  reclaimPlanCopyKey,
  slotsFree,
  type ProcessBudgetSnapshot,
} from "./processBudget";

function snap(
  partial: Partial<ProcessBudgetSnapshot> & {
    live: number;
    background: number;
    parked: number;
  },
): ProcessBudgetSnapshot {
  const live = partial.live;
  const background = partial.background;
  const parked = partial.parked;
  return {
    live,
    background,
    parked,
    totalWarm: partial.totalWarm ?? live + background + parked,
    busy: partial.busy ?? live + background,
    maxConcurrent: partial.maxConcurrent ?? 8,
    idleMinutes: partial.idleMinutes ?? 30,
    liveSessionIds: partial.liveSessionIds ?? [],
    backgroundSessionIds: partial.backgroundSessionIds ?? [],
    parkedSessionIds: partial.parkedSessionIds ?? [],
    available: partial.available ?? true,
  };
}

describe("normalizeProcessCount", () => {
  it("floors and clamps negatives", () => {
    expect(normalizeProcessCount(undefined)).toBe(0);
    expect(normalizeProcessCount(-3)).toBe(0);
    expect(normalizeProcessCount(2.9)).toBe(2);
    expect(normalizeProcessCount("5")).toBe(5);
    expect(normalizeProcessCount("x", 9)).toBe(9);
  });
});

describe("normalizeMaxConcurrent / idle", () => {
  it("clamps concurrent to 1..32", () => {
    expect(normalizeMaxConcurrent(0)).toBe(1);
    expect(normalizeMaxConcurrent(8)).toBe(8);
    expect(normalizeMaxConcurrent(99)).toBe(32);
    expect(normalizeMaxConcurrent(null)).toBe(DEFAULT_MAX_CONCURRENT_AGENTS);
  });

  it("clamps idle minutes", () => {
    expect(normalizeIdleMinutes(0)).toBe(1);
    expect(normalizeIdleMinutes(30)).toBe(30);
    expect(normalizeIdleMinutes(99_999)).toBe(24 * 60);
    expect(normalizeIdleMinutes(undefined)).toBe(DEFAULT_AGENT_IDLE_MINUTES);
  });
});

describe("occupancyPercent / over-cap", () => {
  it("computes percent and over-cap", () => {
    expect(occupancyPercent(0, 8)).toBe(0);
    expect(occupancyPercent(4, 8)).toBe(50);
    expect(occupancyPercent(8, 8)).toBe(100);
    expect(occupancyPercent(12, 8)).toBe(100);
    expect(isOverCap(8, 8)).toBe(false);
    expect(isOverCap(9, 8)).toBe(true);
    expect(isAtOrOverCap(8, 8)).toBe(true);
    expect(isAtOrOverCap(7, 8)).toBe(false);
    expect(slotsFree(3, 8)).toBe(5);
    expect(slotsFree(10, 8)).toBe(0);
  });
});

describe("normalizeProcessBudgetCounts", () => {
  it("recomputes total and busy from buckets", () => {
    const c = normalizeProcessBudgetCounts({
      live: 1,
      background: 2,
      parked: 3,
      maxConcurrent: 8,
      idleMinutes: 30,
    });
    expect(c.totalWarm).toBe(6);
    expect(c.busy).toBe(3);
  });
});

describe("parseProcessBudgetSnapshot", () => {
  it("accepts camelCase host rows", () => {
    const s = parseProcessBudgetSnapshot({
      live: 1,
      background: 1,
      parked: 2,
      totalWarm: 4,
      busy: 2,
      maxConcurrent: 8,
      idleMinutes: 30,
      liveSessionIds: ["a"],
      backgroundSessionIds: ["b"],
      parkedSessionIds: ["c", "d"],
      available: true,
    });
    expect(s.available).toBe(true);
    expect(s.totalWarm).toBe(4);
    expect(s.liveSessionIds).toEqual(["a"]);
    expect(s.parkedSessionIds).toEqual(["c", "d"]);
  });

  it("accepts snake_case aliases", () => {
    const s = parseProcessBudgetSnapshot({
      live: 0,
      background: 1,
      parked: 0,
      total_warm: 1,
      busy: 1,
      max_concurrent: 16,
      idle_minutes: 45,
      live_session_ids: [],
      background_session_ids: ["bg"],
      parked_session_ids: [],
      available: true,
    });
    expect(s.maxConcurrent).toBe(16);
    expect(s.idleMinutes).toBe(45);
    expect(s.backgroundSessionIds).toEqual(["bg"]);
  });

  it("soft-fails null / unavailable", () => {
    expect(parseProcessBudgetSnapshot(null).available).toBe(false);
    expect(parseProcessBudgetSnapshot(undefined).available).toBe(false);
    const empty = emptyProcessBudgetSnapshot();
    expect(empty.available).toBe(false);
    expect(empty.totalWarm).toBe(0);
    const soft = parseProcessBudgetSnapshot({
      live: 9,
      available: false,
      maxConcurrent: 8,
    });
    expect(soft.available).toBe(false);
    expect(soft.live).toBe(0);
  });
});

describe("reclaimPlan + copy keys", () => {
  it("classifies occupancy honestly", () => {
    expect(reclaimPlan(null)).toBe("unavailable");
    expect(reclaimPlan(emptyProcessBudgetSnapshot())).toBe("unavailable");
    expect(reclaimPlan(snap({ live: 0, background: 0, parked: 0 }))).toBe(
      "empty",
    );
    expect(reclaimPlan(snap({ live: 1, background: 0, parked: 2 }))).toBe(
      "headroom",
    );
    expect(
      reclaimPlan(
        snap({ live: 1, background: 5, parked: 2, maxConcurrent: 8 }),
      ),
    ).toBe("at_cap_with_parked");
    expect(
      reclaimPlan(
        snap({ live: 1, background: 7, parked: 0, maxConcurrent: 8 }),
      ),
    ).toBe("at_cap_busy");
    expect(
      reclaimPlan(
        snap({ live: 1, background: 8, parked: 1, maxConcurrent: 8 }),
      ),
    ).toBe("over_cap");
  });

  it("maps copy keys and tones", () => {
    expect(reclaimPlanCopyKey("at_cap_busy")).toBe(
      "processBudget.plan.atCapBusy",
    );
    expect(reclaimPlanCopyKey("at_cap_with_parked")).toBe(
      "processBudget.plan.atCapWithParked",
    );
    expect(occupancyTone("headroom")).toBe("ok");
    expect(occupancyTone("at_cap_with_parked")).toBe("warn");
    expect(occupancyTone("at_cap_busy")).toBe("danger");
    expect(occupancyTone("unavailable")).toBe("muted");
  });
});

describe("process_limit event helpers", () => {
  it("parses host process_limit payload", () => {
    const e = parseProcessLimitEvent(
      {
        sessionId: "s1",
        maxConcurrentAgents: 8,
        code: "PROCESS_LIMIT",
        message: "Agent process limit reached",
      },
      1_700_000_000_000,
    );
    expect(e).toEqual({
      at: 1_700_000_000_000,
      maxConcurrentAgents: 8,
      sessionId: "s1",
      message: "Agent process limit reached",
      code: "PROCESS_LIMIT",
    });
    expect(processLimitExplainKey()).toBe("processBudget.limit.explain");
    expect(processLimitAgeMinutes(e, 1_700_000_000_000 + 5 * 60_000)).toBe(5);
  });

  it("rejects junk", () => {
    expect(parseProcessLimitEvent(null)).toBeNull();
    expect(parseProcessLimitEvent("x")).toBeNull();
  });
});

describe("processBudgetCountVars", () => {
  it("exposes free slots and percent", () => {
    const v = processBudgetCountVars(
      snap({ live: 1, background: 1, parked: 2, maxConcurrent: 8 }),
    );
    expect(v.total).toBe(4);
    expect(v.free).toBe(4);
    expect(v.percent).toBe(50);
    expect(v.busy).toBe(2);
  });
});
