import { describe, expect, it } from "vitest";
import {
  INITIAL_CONTEXT_USAGE,
  knownUsageTotalIsOccupancy,
  isLikelyBillingAggregateUsage,
  isOccupancyUsageSource,
  contextPercentCliStyle,
  reduceContextUsage,
  resolveContextUsageDisplay,
  resolveContextUsageSurface,
  resolveOccupancyPercent,
  resolveOccupancyWindow,
  isContextCompactContent,
  isContextCompactMessage,
  saveSessionUsageSnapshot,
  loadSessionUsageSnapshot,
  clearSessionUsageSnapshot,
  restoreContextUsageForSession,
} from "./contextUsage";

describe("session usage snapshot (localStorage-backed)", () => {
  function mockStorage(): Storage {
    const store = new Map<string, string>();
    return {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (k: string) => store.get(k) ?? null,
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      removeItem: (k: string) => {
        store.delete(k);
      },
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    } as Storage;
  }

  it("saves and loads a per-session snapshot", () => {
    const st = mockStorage();
    saveSessionUsageSnapshot(
      "sess-1",
      {
        totalTokens: 780_341,
        inputTokens: 775_187,
        outputTokens: 5_000,
        systemTokens: null,
        toolsTokens: null,
        historyTokens: null,
        cachedReadTokens: 600_000,
        costUsdTicks: null,
        source: "turn_completed",
      },
      st,
    );
    const snap = loadSessionUsageSnapshot("sess-1", st);
    expect(snap?.totalTokens).toBe(780_341);
    expect(snap?.source).toBe("turn_completed");
    expect(snap?.updatedAt).toBeGreaterThan(0);
    // Other sessions unaffected.
    expect(loadSessionUsageSnapshot("sess-2", st)).toBeNull();
  });

  it("overwrites on newer event and clears on demand", () => {
    const st = mockStorage();
    saveSessionUsageSnapshot("sess-1", { totalTokens: 100, inputTokens: null, outputTokens: null, systemTokens: null, toolsTokens: null, historyTokens: null, cachedReadTokens: null, costUsdTicks: null, source: "usage" }, st);
    saveSessionUsageSnapshot("sess-1", { totalTokens: 250, inputTokens: null, outputTokens: null, systemTokens: null, toolsTokens: null, historyTokens: null, cachedReadTokens: null, costUsdTicks: null, source: "compact" }, st);
    expect(loadSessionUsageSnapshot("sess-1", st)?.totalTokens).toBe(250);
    clearSessionUsageSnapshot("sess-1", st);
    expect(loadSessionUsageSnapshot("sess-1", st)).toBeNull();
  });

  it("restoreContextUsageForSession prefers compact markers over snapshot", () => {
    const st = mockStorage();
    saveSessionUsageSnapshot("sess-c", { totalTokens: 900_000, inputTokens: null, outputTokens: null, systemTokens: null, toolsTokens: null, historyTokens: null, cachedReadTokens: null, costUsdTicks: null, source: "turn_completed" }, st);
    // Journal has a compact marker with tokensAfter=12_000 — authoritative.
    const state = restoreContextUsageForSession(
      "sess-c",
      [
        { id: "u", role: "user", content: "hi" },
        { id: "c", role: "tool", content: "context_compact", marker: "context_compact", compactMeta: { tokensAfter: 12_000 } },
      ],
      st,
    );
    expect(state.knownTokens).toBe(12_000);
    // Snapshot still retrievable but not used.
    expect(loadSessionUsageSnapshot("sess-c", st)?.totalTokens).toBe(900_000);
  });

  it("restoreContextUsageForSession keeps billing snapshot off the occupancy ring", () => {
    const st = mockStorage();
    // Real Grok shape: turn_completed multi-call sum must not drive the ring.
    saveSessionUsageSnapshot("sess-n", { totalTokens: 1_701_340, inputTokens: 1_681_484, outputTokens: 19_856, systemTokens: null, toolsTokens: null, historyTokens: null, cachedReadTokens: 1_581_440, costUsdTicks: null, source: "turn_completed" }, st);
    const state = restoreContextUsageForSession(
      "sess-n",
      [{ id: "u", role: "user", content: "hi" }],
      st,
    );
    // Billing fields still available for cache/cost UI.
    expect(state.knownUsage?.totalTokens).toBe(1_701_340);
    expect(state.knownUsage?.source).toBe("turn_completed");
    // Occupancy stays unset — ring falls back to estimate, not 340% of window.
    expect(state.knownTokens).toBeNull();
    const display = resolveContextUsageDisplay(state, [{ id: "u", role: "user", content: "hi" }], "zh", 500_000);
    expect(display.source).toBe("estimated");
    expect(display.tokens).toBeLessThan(100);
    expect((display.percent ?? 0) < 1).toBe(true);
  });

  it("treats prompt_result as billing so occupancy is not overwritten", () => {
    expect(
      isLikelyBillingAggregateUsage({
        source: "prompt_result",
        totalTokens: 1_701_340,
        inputTokens: 1_681_484,
        cachedReadTokens: 1_581_440,
      }),
    ).toBe(true);
  });

  it("context_size occupancy drives the ring; turn_completed billing does not overwrite it", () => {
    let state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "usage",
      totalTokens: 156_385,
      source: "context_size",
    });
    expect(state.knownTokens).toBe(156_385);
    // Agentic turn ends with multi-call billing (19 modelCalls).
    state = reduceContextUsage(state, {
      type: "usage",
      totalTokens: 1_701_340,
      inputTokens: 1_681_484,
      outputTokens: 19_856,
      cachedReadTokens: 1_581_440,
      source: "turn_completed",
    });
    expect(state.knownTokens).toBe(156_385);
    expect(state.knownUsage?.totalTokens).toBe(1_701_340);
    const d = resolveContextUsageDisplay(state, [], "zh", 500_000);
    expect(d.tokens).toBe(156_385);
    expect(d.source).toBe("known");
    // CLI integer %: round(156385/500000*100) = 31
    expect(d.percent).toBe(31);
  });

  it("restores CLI context window + percentage from snapshot", () => {
    const st = mockStorage();
    // auto_compact_started occupancy with CLI denominator + integer %.
    saveSessionUsageSnapshot(
      "sess-w",
      {
        totalTokens: 402_603,
        inputTokens: null,
        outputTokens: null,
        systemTokens: null,
        toolsTokens: null,
        historyTokens: null,
        cachedReadTokens: null,
        costUsdTicks: null,
        contextWindow: 500_000,
        percentage: 81,
        source: "auto_compact_started",
      },
      st,
    );
    const state = restoreContextUsageForSession(
      "sess-w",
      [{ id: "u", role: "user", content: "hi" }],
      st,
    );
    expect(state.knownTokens).toBe(402_603);
    expect(state.agentContextWindow).toBe(500_000);
    expect(state.agentPercentage).toBe(81);
    // Ring % matches the CLI integer, not a catalog-window re-derivation.
    const d = resolveContextUsageDisplay(state, [], "zh", 128_000);
    expect(d.percent).toBe(81);
  });
});

