import { describe, expect, it } from "vitest";
import type { AgentTask, TaskTreeNode } from "./sessionTasks";
import {
  AGENTS_RAIL_SIDE_MODE,
  countAgentsRailRunning,
  resolveAgentsRailEmptyState,
  shouldShowAgentsRailBadge,
} from "./agentsRail";

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

describe("AGENTS_RAIL_SIDE_MODE", () => {
  it("exports agents side mode id", () => {
    expect(AGENTS_RAIL_SIDE_MODE).toBe("agents");
  });
});

describe("resolveAgentsRailEmptyState", () => {
  it("returns null when tasks are visible", () => {
    expect(
      resolveAgentsRailEmptyState({
        hasTasks: true,
        filterActive: false,
        sessionBusy: false,
      }),
    ).toBeNull();
    expect(
      resolveAgentsRailEmptyState({
        hasTasks: true,
        filterActive: true,
        sessionBusy: true,
      }),
    ).toBeNull();
  });

  it("returns filter_empty when filters hid all rows", () => {
    expect(
      resolveAgentsRailEmptyState({
        hasTasks: false,
        filterActive: true,
        sessionBusy: false,
      }),
    ).toEqual({
      kind: "filter_empty",
      titleKey: "agentsRail.filterEmpty",
      hintKey: "agentsRail.filterEmptyHint",
      showClearFilters: true,
    });
  });

  it("returns no_tasks when session is busy but no tool rows", () => {
    expect(
      resolveAgentsRailEmptyState({
        hasTasks: false,
        filterActive: false,
        sessionBusy: true,
      }),
    ).toEqual({
      kind: "no_tasks",
      titleKey: "agentsRail.noTasks",
      hintKey: "agentsRail.busyHint",
      showClearFilters: false,
    });
  });

  it("returns idle_hint when session is idle with no tasks", () => {
    expect(
      resolveAgentsRailEmptyState({
        hasTasks: false,
        filterActive: false,
        sessionBusy: false,
      }),
    ).toEqual({
      kind: "idle_hint",
      titleKey: "agentsRail.noTasks",
      hintKey: "agentsRail.idleHint",
      showClearFilters: false,
    });
  });

  it("prefers filter_empty over busy/idle when filters active", () => {
    expect(
      resolveAgentsRailEmptyState({
        hasTasks: false,
        filterActive: true,
        sessionBusy: true,
      })?.kind,
    ).toBe("filter_empty");
  });
});

describe("countAgentsRailRunning", () => {
  it("counts flat running tasks", () => {
    const tasks = [
      task({ id: "a", status: "running" }),
      task({ id: "b", status: "completed" }),
      task({ id: "c", status: "running" }),
    ];
    expect(countAgentsRailRunning(tasks)).toBe(2);
  });

  it("counts nested tree nodes", () => {
    const tree: TaskTreeNode[] = [
      {
        task: task({ id: "spawn", status: "running", longRunning: true }),
        children: [
          {
            task: task({ id: "child1", status: "running" }),
            children: [],
          },
          {
            task: task({ id: "child2", status: "completed" }),
            children: [],
          },
        ],
      },
      {
        task: task({ id: "done", status: "failed" }),
        children: [],
      },
    ];
    expect(countAgentsRailRunning(tree)).toBe(2);
  });

  it("returns 0 for empty / null", () => {
    expect(countAgentsRailRunning([])).toBe(0);
    expect(countAgentsRailRunning(null)).toBe(0);
    expect(countAgentsRailRunning(undefined)).toBe(0);
  });
});

describe("shouldShowAgentsRailBadge", () => {
  it("is true only when runningCount > 0", () => {
    expect(shouldShowAgentsRailBadge(0)).toBe(false);
    expect(shouldShowAgentsRailBadge(-1)).toBe(false);
    expect(shouldShowAgentsRailBadge(NaN)).toBe(false);
    expect(shouldShowAgentsRailBadge(1)).toBe(true);
    expect(shouldShowAgentsRailBadge(3)).toBe(true);
  });
});
