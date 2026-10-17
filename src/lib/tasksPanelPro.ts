/**
 * TASKS-PANEL-PRO — pure helpers for the Agent Tasks side panel:
 * running / done / all status chips, empty honesty (no tasks vs filter empty),
 * snapshot-mode banner keys, and soft-fail classification for stop / bind-cwd.
 *
 * Builds on `sessionTasks` tree helpers. No DOM / Tauri side effects.
 * Never invents tasks or kill capability over ACP.
 */

import {
  filterSessionTasks,
  filterTaskTree,
  type AgentTask,
  type AgentTaskStatus,
  type TaskTreeNode,
} from "@/lib/sessionTasks";

// ── Status chips ─────────────────────────────────────────────────────────────

/**
 * First-class status chip buckets for the Tasks panel.
 * `done` = terminal (completed | failed | cancelled).
 */
export type TasksPanelStatusFilter = "all" | "running" | "done";

/** Ordered chip list (All · Running · Done). */
export const TASKS_PANEL_STATUS_FILTERS: readonly TasksPanelStatusFilter[] = [
  "all",
  "running",
  "done",
] as const;

/** Per-chip counts; `all` is total length. */
export type TasksPanelStatusCounts = Record<TasksPanelStatusFilter, number>;

/** True when status is terminal (not running). */
export function isTasksPanelDoneStatus(
  status: AgentTaskStatus | string | null | undefined,
): boolean {
  const s = String(status ?? "")
    .toLowerCase()
    .trim();
  return s !== "" && s !== "running";
}

/** Map a task status into a chip bucket (`running` | `done`). */
export function tasksPanelBucketForStatus(
  status: AgentTaskStatus | string | null | undefined,
): Exclude<TasksPanelStatusFilter, "all"> {
  return isTasksPanelDoneStatus(status) ? "done" : "running";
}

/** Whether a task matches the status chip (`all` always matches). */
export function taskMatchesStatusFilter(
  task: Pick<AgentTask, "status"> | null | undefined,
  filter: TasksPanelStatusFilter | null | undefined,
): boolean {
  if (!task) return false;
  const f = filter ?? "all";
  if (f === "all") return true;
  return tasksPanelBucketForStatus(task.status) === f;
}

/** Count tasks per chip bucket. */
export function countTasksByStatusFilter(
  tasks: readonly Pick<AgentTask, "status">[],
): TasksPanelStatusCounts {
  const counts: TasksPanelStatusCounts = {
    all: tasks.length,
    running: 0,
    done: 0,
  };
  for (const t of tasks) {
    counts[tasksPanelBucketForStatus(t.status)] += 1;
  }
  return counts;
}

/** Filter flat task list by status chip only. */
export function filterTasksByStatus<T extends Pick<AgentTask, "status">>(
  tasks: readonly T[],
  filter: TasksPanelStatusFilter | null | undefined,
): T[] {
  const f = filter ?? "all";
  if (f === "all") return tasks as T[];
  return tasks.filter((t) => taskMatchesStatusFilter(t, f));
}

/** Combined free-text + status chip filter for a flat list. */
export interface TasksPanelListFilter {
  query?: string | null;
  status?: TasksPanelStatusFilter | null;
}

/**
 * Filter tasks by status chip and free-text query (AND).
 * Reuses {@link filterSessionTasks} for query; does not invent rows.
 */
export function filterTasksPanelList<T extends AgentTask>(
  tasks: readonly T[],
  filter: TasksPanelListFilter | string = {},
): T[] {
  const opts: TasksPanelListFilter =
    typeof filter === "string" ? { query: filter } : filter ?? {};
  let out = filterTasksByStatus(tasks, opts.status ?? "all") as T[];
  const q = (opts.query ?? "").trim();
  if (q) {
    out = filterSessionTasks(out, q) as T[];
  }
  return out;
}

/**
 * True when status chip or free-text narrows the list
 * (used for filter-empty honesty and clear-filters CTA).
 */
export function tasksPanelHasActiveFilters(
  filter: TasksPanelListFilter | null | undefined,
): boolean {
  if (!filter) return false;
  const status = filter.status ?? "all";
  const q = (filter.query ?? "").trim();
  return status !== "all" || q.length > 0;
}