describe("occupancy vs billing classification", () => {
  it("classifies stream meta and turn_completed correctly", () => {
    expect(isOccupancyUsageSource("context_size")).toBe(true);
    expect(isOccupancyUsageSource("auto_compact_started")).toBe(true);
    expect(isOccupancyUsageSource("turn_completed")).toBe(false);
    expect(
      isLikelyBillingAggregateUsage({
        source: "turn_completed",
        totalTokens: 1_701_340,
        inputTokens: 1_681_484,
        cachedReadTokens: 1_581_440,
      }),
    ).toBe(true);
    expect(
      knownUsageTotalIsOccupancy({
        inputTokens: null,
        outputTokens: null,
        totalTokens: 27_148,
        source: "context_size",
      }),
    ).toBe(true);
    expect(
      knownUsageTotalIsOccupancy({
        inputTokens: 1_681_484,
        outputTokens: 19_856,
        totalTokens: 1_701_340,
        cachedReadTokens: 1_581_440,
        source: "turn_completed",
      }),
    ).toBe(false);
  });
});

describe("isContextCompactContent / isContextCompactMessage", () => {
  it("accepts structured journal markers only", () => {
    expect(isContextCompactContent("context_compact")).toBe(true);
    expect(isContextCompactContent("context_compact|manual")).toBe(true);
    expect(
      isContextCompactContent("context_compact|auto|tokens:100->40\nkept"),
    ).toBe(true);
    expect(isContextCompactContent("context_compact\nsummary")).toBe(true);
  });

  it("rejects tool titles that merely contain the word compact", () => {
    expect(
      isContextCompactContent("Execute print('ALL POSTS compact') finished"),
    ).toBe(false);
    expect(isContextCompactContent("context_compaction_report")).toBe(false);
    expect(isContextCompactContent("run compact now")).toBe(false);
    expect(
      isContextCompactMessage({
        role: "tool",
        content: "python print('compact')",
      }),
    ).toBe(false);
  });

  it("honors explicit marker even without content prefix", () => {
    expect(
      isContextCompactMessage({
        marker: "context_compact",
        role: "tool",
        content: "ignored",
      }),
    ).toBe(true);
  });
});

