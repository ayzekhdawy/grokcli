/**
 * Agents rail — pure helpers for Resources → Agents side mode.
 *
 * Reuses session task collection (no invented metrics). Empty-state kinds
 * distinguish no tasks vs filter empty vs idle session hint.
 */

import {
  countRunningTasks,
  type AgentTask,
  type TaskTreeNode,
} from "@/lib/sessionTasks";

/** Side-mode id for the Agents rail in ResourceViewer. */
export const AGENTS_RAIL_SIDE_MODE = "agents" as const;

export type AgentsRailSideMode = typeof AGENTS_RAIL_SIDE_MODE;

/** Empty-state kinds when the rail has nothing to list. */
export type AgentsRailEmptyKind = "no_tasks" | "filter_empty" | "idle_hint";

export type AgentsRailEmptyPresentation = {
  kind: AgentsRailEmptyKind;
  /** Primary title i18n key. */
  titleKey: string;
  /** Optional hint i18n key. */
  hintKey: string | null;
  /** Offer clear-filters CTA (filter_empty only). */
  showClearFilters: boolean;
};

export type AgentsRailEmptyInput = {
  /** True when any task rows would render (post-filter). */
  hasTasks: boolean;
  /** Status chip or free-text filter is narrowing the list. */
  filterActive: boolean;
  /** Current session is streaming / connecting / awaiting permission. */
  sessionBusy: boolean;
};

/**
 * Resolve empty-state presentation for Resources → Agents.
 * Returns `null` when task rows should render.
 *
 * Priority:
 * 1. hasTasks → null
 * 2. filterActive → filter_empty
 * 3. sessionBusy → no_tasks (busy but no tool rows yet)
 * 4. else → idle_hint (session idle)
 */
export function resolveAgentsRailEmptyState(
  opts: AgentsRailEmptyInput,
): AgentsRailEmptyPresentation | null {
  if (opts.hasTasks) return null;

  if (opts.filterActive) {
    return {
      kind: "filter_empty",
      titleKey: "agentsRail.filterEmpty",
      hintKey: "agentsRail.filterEmptyHint",
      showClearFilters: true,
    };
  }

  if (opts.sessionBusy) {
    return {
      kind: "no_tasks",
      titleKey: "agentsRail.noTasks",
      hintKey: "agentsRail.busyHint",
      showClearFilters: false,
    };
  }

  return {
    kind: "idle_hint",
    titleKey: "agentsRail.noTasks",
    hintKey: "agentsRail.idleHint",
    showClearFilters: false,
  };
}

/**
 * Count running tasks for the Agents rail badge.
 * Accepts a flat task list or a task tree forest (roots + nested).
 * Thin wrapper over {@link countRunningTasks} — never invents work.
 */
export function countAgentsRailRunning(
  nodesOrTasks:
    | readonly Pick<AgentTask, "status">[]
    | readonly TaskTreeNode[]
    | null
    | undefined,
): number {
  if (!nodesOrTasks || nodesOrTasks.length === 0) return 0;
  const first = nodesOrTasks[0] as { task?: AgentTask; status?: string };
  if (first && typeof first === "object" && "task" in first && first.task) {
    const flat: Pick<AgentTask, "status">[] = [];
    const walk = (node: TaskTreeNode) => {
      flat.push(node.task);
      for (const c of node.children) walk(c);
    };
    for (const n of nodesOrTasks as readonly TaskTreeNode[]) walk(n);
    return countRunningTasks(flat as AgentTask[]);
  }
  return countRunningTasks(nodesOrTasks as AgentTask[]);
}

/** True when the Agents tab / chrome should show a running badge. */
export function shouldShowAgentsRailBadge(runningCount: number): boolean {
  const n = Number(runningCount);
  return Number.isFinite(n) && n > 0;
}
