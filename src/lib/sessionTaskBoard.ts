/**
 * Cross-session task board — pure column model over sessions + liveMap.
 *
 * Status columns (local meta only; no invented CI/cloud state):
 *   needs_you · running · idle · done · error
 *
 * Reuses dashboard status mapping from agentDashboard; groups into a board.
 */

import {
  isStoppableDashboardStatus,
  mapDashboardStatus,
  type AgentDashboardProjectInput,
  type AgentDashboardSessionInput,
  type AgentDashboardStatus,
} from "./agentDashboard";
import type { SessionLiveMap } from "./sessionLiveStore";

/** Board columns for the session task board. */
export type TaskBoardColumn =
  | "needs_you"
  | "running"
  | "idle"
  | "done"
  | "error";

/** Stable left-to-right column order for UI. */
export const TASK_BOARD_COLUMN_ORDER: readonly TaskBoardColumn[] = [
  "needs_you",
  "running",
  "error",
  "idle",
  "done",
] as const;

export interface TaskBoardCard {
  sessionId: string;
  title: string;
  projectName: string | null;
  projectPath: string | null;
  /** Original dashboard-coarse status (busy / permission / …). */
  status: AgentDashboardStatus;
  column: TaskBoardColumn;
  liveToolTitle: string | null;
  isCurrent: boolean;
  lastActivityAt: number;
  /** True when the session is archived (done column when idle). */
  archived: boolean;
}

export type TaskBoard = Record<TaskBoardColumn, TaskBoardCard[]>;

export type TaskBoardColumnCounts = Record<TaskBoardColumn, number> & {
  total: number;
};

export type TaskBoardEmptyState = "empty" | "filter_empty";

export interface TaskBoardFilter {
  /** Free-text over title, project name/path, tool, sessionId. */
  query?: string;
  /** Project id / name / path substring. */
  projectQuery?: string;
}

/**
 * Map a dashboard status to a board column.
 * Archived idle sessions land in `done` (completed / archived).
 */
export function mapDashboardStatusToBoardColumn(
  status: AgentDashboardStatus,
  archived = false,
): TaskBoardColumn {
  if (status === "permission") return "needs_you";
  if (status === "busy" || status === "connecting") return "running";
  if (status === "error") return "error";
  // idle
  if (archived) return "done";
  return "idle";
}

function emptyBoard(): TaskBoard {
  return {
    needs_you: [],
    running: [],
    idle: [],
    done: [],
    error: [],
  };
}

function parseUpdatedMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Build a task board from sessions + liveMap + projects.
 *
 * - Host liveMap is authoritative for busy / permission / connecting / error.
 * - Archived idle sessions appear only when `includeArchived` is true (done).
 * - Live busy / error sessions always appear even if missing from the list.
 * - No invented metrics; sort within each column by lastActivityAt desc
 *   (current session first on ties of activity when both current flags differ).
 */
