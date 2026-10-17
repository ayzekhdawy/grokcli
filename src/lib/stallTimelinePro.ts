/**
 * STALL-TIMELINE-PRO — pure helpers for Reliability Stall timeline deep actions.
 *
 * Builds on {@link reliabilityCenter} history (localStorage ring). Open-session
 * plan (when chat still present), empty honesty (none vs filter), duration
 * labels. No DOM / Tauri side effects. Never invents session ids or stall rows.
 */

import type { Locale } from "@/i18n";
import { formatWorkDuration } from "@/lib/formatWorkDuration";
import {
  hasActiveStallHistoryFilters,
  type StallHistoryEntry,
  type StallHistoryKindFilter,
} from "@/lib/reliabilityStallHistory";

// ── Open session ─────────────────────────────────────────────────────────────

/**
 * Result of planning an "Open session" deep action from a stall timeline row.
 * `ok: true` only when there is a non-empty session id **and** (when a presence
 * set is supplied) that id is still in the app session list.
 */
export type OpenStallSessionPlan =
  | {
      ok: true;
      sessionId: string;
      /** Always true when `ok` — session is considered openable. */
      sessionPresent: true;
    }
  | {
      ok: false;
      reason: "no_session_id" | "session_missing";
      sessionId: string | null;
    };

function toSessionIdSet(
  ids: ReadonlySet<string> | readonly string[] | null | undefined,
): ReadonlySet<string> | null {
  if (ids == null) return null;
  if (ids instanceof Set) return ids;
  return new Set(ids);
}

/**
 * Normalize a stall row's session id for deep-link open.
 * Empty / whitespace / non-string → null.
 */
export function stallEntrySessionId(
  entry:
    | Pick<StallHistoryEntry, "sessionId">
    | { sessionId?: string | null }
    | null
    | undefined,
): string | null {
  if (!entry) return null;
  const raw = entry.sessionId;
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return id || null;
}

/**
 * Plan opening the chat that produced a stall timeline row.
 *
 * - No / blank session id → `{ ok: false, reason: "no_session_id" }`
 * - When `existingSessionIds` is provided and does **not** contain the id →
 *   `{ ok: false, reason: "session_missing" }` (session no longer present)
 * - When `existingSessionIds` is omitted / null → id alone is enough to open
 *   (caller owns presence checks)
 * - Otherwise → `{ ok: true, sessionId, sessionPresent: true }`
 *
 * Pure: never invents a session id from title/reason.
 */
export function planOpenStallSession(
  entry:
    | Pick<StallHistoryEntry, "sessionId">
    | { sessionId?: string | null }
    | null
    | undefined,
  existingSessionIds?: ReadonlySet<string> | readonly string[] | null,
): OpenStallSessionPlan {
  const sessionId = stallEntrySessionId(entry);
  if (!sessionId) {
    return { ok: false, reason: "no_session_id", sessionId: null };
  }

  const set = toSessionIdSet(existingSessionIds);
  if (set != null && !set.has(sessionId)) {
    return { ok: false, reason: "session_missing", sessionId };
  }

  return { ok: true, sessionId, sessionPresent: true };
}

/**
 * Whether the Open session control should render for a stall row.
 * Requires a successful {@link planOpenStallSession} (session still present
 * when a presence set is supplied).
 */
export function canOpenStallSession(
  entry:
    | Pick<StallHistoryEntry, "sessionId">
    | { sessionId?: string | null }
    | null
    | undefined,
  existingSessionIds?: ReadonlySet<string> | readonly string[] | null,
): boolean {
  return planOpenStallSession(entry, existingSessionIds).ok;
}

// ── Empty honesty ────────────────────────────────────────────────────────────

/** Contextual empty surfaces for the stall timeline list. */
export type StallTimelineEmptyKind = "empty" | "filter_empty";

export type StallTimelineEmptyPresentation = {
  kind: StallTimelineEmptyKind;
  /** Primary title i18n key under reliability.timeline.*. */
  titleKey: string;
  /** Optional hint i18n key. */
  hintKey: string | null;
  /** Offer clear-filters CTA. */
  showClearFilters: boolean;
};

export type StallTimelineEmptyInput = {
  /** Total history rows (pre filter). */
  total: number;
  /** Visible rows after filters. */
  filtered: number;
  /** Status chip or free-text active (optional; inferred from query/kind). */
  hasFilters?: boolean;
  query?: string | null;
  kind?: StallHistoryKindFilter | null;
};

/**
 * Resolve which empty surface to show for the stall timeline.
 * Returns `null` when filtered rows should render.
 *
 * Priority:
 * 1. filtered > 0 → null
 * 2. total == 0 → empty (no history yet — honest, never invent rows)
 * 3. total > 0 + filters + filtered == 0 → filter_empty (+ clear CTA)
 *
 * Never invents stall history when the ring buffer is empty.
 */
export function resolveStallTimelineEmptyState(
  input: StallTimelineEmptyInput,
): StallTimelineEmptyPresentation | null {
  const total = Math.max(0, Math.floor(Number(input.total) || 0));
  const filtered = Math.max(0, Math.floor(Number(input.filtered) || 0));

  if (filtered > 0) return null;

  const hasFilters =
    input.hasFilters != null
      ? Boolean(input.hasFilters)
      : hasActiveStallHistoryFilters({
          query: input.query,
          kind: input.kind,
        });

  if (total === 0) {
    return {
      kind: "empty",
      titleKey: "reliability.timeline.empty",
      hintKey: "reliability.timeline.emptyHint",
      showClearFilters: false,
    };
  }

  if (hasFilters) {
    return {
      kind: "filter_empty",
      titleKey: "reliability.timeline.emptyFilter",
      hintKey: "reliability.timeline.emptyFilterHint",
      showClearFilters: true,
    };
  }

  // Total > 0 but filtered 0 without filters should not happen; soft fallback.
  return {
    kind: "empty",
    titleKey: "reliability.timeline.empty",
    hintKey: "reliability.timeline.emptyHint",
    showClearFilters: false,
  };
}

// ── Duration display ─────────────────────────────────────────────────────────

/**
 * Human-readable quiet duration for a stall row.
 * Returns `null` when unknown / non-positive — never invents a duration.
 * Locale-aware via {@link formatWorkDuration} (en: 1m 2s · zh: 1分2秒).
 */
export function formatStallDuration(
  stallSeconds: number | null | undefined,
  locale: Locale = "en",
): string | null {
  if (stallSeconds == null) return null;
  if (typeof stallSeconds !== "number" || !Number.isFinite(stallSeconds)) {
    return null;
  }
  const s = Math.floor(stallSeconds);
  if (s <= 0) return null;
  return formatWorkDuration(s, locale);
}
