import { describe, expect, it } from "vitest";
import {
  emptyProcessBudgetSnapshot,
  type ProcessBudgetSnapshot,
  type ProcessLimitEvent,
} from "./processBudget";
import {
  classifyProcessBudgetError,
  formatOccupancySummary,
  processBudgetErrorView,
  PROCESS_LIMIT_CALLOUT_MAX_AGE_MINUTES,
  resolveProcessBudgetEmptyState,
  resolveProcessLimitCalloutState,
  shouldShowProcessLimitCallout,
} from "./processBudgetPro";

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

function limitEvent(
  partial: Partial<ProcessLimitEvent> = {},
): ProcessLimitEvent {
  return {
    at: partial.at ?? 1_700_000_000_000,
    maxConcurrentAgents: partial.maxConcurrentAgents ?? 8,
    sessionId: partial.sessionId ?? "s1",
    message: partial.message ?? "Agent process limit reached",
    code: partial.code ?? "PROCESS_LIMIT",
  };
}

describe("classifyProcessBudgetError", () => {
  it("classifies host_only / unavailable / timeout / permission", () => {
    expect(classifyProcessBudgetError({ code: "host_only" })).toBe(
      "host_only",
    );
    expect(classifyProcessBudgetError({ code: "need_tauri" })).toBe(
      "host_only",
    );
    expect(classifyProcessBudgetError(new Error("need tauri"))).toBe(
      "host_only",
    );
    expect(classifyProcessBudgetError({ code: "unavailable" })).toBe(
      "unavailable",
    );
    expect(classifyProcessBudgetError(new Error("manager not ready"))).toBe(
      "unavailable",
    );
    expect(classifyProcessBudgetError({ code: "timeout" })).toBe("timeout");
    expect(classifyProcessBudgetError(new Error("request timed out"))).toBe(
      "timeout",
    );
    expect(classifyProcessBudgetError({ code: "permission_denied" })).toBe(
      "permission",
    );
    expect(classifyProcessBudgetError(new Error("permission denied"))).toBe(
      "permission",
    );
    expect(classifyProcessBudgetError(new Error("weird boom"))).toBe("other");
    expect(classifyProcessBudgetError(null)).toBe("other");
  });

  it("maps error views to i18n keys + soft-fail", () => {
    const host = processBudgetErrorView({ code: "host_only" });
    expect(host.softFail).toBe(true);
    expect(host.titleKey).toBe("processBudget.error.hostOnly");
    expect(host.hintKey).toBe("processBudget.error.hostOnlyHint");

    const perm = processBudgetErrorView({ code: "permission" });
    expect(perm.softFail).toBe(false);
    expect(perm.titleKey).toBe("processBudget.error.permission");
  });
});

describe("resolveProcessBudgetEmptyState", () => {
  it("loading + no available snapshot → loading (never invent empty pool)", () => {
    const e = resolveProcessBudgetEmptyState({
      loading: true,
      snapshot: emptyProcessBudgetSnapshot(),
    });
    expect(e?.kind).toBe("loading");
    expect(e?.titleKey).toBe("processBudget.loading");
    expect(e?.softFail).toBe(true);
    expect(e?.showRetry).toBe(false);
  });

  it("error + unavailable → error surface with retry", () => {
    const e = resolveProcessBudgetEmptyState({
      loading: false,
      snapshot: emptyProcessBudgetSnapshot(),
      error: { code: "timeout", message: "snapshot timed out" },
    });
    expect(e?.kind).toBe("error");
    expect(e?.errorKind).toBe("timeout");
    expect(e?.titleKey).toBe("processBudget.error.timeout");
    expect(e?.showRetry).toBe(true);
    expect(e?.tone).toBe("warn");
  });

  it("unavailable host soft-fail (no error) → unavailable", () => {
    const e = resolveProcessBudgetEmptyState({
      loading: false,
      snapshot: emptyProcessBudgetSnapshot(),
    });
    expect(e?.kind).toBe("unavailable");
    expect(e?.titleKey).toBe("processBudget.plan.unavailable");
    expect(e?.showRetry).toBe(true);
    expect(e?.softFail).toBe(true);
  });

  it("available empty pool is honest empty — not unavailable", () => {
    const e = resolveProcessBudgetEmptyState({
      loading: false,
      snapshot: snap({ live: 0, background: 0, parked: 0 }),
    });
    expect(e?.kind).toBe("empty_pool");
    expect(e?.titleKey).toBe("processBudget.plan.empty");
    expect(e?.bodyKey).toBe("processBudget.emptyPoolHint");
    expect(e?.softFail).toBe(false);
  });

  it("returns null when warm occupancy should render", () => {
    expect(
      resolveProcessBudgetEmptyState({
        loading: false,
        snapshot: snap({ live: 1, background: 0, parked: 2 }),
      }),
    ).toBeNull();
    // Loading but already have available data — keep showing occupancy.
    expect(
      resolveProcessBudgetEmptyState({
        loading: true,
        snapshot: snap({ live: 2, background: 1, parked: 0 }),
      }),
    ).toBeNull();
  });

  it("null snapshot treated as unavailable", () => {
    const e = resolveProcessBudgetEmptyState({
      loading: false,
      snapshot: null,
    });
    expect(e?.kind).toBe("unavailable");
  });
});

