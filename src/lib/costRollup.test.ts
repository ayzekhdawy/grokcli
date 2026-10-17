import { describe, expect, it } from "vitest";
import {
  aggregateCostRollup,
  applyClearCostUsageSamplesPlan,
  buildCostRollupView,
  classifyCostRollupExportError,
  clearCostUsageSamples,
  costRollupExportOutcomeMessageKey,
  dayKeyFromIso,
  dayKeyFromMs,
  dedupeUsageSamples,
  extractKnownUsageFromJournalMessages,
  filterCostUsageSamples,
  finiteTokenCount,
  formatCostRollupExport,
  formatRollupEstimatedCost,
  formatRollupTokens,
  hasActiveCostRollupScopeFilter,
  listCostRollupProjectChips,
  listCostRollupSessionChips,
  loadCostUsageSamples,
  mergeCostRollupPrecision,
  parseCostUsageSample,
  planClearCostUsageSamples,
  recordCostUsageSample,
  resolveCostRollupEmptyState,
  resolveCostRollupExportOutcome,
  sampleFromUsageEvent,
  samplesFromLiveUsageMap,
  sinceDayDaysAgo,
  type CostUsageSample,
} from "./costRollup";

function memStorage(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

describe("finiteTokenCount / day keys", () => {
  it("rejects negative and non-finite", () => {
    expect(finiteTokenCount(null)).toBe(null);
    expect(finiteTokenCount(-1)).toBe(null);
    expect(finiteTokenCount(Number.NaN)).toBe(null);
    expect(finiteTokenCount(12.9)).toBe(12);
  });

  it("formats day keys", () => {
    // 2026-04-06T12:00:00.000Z
    const ms = Date.parse("2026-04-06T12:00:00.000Z");
    expect(dayKeyFromMs(ms, true)).toBe("2026-04-06");
    expect(dayKeyFromIso("2026-04-06T15:30:00.000Z", true)).toBe(
      "2026-04-06",
    );
    expect(dayKeyFromIso("2026-04-06")).toBe("2026-04-06");
    expect(dayKeyFromIso("")).toBe(null);
  });
});

describe("formatRollupTokens", () => {
  it("shows em dash when unknown", () => {
    expect(formatRollupTokens(null)).toBe("—");
    expect(formatRollupTokens(-1)).toBe("—");
  });

  it("uses coarse units", () => {
    expect(formatRollupTokens(42)).toBe("42");
    expect(formatRollupTokens(1500)).toBe("1.5k");
    expect(formatRollupTokens(12_400)).toBe("12k");
    expect(formatRollupTokens(2_500_000)).toBe("2.50M");
  });
});

describe("formatRollupEstimatedCost / mergeCostRollupPrecision", () => {
  it("always prefixes ~ for estimate/partial and never fakes none", () => {
    expect(formatRollupEstimatedCost(1.25, "estimate")).toBe("~$1.25");
    expect(formatRollupEstimatedCost(0.5, "partial")).toBe("~$0.5");
    expect(formatRollupEstimatedCost(1.25, "none")).toBe("—");
    expect(formatRollupEstimatedCost(null, "estimate")).toBe("—");
  });

  it("merges precision with unknown-session honesty", () => {
    expect(mergeCostRollupPrecision(["estimate", "estimate"])).toBe(
      "estimate",
    );
    expect(mergeCostRollupPrecision(["estimate", "partial"])).toBe(
      "partial",
    );
    // Some rows have $ rates, others only tokens → overall partial.
    expect(mergeCostRollupPrecision(["estimate", "none"])).toBe("partial");
    expect(mergeCostRollupPrecision(["none", "none"])).toBe("none");
    expect(
      mergeCostRollupPrecision(["estimate"], { hasUnknownSessions: true }),
    ).toBe("partial");
    expect(
      mergeCostRollupPrecision(["none"], { hasUnknownSessions: true }),
    ).toBe("none");
  });
});

describe("sampleFromUsageEvent", () => {
  it("returns null without session or tokens", () => {
    expect(
      sampleFromUsageEvent({ sessionId: "", totalTokens: 10 }),
    ).toBe(null);
    expect(
      sampleFromUsageEvent({ sessionId: "s1" }),
    ).toBe(null);
  });

  it("builds a known sample with derived total", () => {
    const s = sampleFromUsageEvent({
      sessionId: "s1",
      projectId: "p1",
      projectName: "Demo",
      modelId: "grok-4.5",
      inputTokens: 100,
      outputTokens: 20,
      at: "2026-04-06T10:00:00.000Z",
      utc: true,
    });
    expect(s).toMatchObject({
      sessionId: "s1",
      projectId: "p1",
      day: "2026-04-06",
      totalTokens: 120,
      source: "usage",
    });
  });

  it("does not invent zeros for empty usage", () => {
    expect(
      sampleFromUsageEvent({
        sessionId: "s1",
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      }),
    ).toBe(null);
  });
});

describe("extractKnownUsageFromJournalMessages", () => {
  it("returns null when no compact known tokens", () => {
    expect(
      extractKnownUsageFromJournalMessages(
        [{ id: "1", role: "user", content: "hi" }],
        { sessionId: "s1" },
      ),
    ).toBe(null);
    expect(
      extractKnownUsageFromJournalMessages(
        [
          {
            id: "c",
            role: "tool",
            marker: "context_compact",
            compactMeta: { trigger: "auto" },
          },
        ],
        { sessionId: "s1" },
      ),
    ).toBe(null);
  });

  it("takes latest compact tokensAfter", () => {
    const s = extractKnownUsageFromJournalMessages(
      [
        {
          id: "c1",
          marker: "context_compact",
          compactMeta: { tokensAfter: 1000 },
          createdAt: "2026-04-05T10:00:00.000Z",
        },
        {
          id: "c2",
          marker: "context_compact",
          compactMeta: { tokensAfter: 2500 },
          createdAt: "2026-04-06T10:00:00.000Z",
        },
      ],
      {
        sessionId: "s1",
        projectId: "p1",
        modelId: "grok-3",
        utc: true,
      },
    );
    expect(s?.totalTokens).toBe(2500);
    expect(s?.source).toBe("journal_compact");
    expect(s?.day).toBe("2026-04-06");
  });
});

describe("dedupeUsageSamples", () => {
  it("prefers usage over journal_compact and richer I/O", () => {
    const a: CostUsageSample = {
      sessionId: "s1",
      projectId: "p",
      day: "2026-04-06",
      totalTokens: 100,
      source: "journal_compact",
      at: "2026-04-06T09:00:00.000Z",
    };
    const b: CostUsageSample = {
      sessionId: "s1",
      projectId: "p",
      day: "2026-04-06",
      inputTokens: 80,
      outputTokens: 40,
      totalTokens: 120,
      source: "usage",
      at: "2026-04-06T10:00:00.000Z",
    };
    const out = dedupeUsageSamples([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe("usage");
    expect(out[0]!.totalTokens).toBe(120);
  });
});

describe("aggregateCostRollup", () => {
  const samples: CostUsageSample[] = [
    {
      sessionId: "s1",
      projectId: "p1",
      projectName: "Alpha",
      day: "2026-04-06",
      modelId: "grok-4.5",
      inputTokens: 1_000_000,
      outputTokens: 0,
      totalTokens: 1_000_000,
      source: "usage",
    },
    {
      sessionId: "s2",
      projectId: "p1",
      projectName: "Alpha",
      day: "2026-04-06",
      modelId: "grok-4.5",
      inputTokens: 500_000,
      outputTokens: 0,
      totalTokens: 500_000,
      source: "usage",
    },
    {
      sessionId: "s3",
      projectId: "p2",
      projectName: "Beta",
      day: "2026-04-05",
      modelId: "mystery",
      totalTokens: 10_000,
      source: "usage",
    },
  ];

  it("sums known tokens by project/day and estimates when rates exist", () => {
    const view = aggregateCostRollup({
      samples,
      projects: [
        { id: "p1", name: "Alpha" },
        { id: "p2", name: "Beta" },
      ],
    });
    expect(view.invoiceGrade).toBe(false);
    expect(view.groupBy).toBe("project");
    expect(view.empty).toBe(false);
    expect(view.sessionsKnown).toBe(3);
    // Alpha has $, Beta has tokens without rates → overall partial.
    expect(view.precision).toBe("partial");

    const alpha = view.buckets.find(
      (b) => b.projectId === "p1" && b.day === "2026-04-06",
    );
    expect(alpha?.totalTokens).toBe(1_500_000);
    expect(alpha?.estimatedUsd).toBeCloseTo(4.5, 6); // 1.5M * $3/1M input
    expect(alpha?.precision).toBe("estimate");
    expect(alpha?.sessionsKnown).toBe(2);
    expect(alpha?.sessionId).toBe(null);

    const beta = view.buckets.find(
      (b) => b.projectId === "p2" && b.day === "2026-04-05",
    );
    expect(beta?.totalTokens).toBe(10_000);
    expect(beta?.estimatedUsd).toBe(null); // unknown model rates
    expect(beta?.precision).toBe("none");
  });

  it("groups by session × day when groupBy=session", () => {
    const view = aggregateCostRollup({
      samples,
      sessions: [
        { id: "s1", projectId: "p1", title: "Chat A" },
        { id: "s2", projectId: "p1", title: "Chat B" },
        { id: "s3", projectId: "p2", title: "Chat C" },
      ],
      projects: [
        { id: "p1", name: "Alpha" },
        { id: "p2", name: "Beta" },
      ],
      groupBy: "session",
    });
    expect(view.groupBy).toBe("session");
    expect(view.buckets).toHaveLength(3);
    const a = view.buckets.find((b) => b.sessionId === "s1");
    expect(a?.sessionTitle).toBe("Chat A");
    expect(a?.projectName).toBe("Alpha");
    expect(a?.totalTokens).toBe(1_000_000);
    expect(a?.sessionsKnown).toBe(1);
    const chatB = view.buckets.find((row) => row.sessionId === "s2");
    expect(chatB?.totalTokens).toBe(500_000);
  });

  it("marks sessions without samples as unknown (not zero)", () => {
    const view = aggregateCostRollup({
      samples: [samples[0]!],
      sessions: [
        {
          id: "s1",
          projectId: "p1",
          updatedAt: "2026-04-06T12:00:00.000Z",
        },
        {
          id: "s-missing",
          projectId: "p1",
          updatedAt: "2026-04-06T13:00:00.000Z",
        },
      ],
      utc: true,
    });
    const alpha = view.buckets.find(
      (b) => b.projectId === "p1" && b.day === "2026-04-06",
    );
    expect(alpha?.sessionsKnown).toBe(1);
    expect(alpha?.sessionsUnknown).toBe(1);
    // Dollars present but unknown sessions → partial estimate quality.
    expect(alpha?.precision).toBe("partial");
    // Tokens stay known-only — do not invent for s-missing.
    expect(alpha?.totalTokens).toBe(1_000_000);
  });

  it("returns empty when nothing known", () => {
    const view = aggregateCostRollup({ samples: [] });
    expect(view.empty).toBe(true);
    expect(view.totalTokensKnown).toBe(null);
    expect(view.totalEstimatedUsd).toBe(null);
  });

  it("filters sinceDay and caps buckets", () => {
    const view = aggregateCostRollup({
      samples,
      sinceDay: "2026-04-06",
      maxBuckets: 1,
    });
    expect(view.buckets).toHaveLength(1);
    expect(view.buckets[0]!.day).toBe("2026-04-06");
  });
});

describe("live map + buildCostRollupView", () => {
  it("reads known tokens from live usage map", () => {
    const fromLive = samplesFromLiveUsageMap(
      {
        s1: {
          inputTokens: 10,
          outputTokens: 5,
          modelId: "grok-3",
          at: "2026-04-06T08:00:00.000Z",
        },
      },
      {
        sessionMeta: [{ id: "s1", projectId: "p1" }],
        projectMeta: [{ id: "p1", name: "P" }],
        utc: true,
      },
    );
    expect(fromLive).toHaveLength(1);
    expect(fromLive[0]!.totalTokens).toBe(15);
    expect(fromLive[0]!.projectId).toBe("p1");

    const view = buildCostRollupView({
      liveMap: {
        s1: {
          totalTokens: 99,
          at: "2026-04-06T08:00:00.000Z",
          modelId: "grok-3",
        },
      },
      sessions: [{ id: "s1", projectId: "p1", modelId: "grok-3" }],
      projects: [{ id: "p1", name: "P" }],
      utc: true,
    });
    expect(view.totalTokensKnown).toBe(99);
  });
});

describe("storage ring", () => {
  it("records, loads, clears samples", () => {
    const storage = memStorage();
    const sample = sampleFromUsageEvent({
      sessionId: "s1",
      totalTokens: 42,
      at: "2026-04-06T00:00:00.000Z",
      utc: true,
    })!;
    recordCostUsageSample(sample, storage);
    const loaded = loadCostUsageSamples(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.totalTokens).toBe(42);

    // Upsert same session+day with richer data.
    recordCostUsageSample(
      sampleFromUsageEvent({
        sessionId: "s1",
        inputTokens: 30,
        outputTokens: 20,
        at: "2026-04-06T01:00:00.000Z",
        utc: true,
      }),
      storage,
    );
    const again = loadCostUsageSamples(storage);
    expect(again).toHaveLength(1);
    expect(again[0]!.inputTokens).toBe(30);

    clearCostUsageSamples(storage);
    expect(loadCostUsageSamples(storage)).toEqual([]);
  });

  it("parseCostUsageSample rejects junk", () => {
    expect(parseCostUsageSample(null)).toBe(null);
    expect(parseCostUsageSample({ sessionId: "x" })).toBe(null);
    expect(
      parseCostUsageSample({
        sessionId: "x",
        totalTokens: 1,
        day: "2026-01-01",
        source: "usage",
        at: "2026-01-01T00:00:00.000Z",
      })?.totalTokens,
    ).toBe(1);
  });
});

describe("sinceDayDaysAgo", () => {
  it("returns inclusive window start", () => {
    const now = Date.parse("2026-04-10T15:00:00.000Z");
    expect(sinceDayDaysAgo(1, now, true)).toBe("2026-04-10");
    expect(sinceDayDaysAgo(3, now, true)).toBe("2026-04-08");
  });
});

describe("formatCostRollupExport", () => {
  it("exports empty view with disclaimer", () => {
    const view = aggregateCostRollup({ samples: [] });
    const text = formatCostRollupExport(view, { days: 14 });
    expect(text).toContain("Cost rollup summary");
    expect(text).toContain("never invoice-grade");
    expect(text).toContain("No known usage");
    expect(text).toContain("Window: last 14 day(s)");
    expect(text).toContain("Group by: project × day");
  });

  it("lists project buckets with ~ estimates", () => {
    const view = aggregateCostRollup({
      samples: [
        {
          sessionId: "s1",
          projectId: "p1",
          projectName: "Alpha",
          day: "2026-04-06",
          modelId: "grok-4.5",
          inputTokens: 1_000_000,
          outputTokens: 0,
          totalTokens: 1_000_000,
          source: "usage",
        },
      ],
      projects: [{ id: "p1", name: "Alpha" }],
    });
    const text = formatCostRollupExport(view, {
      days: 7,
      generatedAt: "2026-04-10T00:00:00.000Z",
    });
    expect(text).toContain("Generated: 2026-04-10T00:00:00.000Z");
    expect(text).toContain("2026-04-06 · Alpha");
    expect(text).toMatch(/Est\. cost: ~\$/);
    expect(text).toContain("estimate");
    expect(text).not.toMatch(/Est\. cost: \$[0-9]/); // must be ~$ not bare $
  });

  it("lists session grain with titles", () => {
    const view = aggregateCostRollup({
      samples: [
        {
          sessionId: "s1",
          projectId: "p1",
          projectName: "Alpha",
          day: "2026-04-06",
          modelId: "mystery",
          totalTokens: 1000,
          source: "usage",
        },
      ],
      sessions: [{ id: "s1", projectId: "p1", title: "Debug loop" }],
      groupBy: "session",
    });
    const text = formatCostRollupExport(view);
    expect(text).toContain("Group by: session × day");
    expect(text).toContain("Debug loop");
    expect(text).toContain("Alpha");
    // unknown rates → no $ invent
    expect(text).toMatch(/Est\. cost: —/);
  });
});

describe("filterCostUsageSamples / chips / empty honesty", () => {
  const samples: CostUsageSample[] = [
    {
      sessionId: "s1",
      projectId: "p1",
      projectName: "Alpha",
      day: "2026-04-06",
      totalTokens: 100,
      source: "usage",
    },
    {
      sessionId: "s2",
      projectId: "p2",
      projectName: "Beta",
      day: "2026-04-05",
      totalTokens: 50,
      source: "usage",
    },
    {
      sessionId: "s3",
      projectId: null,
      day: "2026-04-06",
      totalTokens: 10,
      source: "usage",
    },
  ];

  it("filters by session, project, noProject, and day window", () => {
    expect(
      filterCostUsageSamples(samples, { sessionId: "s1" }).map((s) => s.sessionId),
    ).toEqual(["s1"]);
    expect(
      filterCostUsageSamples(samples, { projectId: "p2" }).map((s) => s.sessionId),
    ).toEqual(["s2"]);
    expect(
      filterCostUsageSamples(samples, { noProject: true }).map((s) => s.sessionId),
    ).toEqual(["s3"]);
    expect(
      filterCostUsageSamples(samples, {
        sinceDay: "2026-04-06",
        untilDay: "2026-04-06",
      }),
    ).toHaveLength(2);
    expect(filterCostUsageSamples(samples, null)).toHaveLength(3);
  });

  it("hasActiveCostRollupScopeFilter ignores empty ids", () => {
    expect(hasActiveCostRollupScopeFilter({})).toBe(false);
    expect(hasActiveCostRollupScopeFilter({ projectId: "  " })).toBe(false);
    expect(hasActiveCostRollupScopeFilter({ projectId: "p1" })).toBe(true);
    expect(hasActiveCostRollupScopeFilter({ noProject: true })).toBe(true);
    expect(hasActiveCostRollupScopeFilter({ sessionId: "s1" })).toBe(true);
  });

  it("lists project and session chips with all + orphan", () => {
    const projectChips = listCostRollupProjectChips(samples, [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" },
    ]);
    expect(projectChips[0]!.id).toBe("all");
    expect(projectChips[0]!.count).toBe(3);
    expect(projectChips.some((c) => c.id === "p1" && c.count === 1)).toBe(true);
    expect(projectChips.some((c) => c.id === "noproject" && c.count === 1)).toBe(
      true,
    );

    const sessionChips = listCostRollupSessionChips(
      samples,
      [{ id: "s1", title: "Chat A" }],
      10,
    );
    expect(sessionChips[0]!.id).toBe("all");
    expect(sessionChips.some((c) => c.id === "s1" && c.label === "Chat A")).toBe(
      true,
    );
  });

  it("aggregateCostRollup respects projectId / sessionId / untilDay", () => {
    const byProject = aggregateCostRollup({
      samples,
      projectId: "p1",
      projects: [{ id: "p1", name: "Alpha" }],
    });
    expect(byProject.buckets).toHaveLength(1);
    expect(byProject.totalTokensKnown).toBe(100);

    const bySession = aggregateCostRollup({
      samples,
      sessionId: "s2",
      groupBy: "session",
    });
    expect(bySession.buckets).toHaveLength(1);
    expect(bySession.buckets[0]!.sessionId).toBe("s2");

    const until = aggregateCostRollup({
      samples,
      untilDay: "2026-04-05",
    });
    expect(until.totalTokensKnown).toBe(50);
  });

  it("resolveCostRollupEmptyState distinguishes no samples / window / filter", () => {
    expect(
      resolveCostRollupEmptyState({
        viewEmpty: false,
        rawSampleCount: 3,
        windowSampleCount: 2,
        filteredSampleCount: 1,
      }),
    ).toBe(null);

    expect(
      resolveCostRollupEmptyState({
        viewEmpty: true,
        rawSampleCount: 0,
        windowSampleCount: 0,
        filteredSampleCount: 0,
      })?.kind,
    ).toBe("no_samples");

    expect(
      resolveCostRollupEmptyState({
        viewEmpty: true,
        rawSampleCount: 5,
        windowSampleCount: 0,
        filteredSampleCount: 0,
      })?.kind,
    ).toBe("empty_window");

    expect(
      resolveCostRollupEmptyState({
        viewEmpty: true,
        rawSampleCount: 5,
        windowSampleCount: 3,
        filteredSampleCount: 0,
        hasScopeFilter: true,
      })?.kind,
    ).toBe("no_matches");
  });
});

describe("clear plan + export soft-fail", () => {
  it("planClearCostUsageSamples requires confirm only when non-empty", () => {
    const empty = planClearCostUsageSamples([]);
    expect(empty.count).toBe(0);
    expect(empty.confirmNeeded).toBe(false);
    expect(empty.logMeta).toBe(null);

    const plan = planClearCostUsageSamples([
      {
        sessionId: "s1",
        projectId: "p1",
        day: "2026-04-06",
        totalTokens: 1,
        source: "usage",
      },
      {
        sessionId: "s2",
        projectId: null,
        day: "2026-04-06",
        totalTokens: 2,
        source: "usage",
      },
    ]);
    expect(plan.count).toBe(2);
    expect(plan.confirmNeeded).toBe(true);
    expect(plan.sessionIds).toEqual(["s1", "s2"]);
    expect(plan.projectIds).toEqual(["p1"]);
    expect(plan.next).toEqual([]);
  });

  it("applyClearCostUsageSamplesPlan wipes storage", () => {
    const storage = memStorage();
    recordCostUsageSample(
      sampleFromUsageEvent({
        sessionId: "s1",
        totalTokens: 9,
        at: "2026-04-06T00:00:00.000Z",
        utc: true,
      }),
      storage,
    );
    const plan = planClearCostUsageSamples(loadCostUsageSamples(storage));
    expect(plan.count).toBe(1);
    applyClearCostUsageSamplesPlan(plan, storage);
    expect(loadCostUsageSamples(storage)).toEqual([]);
  });

  it("classifies export errors and resolves outcomes honestly", () => {
    expect(classifyCostRollupExportError(new Error("clipboard blocked"))).toBe(
      "clipboard",
    );
    expect(classifyCostRollupExportError(new Error("download failed"))).toBe(
      "download_failed",
    );
    expect(classifyCostRollupExportError(new Error("nothing to export"))).toBe(
      "empty",
    );
    expect(classifyCostRollupExportError(new Error("weird boom"))).toBe("other");

    expect(
      resolveCostRollupExportOutcome({
        channel: "copy",
        empty: true,
        copyOk: true,
      }),
    ).toEqual({ ok: false, kind: "empty", channel: "copy" });

    expect(
      resolveCostRollupExportOutcome({
        channel: "copy",
        empty: false,
        copyOk: false,
      }),
    ).toEqual({ ok: false, kind: "clipboard", channel: "copy" });

    expect(
      resolveCostRollupExportOutcome({
        channel: "download",
        empty: false,
        error: new Error("blob save failed"),
      }).ok,
    ).toBe(false);

    const okCopy = resolveCostRollupExportOutcome({
      channel: "copy",
      empty: false,
      copyOk: true,
    });
    expect(okCopy).toEqual({ ok: true, channel: "copy" });
    expect(costRollupExportOutcomeMessageKey(okCopy)).toBe(
      "costRollup.exportCopied",
    );
    expect(
      costRollupExportOutcomeMessageKey({
        ok: false,
        kind: "empty",
        channel: "download",
      }),
    ).toBe("costRollup.exportEmpty");
    expect(
      costRollupExportOutcomeMessageKey({
        ok: false,
        kind: "download_failed",
        channel: "download",
      }),
    ).toBe("costRollup.exportDownloadFailed");
  });
});
