/**
 * Automations Inbox — review queue over observed schedule run history.
 *
 * Pure helpers only. Built on `automationRunHistory` (process-bound ring).
 * Never invents offline runs; empty is a soft-fail honesty state.
 */

import {
  parseAutomationRunHistory,
  type AutomationRunOutcome,
  type AutomationRunOutcomeFilter,
  type AutomationRunRecord,
  type AutomationRunSource,
} from "./automationRunHistory";

/** localStorage key for ids the user has marked read in the Inbox. */
export const AUTOMATIONS_INBOX_SEEN_STORAGE_KEY = "grok.automationsInboxSeen";

/** Cap seen-id set growth (ring history is already ~50). */
export const AUTOMATIONS_INBOX_SEEN_MAX = 200;

export type AutomationsInboxItem = {
  id: string;
  /** Schedule / task id when known (may be empty). */
  scheduleId: string;
  /** Display title (name at fire time). */
  title: string;
  /** ISO-8601 timestamp. */
  at: string;
  outcome: AutomationRunOutcome;
  source: AutomationRunSource;
  /** Redacted error snippet when outcome === "error". */
  error: string | null;
  sessionId: string | null;
  projectId: string | null;
  /** True when id is not in the optional seen set. */
  unread: boolean;
  /**
   * Soft: schedule still present in the current tasks list.
   * Used only for Retry / Run now CTA — never invents a missing task.
   */
  taskExists: boolean;
};

export type AutomationsInboxTaskRef = {
  id: string;
  projectId?: string | null;
  title?: string | null;
};

export type BuildAutomationsInboxOpts = {
  /** Ids already marked read. Missing / empty → all unread when trackUnread. */
  seenIds?: Iterable<string> | ReadonlySet<string> | null;
  /**
   * Current scheduled tasks (for taskExists + projectId fallback).
   * Soft join only — never invents history rows.
   */
  tasks?: ReadonlyArray<AutomationsInboxTaskRef> | null;
  /**
   * When false, every item has unread=false (no mark-read UX).
   * Default true.
   */
  trackUnread?: boolean;
};

export type FilterInboxOpts = {
  outcome?: AutomationRunOutcomeFilter;
  query?: string | null;
};

export type AutomationsInboxEmptyState =
  | "empty"
  | "filter"
  | "process_bound_hint";

export type PlanOpenInboxItem =
  | { kind: "session"; sessionId: string; projectId?: string }
  | { kind: "project"; projectId: string }
  | { kind: "none" };

export type PlanRetryAutomation =
  | { canRetry: true; taskId: string }
  | { canRetry: false; reason: "no_task_id" | "task_missing" };

/** Minimal storage surface so unit tests need no jsdom. */
export interface AutomationsInboxStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): AutomationsInboxStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

function scrubId(raw: unknown, max = 120): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
}

function toSeenSet(
  seenIds?: Iterable<string> | ReadonlySet<string> | null,
): Set<string> {
  if (!seenIds) return new Set();
  if (seenIds instanceof Set) {
    const out = new Set<string>();
    for (const id of seenIds) {
      const s = scrubId(id);
      if (s) out.add(s);
    }
    return out;
  }
  const out = new Set<string>();
  for (const id of seenIds) {
    const s = scrubId(id);
    if (s) out.add(s);
  }
  return out;
}

function tasksById(
  tasks?: ReadonlyArray<AutomationsInboxTaskRef> | null,
): Map<string, AutomationsInboxTaskRef> {
  const map = new Map<string, AutomationsInboxTaskRef>();
  if (!tasks) return map;
  for (const t of tasks) {
    const id = scrubId(t?.id);
    if (!id) continue;
    map.set(id, t);
  }
  return map;
}

/**
 * Build Inbox rows from observed run history (newest first).
 * Soft-fails corrupt history to []. Never invents offline fires.
 */
export function buildAutomationsInbox(
  history: readonly AutomationRunRecord[] | unknown,
  opts: BuildAutomationsInboxOpts = {},
): AutomationsInboxItem[] {
  const cleaned = parseAutomationRunHistory(history);
  const seen = toSeenSet(opts.seenIds);
  const trackUnread = opts.trackUnread !== false;
  const taskMap = tasksById(opts.tasks);

  return cleaned.map((row) => {
    const scheduleId = scrubId(row.scheduleId);
    const task = scheduleId ? taskMap.get(scheduleId) : undefined;
    const sessionId = scrubId(row.sessionId);
    const fromRow = scrubId(row.projectId);
    const fromTask = scrubId(task?.projectId ?? "");
    const projectId = fromRow || fromTask || "";

    return {
      id: row.id,
      scheduleId,
      title: row.name || scheduleId || "automation",
      at: row.at,
      outcome: row.outcome,
      source: row.source,
      error: row.error ?? null,
      sessionId: sessionId || null,
      projectId: projectId || null,
      unread: trackUnread ? !seen.has(row.id) : false,
      taskExists: !!task,
    };
  });
}

/**
 * Filter Inbox items by outcome chip and free-text query (title / error / id).
 */