/**
 * Whether a task tree node (or any descendant) matches the status chip.
 * Used so parents of matching children stay visible when nested.
 */
export function taskTreeMatchesStatusFilter(
  node: TaskTreeNode,
  filter: TasksPanelStatusFilter | null | undefined,
): boolean {
  const f = filter ?? "all";
  if (f === "all") return true;
  if (taskMatchesStatusFilter(node.task, f)) return true;
  return node.children.some((c) => taskTreeMatchesStatusFilter(c, f));
}

/**
 * Filter a task forest by status chip; keeps ancestors of matches.
 * Empty / `all` returns nodes unchanged (same references when possible).
 */
export function filterTaskTreeByStatus(
  nodes: TaskTreeNode[],
  filter: TasksPanelStatusFilter | null | undefined,
): TaskTreeNode[] {
  const f = filter ?? "all";
  if (f === "all") return nodes;

  const walk = (node: TaskTreeNode): TaskTreeNode | null => {
    const kids = node.children
      .map(walk)
      .filter((n): n is TaskTreeNode => n != null);
    if (taskMatchesStatusFilter(node.task, f) || kids.length > 0) {
      return { task: node.task, children: kids };
    }
    return null;
  };

  return nodes.map(walk).filter((n): n is TaskTreeNode => n != null);
}

/**
 * Filter a task forest by status chip + free-text query (AND).
 * Query uses {@link filterTaskTree} (keeps ancestors of text matches).
 */
export function filterTaskTreePanel(
  nodes: TaskTreeNode[],
  filter: TasksPanelListFilter | string = {},
): TaskTreeNode[] {
  const opts: TasksPanelListFilter =
    typeof filter === "string" ? { query: filter } : filter ?? {};
  let out = filterTaskTreeByStatus(nodes, opts.status ?? "all");
  const q = (opts.query ?? "").trim();
  if (q) {
    out = filterTaskTree(out, q);
  }
  return out;
}

/** Count root-level task ids in a forest (each root once). */
export function countTaskTreeRoots(nodes: readonly TaskTreeNode[]): number {
  return nodes.length;
}

/**
 * Count all task nodes in a forest (roots + nested children).
 * Used for chip counts when nested tools exist.
 */
export function countTaskTreeNodes(nodes: readonly TaskTreeNode[]): number {
  let n = 0;
  const walk = (node: TaskTreeNode) => {
    n += 1;
    for (const c of node.children) walk(c);
  };
  for (const root of nodes) walk(root);
  return n;
}

// ── Empty honesty ────────────────────────────────────────────────────────────

/** Contextual empty surfaces for the tasks list body. */
export type TasksPanelEmptyKind = "no_tasks" | "filter_empty";

export type TasksPanelEmptyPresentation = {
  kind: TasksPanelEmptyKind;
  /** Primary title i18n key under tasks.*. */
  titleKey: string;
  /** Optional hint i18n key. */
  hintKey: string | null;
  /** Offer clear-filters CTA. */
  showClearFilters: boolean;
};

export type TasksPanelEmptyInput = {
  /** Total tasks from session (pre status/query filter). */
  totalTasks: number;
  /** Visible tasks after filters (flat or root count — same honesty). */
  filteredTasks: number;
  /**
   * Other busy sessions shown in the activity section.
   * When > 0 and there are no local tasks, the panel still has content —
   * returns `null` so the body can render other sessions without a full empty.
   * Filter-empty still returns when local tasks exist but chips hid them all
   * (caller may show other sessions + a filter-empty block together).
   */
  otherSessions?: number;
  /** Status chip or free-text active. */
  hasFilters?: boolean;
};

/**
 * Resolve which empty surface to show for the local tasks list.
 * Returns `null` when filtered task rows should render.
 *
 * Priority:
 * 1. filtered tasks > 0 → null (render list)
 * 2. total == 0 → no_tasks (unless otherSessions > 0 → null, body has content)
 * 3. total > 0 + filters + filtered == 0 → filter_empty
 *
 * Never invents “running” work when the stream is idle.
 */
