import { describe, expect, it } from "vitest";
import {
  BATCH_AGENTS_MAX_PROJECTS,
  buildBatchDispatchPlan,
  buildBatchPromptBody,
  buildBatchSessionTitle,
  canDispatchBatch,
  classifyBatchError,
  evaluateBatchProject,
  filterBatchProjects,
  formatBatchSummaryText,
  isBatchDispatchMode,
  isBatchPromptReady,
  mapHeadlessHostResult,
  normalizeBatchPrompt,
  pruneBatchProjectSelection,
  seedBatchResultRows,
  skipReasonToResult,
  summarizeBatchResults,
  toggleBatchProjectSelection,
  truncateBatchText,
  upsertBatchResultItem,
  type BatchProjectInput,
} from "./batchAgents";

const projs: BatchProjectInput[] = [
  {
    id: "a",
    name: "Alpha",
    path: "/Users/me/alpha",
    trusted: true,
    pathOk: true,
  },
  {
    id: "b",
    name: "Beta",
    path: "/Users/me/beta",
    trusted: false,
    pathOk: true,
  },
  {
    id: "c",
    name: "Gamma",
    path: "/Users/me/gamma",
    trusted: true,
    pathOk: false,
  },
  {
    id: "sys",
    name: "General",
    path: "/tmp/general",
    trusted: true,
    pathOk: true,
    system: true,
  },
];

describe("normalizeBatchPrompt / isBatchPromptReady", () => {
  it("trims and detects empty", () => {
    expect(normalizeBatchPrompt("  hello  ")).toBe("hello");
    expect(normalizeBatchPrompt(null)).toBe("");
    expect(isBatchPromptReady("  x ")).toBe(true);
    expect(isBatchPromptReady("   ")).toBe(false);
  });
});

describe("isBatchDispatchMode", () => {
  it("accepts only sessions | headless", () => {
    expect(isBatchDispatchMode("sessions")).toBe(true);
    expect(isBatchDispatchMode("headless")).toBe(true);
    expect(isBatchDispatchMode("other")).toBe(false);
    expect(isBatchDispatchMode(null)).toBe(false);
  });
});

describe("evaluateBatchProject", () => {
  it("accepts trusted path-ok projects", () => {
    expect(evaluateBatchProject(projs[0])).toEqual({
      ok: true,
      projectId: "a",
    });
  });

  it("rejects untrusted, missing path, system, empty", () => {
    expect(evaluateBatchProject(projs[1])).toMatchObject({
      ok: false,
      reason: "untrusted",
    });
    expect(evaluateBatchProject(projs[2])).toMatchObject({
      ok: false,
      reason: "path_missing",
    });
    expect(evaluateBatchProject(projs[3])).toMatchObject({
      ok: false,
      reason: "system_project",
    });
    expect(evaluateBatchProject({ id: "", name: "x", path: "/p" })).toMatchObject(
      { reason: "empty_id" },
    );
    expect(
      evaluateBatchProject({ id: "z", name: "z", path: "  " }),
    ).toMatchObject({ reason: "empty_path" });
    expect(evaluateBatchProject(null)).toMatchObject({ reason: "empty_id" });
  });

  it("accepts a trusted SSH remote even if local pathOk is false", () => {
    expect(
      evaluateBatchProject({
        id: "ssh",
        name: "UTS:work",
        path: "/data/work",
        trusted: true,
        pathOk: false,
        sshAlias: "UTS",
      }),
    ).toEqual({ ok: true, projectId: "ssh" });
  });
});

describe("filterBatchProjects", () => {
  it("filters by name/path and drops system", () => {
    expect(filterBatchProjects(projs, "").map((p) => p.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(filterBatchProjects(projs, "beta").map((p) => p.id)).toEqual([
      "b",
    ]);
    expect(filterBatchProjects(projs, "gamma").map((p) => p.id)).toEqual([
      "c",
    ]);
    expect(filterBatchProjects(projs, "nope")).toEqual([]);
  });
});

describe("selection helpers", () => {
  it("toggles and prunes", () => {
    let s = new Set<string>();
    s = toggleBatchProjectSelection(s, "a");
    expect([...s]).toEqual(["a"]);
    s = toggleBatchProjectSelection(s, "a");
    expect([...s]).toEqual([]);
    s = new Set(["a", "gone"]);
    s = pruneBatchProjectSelection(s, new Set(["a"]));
    expect([...s]).toEqual(["a"]);
  });
});

describe("buildBatchDispatchPlan", () => {
  it("requires prompt and eligible projects", () => {
    const empty = buildBatchDispatchPlan({
      mode: "sessions",
      prompt: "  ",
      projects: projs,
      selectedIds: new Set(["a"]),
    });
    expect(empty.promptOk).toBe(false);
    expect(empty.canDispatch).toBe(false);

    const plan = buildBatchDispatchPlan({
      mode: "headless",
      prompt: "fix the TODOs",
      projects: projs,
      selectedIds: new Set(["a", "b", "c"]),
    });
    expect(plan.promptOk).toBe(true);
    expect(plan.eligible.map((p) => p.id)).toEqual(["a"]);
    expect(plan.skipped.map((s) => s.reason).sort()).toEqual([
      "path_missing",
      "untrusted",
    ]);
    expect(plan.canDispatch).toBe(true);
  });

  it("caps eligible at max and marks over_limit", () => {
    const many: BatchProjectInput[] = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      path: `/p/${i}`,
      trusted: true,
      pathOk: true,
    }));
    const plan = buildBatchDispatchPlan({
      mode: "sessions",
      prompt: "go",
      projects: many,
      selectedIds: new Set(many.map((p) => p.id)),
      maxProjects: 2,
    });
    expect(plan.eligible).toHaveLength(2);
    expect(plan.skipped.filter((s) => s.reason === "over_limit")).toHaveLength(
      3,
    );
    expect(plan.overLimit).toBe(true);
  });

  it("default max is BATCH_AGENTS_MAX_PROJECTS", () => {
    expect(BATCH_AGENTS_MAX_PROJECTS).toBeGreaterThanOrEqual(8);
  });
});

