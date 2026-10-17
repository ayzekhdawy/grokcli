/**
 * Chrome label for bare thinking rows (Thinking.tsx).
 *
 * Unified product language (matches work-phase Working/Worked cadence):
 * - live:  “Thinking for {duration}” / “思考中 {duration}”
 * - done:  “Thought for {duration}” / “思考了 {duration}”
 * - no duration yet (rare history): short done label (“Thought” / “思考了”)
 *
 * Never use gist / first-line body as the collapsed surface.
 */

export function resolveThinkingChromeLabel(opts: {
  live: boolean;
  /** Elapsed ms (live tick or history). */
  durationMs?: number | null;
  thinkingFor: (duration: string) => string;
  thoughtFor: (duration: string) => string;
  /** Fallback when finished with no usable duration. */
  doneLabel: string;
  formatDuration: (totalSeconds: number) => string;
}): string {
  const msRaw = opts.durationMs;
  const ms =
    msRaw != null && Number.isFinite(msRaw) && msRaw >= 0 ? msRaw : null;

  if (opts.live) {
    const sec = ms != null ? Math.max(0, Math.floor(ms / 1000)) : 0;
    return opts.thinkingFor(opts.formatDuration(sec));
  }

  if (ms != null && ms >= 100) {
    // Whole seconds like Grok “Thought for 12s” (not 12.3).
    const sec = Math.max(1, Math.round(ms / 1000));
    return opts.thoughtFor(opts.formatDuration(sec));
  }

  return opts.doneLabel;
}