export function resolveTasksPanelEmptyState(
  input: TasksPanelEmptyInput,
): TasksPanelEmptyPresentation | null {
  const total = Math.max(0, Number(input.totalTasks) || 0);
  const filtered = Math.max(0, Number(input.filteredTasks) || 0);
  const other = Math.max(0, Number(input.otherSessions) || 0);
  const hasFilters = Boolean(input.hasFilters);

  if (filtered > 0) return null;

  if (total === 0) {
    // Other busy sessions alone are enough content for the body.
    if (other > 0) return null;
    return {
      kind: "no_tasks",
      titleKey: "tasks.empty",
      hintKey: "tasks.emptyHint",
      showClearFilters: false,
    };
  }

  if (hasFilters) {
    return {
      kind: "filter_empty",
      titleKey: "tasks.filterEmpty",
      hintKey: "tasks.filterEmptyHint",
      showClearFilters: true,
    };
  }

  // Total > 0 but filtered 0 without filters should not happen; soft fallback.
  if (other > 0) return null;
  return {
    kind: "no_tasks",
    titleKey: "tasks.empty",
    hintKey: "tasks.emptyHint",
    showClearFilters: false,
  };
}

// ── Snapshot mode banner ─────────────────────────────────────────────────────

/** i18n key for the subagent worktree snapshot note (when enabled). */
export const TASKS_PANEL_SNAPSHOT_NOTE_KEY = "tasks.subagentWtSnapNote";

/**
 * Banner copy key when subagent worktree snapshot mode is on.
 * Returns `null` when disabled / unset — UI omits the note.
 */
export function tasksPanelSnapshotBannerKey(
  enabled: boolean | null | undefined,
): typeof TASKS_PANEL_SNAPSHOT_NOTE_KEY | null {
  return enabled === true ? TASKS_PANEL_SNAPSHOT_NOTE_KEY : null;
}

/** Label i18n key for a status chip. */
export function tasksPanelStatusFilterLabelKey(
  filter: TasksPanelStatusFilter,
): string {
  switch (filter) {
    case "running":
      return "tasks.filter.running";
    case "done":
      return "tasks.filter.done";
    case "all":
    default:
      return "tasks.filter.all";
  }
}

// ── Soft-fail: stop session ──────────────────────────────────────────────────

/** Stable failure kinds for Tasks-panel session stop. */
export type TasksStopErrorKind =
  | "host_only"
  | "not_found"
  | "already_stopped"
  | "timeout"
  | "permission"
  | "other";

export type TasksStopErrorView = {
  kind: TasksStopErrorKind;
  /** Soft-fail: capability / already-idle — warn, do not escalate. */
  softFail: boolean;
  /** Short detail excerpt for UI (no secrets expected). */
  detail: string;
  /** i18n title key under tasks.activity.stopErr.*. */
  titleKey: string;
  /** i18n hint key under tasks.activity.stopErr.*. */
  hintKey: string;
};

