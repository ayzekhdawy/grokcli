import { describe, expect, it } from "vitest";
import type { AgentTask, TaskTreeNode } from "./sessionTasks";
import {
  TASKS_PANEL_SNAPSHOT_NOTE_KEY,
  TASKS_PANEL_STATUS_FILTERS,
  classifyTasksBindCwdError,
  classifyTasksStopError,
  countTaskTreeNodes,
  countTasksByStatusFilter,
  filterTaskTreeByStatus,
  filterTaskTreePanel,
  filterTasksByStatus,
  filterTasksPanelList,
  isTasksPanelDoneStatus,
  normalizeTasksBindCwdResult,
  resolveTasksPanelEmptyState,
  taskMatchesStatusFilter,
  taskTreeMatchesStatusFilter,
  tasksPanelBucketForStatus,
  tasksPanelHasActiveFilters,
  tasksPanelSnapshotBannerKey,
  tasksPanelStatusFilterLabelKey,
} from "./tasksPanelPro";

function task(
  partial: Partial<AgentTask> & Pick<AgentTask, "id" | "status">,
): AgentTask {
  return {
    name: partial.name ?? partial.id,
    kind: partial.kind ?? "tool",
    longRunning: partial.longRunning ?? false,
    ...partial,
  };
}

const TASKS: AgentTask[] = [
  task({ id: "r1", status: "running", name: "spawn_subagent", kind: "spawn_subagent" }),
  task({ id: "r2", status: "running", name: "bash build", kind: "bash", detail: "pnpm test" }),
  task({ id: "d1", status: "completed", name: "read_file", kind: "read_file", path: "/a.ts" }),
  task({ id: "d2", status: "failed", name: "write_file", kind: "write_file" }),
  task({ id: "d3", status: "cancelled", name: "monitor", kind: "monitor" }),
];

describe("status chip buckets", () => {
  it("maps running vs done", () => {
    expect(isTasksPanelDoneStatus("running")).toBe(false);
    expect(isTasksPanelDoneStatus("completed")).toBe(true);
    expect(isTasksPanelDoneStatus("failed")).toBe(true);
    expect(isTasksPanelDoneStatus("cancelled")).toBe(true);
    expect(tasksPanelBucketForStatus("running")).toBe("running");
    expect(tasksPanelBucketForStatus("failed")).toBe("done");
  });

  it("matches filter chips", () => {
    expect(taskMatchesStatusFilter(TASKS[0]!, "all")).toBe(true);
    expect(taskMatchesStatusFilter(TASKS[0]!, "running")).toBe(true);
    expect(taskMatchesStatusFilter(TASKS[0]!, "done")).toBe(false);
    expect(taskMatchesStatusFilter(TASKS[2]!, "done")).toBe(true);
    expect(taskMatchesStatusFilter(null, "running")).toBe(false);
  });

  it("counts all / running / done", () => {
    const counts = countTasksByStatusFilter(TASKS);
    expect(counts).toEqual({ all: 5, running: 2, done: 3 });
    expect(countTasksByStatusFilter([])).toEqual({
      all: 0,
      running: 0,
      done: 0,
    });
    expect(TASKS_PANEL_STATUS_FILTERS).toEqual(["all", "running", "done"]);
  });

  it("filters by status chip", () => {
    expect(filterTasksByStatus(TASKS, "running").map((t) => t.id)).toEqual([
      "r1",
      "r2",
    ]);
    expect(filterTasksByStatus(TASKS, "done").map((t) => t.id)).toEqual([
      "d1",
      "d2",
      "d3",
    ]);
    expect(filterTasksByStatus(TASKS, "all")).toHaveLength(5);
    expect(filterTasksByStatus(TASKS, null)).toHaveLength(5);
  });

  it("combines status + free-text query", () => {
    expect(
      filterTasksPanelList(TASKS, { status: "running", query: "pnpm" }).map(
        (t) => t.id,
      ),
    ).toEqual(["r2"]);
    expect(
      filterTasksPanelList(TASKS, { status: "done", query: "read" }).map(
        (t) => t.id,
      ),
    ).toEqual(["d1"]);
    expect(
      filterTasksPanelList(TASKS, { status: "running", query: "read" }),
    ).toHaveLength(0);
    expect(filterTasksPanelList(TASKS, "WRITE").map((t) => t.id)).toEqual([
      "d2",
    ]);
    expect(filterTasksPanelList([], { status: "running" })).toEqual([]);
  });

  it("detects active filters", () => {
    expect(tasksPanelHasActiveFilters(undefined)).toBe(false);
    expect(tasksPanelHasActiveFilters({ status: "all", query: "" })).toBe(
      false,
    );
    expect(tasksPanelHasActiveFilters({ status: "running" })).toBe(true);
    expect(tasksPanelHasActiveFilters({ query: "bash" })).toBe(true);
  });

  it("maps chip labels to i18n keys", () => {
    expect(tasksPanelStatusFilterLabelKey("all")).toBe("tasks.filter.all");
    expect(tasksPanelStatusFilterLabelKey("running")).toBe(
      "tasks.filter.running",
    );
    expect(tasksPanelStatusFilterLabelKey("done")).toBe("tasks.filter.done");
  });
});