export function filterInbox(
  items: readonly AutomationsInboxItem[],
  opts: FilterInboxOpts = {},
): AutomationsInboxItem[] {
  const outcome = opts.outcome ?? "all";
  const q = (opts.query ?? "").trim().toLowerCase();

  return items.filter((item) => {
    if (outcome !== "all" && item.outcome !== outcome) return false;
    if (!q) return true;
    const hay = [
      item.title,
      item.error ?? "",
      item.scheduleId,
      item.id,
      item.sessionId ?? "",
      item.projectId ?? "",
      item.outcome,
      item.source,
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

/** Counts per outcome for chip labels (from unfiltered Inbox items). */
export function countInboxByOutcome(
  items: readonly AutomationsInboxItem[],
): Record<AutomationRunOutcomeFilter, number> {
  const counts: Record<AutomationRunOutcomeFilter, number> = {
    all: items.length,
    ok: 0,
    error: 0,
    skipped: 0,
  };
  for (const e of items) {
    counts[e.outcome] += 1;
  }
  return counts;
}

/**
 * Empty-state kind for the Inbox list.
 * - process_bound_hint: no observed runs (honest empty; process-bound)
 * - filter: history exists but chips/query match nothing
 * - empty: soft fallback
 * Returns null when the filtered list is non-empty.
 */
export function resolveInboxEmptyState(input: {
  totalCount: number;
  filteredCount: number;
  outcomeFilter?: AutomationRunOutcomeFilter;
  query?: string | null;
}): AutomationsInboxEmptyState | null {
  const total =
    typeof input.totalCount === "number" && Number.isFinite(input.totalCount)
      ? Math.max(0, Math.floor(input.totalCount))
      : 0;
  const filtered =
    typeof input.filteredCount === "number" &&
    Number.isFinite(input.filteredCount)
      ? Math.max(0, Math.floor(input.filteredCount))
      : 0;

  if (filtered > 0) return null;
  if (total === 0) return "process_bound_hint";

  const q = (input.query ?? "").trim();
  const f = input.outcomeFilter ?? "all";
  if (q || f !== "all") return "filter";
  return "empty";
}

/**
 * Plan navigation for an Inbox row.
 * Prefers linked session when known; else project; else none.
 * Soft — never invents ids.
 */
export function planOpenInboxItem(
  item: Pick<AutomationsInboxItem, "sessionId" | "projectId"> | null | undefined,
): PlanOpenInboxItem {
  if (!item) return { kind: "none" };
  const sessionId = scrubId(item.sessionId);
  const projectId = scrubId(item.projectId);
  if (sessionId) {
    return projectId
      ? { kind: "session", sessionId, projectId }
      : { kind: "session", sessionId };
  }
  if (projectId) return { kind: "project", projectId };
  return { kind: "none" };
}

/**
 * Soft retry plan: only when scheduleId is present **and** the task still exists.
 * UI must call existing run-now with the live task — never invent a payload.
 */
export function planRetryAutomation(
  item:
    | Pick<AutomationsInboxItem, "scheduleId" | "taskExists">
    | null
    | undefined,
): PlanRetryAutomation {
  if (!item) return { canRetry: false, reason: "no_task_id" };
  const taskId = scrubId(item.scheduleId);
  if (!taskId) return { canRetry: false, reason: "no_task_id" };
  if (!item.taskExists) return { canRetry: false, reason: "task_missing" };
  return { canRetry: true, taskId };
}

/** Parse stored JSON array of seen run ids. Soft-fails to empty Set. */
export function parseInboxSeenIds(raw: unknown): Set<string> {
  if (raw == null || raw === "") return new Set();
  let value: unknown = raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return new Set();
    try {
      value = JSON.parse(t);
    } catch {
      return new Set();
    }
  }
  if (!Array.isArray(value)) return new Set();
  const out = new Set<string>();
  for (const item of value) {
    const id = scrubId(item);
    if (id) out.add(id);
    if (out.size >= AUTOMATIONS_INBOX_SEEN_MAX) break;
  }
  return out;
}

export function loadInboxSeenIds(
  storage: AutomationsInboxStorage = defaultStorage(),
): Set<string> {
  try {
    return parseInboxSeenIds(
      storage.getItem(AUTOMATIONS_INBOX_SEEN_STORAGE_KEY),
    );
  } catch {
    return new Set();
  }
}

export function saveInboxSeenIds(
  ids: Iterable<string>,
  storage: AutomationsInboxStorage = defaultStorage(),
): Set<string> {
  const unique = new Set<string>();
  for (const item of ids) {
    const id = scrubId(item);
    if (id) unique.add(id);
    if (unique.size >= AUTOMATIONS_INBOX_SEEN_MAX) break;
  }
  // Keep a stable newest-ish order: insertion order of the Set as given.
  const list = Array.from(unique).slice(-AUTOMATIONS_INBOX_SEEN_MAX);
  try {
    storage.setItem(AUTOMATIONS_INBOX_SEEN_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* private mode / quota */
  }
  return new Set(list);
}

/** Mark one Inbox row read. Returns updated seen set. */
export function markInboxItemRead(
  id: string | null | undefined,
  storage: AutomationsInboxStorage = defaultStorage(),
): Set<string> {
  const sid = scrubId(id);
  if (!sid) return loadInboxSeenIds(storage);
  const next = loadInboxSeenIds(storage);
  next.add(sid);
  return saveInboxSeenIds(next, storage);
}

/** Mark every provided id read (mark-all). Returns updated seen set. */
export function markAllInboxRead(
  itemIds: Iterable<string>,
  storage: AutomationsInboxStorage = defaultStorage(),
): Set<string> {
  const next = loadInboxSeenIds(storage);
  for (const raw of itemIds) {
    const id = scrubId(raw);
    if (id) next.add(id);
  }
  return saveInboxSeenIds(next, storage);
}

/** Whether a run id is still unread given a seen set. */
export function isInboxItemUnread(
  id: string | null | undefined,
  seenIds: Iterable<string> | ReadonlySet<string> | null | undefined,
): boolean {
  const sid = scrubId(id);
  if (!sid) return false;
  return !toSeenSet(seenIds).has(sid);
}

/** Wipe seen markers (e.g. after clear history). Soft no-op on failure. */
export function clearInboxSeenIds(
  storage: AutomationsInboxStorage = defaultStorage(),
): Set<string> {
  return saveInboxSeenIds([], storage);
}
