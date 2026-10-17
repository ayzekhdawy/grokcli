/**
 * Cross-session Agent Dashboard row model.
 *
 * Distinct from AgentTasksPanel (per-turn tools): this aggregates App sessions
 * with Host liveMap snapshots for multi-session ops (focus / stop-all).
 * Host remains authoritative — no invented metrics.
 */

import type { SessionState } from "./session";
import type {
  SessionLiveMap,
  SessionLiveSnapshot,
} from "./sessionLiveStore";
import { isSessionLiveStreaming } from "./session";

/** Coarse UI status for dashboard rows. */
export type AgentDashboardStatus =
  | "busy"
  | "permission"
  | "connecting"
  | "idle"
  | "error";

export interface AgentDashboardSessionInput {
  id: string;
  title?: string | null;
  projectId?: string | null;
  updatedAt?: string | null;
  modelId?: string | null;
  effort?: string | null;
  archived?: boolean;
}

export interface AgentDashboardProjectInput {
  id: string;
  name: string;
  path: string;
}

export interface AgentDashboardRow {
  sessionId: string;
  title: string;
  projectId: string | null;
  /** Project display name, or null when unbound. */
  projectName: string | null;
  /** Project path / cwd when known. */
  projectPath: string | null;
  modelId: string | null;
  effort: string | null;
  status: AgentDashboardStatus;
  /** Running tool title from live projection, if any. */
  liveToolTitle: string | null;
  isCurrent: boolean;
  /**
   * Best-known last activity (ms epoch): liveMap.updatedAt when present,
   * else session.updatedAt. Used for sort + optional relative display.
   */
  lastActivityAt: number;
  /** Original session.updatedAt ISO when available. */
  updatedAtIso: string | null;
  /** True when Stop / Stop-all can target this row. */
  stoppable: boolean;
}

export type SessionDashboardLookup = AgentDashboardSessionInput;

/** Map Host / live session state into a dashboard status. */
export function mapDashboardStatus(
  snap: SessionLiveSnapshot | undefined | null,
): AgentDashboardStatus {
  if (!snap) return "idle";
  if (snap.awaitingPermission || snap.state === "awaiting_permission") {
    return "permission";
  }
  if (snap.state === "connecting") return "connecting";
  if (snap.state === "streaming" || isSessionLiveStreaming(snap.state)) {
    return "busy";
  }
  if (snap.state === "disconnected") return "error";
  return "idle";
}

/** True when the row should accept sessionStop. */
export function isStoppableDashboardStatus(
  status: AgentDashboardStatus,
): boolean {
  return (
    status === "busy" ||
    status === "permission" ||
    status === "connecting"
  );
}

/**
 * Sort rank for dashboard rows: permission (needs you) first, then busy,
 * connecting, error, idle. Lower = higher priority.
 */
export function dashboardStatusSortRank(status: AgentDashboardStatus): number {
  switch (status) {
    case "permission":
      return 0;
    case "busy":
      return 1;
    case "connecting":
      return 2;
    case "error":
      return 3;
    default:
      return 4;
  }
}

function parseUpdatedMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function resolveStatusFromState(state: SessionState): AgentDashboardStatus {
  if (state === "awaiting_permission") return "permission";
  if (state === "connecting") return "connecting";
  if (state === "streaming") return "busy";
  if (state === "disconnected") return "error";
  return "idle";
}

/**
 * Build dashboard rows for active (busy/live) + recent non-archived sessions.
 *
 * - Busy / connecting / permission sessions always appear (even if missing from
 *   the sidebar list, with untitled fallback).
 * - Recent idle sessions fill up to `recentLimit` (default 40), newest first.
 * - Archived sessions are omitted unless currently live-busy.
 */