describe("task tree status filter", () => {
  const forest: TaskTreeNode[] = [
    {
      task: task({
        id: "spawn",
        status: "running",
        name: "spawn",
        kind: "spawn_subagent",
        longRunning: true,
      }),
      children: [
        {
          task: task({
            id: "child-done",
            status: "completed",
            name: "child read",
            parentId: "spawn",
          }),
          children: [],
        },
      ],
    },
    {
      task: task({ id: "solo", status: "failed", name: "solo fail" }),
      children: [],
    },
  ];

  it("keeps ancestors when a child matches", () => {
    const done = filterTaskTreeByStatus(forest, "done");
    expect(done.map((n) => n.task.id)).toEqual(["spawn", "solo"]);
    expect(done[0]!.children.map((c) => c.task.id)).toEqual(["child-done"]);
    expect(taskTreeMatchesStatusFilter(forest[0]!, "done")).toBe(true);
    expect(taskTreeMatchesStatusFilter(forest[0]!, "running")).toBe(true);
  });

  it("filters running-only tree", () => {
    const running = filterTaskTreeByStatus(forest, "running");
    expect(running.map((n) => n.task.id)).toEqual(["spawn"]);
    // Child completed is dropped when status is running-only.
    expect(running[0]!.children).toEqual([]);
  });

  it("combines tree status + query", () => {
    const hit = filterTaskTreePanel(forest, {
      status: "done",
      query: "solo",
    });
    expect(hit.map((n) => n.task.id)).toEqual(["solo"]);
    expect(countTaskTreeNodes(forest)).toBe(3);
  });
});

describe("empty honesty", () => {
  it("shows no_tasks when stream has nothing", () => {
    expect(
      resolveTasksPanelEmptyState({
        totalTasks: 0,
        filteredTasks: 0,
      }),
    ).toEqual({
      kind: "no_tasks",
      titleKey: "tasks.empty",
      hintKey: "tasks.emptyHint",
      showClearFilters: false,
    });
  });

  it("shows filter_empty when chips/query hide all tasks", () => {
    expect(
      resolveTasksPanelEmptyState({
        totalTasks: 4,
        filteredTasks: 0,
        hasFilters: true,
      }),
    ).toEqual({
      kind: "filter_empty",
      titleKey: "tasks.filterEmpty",
      hintKey: "tasks.filterEmptyHint",
      showClearFilters: true,
    });
  });

  it("returns null when filtered rows exist", () => {
    expect(
      resolveTasksPanelEmptyState({
        totalTasks: 4,
        filteredTasks: 2,
        hasFilters: true,
      }),
    ).toBeNull();
  });

  it("returns null when only other busy sessions exist (no local tasks)", () => {
    expect(
      resolveTasksPanelEmptyState({
        totalTasks: 0,
        filteredTasks: 0,
        otherSessions: 2,
      }),
    ).toBeNull();
  });

  it("filter_empty when chips hide tools even if other sessions exist", () => {
    // UI may still render other sessions above the filter-empty block.
    expect(
      resolveTasksPanelEmptyState({
        totalTasks: 3,
        filteredTasks: 0,
        otherSessions: 1,
        hasFilters: true,
      }),
    ).toEqual({
      kind: "filter_empty",
      titleKey: "tasks.filterEmpty",
      hintKey: "tasks.filterEmptyHint",
      showClearFilters: true,
    });
  });
});

