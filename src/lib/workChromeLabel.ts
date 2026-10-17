/**
 * Chrome label for work-phase headers (TimelinePhaseBlock).
 *
 * Unified with thinking chrome:
 * - live:  “Working for {duration}” / “工作中 {duration}”
 * - done:  “Worked for {duration}” / “工作了 {duration}”
 * - rare no-duration done: short done label (“Worked” / “工作了”)
 *
 * Never bare “工作” / mixed “已工作” without the 了 form.
 */

export function resolveWorkChromeLabel(opts: {
  live: boolean;
  /** Elapsed whole seconds (live tick and/or history span). */
  durationSec?: number | null;
  workingFor: (duration: string) => string;
  workedFor: (duration: string) => string;
  /** Finished fallback when no usable duration. */
  doneLabel: string;
  formatDuration: (totalSeconds: number) => string;
}): string {
  const raw = opts.durationSec;
  const sec =
    raw != null && Number.isFinite(raw) && raw >= 0
      ? Math.floor(raw)
      : null;

  if (opts.live) {
    // Always show timer while working (0s allowed at first paint).
    return opts.workingFor(opts.formatDuration(sec ?? 0));
  }

  if (sec != null && sec >= 1) {
    return opts.workedFor(opts.formatDuration(sec));
  }

  // Sub-second or unknown history span — still use “工作了”, not “已工作/工作”.
  if (sec != null && sec >= 0) {
    return opts.workedFor(opts.formatDuration(Math.max(1, sec)));
  }

  return opts.doneLabel;
}
