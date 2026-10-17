/**
 * Pure helpers for bulk-archive-by-age (sidebar / Settings).
 * Filters + preview plan + empty honesty only — host archive is still
 * `session_set_archived`. No DOM / Tauri side effects.
 */

/** Supported thresholds in the “Archive older than…” picker. */
export const ARCHIVE_AGE_DAY_OPTIONS = [7, 30, 90] as const;

export type ArchiveAgeDays = (typeof ARCHIVE_AGE_DAY_OPTIONS)[number];

/** Max titles shown in the GlassModal preview list. */
export const ARCHIVE_AGE_PREVIEW_LIMIT = 8;

export type ArchiveAgeSessionLike = {
  id: string;
  updatedAt: string;
  archived?: boolean;
  pinned?: boolean;
  /** Optional title for confirm-modal preview (never required for filter). */
  title?: string | null;
};

/**
 * Honest empty reasons when no session is eligible for archive-by-age.
 * `null` means matches exist (caller should confirm).
 */
export type ArchiveAgeEmptyKind =
  | "no_sessions"
  | "none_active"
  | "all_pinned"
  | "all_recent";

/** i18n keys for {@link ArchiveAgeEmptyKind}. */
export type ArchiveAgeEmptyMessageKey =
  | "sidebar.archiveOlderEmpty.no_sessions"
  | "sidebar.archiveOlderEmpty.none_active"
  | "sidebar.archiveOlderEmpty.all_pinned"
  | "sidebar.archiveOlderEmpty.all_recent";

/** Milliseconds for `days` full days (UTC-safe wall-clock delta). */
export function daysToMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

/**
 * True when `updatedAt` is strictly older than `days` before `now`.
 * Invalid / empty timestamps never match (safe: do not archive unknowns).
 */
export function isSessionOlderThanDays(
  updatedAt: string | undefined | null,
  days: number,
  now: Date | number = Date.now(),
): boolean {
  if (!updatedAt || !Number.isFinite(days) || days <= 0) return false;
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return false;
  const nowMs = typeof now === "number" ? now : now.getTime();
  if (!Number.isFinite(nowMs)) return false;
  return t < nowMs - daysToMs(days);
}

/**
 * Sessions eligible for bulk archive-by-age:
 * - not already archived
 * - not pinned
 * - `updatedAt` strictly older than `days` before `now`
 *
 * Preserves input order.
 */
export function filterSessionsOlderThanDays<T extends ArchiveAgeSessionLike>(
  sessions: readonly T[],
  days: number,
  now: Date | number = Date.now(),
): T[] {
  if (!Number.isFinite(days) || days <= 0) return [];
  return sessions.filter(
    (s) =>
      !s.archived &&
      !s.pinned &&
      isSessionOlderThanDays(s.updatedAt, days, now),
  );
}

/** Count of sessions eligible for archive-by-age (pure). */
export function countSessionsOlderThanDays(
  sessions: readonly ArchiveAgeSessionLike[],
  days: number,
  now: Date | number = Date.now(),
): number {
  return filterSessionsOlderThanDays(sessions, days, now).length;
}

/**
 * Resolve why nothing is eligible for archive-by-age.
 * Returns `null` when at least one session matches.
 *
 * Priority when empty:
 * 1. no_sessions — catalog empty
 * 2. none_active — every row is already archived
 * 3. all_pinned — age-matching active rows exist but all are pinned
 *    (or no unpinned active rows at all)
 * 4. all_recent — active unpinned rows exist, but none older than threshold
 */
export function resolveArchiveAgeEmpty(
  sessions: readonly ArchiveAgeSessionLike[],
  days: number,
  now: Date | number = Date.now(),
): ArchiveAgeEmptyKind | null {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return "no_sessions";
  }
  if (countSessionsOlderThanDays(sessions, days, now) > 0) {
    return null;
  }
  if (!Number.isFinite(days) || days <= 0) {
    return "all_recent";
  }

  const active = sessions.filter((s) => !s.archived);
  if (active.length === 0) return "none_active";

  const olderActive = active.filter((s) =>
    isSessionOlderThanDays(s.updatedAt, days, now),
  );
  if (olderActive.length > 0) {
    // Eligible filter already excluded pinned → every older active is pinned.
    return "all_pinned";
  }

  const activeUnpinned = active.filter((s) => !s.pinned);
  if (activeUnpinned.length === 0) return "all_pinned";
  return "all_recent";
}

