/**
 * Localized work duration labels for chat activity chrome
 * ("Worked for …" / "Working for …").
 *
 * en: 38s · 1m 2s · 1h 3m
 * zh / zh-TW: 38秒 · 1分2秒 · 1小时3分
 */

import type { Locale } from "@/i18n";
import { t } from "@/i18n";

/** Format elapsed seconds with locale-aware unit strings. */
export function formatWorkDuration(
  totalSeconds: number,
  locale: Locale = "en",
): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return t(locale, "chat.duration.seconds", { n: s });
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    if (m === 0 && sec === 0) {
      return t(locale, "chat.duration.hours", { n: h });
    }
    if (sec === 0) {
      return t(locale, "chat.duration.hoursMinutes", { h, m });
    }
    return t(locale, "chat.duration.hoursMinutesSeconds", {
      h,
      m,
      s: sec,
    });
  }
  if (sec === 0) return t(locale, "chat.duration.minutes", { n: m });
  return t(locale, "chat.duration.minutesSeconds", { m, s: sec });
}

/**
 * Estimate phase work duration from ISO timestamps (history reload).
 * Prefer tool span; fall back to assistant createdAt − earliest tool.
 * Returns null when timestamps are missing or inverted.
 */
export function estimateDurationSecFromTimestamps(
  times: Array<string | undefined | null>,
): number | null {
  const ms = times
    .map((t) => (t ? Date.parse(t) : NaN))
    .filter((n) => Number.isFinite(n)) as number[];
  if (ms.length < 2) {
    // Single timestamp is not enough for a span.
    return null;
  }
  const min = Math.min(...ms);
  const max = Math.max(...ms);
  const sec = Math.floor((max - min) / 1000);
  if (sec < 1) return 1;
  // Guard absurd journal clock skew.
  if (sec > 24 * 3600) return null;
  return sec;
}

/** Earliest parseable ISO time in ms, or null. */
export function earliestTimestampMs(
  times: Array<string | undefined | null>,
): number | null {
  let min: number | null = null;
  for (const t of times) {
    if (!t) continue;
    const n = Date.parse(t);
    if (!Number.isFinite(n)) continue;
    if (min == null || n < min) min = n;
  }
  return min;
}

/**
 * Pick the label duration for a work phase.
 *
 * Live wall-clock alone is wrong when content splits phases mid-turn (timer
 * restarts on the trailing phase) or when a phase remounts after segment
 * reorder — that often freezes at a few seconds and used to *override* the
 * real tool-span from journal timestamps. Always take the larger of live and
 * history so "Worked for …" matches the actual work window.
 */
export function resolveWorkDurationSec(opts: {
  liveSec: number | null | undefined;
  historySec: number | null | undefined;
}): number | null {
  const live =
    opts.liveSec != null && opts.liveSec > 0 ? Math.floor(opts.liveSec) : null;
  const history =
    opts.historySec != null && opts.historySec > 0
      ? Math.floor(opts.historySec)
      : null;
  if (live != null && history != null) return Math.max(live, history);
  return live ?? history;
}