describe("snapshot banner key", () => {
  it("returns note key only when enabled", () => {
    expect(tasksPanelSnapshotBannerKey(true)).toBe(
      TASKS_PANEL_SNAPSHOT_NOTE_KEY,
    );
    expect(tasksPanelSnapshotBannerKey(false)).toBeNull();
    expect(tasksPanelSnapshotBannerKey(null)).toBeNull();
    expect(tasksPanelSnapshotBannerKey(undefined)).toBeNull();
    expect(TASKS_PANEL_SNAPSHOT_NOTE_KEY).toBe("tasks.subagentWtSnapNote");
  });
});

describe("stop soft-fail", () => {
  it("classifies host-only / not-found / already-stopped / timeout", () => {
    expect(classifyTasksStopError("need_tauri: desktop app").kind).toBe(
      "host_only",
    );
    expect(classifyTasksStopError("session not found").kind).toBe("not_found");
    expect(classifyTasksStopError("already stopped").kind).toBe(
      "already_stopped",
    );
    expect(classifyTasksStopError("operation timed out").kind).toBe("timeout");
    expect(classifyTasksStopError("permission denied").kind).toBe("permission");
    expect(classifyTasksStopError("boom").kind).toBe("other");
  });

  it("marks capability gaps as softFail", () => {
    expect(classifyTasksStopError("need_tauri").softFail).toBe(true);
    expect(classifyTasksStopError("unknown session").softFail).toBe(true);
    expect(classifyTasksStopError("already idle").softFail).toBe(true);
    expect(classifyTasksStopError("timeout").softFail).toBe(true);
    expect(classifyTasksStopError("weird crash").softFail).toBe(false);
    expect(classifyTasksStopError("permission denied").softFail).toBe(false);
  });

  it("emits i18n key paths", () => {
    const v = classifyTasksStopError("timeout waiting");
    expect(v.titleKey).toBe("tasks.activity.stopErr.timeout");
    expect(v.hintKey).toBe("tasks.activity.stopErr.timeoutHint");
  });
});

describe("bind-cwd soft-fail", () => {
  it("handles already_active / empty_path opts", () => {
    expect(
      classifyTasksBindCwdError(null, { alreadyActive: true }).kind,
    ).toBe("already_active");
    expect(classifyTasksBindCwdError(null, { emptyPath: true }).kind).toBe(
      "empty_path",
    );
    expect(
      classifyTasksBindCwdError(null, { alreadyActive: true }).softFail,
    ).toBe(true);
  });

  it("classifies host-only / not_worktree / switch_failed", () => {
    expect(classifyTasksBindCwdError("need_tauri host").kind).toBe(
      "host_only",
    );
    expect(classifyTasksBindCwdError("not a worktree path").kind).toBe(
      "not_worktree",
    );
    expect(classifyTasksBindCwdError("project_add failed: EACCES").kind).toBe(
      "switch_failed",
    );
    expect(classifyTasksBindCwdError("need_tauri").softFail).toBe(true);
    expect(classifyTasksBindCwdError("switch failed").softFail).toBe(false);
  });

  it("normalizes void / result returns", () => {
    expect(normalizeTasksBindCwdResult(undefined)).toEqual({ ok: true });
    expect(normalizeTasksBindCwdResult(null)).toEqual({ ok: true });
    expect(normalizeTasksBindCwdResult({ ok: true })).toEqual({ ok: true });
    expect(
      normalizeTasksBindCwdResult({
        ok: false,
        kind: "not_worktree",
        detail: "x",
      }),
    ).toEqual({ ok: false, kind: "not_worktree", detail: "x" });
  });
});
