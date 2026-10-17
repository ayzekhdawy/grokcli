/**
 * Automation / schedule run history — local observable ring buffer.
 *
 * Records fires the UI actually observes: host `automation://ran` /
 * `automation://error` while the process is alive, and client "Run now"
 * outcomes. Newest first, max ~50, localStorage only.
 *
 * **Honest model:** process-bound. This never invents background fires after
 * Quit. Empty history is a soft-fail empty state, not a claim that nothing
 * was due offline.
 */

import { redact } from "./redact";

export type AutomationRunOutcome = "ok" | "error" | "skipped";

export type AutomationRunSource = "host" | "run_now" | "unknown";

export type AutomationRunRecord = {
  /** Stable id for list keys / remove. */
  id: string;
  /** Automation schedule id (may be empty for edge payloads). */
  scheduleId: string;
  /** Display name at fire time. */
  name: string;
  /** ISO-8601 timestamp. */
  at: string;
  outcome: AutomationRunOutcome;
  /** Redacted short error when outcome === "error". */
  error?: string | null;
  /** How this row was observed. */
  source: AutomationRunSource;
  /**
   * Session created for this fire when known (host runner / Run now).
   * Soft optional — never invented after Quit.
   */
  sessionId?: string | null;
  /** Project the schedule was bound to when known. */
  projectId?: string | null;
};

export type AutomationRunOutcomeFilter = "all" | AutomationRunOutcome;

export const AUTOMATION_RUN_HISTORY_STORAGE_KEY = "grok.automationRunHistory";
export const AUTOMATION_RUN_HISTORY_MAX = 50;
/** Cap redacted error text in storage / UI. */
export const AUTOMATION_RUN_ERROR_MAX = 280;
export const AUTOMATION_RUN_NAME_MAX = 160;
export const AUTOMATION_RUN_ID_MAX = 80;

/** Fired on `window` after load/save/clear (detail = entries). */
export const AUTOMATION_RUN_HISTORY_CHANGE_EVENT =
  "grok-automation-run-history-change";

const OUTCOMES = new Set<string>(["ok", "error", "skipped"]);
const SOURCES = new Set<string>(["host", "run_now", "unknown"]);

/** Minimal storage surface so unit tests need no jsdom. */
export interface AutomationRunHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): AutomationRunHistoryStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

function scrub(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  let s = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  if (!s) return "";
  if (s.length > max) s = s.slice(0, max);
  return s;
}

/**
 * Redact secrets and clamp error text for storage / list display.
 * Empty after scrub → null (no invented message).
 */
export function redactAutomationRunError(raw: unknown): string | null {
  let text = "";
  if (raw instanceof Error) text = raw.message;
  else if (typeof raw === "string") text = raw;
  else if (raw != null) text = String(raw);
  text = scrub(text, AUTOMATION_RUN_ERROR_MAX * 2);
  if (!text) return null;
  try {
    text = redact(text);
  } catch {
    /* keep scrubbed */
  }
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length > AUTOMATION_RUN_ERROR_MAX) {
    text = `${text.slice(0, AUTOMATION_RUN_ERROR_MAX - 1)}…`;
  }
  return text;
}

