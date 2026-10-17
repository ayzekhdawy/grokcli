import { describe, expect, it } from "vitest";
import type { BatchDispatchItemResult } from "./batchAgents";
import {
  applyBatchTemplate,
  classifyBatchResultRow,
  DEFAULT_BATCH_TEMPLATES,
  exportBatchResultsSummary,
  getBatchTemplate,
  isBatchTemplateId,
  planBatchExport,
  summarizeBatchEligibility,
} from "./batchAgentsPro";

const sampleItems: BatchDispatchItemResult[] = [
  {
    projectId: "a",
    projectName: "Alpha",
    projectPath: "/a",
    status: "ok",
    summary: "looks good",
  },
  {
    projectId: "b",
    projectName: "Beta",
    projectPath: "/b",
    status: "ok",
    summary: null,
  },
  {
    projectId: "c",
    projectName: "Gamma",
    projectPath: "/c",
    status: "soft_fail",
    reason: "timeout",
    summary: "timed out",
  },
  {
    projectId: "d",
    projectName: "Delta",
    projectPath: "/d",
    status: "skipped",
    reason: "untrusted",
  },
];

describe("DEFAULT_BATCH_TEMPLATES", () => {
  it("has three honest templates with i18n keys", () => {
    expect(DEFAULT_BATCH_TEMPLATES).toHaveLength(3);
    const ids = DEFAULT_BATCH_TEMPLATES.map((t) => t.id).sort();
    expect(ids).toEqual(["code_review", "fix_tests", "summarize"].sort());
    for (const t of DEFAULT_BATCH_TEMPLATES) {
      expect(t.titleKey.startsWith("batchAgents.tpl.")).toBe(true);
      expect(t.bodyKey.startsWith("batchAgents.tpl.")).toBe(true);
      expect(t.titleKey.endsWith(".title")).toBe(true);
      expect(t.bodyKey.endsWith(".body")).toBe(true);
    }
  });

  it("isBatchTemplateId / getBatchTemplate gate unknowns", () => {
    expect(isBatchTemplateId("code_review")).toBe(true);
    expect(isBatchTemplateId("nope")).toBe(false);
    expect(getBatchTemplate("fix_tests")?.id).toBe("fix_tests");
    expect(getBatchTemplate("missing")).toBeNull();
    expect(getBatchTemplate(null)).toBeNull();
  });
});

describe("applyBatchTemplate", () => {
  it("replaces {project} when name provided", () => {
    expect(applyBatchTemplate("Review {project} risks", "Alpha")).toBe(
      "Review Alpha risks",
    );
    expect(applyBatchTemplate("A {project} / {project}", "X")).toBe("A X / X");
  });

  it("leaves placeholder when no project name", () => {
    expect(applyBatchTemplate("Review {project}", null)).toBe(
      "Review {project}",
    );
    expect(applyBatchTemplate("  hello  ")).toBe("hello");
    expect(applyBatchTemplate("   ")).toBe("");
    expect(applyBatchTemplate(null)).toBe("");
  });
});

describe("classifyBatchResultRow", () => {
  it("marks ok without summary as ok_empty", () => {
    const row = classifyBatchResultRow(sampleItems[1]);
    expect(row.kind).toBe("ok_empty");
    expect(row.terminal).toBe(true);
    expect(row.note).toBe("no_detail");
  });

  it("keeps ok with detail", () => {
    const row = classifyBatchResultRow(sampleItems[0]);
    expect(row.kind).toBe("ok");
    expect(row.hasDetail).toBe(true);
  });

  it("classifies soft_fail / skipped / empty", () => {
    expect(classifyBatchResultRow(sampleItems[2]).kind).toBe("soft_fail");
    expect(classifyBatchResultRow(sampleItems[3]).kind).toBe("skipped");
    expect(classifyBatchResultRow(null).kind).toBe("pending");
    expect(classifyBatchResultRow(null).note).toBe("empty_row");
  });

  it("flags partial soft_fail when reason says partial", () => {
    const row = classifyBatchResultRow({
      projectId: "p",
      projectName: "P",
      projectPath: "/p",
      status: "soft_fail",
      reason: "partial",
      summary: "got some output",
    });
    expect(row.kind).toBe("partial");
  });
});

describe("exportBatchResultsSummary / planBatchExport", () => {
  it("builds a matrix with empty-detail honesty", () => {
    const text = exportBatchResultsSummary(sampleItems, undefined, {
      mode: "headless",
      prompt: "review todos",
    });
    expect(text).toContain("Alpha");
    expect(text).toContain("Beta");
    expect(text).toContain("Results matrix");
    expect(text).toMatch(/ok \(no detail\)|no detail/i);
    expect(text).toContain("soft-fail");
    expect(text).toContain("untrusted");
  });

  it("soft-fails empty export plans", () => {
    expect(planBatchExport(null).ok).toBe(false);
    const empty = planBatchExport([]);
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.reason).toBe("empty");
      expect(empty.filename).toBeNull();
    }
    expect(exportBatchResultsSummary(null)).toMatch(/no batch results/i);
  });

  it("plans a downloadable export with counts", () => {
    const plan = planBatchExport(sampleItems, undefined, {
      mode: "sessions",
      prompt: "go",
      now: new Date(2026, 6, 31, 14, 5),
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.rowCount).toBe(4);
      expect(plan.okCount).toBe(2);
      expect(plan.softFail).toBe(1);
      expect(plan.skipped).toBe(1);
      expect(plan.emptyDetail).toBe(1);
      expect(plan.filename).toBe("batch-agents-20260731-1405.txt");
      expect(plan.text.length).toBeGreaterThan(20);
    }
  });

  it("accepts a BatchDispatchSummary object", () => {
    const plan = planBatchExport({
      mode: "sessions",
      promptPreview: "x",
      total: 1,
      ok: 1,
      softFail: 0,
      error: 0,
      skipped: 0,
      queued: 0,
      items: [sampleItems[0]!],
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.rowCount).toBe(1);
  });
});

describe("summarizeBatchEligibility", () => {
  it("tallies skip reasons", () => {
    const c = summarizeBatchEligibility({
      selectedCount: 4,
      eligibleCount: 2,
      skipped: [
        { reason: "untrusted" },
        { reason: "untrusted" },
        { reason: "path_missing" },
      ],
    });
    expect(c.selected).toBe(4);
    expect(c.eligible).toBe(2);
    expect(c.skipped).toBe(3);
    expect(c.byReason.untrusted).toBe(2);
    expect(c.byReason.path_missing).toBe(1);
  });
});
