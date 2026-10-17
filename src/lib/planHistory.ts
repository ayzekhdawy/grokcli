/**
 * Local archive of reviewed plans (localStorage ring buffer).
 *
 * Records a short, redacted body preview when a plan is approved, abandoned,
 * or completes — never full secrets or unbounded payloads.
 * Entries: { sessionId, title?, bodyPreview, decision, at }, max 30, newest first.
 */

import { redact } from "@/lib/redact";

export type PlanHistoryDecision = "approved" | "abandoned" | "completed";

export type PlanHistoryEntry = {
  sessionId: string;
  title?: string;
  /** Truncated, redacted plan body for read-only preview. */
  bodyPreview: string;
  decision: PlanHistoryDecision;
  /** ISO-8601 timestamp. */
  at: string;
};

export const PLAN_HISTORY_STORAGE_KEY = "grok.planHistory";
export const PLAN_HISTORY_MAX = 30;
/** Cap stored preview size (characters) — keeps localStorage lean. */
export const PLAN_HISTORY_BODY_PREVIEW_MAX = 2000;
/** Cap stored title length. */
export const PLAN_HISTORY_TITLE_MAX = 200;

/** Fired on `window` after a successful record (detail = entries). */
export const PLAN_HISTORY_CHANGE_EVENT = "grok-plan-history-change";

const DECISIONS = new Set<PlanHistoryDecision>([
  "approved",
  "abandoned",
  "completed",
]);

/** Minimal storage surface so unit tests need no jsdom. */
export interface PlanHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): PlanHistoryStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/**
 * Build a safe body preview: strip NULs, redact common secret patterns, cap length.
 * Keeps newlines so Markdown preview remains readable.
 */
export function planHistoryBodyPreview(
  text: string | null | undefined,
  max = PLAN_HISTORY_BODY_PREVIEW_MAX,
): string {
  const raw = typeof text === "string" ? text : "";
  const cleaned = raw.replace(/\u0000/g, "").trim();
  if (!cleaned) return "";
  let redacted: string;
  try {
    redacted = redact(cleaned);
  } catch {
    redacted = cleaned;
  }
  if (redacted.length <= max) return redacted;
  return `${redacted.slice(0, Math.max(1, max - 1))}…`;
}

/** Normalize optional title (trim, cap, omit empty). */
export function planHistoryTitle(
  title: string | null | undefined,
): string | undefined {
  if (typeof title !== "string") return undefined;
  const t = title.trim();
  if (!t) return undefined;
  return t.slice(0, PLAN_HISTORY_TITLE_MAX);
}

/**
 * Normalize one raw object into a PlanHistoryEntry, or null if invalid.
 * Only known fields; drops unknown keys that could carry secrets.
 */
export function parsePlanHistoryEntry(raw: unknown): PlanHistoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sessionId =
    typeof o.sessionId === "string" ? o.sessionId.trim() : "";
  if (!sessionId) return null;

  const decisionRaw =
    typeof o.decision === "string" ? o.decision.trim().toLowerCase() : "";
  if (!DECISIONS.has(decisionRaw as PlanHistoryDecision)) return null;
  const decision = decisionRaw as PlanHistoryDecision;

  const at =
    typeof o.at === "string" && o.at.trim()
      ? o.at.trim()
      : new Date(0).toISOString();

  const bodyPreview = planHistoryBodyPreview(
    typeof o.bodyPreview === "string" ? o.bodyPreview : "",
  );

  const title = planHistoryTitle(
    typeof o.title === "string" ? o.title : undefined,
  );

  return {
    sessionId,
    bodyPreview,
    decision,
    at,
    ...(title ? { title } : {}),
  };
}

/**
 * Parse stored JSON into a clean, newest-first list (capped).
 * Tolerates corrupt / partial data.
 */