export function buildTaskBoard(opts: {
  sessions: AgentDashboardSessionInput[];
  liveMap: SessionLiveMap;
  projects: AgentDashboardProjectInput[];
  currentSessionId?: string | null;
  includeArchived?: boolean;
  untitledLabel?: string;
  generalWorkspacePath?: string | null;
  unboundProjectLabel?: string | null;
}): TaskBoard {
  const untitled = opts.untitledLabel || "Untitled";
  const includeArchived = opts.includeArchived === true;
  const current = opts.currentSessionId || null;
  const projectById = new Map(
    opts.projects.map((p) => [p.id, p] as const),
  );
  const sessionById = new Map(opts.sessions.map((s) => [s.id, s] as const));

  const ids = new Set<string>();
  for (const s of opts.sessions) {
    if (!s.archived || includeArchived) {
      ids.add(s.id);
    } else {
      // Still surface archived when live-busy / error (ops honesty).
      const status = mapDashboardStatus(opts.liveMap[s.id]);
      if (isStoppableDashboardStatus(status) || status === "error") {
        ids.add(s.id);
      }
    }
  }
  for (const [id, snap] of Object.entries(opts.liveMap)) {
    const status = mapDashboardStatus(snap);
    if (isStoppableDashboardStatus(status) || status === "error") {
      ids.add(id);
    }
  }

  const board = emptyBoard();
  for (const sessionId of ids) {
    const meta = sessionById.get(sessionId);
    const snap = opts.liveMap[sessionId];
    const status = mapDashboardStatus(snap);
    const archived = !!meta?.archived;

    // Drop archived idle when not including archived (done would be empty).
    if (archived && status === "idle" && !includeArchived) {
      continue;
    }

    const column = mapDashboardStatusToBoardColumn(status, archived);
    const projectId = meta?.projectId ?? null;
    const project = projectId ? projectById.get(projectId) : undefined;
    const sessionUpdatedMs = parseUpdatedMs(meta?.updatedAt);
    const liveUpdatedMs = snap?.updatedAt ?? 0;
    const lastActivityAt = Math.max(sessionUpdatedMs, liveUpdatedMs);
    const title = (meta?.title || "").trim() || untitled;
    const projectPath =
      project?.path?.trim() ||
      (projectId ? null : opts.generalWorkspacePath?.trim() || null);
    const projectName =
      project?.name?.trim() ||
      (projectId
        ? null
        : opts.unboundProjectLabel?.trim() || null);

    board[column].push({
      sessionId,
      title,
      projectName,
      projectPath,
      status,
      column,
      liveToolTitle: snap?.liveToolTitle ?? null,
      isCurrent: current != null && sessionId === current,
      lastActivityAt,
      archived,
    });
  }

  // Sort each column: current first, then newest activity. No invented ranks.
  for (const col of TASK_BOARD_COLUMN_ORDER) {
    board[col].sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      return b.lastActivityAt - a.lastActivityAt;
    });
  }

  return board;
}

/** Per-column counts plus total cards. */
export function countTaskBoardColumns(board: TaskBoard): TaskBoardColumnCounts {
  const counts: TaskBoardColumnCounts = {
    needs_you: board.needs_you.length,
    running: board.running.length,
    idle: board.idle.length,
    done: board.done.length,
    error: board.error.length,
    total: 0,
  };
  counts.total =
    counts.needs_you +
    counts.running +
    counts.idle +
    counts.done +
    counts.error;
  return counts;
}

/** Flatten board cards in column order. */
export function flattenTaskBoard(board: TaskBoard): TaskBoardCard[] {
  const out: TaskBoardCard[] = [];
  for (const col of TASK_BOARD_COLUMN_ORDER) {
    out.push(...board[col]);
  }
  return out;
}

function cardMatchesQuery(card: TaskBoardCard, q: string): boolean {
  if (!q) return true;
  const hay = [
    card.title,
    card.projectName || "",
    card.projectPath || "",
    card.liveToolTitle || "",
    card.status,
    card.column,
    card.sessionId,
  ]
    .join("\n")
    .toLowerCase();
  return hay.includes(q);
}

function cardMatchesProject(card: TaskBoardCard, projectQuery: string): boolean {
  const q = projectQuery.trim().toLowerCase();
  if (!q) return true;
  const hay = [card.projectName || "", card.projectPath || ""]
    .join("\n")
    .toLowerCase();
  return hay.includes(q);
}

/**
 * Filter board cards by free-text and/or project substring (AND).
 * Column structure is preserved; empty columns stay empty arrays.
 */
export function filterTaskBoard(
  board: TaskBoard,
  filter: TaskBoardFilter = {},
): TaskBoard {
  const q = (filter.query ?? "").trim().toLowerCase();
  const pq = filter.projectQuery ?? "";
  if (!q && !pq.trim()) return board;

  const out = emptyBoard();
  for (const col of TASK_BOARD_COLUMN_ORDER) {
    out[col] = board[col].filter(
      (c) => cardMatchesQuery(c, q) && cardMatchesProject(c, pq),
    );
  }
  return out;
}

/**
 * Honest empty-state kind for the board UI.
 * - `empty` — no sessions in the catalog at all
 * - `filter_empty` — catalog has sessions but filters removed all cards
 * - `null` — board has visible cards
 */
export function resolveTaskBoardEmptyState(opts: {
  totalSessions: number;
  filteredCount: number;
}): TaskBoardEmptyState | null {
  if (opts.totalSessions <= 0) return "empty";
  if (opts.filteredCount <= 0) return "filter_empty";
  return null;
}