/** New id for a run record (crypto when available). */
export function newAutomationRunId(now = Date.now()): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `ar-${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through */
  }
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `ar-${now.toString(36)}-${rand}`;
}

/**
 * Normalize one raw object into an AutomationRunRecord, or null if invalid.
 */
export function parseAutomationRunRecord(raw: unknown): AutomationRunRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const outcomeRaw = scrub(o.outcome, 32).toLowerCase();
  if (!OUTCOMES.has(outcomeRaw)) return null;
  const outcome = outcomeRaw as AutomationRunOutcome;

  const scheduleId = scrub(
    o.scheduleId ?? o.automationId ?? o.schedule_id ?? o.automation_id,
    AUTOMATION_RUN_ID_MAX,
  );
  const name =
    scrub(o.name ?? o.title, AUTOMATION_RUN_NAME_MAX) ||
    (scheduleId ? scheduleId : "automation");

  const id = scrub(o.id, AUTOMATION_RUN_ID_MAX) || newAutomationRunId();

  const atRaw = scrub(o.at ?? o.ts ?? o.timestamp, 64);
  const at = atRaw || new Date(0).toISOString();

  const sourceRaw = scrub(o.source, 32).toLowerCase();
  const source: AutomationRunSource = SOURCES.has(sourceRaw)
    ? (sourceRaw as AutomationRunSource)
    : "unknown";

  const error =
    outcome === "error" ? redactAutomationRunError(o.error ?? o.detail) : null;

  const sessionId = scrub(
    o.sessionId ?? o.session_id,
    AUTOMATION_RUN_ID_MAX,
  );
  const projectId = scrub(
    o.projectId ?? o.project_id,
    AUTOMATION_RUN_ID_MAX,
  );

  return {
    id,
    scheduleId,
    name,
    at,
    outcome,
    source,
    ...(error ? { error } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(projectId ? { projectId } : {}),
  };
}

/**
 * Parse stored JSON into a clean, newest-first list (capped).
 * Soft-fails corrupt / partial data to [].
 */
export function parseAutomationRunHistory(
  raw: unknown,
  max = AUTOMATION_RUN_HISTORY_MAX,
): AutomationRunRecord[] {
  const lim =
    typeof max === "number" && Number.isFinite(max) && max > 0
      ? Math.min(500, Math.floor(max))
      : AUTOMATION_RUN_HISTORY_MAX;

  let list: unknown[] = [];
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    try {
      const parsed = JSON.parse(t) as unknown;
      if (Array.isArray(parsed)) list = parsed;
      else return [];
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    list = raw;
  } else {
    return [];
  }

  const out: AutomationRunRecord[] = [];
  for (const item of list) {
    const e = parseAutomationRunRecord(item);
    if (!e) continue;
    out.push(e);
    if (out.length >= lim) break;
  }
  return out;
}

/**
 * Pure ring-buffer push: newest first, max length. Does not touch storage.
 */
export function pushAutomationRun(
  existing: readonly AutomationRunRecord[],
  entry: AutomationRunRecord | Record<string, unknown>,
  max = AUTOMATION_RUN_HISTORY_MAX,
): AutomationRunRecord[] {
  const next = parseAutomationRunRecord(entry);
  if (!next) return parseAutomationRunHistory(existing, max);
  const cleaned = parseAutomationRunHistory(existing, max);
  // Dedupe identical id if re-appended.
  const without = cleaned.filter((e) => e.id !== next.id);
  return parseAutomationRunHistory([next, ...without], max);
}

export function loadAutomationRunHistory(
  storage: AutomationRunHistoryStorage = defaultStorage(),
  max = AUTOMATION_RUN_HISTORY_MAX,
): AutomationRunRecord[] {
  try {
    return parseAutomationRunHistory(
      storage.getItem(AUTOMATION_RUN_HISTORY_STORAGE_KEY),
      max,
    );
  } catch {
    return [];
  }
}

export function saveAutomationRunHistory(
  entries: readonly AutomationRunRecord[],
  storage: AutomationRunHistoryStorage = defaultStorage(),
  max = AUTOMATION_RUN_HISTORY_MAX,
): void {
  const clean = parseAutomationRunHistory(entries, max);
  try {
    storage.setItem(AUTOMATION_RUN_HISTORY_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    /* private mode / quota */
  }
}

/**
 * Record an observed fire: load → push → save → notify.
 * Returns the updated list. Invalid input is a soft no-op (returns current).
 */
export function recordAutomationRun(
  input: {
    scheduleId?: string | null;
    name?: string | null;
    title?: string | null;
    at?: string;
    outcome: AutomationRunOutcome;
    error?: unknown;
    source?: AutomationRunSource;
    id?: string;
    sessionId?: string | null;
    projectId?: string | null;
  },
  storage: AutomationRunHistoryStorage = defaultStorage(),
  max = AUTOMATION_RUN_HISTORY_MAX,
): AutomationRunRecord[] {
  const name = (input.name ?? input.title ?? "").toString();
  const sessionId = scrub(input.sessionId, AUTOMATION_RUN_ID_MAX);
  const projectId = scrub(input.projectId, AUTOMATION_RUN_ID_MAX);
  const entry: AutomationRunRecord = {
    id: input.id || newAutomationRunId(),
    scheduleId: (input.scheduleId ?? "").toString(),
    name: name || "automation",
    at: input.at || new Date().toISOString(),
    outcome: input.outcome,
    source: input.source ?? "unknown",
    ...(input.outcome === "error"
      ? { error: redactAutomationRunError(input.error) }
      : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(projectId ? { projectId } : {}),
  };
  const next = pushAutomationRun(
    loadAutomationRunHistory(storage, max),
    entry,
    max,
  );
  saveAutomationRunHistory(next, storage, max);
  notifyAutomationRunHistoryChange(next);
  return next;
}

/**
 * Filter history by outcome chip. "all" returns cleaned list as-is.
 */
export function filterAutomationRunHistory(
  history: readonly AutomationRunRecord[],
  filter: AutomationRunOutcomeFilter = "all",
): AutomationRunRecord[] {
  const cleaned = parseAutomationRunHistory(history);
  if (filter === "all") return cleaned;
  return cleaned.filter((e) => e.outcome === filter);
}

/** Counts per outcome for chip labels. */
export function countAutomationRunOutcomes(
  history: readonly AutomationRunRecord[],
): Record<AutomationRunOutcomeFilter, number> {
  const cleaned = parseAutomationRunHistory(history);
  const counts: Record<AutomationRunOutcomeFilter, number> = {
    all: cleaned.length,
    ok: 0,
    error: 0,
    skipped: 0,
  };
  for (const e of cleaned) {
    counts[e.outcome] += 1;
  }
  return counts;
}

/**
 * Wipe the local ring (empty list + notify). Soft no-op on storage failure.
 */
export function clearAutomationRunHistory(
  storage: AutomationRunHistoryStorage = defaultStorage(),
): AutomationRunRecord[] {
  saveAutomationRunHistory([], storage);
  notifyAutomationRunHistoryChange([]);
  return [];
}

function notifyAutomationRunHistoryChange(
  next: readonly AutomationRunRecord[],
): void {
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(AUTOMATION_RUN_HISTORY_CHANGE_EVENT, {
          detail: next,
        }),
      );
    } catch {
      /* ignore */
    }
  }
}