describe("formatOccupancySummary", () => {
  it("soft-fails to zeros when unavailable", () => {
    const s = formatOccupancySummary(emptyProcessBudgetSnapshot());
    expect(s.available).toBe(false);
    expect(s.total).toBe(0);
    expect(s.busy).toBe(0);
    expect(s.ratio).toBe("");
    expect(s.tokenLine).toBe("");
    expect(s.plan).toBe("unavailable");
  });

  it("formats ready occupancy", () => {
    const s = formatOccupancySummary(
      snap({ live: 1, background: 1, parked: 2, maxConcurrent: 8 }),
    );
    expect(s.available).toBe(true);
    expect(s.total).toBe(4);
    expect(s.free).toBe(4);
    expect(s.percent).toBe(50);
    expect(s.ratio).toBe("4/8");
    expect(s.tokenLine).toBe("live=1 bg=1 parked=2 free=4");
    expect(s.plan).toBe("headroom");
  });

  it("classifies at-cap-with-parked plan", () => {
    const s = formatOccupancySummary(
      snap({ live: 1, background: 5, parked: 2, maxConcurrent: 8 }),
    );
    expect(s.plan).toBe("at_cap_with_parked");
    expect(s.free).toBe(0);
    expect(s.percent).toBe(100);
  });
});

describe("shouldShowProcessLimitCallout + resolveProcessLimitCalloutState", () => {
  const base = 1_700_000_000_000;

  it("hides null / missing events", () => {
    expect(shouldShowProcessLimitCallout({ event: null })).toBe(false);
    expect(shouldShowProcessLimitCallout({ event: undefined })).toBe(false);
    const none = resolveProcessLimitCalloutState({ event: null });
    expect(none.kind).toBe("none");
    expect(none.titleKey).toBe("processBudget.limit.noneTitle");
    expect(none.emphasized).toBe(false);
  });

  it("shows recent PROCESS_LIMIT within max age", () => {
    const event = limitEvent({ at: base });
    expect(
      shouldShowProcessLimitCallout({
        event,
        now: base + 30 * 60_000,
      }),
    ).toBe(true);
    const active = resolveProcessLimitCalloutState({
      event,
      now: base + 30 * 60_000,
    });
    expect(active.kind).toBe("active");
    expect(active.bodyKey).toBe("processBudget.limit.explain");
    expect(active.ageMinutes).toBe(30);
    expect(active.maxConcurrentAgents).toBe(8);
    expect(active.emphasized).toBe(true);
  });

  it("hides events at/after max age (default 24h)", () => {
    const event = limitEvent({ at: base });
    expect(PROCESS_LIMIT_CALLOUT_MAX_AGE_MINUTES).toBe(24 * 60);
    expect(
      shouldShowProcessLimitCallout({
        event,
        now: base + PROCESS_LIMIT_CALLOUT_MAX_AGE_MINUTES * 60_000,
      }),
    ).toBe(false);
    expect(
      shouldShowProcessLimitCallout({
        event,
        now: base + (PROCESS_LIMIT_CALLOUT_MAX_AGE_MINUTES + 1) * 60_000,
      }),
    ).toBe(false);
    // Custom shorter window
    expect(
      shouldShowProcessLimitCallout({
        event,
        now: base + 10 * 60_000,
        maxAgeMinutes: 5,
      }),
    ).toBe(false);
  });
});