export function parsePlanHistory(
  raw: unknown,
  max = PLAN_HISTORY_MAX,
): PlanHistoryEntry[] {
  let list: unknown[] = [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    list = raw;
  } else {
    return [];
  }

  const out: PlanHistoryEntry[] = [];
  for (const item of list) {
    const e = parsePlanHistoryEntry(item);
    if (!e) continue;
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Pure ring-buffer push: newest first, max length.
 * Does not touch storage. Each decision is a distinct row (no path-style dedupe).
 */
export function pushPlanHistory(
  existing: readonly PlanHistoryEntry[],
  entry: PlanHistoryEntry,
  max = PLAN_HISTORY_MAX,
): PlanHistoryEntry[] {
  const next = parsePlanHistoryEntry(entry);
  if (!next) return parsePlanHistory(existing, max);
  return parsePlanHistory([next, ...existing], max);
}

export function loadPlanHistory(
  storage: PlanHistoryStorage = defaultStorage(),
  max = PLAN_HISTORY_MAX,
): PlanHistoryEntry[] {
  try {
    return parsePlanHistory(
      storage.getItem(PLAN_HISTORY_STORAGE_KEY),
      max,
    );
  } catch {
    /* private mode */
    return [];
  }
}

export function savePlanHistory(
  entries: readonly PlanHistoryEntry[],
  storage: PlanHistoryStorage = defaultStorage(),
  max = PLAN_HISTORY_MAX,
): void {
  const clean = parsePlanHistory(entries, max);
  try {
    storage.setItem(PLAN_HISTORY_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    /* private mode / quota */
  }
}

/**
 * Record a plan decision: load → push → save → notify.
 * Returns the updated list.
 */
export function recordPlanHistory(
  input: {
    sessionId: string;
    decision: PlanHistoryDecision;
    title?: string | null;
    body?: string | null;
    /** Prefer pre-built preview when body was assembled from entries. */
    bodyPreview?: string | null;
    at?: string;
  },
  storage: PlanHistoryStorage = defaultStorage(),
  max = PLAN_HISTORY_MAX,
): PlanHistoryEntry[] {
  const sessionId =
    typeof input.sessionId === "string" ? input.sessionId.trim() : "";
  if (!sessionId) return loadPlanHistory(storage, max);
  if (!DECISIONS.has(input.decision)) return loadPlanHistory(storage, max);

  const previewSource =
    typeof input.bodyPreview === "string" && input.bodyPreview.trim()
      ? input.bodyPreview
      : (input.body ?? "");

  const entry: PlanHistoryEntry = {
    sessionId,
    decision: input.decision,
    bodyPreview: planHistoryBodyPreview(previewSource),
    at: input.at || new Date().toISOString(),
    ...(planHistoryTitle(input.title ?? undefined)
      ? { title: planHistoryTitle(input.title ?? undefined) }
      : {}),
  };

  const next = pushPlanHistory(loadPlanHistory(storage, max), entry, max);
  savePlanHistory(next, storage, max);
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(PLAN_HISTORY_CHANGE_EVENT, { detail: next }),
      );
    } catch {
      /* ignore */
    }
  }
  return next;
}

/** Short label for list rows: title, else session id prefix. */
export function planHistoryLabel(entry: PlanHistoryEntry): string {
  const t = (entry.title || "").trim();
  if (t) return t;
  const id = entry.sessionId.trim();
  if (id.length <= 12) return id;
  return id.slice(0, 8) + "…";
}

/** One-line list preview of body (collapsed whitespace). */
export function planHistoryListSnippet(
  entry: PlanHistoryEntry,
  maxLen = 100,
): string {
  const flat = (entry.bodyPreview || "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  if (flat.length <= maxLen) return flat;
  return `${flat.slice(0, Math.max(1, maxLen - 1))}…`;
}

/** Stable list key (session + decision + time). */
export function planHistoryEntryKey(entry: PlanHistoryEntry): string {
  return `${entry.sessionId}|${entry.decision}|${entry.at}`;
}

/**
 * Filter history by free-text query and/or decision chips.
 * Empty / whitespace query matches all (still respects decision filter).
 * Query matches title, body preview, list label, or session id (case-insensitive substring).
 * Empty `decisions` / omitted / `"all"` means every decision.
 */
export function filterPlanHistory(
  entries: readonly PlanHistoryEntry[],
  opts?: {
    query?: string | null;
    decisions?: readonly PlanHistoryDecision[] | "all" | null;
  },
): PlanHistoryEntry[] {
  const q = (opts?.query ?? "").trim().toLowerCase();
  const raw = opts?.decisions;
  let decisionSet: Set<PlanHistoryDecision> | null = null;
  if (raw && raw !== "all" && Array.isArray(raw) && raw.length > 0) {
    decisionSet = new Set(
      raw.filter((d): d is PlanHistoryDecision => DECISIONS.has(d)),
    );
    if (decisionSet.size === 0) decisionSet = null;
  }

  if (!q && !decisionSet) return entries.slice();

  return entries.filter((e) => {
    if (decisionSet && !decisionSet.has(e.decision)) return false;
    if (!q) return true;
    const title = (e.title || "").toLowerCase();
    const preview = (e.bodyPreview || "").toLowerCase();
    const label = planHistoryLabel(e).toLowerCase();
    const sessionId = e.sessionId.toLowerCase();
    return (
      title.includes(q) ||
      preview.includes(q) ||
      label.includes(q) ||
      sessionId.includes(q)
    );
  });
}

/**
 * Wipe the local plan history archive (empty list + notify listeners).
 * Returns the empty list. Safe no-op on storage failure.
 */
export function clearPlanHistory(
  storage: PlanHistoryStorage = defaultStorage(),
): PlanHistoryEntry[] {
  savePlanHistory([], storage);
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(PLAN_HISTORY_CHANGE_EVENT, { detail: [] }),
      );
    } catch {
      /* ignore */
    }
  }
  return [];
}