describe("window resolve + display surface (500k honesty)", () => {
  it("resolveOccupancyWindow prefers agent 500k over catalog 200k", () => {
    const state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "usage",
      totalTokens: 100_000,
      contextWindow: 500_000,
      source: "auto_compact_started",
    });
    expect(resolveOccupancyWindow(state, 200_000)).toBe(500_000);
    expect(resolveOccupancyWindow(state, null)).toBe(500_000);
  });

  it("catalog 500k is the ring denominator when agent window unset", () => {
    const state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "usage",
      totalTokens: 156_385,
      source: "context_size",
    });
    expect(resolveOccupancyWindow(state, 500_000)).toBe(500_000);
    const d = resolveContextUsageDisplay(state, [], "zh", 500_000);
    expect(d.windowSize).toBe(500_000);
    expect(d.percent).toBe(31);
    expect(d.source).toBe("known");
    expect(resolveContextUsageSurface(d)).toBe("visible");
  });

  it("empty session surface stays hidden; soft-unknown after compact without counts", () => {
    const empty = resolveContextUsageDisplay(INITIAL_CONTEXT_USAGE, [], "zh", 500_000);
    expect(resolveContextUsageSurface(empty)).toBe("hidden");
    expect(empty.windowSize).toBe(500_000);

    const soft = resolveContextUsageDisplay(
      reduceContextUsage(INITIAL_CONTEXT_USAGE, {
        type: "compact",
        trigger: "manual",
        messageId: "c1",
      }),
      [{ id: "c1", role: "tool", marker: "context_compact" }],
      "zh",
      500_000,
    );
    expect(soft.source).toBe("unknown");
    expect(soft.label).toBe("—");
    expect(resolveContextUsageSurface(soft)).toBe("soft_unknown");
  });

  it("estimated vs known labels stay honest on the display surface", () => {
    const estimated = resolveContextUsageDisplay(
      INITIAL_CONTEXT_USAGE,
      [{ id: "u", role: "user", content: "a".repeat(40) }],
      "zh",
      500_000,
    );
    expect(estimated.source).toBe("estimated");
    expect(estimated.label.startsWith("~")).toBe(true);
    expect(estimated.windowSize).toBe(500_000);

    const known = resolveContextUsageDisplay(
      reduceContextUsage(INITIAL_CONTEXT_USAGE, {
        type: "usage",
        totalTokens: 12_000,
        source: "context_size",
      }),
      [],
      "zh",
      500_000,
    );
    expect(known.source).toBe("known");
    expect(known.label.startsWith("~")).toBe(false);
  });
});

describe("CLI occupancy parity", () => {
  it("matches Grok Build auto_compact_started tokens + %", () => {
    // Live wire: tokens_used 402603 / context_window 500000 → percentage 81
    expect(contextPercentCliStyle(402_603, 500_000)).toBe(81);
    expect(contextPercentCliStyle(400_460, 500_000)).toBe(80);
    expect(contextPercentCliStyle(222_570, 256_000)).toBe(87);

    const state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "usage",
      totalTokens: 402_603,
      contextWindow: 500_000,
      percentage: 81,
      source: "auto_compact_started",
    });
    expect(state.knownTokens).toBe(402_603);
    expect(state.agentContextWindow).toBe(500_000);
    expect(state.agentPercentage).toBe(81);

    const d = resolveContextUsageDisplay(state, [], "zh", 128_000);
    // Prefer agent window over catalog fallback.
    expect(d.windowSize).toBe(500_000);
    expect(d.tokens).toBe(402_603);
    expect(d.source).toBe("known");
    expect(d.percent).toBe(81);
  });

  it("stream context_size uses CLI-style integer % with agent or catalog window", () => {
    let state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "usage",
      totalTokens: 156_385,
      source: "context_size",
    });
    // No agent window yet — catalog 500k → round(31.277%) = 31
    expect(contextPercentCliStyle(156_385, 500_000)).toBe(31);
    let d = resolveContextUsageDisplay(state, [], "zh", 500_000);
    expect(d.percent).toBe(31);

    // Later auto_compact_started refreshes window + integer %
    state = reduceContextUsage(state, {
      type: "usage",
      totalTokens: 402_603,
      contextWindow: 500_000,
      percentage: 81,
      source: "auto_compact_started",
    });
    d = resolveContextUsageDisplay(state, [], "zh", 500_000);
    expect(d.tokens).toBe(402_603);
    expect(d.percent).toBe(81);
    expect(resolveOccupancyPercent(402_603, state, 500_000)).toBe(81);
  });

  it("auto_compact_completed tokens_after replaces occupancy", () => {
    let state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "usage",
      totalTokens: 402_603,
      contextWindow: 500_000,
      percentage: 81,
      source: "auto_compact_started",
    });
    state = reduceContextUsage(state, {
      type: "compact",
      tokensBefore: 402_603,
      tokensAfter: 34_179,
      trigger: "auto",
      messageId: "c1",
    });
    expect(state.knownTokens).toBe(34_179);
    expect(state.agentPercentage).toBeNull();
    expect(state.agentContextWindow).toBe(500_000);
    const d = resolveContextUsageDisplay(
      state,
      [
        {
          id: "c1",
          role: "tool",
          marker: "context_compact",
          compactMeta: { tokensAfter: 34_179 },
        },
      ],
      "zh",
      500_000,
    );
    expect(d.tokens).toBe(34_179);
    expect(d.percent).toBe(contextPercentCliStyle(34_179, 500_000));
  });
});