export function collectAgentDashboardRows(opts: {
  sessions: AgentDashboardSessionInput[];
  projects: AgentDashboardProjectInput[];
  liveMap: SessionLiveMap;
  currentSessionId?: string | null;
  untitledLabel?: string;
  /** Cap on non-busy rows. Busy rows are always included. Default 40. */
  recentLimit?: number;
  /** Path label for project-less sessions (general workspace). */
  generalWorkspacePath?: string | null;
  /** Display name when no project is bound. */
  unboundProjectLabel?: string | null;
}): AgentDashboardRow[] {
  const untitled = opts.untitledLabel || "Untitled";
  const recentLimit = opts.recentLimit ?? 40;
  const current = opts.currentSessionId || null;
  const projectById = new Map(
    opts.projects.map((p) => [p.id, p] as const),
  );
  const sessionById = new Map(opts.sessions.map((s) => [s.id, s] as const));

  const ids = new Set<string>();
  for (const s of opts.sessions) {
    if (!s.archived) ids.add(s.id);
  }
  // Always surface live busy/connecting/permission even if not in list yet.
  for (const [id, snap] of Object.entries(opts.liveMap)) {
    const status = mapDashboardStatus(snap);
    if (isStoppableDashboardStatus(status) || status === "error") {
      ids.add(id);
    }
  }

  const rows: AgentDashboardRow[] = [];
  for (const sessionId of ids) {
    const meta = sessionById.get(sessionId);
    const snap = opts.liveMap[sessionId];
    const status = mapDashboardStatus(snap);
    // Drop archived idle sessions (keep if live-busy / error).
    if (meta?.archived && !isStoppableDashboardStatus(status) && status !== "error") {
      continue;
    }
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

    rows.push({
      sessionId,
      title,
      projectId,
      projectName,
      projectPath,
      modelId: meta?.modelId ?? null,
      effort: meta?.effort ?? null,
      status,
      liveToolTitle: snap?.liveToolTitle ?? null,
      isCurrent: current != null && sessionId === current,
      lastActivityAt,
      updatedAtIso: meta?.updatedAt ?? null,
      stoppable: isStoppableDashboardStatus(status),
    });
  }

  // Sort: permission (needs you) → busy → connecting → error → idle; then
  // current session, then newest activity.
  rows.sort((a, b) => {
    const ra = dashboardStatusSortRank(a.status);
    const rb = dashboardStatusSortRank(b.status);
    if (ra !== rb) return ra - rb;
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return b.lastActivityAt - a.lastActivityAt;
  });

  // Keep all busy/error; cap idle/recent.
  const out: AgentDashboardRow[] = [];
  let idleCount = 0;
  for (const row of rows) {
    if (row.status === "idle") {
      if (idleCount >= recentLimit) continue;
      idleCount += 1;
    }
    out.push(row);
  }
  return out;
}

/** Status order used by {@link groupDashboardRowsByStatus}. */
export const AGENT_DASHBOARD_STATUS_GROUP_ORDER: readonly AgentDashboardStatus[] =
  ["permission", "busy", "connecting", "error", "idle"] as const;

export type DashboardStatusGroup = {
  status: AgentDashboardStatus;
  rows: AgentDashboardRow[];
};

/**
 * Group rows into status sections (permission → busy → … → idle).
 * Empty statuses are omitted. Within each group, input order is preserved.
 */
export function groupDashboardRowsByStatus(
  rows: readonly AgentDashboardRow[],
): DashboardStatusGroup[] {
  const buckets = new Map<AgentDashboardStatus, AgentDashboardRow[]>();
  for (const status of AGENT_DASHBOARD_STATUS_GROUP_ORDER) {
    buckets.set(status, []);
  }
  for (const row of rows) {
    const list = buckets.get(row.status);
    if (list) list.push(row);
  }
  const out: DashboardStatusGroup[] = [];
  for (const status of AGENT_DASHBOARD_STATUS_GROUP_ORDER) {
    const groupRows = buckets.get(status) ?? [];
    if (groupRows.length > 0) out.push({ status, rows: groupRows });
  }
  return out;
}

/** Read-only peek card model for a dashboard row (no I/O). */
export type DashboardPeekModel = {
  title: string;
  status: AgentDashboardStatus;
  toolTitle: string | null;
  projectPath: string | null;
  projectName: string | null;
  modelId: string | null;
  effort: string | null;
  lastActivityAt: number;
  /** Always true when the row is listed (session can be focused). */
  canOpen: boolean;
  canStop: boolean;
};