/** Map empty kind → MessageKey for toast / modal honesty. */
export function archiveAgeEmptyMessageKey(
  kind: ArchiveAgeEmptyKind,
): ArchiveAgeEmptyMessageKey {
  switch (kind) {
    case "no_sessions":
      return "sidebar.archiveOlderEmpty.no_sessions";
    case "none_active":
      return "sidebar.archiveOlderEmpty.none_active";
    case "all_pinned":
      return "sidebar.archiveOlderEmpty.all_pinned";
    case "all_recent":
    default:
      return "sidebar.archiveOlderEmpty.all_recent";
  }
}

/**
 * One-line titles for GlassModal preview.
 * Empty / whitespace titles become "" so the UI can fall back to untitled.
 * Preserves input order; never invents session names.
 */
export function archiveAgePreviewTitles(
  sessions: readonly Pick<ArchiveAgeSessionLike, "id" | "title">[],
  limit: number = ARCHIVE_AGE_PREVIEW_LIMIT,
): { titles: string[]; more: number } {
  const max =
    Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : ARCHIVE_AGE_PREVIEW_LIMIT;
  const list = Array.isArray(sessions) ? sessions : [];
  const slice = list.slice(0, max);
  const titles = slice.map((s) => {
    const t = typeof s.title === "string" ? s.title.trim() : "";
    return t;
  });
  return {
    titles,
    more: Math.max(0, list.length - titles.length),
  };
}

/**
 * Pure plan for archive-by-age confirm.
 * Caller owns GlassModal + `session_set_archived`.
 */
export type ArchiveAgePlan<T extends ArchiveAgeSessionLike = ArchiveAgeSessionLike> =
  {
    days: number;
    sessions: T[];
    count: number;
    /** True when UI should open GlassModal before archiving. */
    confirmNeeded: boolean;
    /** Set when count is 0 — honest empty reason. */
    emptyKind: ArchiveAgeEmptyKind | null;
    /** Sample titles for confirm body (may include ""). */
    previewTitles: string[];
    /** Sessions beyond the preview list. */
    previewMore: number;
    /** Safe meta for logs — ids + count only, never titles. */
    logMeta: { days: number; count: number; ids: string[] } | null;
  };

/**
 * Build an archive-by-age plan for `days`.
 * Does not mutate storage or call the host.
 */
export function planArchiveOlderThan<T extends ArchiveAgeSessionLike>(
  sessions: readonly T[],
  days: number,
  now: Date | number = Date.now(),
  previewLimit: number = ARCHIVE_AGE_PREVIEW_LIMIT,
): ArchiveAgePlan<T> {
  const safeDays = Number.isFinite(days) ? days : 0;
  const matched = filterSessionsOlderThanDays(sessions, safeDays, now);
  const count = matched.length;
  const emptyKind =
    count > 0 ? null : resolveArchiveAgeEmpty(sessions, safeDays, now);
  const preview = archiveAgePreviewTitles(matched, previewLimit);
  return {
    days: safeDays,
    sessions: matched,
    count,
    confirmNeeded: count > 0,
    emptyKind,
    previewTitles: preview.titles,
    previewMore: preview.more,
    logMeta:
      count > 0
        ? {
            days: safeDays,
            count,
            ids: matched.map((s) => s.id),
          }
        : null,
  };
}

/** Live count chip for one day option (sidebar menu / Settings buttons). */
export type ArchiveAgeOptionPreview = {
  days: ArchiveAgeDays;
  count: number;
  emptyKind: ArchiveAgeEmptyKind | null;
};

/**
 * Preview counts for every supported day threshold.
 * Used to badge “Older than N days (k)” before the user confirms.
 */
export function listArchiveAgeOptionPreviews(
  sessions: readonly ArchiveAgeSessionLike[],
  now: Date | number = Date.now(),
): ArchiveAgeOptionPreview[] {
  return ARCHIVE_AGE_DAY_OPTIONS.map((days) => {
    const count = countSessionsOlderThanDays(sessions, days, now);
    return {
      days,
      count,
      emptyKind:
        count > 0 ? null : resolveArchiveAgeEmpty(sessions, days, now),
    };
  });
}

/**
 * True when at least one day option has eligible sessions.
 * Useful for empty-honesty banners on the Settings card.
 */
export function hasAnyArchiveAgeMatches(
  sessions: readonly ArchiveAgeSessionLike[],
  now: Date | number = Date.now(),
): boolean {
  return ARCHIVE_AGE_DAY_OPTIONS.some(
    (days) => countSessionsOlderThanDays(sessions, days, now) > 0,
  );
}