describe("buildBatchSessionTitle / buildBatchPromptBody", () => {
  it("builds title and optional header body", () => {
    expect(buildBatchSessionTitle("  hello world  ")).toMatch(/^Batch: hello/);
    expect(buildBatchSessionTitle("")).toBe("Batch");
    expect(buildBatchPromptBody("do it", { projectName: "Alpha" })).toBe(
      "[Batch · Alpha]\n\ndo it",
    );
    expect(buildBatchPromptBody("do it", { header: false })).toBe("do it");
    expect(buildBatchPromptBody("  ")).toBe("");
  });
});

describe("truncateBatchText", () => {
  it("collapses whitespace and truncates", () => {
    expect(truncateBatchText("a\n\nb", 10)).toBe("a b");
    expect(truncateBatchText("x".repeat(50), 10).endsWith("…")).toBe(true);
    expect(truncateBatchText(null)).toBe("");
  });
});

describe("summarize / format / seed / upsert", () => {
  it("aggregates counts and formats text", () => {
    const items = [
      skipReasonToResult(projs[1]!, "untrusted"),
      {
        projectId: "a",
        projectName: "Alpha",
        projectPath: "/a",
        status: "ok" as const,
        sessionId: "s1",
        summary: "done",
      },
      {
        projectId: "x",
        projectName: "X",
        projectPath: "/x",
        status: "soft_fail" as const,
        reason: "timeout",
        summary: "timed out",
      },
    ];
    const sum = summarizeBatchResults({
      mode: "sessions",
      prompt: "fix me",
      items,
    });
    expect(sum.ok).toBe(1);
    expect(sum.softFail).toBe(1);
    expect(sum.skipped).toBe(1);
    expect(sum.total).toBe(3);
    const text = formatBatchSummaryText(sum);
    expect(text).toContain("ok 1");
    expect(text).toContain("Alpha");
    expect(text).toContain("soft-fail");
  });

  it("seeds pending rows from plan", () => {
    const plan = buildBatchDispatchPlan({
      mode: "sessions",
      prompt: "hi",
      projects: projs,
      selectedIds: new Set(["a", "b"]),
    });
    const rows = seedBatchResultRows(plan);
    expect(rows.find((r) => r.projectId === "a")?.status).toBe("pending");
    expect(rows.find((r) => r.projectId === "b")?.status).toBe("skipped");
  });

  it("upserts by projectId", () => {
    const a = {
      projectId: "a",
      projectName: "A",
      projectPath: "/a",
      status: "pending" as const,
    };
    const next = upsertBatchResultItem([a], {
      ...a,
      status: "ok",
      sessionId: "s",
    });
    expect(next).toHaveLength(1);
    expect(next[0]!.status).toBe("ok");
    const withNew = upsertBatchResultItem(next, {
      projectId: "b",
      projectName: "B",
      projectPath: "/b",
      status: "error",
    });
    expect(withNew).toHaveLength(2);
  });
});

describe("canDispatchBatch", () => {
  it("gates on prompt, count, running", () => {
    expect(canDispatchBatch({ prompt: "x", eligibleCount: 1 })).toBe(true);
    expect(canDispatchBatch({ prompt: "", eligibleCount: 1 })).toBe(false);
    expect(canDispatchBatch({ prompt: "x", eligibleCount: 0 })).toBe(false);
    expect(
      canDispatchBatch({ prompt: "x", eligibleCount: 1, running: true }),
    ).toBe(false);
  });
});

describe("classifyBatchError", () => {
  it("maps common soft-fail codes", () => {
    expect(classifyBatchError("CLI_NOT_FOUND: missing").reason).toBe(
      "cli_missing",
    );
    expect(classifyBatchError("PROCESS_LIMIT: full").reason).toBe(
      "process_limit",
    );
    expect(classifyBatchError(new Error("connect failed")).status).toBe(
      "soft_fail",
    );
    expect(classifyBatchError("weird boom").status).toBe("error");
  });
});

describe("mapHeadlessHostResult", () => {
  it("maps ok and soft-fail host DTOs", () => {
    const ok = mapHeadlessHostResult(projs[0]!, {
      ok: true,
      text: "hello",
      durationMs: 12,
    });
    expect(ok.status).toBe("ok");
    expect(ok.summary).toBe("hello");

    const fail = mapHeadlessHostResult(projs[0]!, {
      ok: false,
      reason: "timeout",
      text: null,
    });
    expect(fail.status).toBe("soft_fail");
    expect(fail.reason).toBe("timeout");
  });
});