/** Build a peek model from a collected row. */
export function buildDashboardPeekModel(
  row: AgentDashboardRow,
): DashboardPeekModel {
  return {
    title: row.title,
    status: row.status,
    toolTitle: row.liveToolTitle?.trim() || null,
    projectPath: row.projectPath,
    projectName: row.projectName,
    modelId: row.modelId,
    effort: row.effort,
    lastActivityAt: row.lastActivityAt,
    canOpen: !!row.sessionId,
    canStop: row.stoppable,
  };
}

/** Default max length for a dashboard dispatch prompt. */
export const DASHBOARD_DISPATCH_PROMPT_MAX = 8000;

/**
 * Trim + clamp a dispatch prompt. Empty / whitespace-only → "".
 * Does not invent content.
 */
export function sanitizeDispatchPrompt(
  raw: string | null | undefined,
  max: number = DASHBOARD_DISPATCH_PROMPT_MAX,
): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const cap = Number.isFinite(max) && max > 0 ? Math.floor(max) : DASHBOARD_DISPATCH_PROMPT_MAX;
  return s.length <= cap ? s : s.slice(0, cap);
}

export type DashboardDispatchProject = {
  id: string;
  name: string;
  path: string;
  /** Trusted projects only may receive agent work. Default true when omitted. */
  trusted?: boolean;
};

export type DashboardDispatchFailReason =
  | "no_project"
  | "untrusted"
  | "empty_prompt"
  | "no_trusted_project";

export type DashboardDispatchPlan =
  | {
      ok: true;
      prompt: string;
      project: DashboardDispatchProject;
    }
  | {
      ok: false;
      reason: DashboardDispatchFailReason;
    };

/**
 * Plan a single-project dashboard dispatch (no I/O).
 *
 * Soft-fails:
 * - `empty_prompt` — sanitized prompt is empty
 * - `no_trusted_project` — catalog has no trusted targets (and no projectId)
 * - `no_project` — missing / unknown projectId
 * - `untrusted` — project found but not trusted
 */
export function planDashboardDispatch(opts: {
  projectId?: string | null;
  prompt: string;
  projects: readonly DashboardDispatchProject[];
}): DashboardDispatchPlan {
  const prompt = sanitizeDispatchPrompt(opts.prompt);
  if (!prompt) return { ok: false, reason: "empty_prompt" };

  const projects = opts.projects ?? [];
  const trustedProjects = projects.filter((p) => {
    const id = String(p?.id ?? "").trim();
    return !!id && p.trusted !== false;
  });

  const projectId = String(opts.projectId ?? "").trim();
  if (!projectId) {
    if (trustedProjects.length === 0) {
      return { ok: false, reason: "no_trusted_project" };
    }
    return { ok: false, reason: "no_project" };
  }

  const project = projects.find((p) => String(p.id ?? "").trim() === projectId);
  if (!project) return { ok: false, reason: "no_project" };
  if (project.trusted === false) return { ok: false, reason: "untrusted" };

  return {
    ok: true,
    prompt,
    project: {
      id: project.id,
      name: project.name,
      path: project.path,
      trusted: true,
    },
  };
}

/** Trusted-only project list for the dispatch select. */
export function trustedDashboardDispatchProjects(
  projects: readonly DashboardDispatchProject[],
): DashboardDispatchProject[] {
  return projects.filter((p) => {
    const id = String(p?.id ?? "").trim();
    return !!id && p.trusted !== false;
  });
}

/** Rows that accept Stop / Stop all. */
export function stoppableDashboardRows(
  rows: AgentDashboardRow[],
): AgentDashboardRow[] {
  return rows.filter((r) => r.stoppable);
}

/** Count of busy / permission / connecting rows. */
export function countBusyDashboardRows(rows: AgentDashboardRow[]): number {
  return rows.filter((r) => isStoppableDashboardStatus(r.status)).length;
}

/**
 * Among the current selection, keep only rows that can be stopped.
 *
 * Idle / error / missing rows may still be selected in the UI; **Stop selected**
 * targets only {@link AgentDashboardRow.stoppable} members. Order follows `rows`.
 */
