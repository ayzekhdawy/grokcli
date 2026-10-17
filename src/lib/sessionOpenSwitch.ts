/**
 * Fast session-switch policy: generation tokens + debounce timings.
 *
 * Rapid sidebar clicks used to fire N concurrent openSession pipelines
 * (full journal reconcile, paths_classify, warm sessionConnect). On Windows
 * that stacked into WebView2 "Not Responding". Callers bump a generation on
 * every navigation and abort after each await when superseded.
 */

/** Passive passive warm-connect so rapid switches do not thrash connect_lock. */
export const WARM_CONNECT_DEBOUNCE_MS = 350;

/**
 * After a fast journal paint (no agent reconcile), recover missing assistant
 * bodies once the user settles on a chat.
 */
export const DEFERRED_RECONCILE_MS = 500;

/** True when async open work still belongs to the latest navigation. */
export function isOpenGenerationCurrent(
  currentGen: number,
  startedGen: number,
): boolean {
  return currentGen === startedGen;
}

/**
 * Whether openSession may write workbench UI for `targetSessionId`.
 * Requires both generation match and viewing id match.
 */
export function shouldApplyOpenSessionResult(opts: {
  currentGen: number;
  startedGen: number;
  viewingSessionId: string | null | undefined;
  targetSessionId: string;
}): boolean {
  return (
    isOpenGenerationCurrent(opts.currentGen, opts.startedGen) &&
    opts.viewingSessionId === opts.targetSessionId
  );
}

/**
 * Cheap journal equality so deferred reconcile does not re-paint when
 * agent chat_history had nothing new.
 */
export function sessionJournalLooksUnchanged(
  prev: ReadonlyArray<{ id: string }> | null | undefined,
  next: ReadonlyArray<{ id: string }> | null | undefined,
): boolean {
  const a = prev ?? [];
  const b = next ?? [];
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  return a[0]?.id === b[0]?.id && a[a.length - 1]?.id === b[b.length - 1]?.id;
}