function errText(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const code =
      typeof (err as Error & { code?: unknown }).code === "string"
        ? String((err as Error & { code?: string }).code)
        : "";
    return `${code} ${err.message} ${err.name}`.trim();
  }
  if (typeof err === "object") {
    const o = err as {
      code?: unknown;
      message?: unknown;
      reason?: unknown;
      error?: unknown;
    };
    const parts = [o.code, o.message, o.reason, o.error]
      .filter((x) => x != null && String(x).trim())
      .map(String);
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * Classify a sessionStop / stop-all failure for soft-fail presentation.
 * Soft-fail: host-only, already idle, missing session, timeout.
 */
export function classifyTasksStopError(err: unknown): TasksStopErrorView {
  const raw = errText(err);
  const detail = raw.trim().slice(0, 280);
  const s = raw.toLowerCase();

  let kind: TasksStopErrorKind = "other";

  if (
    /need[_\s-]?tauri|desktop\s+app|host[_\s-]?only|not\s+available\s+in\s+browser|webview\s+only/i.test(
      s,
    )
  ) {
    kind = "host_only";
  } else if (
    /not\s+found|unknown\s+session|no\s+such\s+session|session[_\s-]?missing|enoent/i.test(
      s,
    )
  ) {
    kind = "not_found";
  } else if (
    /already\s+(stopped|idle|settled)|not\s+(running|busy|active)|nothing\s+to\s+stop|idle/i.test(
      s,
    )
  ) {
    kind = "already_stopped";
  } else if (/timed?\s*out|timeout/i.test(s)) {
    kind = "timeout";
  } else if (
    /permission|eacces|eperm|denied|unauthorized|forbidden/i.test(s)
  ) {
    kind = "permission";
  } else if (raw.trim()) {
    kind = "other";
  }

  const softFail =
    kind === "host_only" ||
    kind === "not_found" ||
    kind === "already_stopped" ||
    kind === "timeout";

  return {
    kind,
    softFail,
    detail,
    titleKey: `tasks.activity.stopErr.${kind}`,
    hintKey: `tasks.activity.stopErr.${kind}Hint`,
  };
}

// ── Soft-fail: bind cwd / open worktree ──────────────────────────────────────

/** Stable failure kinds for “use as chat folder” bind. */
export type TasksBindCwdErrorKind =
  | "empty_path"
  | "already_active"
  | "host_only"
  | "not_worktree"
  | "switch_failed"
  | "other";

export type TasksBindCwdErrorView = {
  kind: TasksBindCwdErrorKind;
  softFail: boolean;
  detail: string;
  titleKey: string;
  hintKey: string;
};

export type TasksBindCwdResult =
  | { ok: true }
  | { ok: false; kind: TasksBindCwdErrorKind; detail?: string };

/**
 * Classify a bind-cwd / open-as-chat-folder failure.
 * Soft-fail: empty path, already active, host-only, not a worktree.
 */
export function classifyTasksBindCwdError(
  err: unknown,
  opts?: { alreadyActive?: boolean; emptyPath?: boolean },
): TasksBindCwdErrorView {
  if (opts?.emptyPath) {
    return {
      kind: "empty_path",
      softFail: true,
      detail: "",
      titleKey: "tasks.cwdBindErr.empty_path",
      hintKey: "tasks.cwdBindErr.empty_pathHint",
    };
  }
  if (opts?.alreadyActive) {
    return {
      kind: "already_active",
      softFail: true,
      detail: "",
      titleKey: "tasks.cwdBindErr.already_active",
      hintKey: "tasks.cwdBindErr.already_activeHint",
    };
  }

  const raw = errText(err);
  const detail = raw.trim().slice(0, 280);
  const s = raw.toLowerCase();

  let kind: TasksBindCwdErrorKind = "other";

  if (
    /need[_\s-]?tauri|desktop\s+app|host[_\s-]?only|not\s+available\s+in\s+browser/i.test(
      s,
    )
  ) {
    kind = "host_only";
  } else if (
    /not\s+(a\s+)?worktree|no\s+worktree|unknown\s+worktree|invalid\s+path|not\s+a\s+(git\s+)?repo/i.test(
      s,
    )
  ) {
    kind = "not_worktree";
  } else if (
    /already\s+(active|bound|current)|same\s+(path|cwd|folder|project)/i.test(s)
  ) {
    kind = "already_active";
  } else if (
    /switch|bind|project[_\s-]?add|failed|error|eacces|enoent|permission/i.test(
      s,
    ) &&
    raw.trim()
  ) {
    kind = "switch_failed";
  } else if (raw.trim()) {
    kind = "other";
  }

  const softFail =
    kind === "already_active" ||
    kind === "host_only" ||
    kind === "not_worktree";

  return {
    kind,
    softFail,
    detail,
    titleKey: `tasks.cwdBindErr.${kind}`,
    hintKey: `tasks.cwdBindErr.${kind}Hint`,
  };
}

/**
 * Normalize an onOpenCwd callback return value into a bind result.
 * `void` / `undefined` → success (legacy callers).
 */
export function normalizeTasksBindCwdResult(
  value: void | TasksBindCwdResult | null | undefined,
): TasksBindCwdResult {
  if (value == null) return { ok: true };
  if (typeof value === "object" && "ok" in value) {
    return value.ok
      ? { ok: true }
      : {
          ok: false,
          kind: value.kind ?? "other",
          detail: value.detail,
        };
  }
  return { ok: true };
}