export function filterStoppableAmongSelection(
  rows: readonly AgentDashboardRow[],
  selectedIds: ReadonlySet<string> | readonly string[],
): AgentDashboardRow[] {
  const selected =
    selectedIds instanceof Set
      ? selectedIds
      : new Set(selectedIds);
  if (selected.size === 0) return [];
  return rows.filter((r) => selected.has(r.sessionId) && r.stoppable);
}

/** Session ids for **Stop selected** (stoppable ∩ selection, row order). */
export function stoppableSelectedSessionIds(
  rows: readonly AgentDashboardRow[],
  selectedIds: ReadonlySet<string> | readonly string[],
): string[] {
  return filterStoppableAmongSelection(rows, selectedIds).map(
    (r) => r.sessionId,
  );
}

/**
 * Status chip filter values (single-select).
 * `"all"` shows every row; other values match {@link AgentDashboardStatus}.
 */
export type AgentDashboardStatusFilter = "all" | AgentDashboardStatus;

/** Ordered chip list for the dashboard status filter bar. */
export const AGENT_DASHBOARD_STATUS_FILTERS: readonly AgentDashboardStatusFilter[] =
  ["all", "busy", "permission", "connecting", "idle", "error"] as const;

/** Per-status counts plus total (`all`). Used for chip badges. */
export type AgentDashboardStatusCounts = Record<
  AgentDashboardStatusFilter,
  number
>;

/** Count rows per status (and total under `all`). */
export function countDashboardRowsByStatus(
  rows: AgentDashboardRow[],
): AgentDashboardStatusCounts {
  const counts: AgentDashboardStatusCounts = {
    all: rows.length,
    busy: 0,
    permission: 0,
    connecting: 0,
    idle: 0,
    error: 0,
  };
  for (const r of rows) {
    counts[r.status] += 1;
  }
  return counts;
}

/**
 * Match a row against a project id / name / path substring (case-insensitive).
 * Empty query matches everything.
 */
export function matchAgentDashboardProject(
  row: AgentDashboardRow,
  projectQuery: string,
): boolean {
  const q = projectQuery.trim().toLowerCase();
  if (!q) return true;
  const hay = [row.projectId || "", row.projectName || "", row.projectPath || ""]
    .join("\n")
    .toLowerCase();
  return hay.includes(q);
}

/** Combined dashboard list filters (status chips + text + project). */
export interface AgentDashboardFilter {
  /** Free-text over title, project, model, path, status, tool, sessionId. */
  query?: string;
  /** Status chip; default `"all"`. */
  status?: AgentDashboardStatusFilter;
  /** Project id / name / path substring. */
  projectQuery?: string;
}

function normalizeDashboardFilter(
  queryOrFilter: string | AgentDashboardFilter | undefined,
): AgentDashboardFilter {
  if (queryOrFilter == null) return {};
  if (typeof queryOrFilter === "string") return { query: queryOrFilter };
  return queryOrFilter;
}

/**
 * Filter rows by free-text query, status chip, and/or project substring.
 *
 * Accepts a plain string (legacy free-text only) or a structured
 * {@link AgentDashboardFilter}. Filters combine with AND.
 */
export function filterAgentDashboardRows(
  rows: AgentDashboardRow[],
  queryOrFilter: string | AgentDashboardFilter = "",
): AgentDashboardRow[] {
  const filter = normalizeDashboardFilter(queryOrFilter);
  const status = filter.status ?? "all";
  let out = rows;
  if (status !== "all") {
    out = out.filter((r) => r.status === status);
  }
  if (filter.projectQuery?.trim()) {
    const pq = filter.projectQuery;
    out = out.filter((r) => matchAgentDashboardProject(r, pq));
  }
  const q = (filter.query ?? "").trim().toLowerCase();
  if (!q) return out;
  return out.filter((r) => {
    const hay = [
      r.title,
      r.projectName || "",
      r.projectPath || "",
      r.projectId || "",
      r.modelId || "",
      r.effort || "",
      r.status,
      r.liveToolTitle || "",
      r.sessionId,
    ]
      .join("\n")
      .toLowerCase();
    return hay.includes(q);
  });
}

/** Exported for tests that assert state mapping without a full snapshot. */
export function dashboardStatusFromSessionState(
  state: SessionState,
): AgentDashboardStatus {
  return resolveStatusFromState(state);
}
