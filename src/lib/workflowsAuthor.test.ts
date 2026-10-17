import { describe, expect, it } from "vitest";
import {
  WORKFLOW_RUN_HISTORY_MAX,
  clearWorkflowRunHistory,
  defaultWorkflowTemplate,
  filterWorkflowRunHistory,
  loadWorkflowRunHistory,
  parseWorkflowRunHistory,
  parseWorkflowRunHistoryRecord,
  planCreateWorkflow,
  pushWorkflowRunHistory,
  recordWorkflowRunHistory,
  redactWorkflowRunHistoryLog,
  resolveCreateWorkflowSkillPath,
  resolveWorkflowsAuthorEmptyState,
  sanitizeWorkflowName,
  workflowRunResultToHistoryOutcome,
  type WorkflowRunHistoryRecord,
  type WorkflowRunHistoryStorage,
} from "./workflowsAuthor";

function memStorage(seed?: string): WorkflowRunHistoryStorage {
  let val: string | null = seed ?? null;
  return {
    getItem: () => val,
    setItem: (_k, v) => {
      val = v;
    },
  };
}

describe("sanitizeWorkflowName", () => {
  it("accepts alnum dash underscore", () => {
    expect(sanitizeWorkflowName("review-changes")).toBe("review-changes");
    expect(sanitizeWorkflowName("Foo_Bar1")).toBe("Foo_Bar1");
    expect(sanitizeWorkflowName("  my workflow  ")).toBe("my-workflow");
    expect(sanitizeWorkflowName("find.flaky.rhai")).toBe("find-flaky");
  });

  it("rejects empty, path junk, reserved", () => {
    expect(sanitizeWorkflowName("")).toBeNull();
    expect(sanitizeWorkflowName("...")).toBeNull();
    expect(sanitizeWorkflowName("../evil")).toBeNull();
    expect(sanitizeWorkflowName("README")).toBeNull();
    expect(sanitizeWorkflowName(null)).toBeNull();
  });
});

