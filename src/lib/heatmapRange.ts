/**
 * Heatmap range helpers — pure inclusive calendar-range math for Account
 * activity heatmap selection (day cell vs week strip).
 *
 * Shared by Heatmap UI and heatmapUsagePro. No DOM / Tauri side effects.
 * Never invents activity cells or SuperGrok quota from range math alone.
 */

/** Inclusive local calendar range (YYYY-MM-DD). Day mode: start === end. */
export type HeatRange = {
  start: string;
  end: string;
};

/** Minimal day row used by sum helpers (matches HeatmapDay fields). */
export type HeatmapRangeDay = {
  date: string;
  requests: number;
  tokens: number;
};

export function heatRangesEqual(
  a: HeatRange | null | undefined,
  b: HeatRange | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.start === b.start && a.end === b.end;
}

/** Inclusive YYYY-MM-DD compare (lexicographic is valid for ISO dates). */
export function dateInHeatRange(ymd: string, range: HeatRange): boolean {
  return ymd >= range.start && ymd <= range.end;
}

/**
 * Sum requests / tokens for days inside an inclusive range.
 * Days outside the range are ignored; missing days contribute nothing
 * (never invent activity).
 */
export function sumHeatInRange(
  days: readonly HeatmapRangeDay[],
  range: HeatRange,
): { requests: number; tokens: number } {
  let requests = 0;
  let tokens = 0;
  for (const d of days) {
    if (!d?.date || !dateInHeatRange(d.date, range)) continue;
    const r = Number(d.requests);
    const t = Number(d.tokens);
    if (Number.isFinite(r) && r > 0) requests += Math.floor(r);
    if (Number.isFinite(t) && t > 0) tokens += Math.floor(t);
  }
  return { requests, tokens };
}
