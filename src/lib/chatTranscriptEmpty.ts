/**
 * Honest empty copy for the main chat transcript.
 *
 * - new draft → "Start chatting"
 * - selected session whose journal is not hydrated yet → loading
 * - selected session whose journal is confirmed empty → no welcome copy
 *   (the empty-session banner owns that case)
 *
 * Loading must not look like a fresh chat or a failed empty session.
 */

export type ChatTranscriptEmptyKind = "start" | "loading";

export type ChatTranscriptEmptyPresentation = {
  kind: ChatTranscriptEmptyKind;
  titleKey: "main.startTitle" | "main.loadingTitle";
  hintKey: "main.startHint" | "main.loadingHint";
};

export function resolveChatTranscriptEmptyState(input: {
  empty: boolean;
  suppressEmptyCopy?: boolean;
  journalLoading?: boolean;
  journalHydrated?: boolean;
  hasSession?: boolean;
}): ChatTranscriptEmptyPresentation | null {
  if (!input.empty || input.suppressEmptyCopy) return null;
  const waitingOnJournal =
    !!input.journalLoading ||
    (!!input.hasSession && input.journalHydrated === false);
  if (waitingOnJournal) {
    return {
      kind: "loading",
      titleKey: "main.loadingTitle",
      hintKey: "main.loadingHint",
    };
  }
  if (input.hasSession) return null;
  return {
    kind: "start",
    titleKey: "main.startTitle",
    hintKey: "main.startHint",
  };
}

/** After HMR / remount: session id survived but journal cache did not. */
export function shouldReopenUnhydratedSession(input: {
  sessionId: string | null | undefined;
  mainPaneIsChat: boolean;
  journalHydrated: boolean;
  journalLoading: boolean;
  messageCount: number;
  rowExists: boolean;
}): boolean {
  if (!input.mainPaneIsChat) return false;
  if (!input.sessionId) return false;
  if (!input.rowExists) return false;
  if (input.journalHydrated || input.journalLoading) return false;
  if (input.messageCount > 0) return false;
  return true;
}