describe("defaultWorkflowTemplate", () => {
  it("emits pure-literal meta and honest comments", () => {
    const body = defaultWorkflowTemplate("review-changes");
    expect(body).toContain('name: "review-changes"');
    expect(body).toMatch(/let meta = #\{/);
    expect(body).toContain("create-workflow");
    expect(body).toContain("complete(");
    expect(body).toContain("no visual graph editor");
    // Not a fake multi-agent pipeline.
    expect(body).not.toContain("parallel(");
  });
});

describe("planCreateWorkflow", () => {
  it("plans user path", () => {
    const p = planCreateWorkflow({
      name: "review-changes",
      scope: "user",
      userHome: "/Users/me",
    });
    expect(p.ok).toBe(true);
    expect(p.reason).toBe("ok");
    expect(p.path).toBe("/Users/me/.grok/workflows/review-changes.rhai");
    expect(p.dir).toBe("/Users/me/.grok/workflows");
  });

  it("plans project path", () => {
    const p = planCreateWorkflow({
      name: "find-flaky",
      scope: "project",
      projectPath: "/repo/app",
      userHome: "/Users/me",
    });
    expect(p.ok).toBe(true);
    expect(p.path).toBe("/repo/app/.grok/workflows/find-flaky.rhai");
  });

  it("soft-fails invalid_name / no_project / host_only", () => {
    expect(
      planCreateWorkflow({ name: "../x", scope: "user", userHome: "/h" })
        .reason,
    ).toBe("invalid_name");
    expect(
      planCreateWorkflow({ name: "a", scope: "project", projectPath: "" })
        .reason,
    ).toBe("no_project");
    expect(
      planCreateWorkflow({ name: "a", scope: "user", userHome: "" }).reason,
    ).toBe("host_only");
    const browser = planCreateWorkflow({
      name: "a",
      scope: "user",
      userHome: "/h",
      isDesktop: false,
    });
    expect(browser.reason).toBe("host_only");
    expect(browser.hostOnly).toBe(true);
    expect(browser.path).toContain("a.rhai");
  });
});

describe("resolveWorkflowsAuthorEmptyState", () => {
  it("list surface", () => {
    expect(
      resolveWorkflowsAuthorEmptyState({ workflowCount: 2 })?.kind,
    ).toBeUndefined();
    expect(
      resolveWorkflowsAuthorEmptyState({ workflowCount: 0 })?.kind,
    ).toBe("no_workflows");
    expect(
      resolveWorkflowsAuthorEmptyState({
        workflowCount: 0,
        scanError: true,
      })?.kind,
    ).toBe("scan_soft_fail");
    expect(
      resolveWorkflowsAuthorEmptyState({
        workflowCount: 0,
        isDesktop: false,
      })?.kind,
    ).toBe("browser_only");
  });

  it("history surface", () => {
    expect(
      resolveWorkflowsAuthorEmptyState({
        surface: "history",
        historyCount: 0,
      })?.kind,
    ).toBe("history_empty");
    expect(
      resolveWorkflowsAuthorEmptyState({
        surface: "history",
        historyCount: 3,
      }),
    ).toBeNull();
  });
});

describe("resolveCreateWorkflowSkillPath", () => {
  it("joins skill segments", () => {
    const p = resolveCreateWorkflowSkillPath("/Users/me");
    expect(p).toContain("create-workflow");
    expect(p?.endsWith("SKILL.md")).toBe(true);
  });
});

const base: WorkflowRunHistoryRecord = {
  id: "wr-1",
  name: "review-changes",
  at: "2026-08-01T12:00:00.000Z",
  mode: "validate",
  outcome: "ok",
  source: "settings",
};

describe("parseWorkflowRunHistoryRecord", () => {
  it("accepts valid records and aliases", () => {
    const e = parseWorkflowRunHistoryRecord({
      id: "x",
      workflowName: "find-flaky",
      at: "2026-01-01T00:00:00.000Z",
      mode: "launch",
      outcome: "soft_fail",
      reason: "timeout",
      log: "fail sk-abcdefghijklmnop",
      source: "settings",
    });
    expect(e).toMatchObject({
      id: "x",
      name: "find-flaky",
      mode: "launch",
      outcome: "soft_fail",
      reason: "timeout",
    });
    expect(e?.logSnippet).toContain("[REDACTED]");
  });

  it("rejects unknown outcomes / missing name", () => {
    expect(
      parseWorkflowRunHistoryRecord({ ...base, outcome: "pending" }),
    ).toBeNull();
    expect(parseWorkflowRunHistoryRecord({ outcome: "ok" })).toBeNull();
  });
});

describe("redactWorkflowRunHistoryLog", () => {
  it("redacts secrets and clamps", () => {
    const long = `fail sk-abcdefghijklmnop ${"x".repeat(400)}`;
    const r = redactWorkflowRunHistoryLog(long);
    expect(r).toBeTruthy();
    expect(r).toContain("[REDACTED]");
    expect((r ?? "").length).toBeLessThanOrEqual(281);
  });
});

describe("push / load / filter history", () => {
  it("rings newest first and caps", () => {
    let list: WorkflowRunHistoryRecord[] = [];
    for (let i = 0; i < WORKFLOW_RUN_HISTORY_MAX + 5; i++) {
      list = pushWorkflowRunHistory(list, {
        ...base,
        id: `wr-${i}`,
        name: `w-${i}`,
      });
    }
    expect(list.length).toBe(WORKFLOW_RUN_HISTORY_MAX);
    expect(list[0].id).toBe(`wr-${WORKFLOW_RUN_HISTORY_MAX + 4}`);
  });

  it("persists via storage", () => {
    const store = memStorage();
    recordWorkflowRunHistory(
      {
        name: "a",
        mode: "validate",
        outcome: "ok",
        log: "done",
      },
      store,
    );
    const loaded = loadWorkflowRunHistory(store);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("a");
    clearWorkflowRunHistory(store);
    expect(loadWorkflowRunHistory(store)).toEqual([]);
  });

  it("filters by outcome and mode", () => {
    const list = parseWorkflowRunHistory([
      { ...base, id: "1", outcome: "ok", mode: "validate" },
      { ...base, id: "2", outcome: "error", mode: "launch" },
      { ...base, id: "3", outcome: "soft_fail", mode: "validate" },
    ]);
    expect(filterWorkflowRunHistory(list, "error")).toHaveLength(1);
    expect(filterWorkflowRunHistory(list, "launch")).toHaveLength(1);
    expect(filterWorkflowRunHistory(list, "all")).toHaveLength(3);
  });
});

describe("workflowRunResultToHistoryOutcome", () => {
  it("maps ok / soft / hard", () => {
    expect(workflowRunResultToHistoryOutcome({ ok: true })).toBe("ok");
    expect(
      workflowRunResultToHistoryOutcome({ ok: false, reason: "timeout" }),
    ).toBe("error");
    expect(
      workflowRunResultToHistoryOutcome({
        ok: false,
        reason: "invalid_name",
      }),
    ).toBe("soft_fail");
  });
});
