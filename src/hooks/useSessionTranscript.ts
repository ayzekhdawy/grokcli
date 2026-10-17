/**
 * React bindings for sessionTranscriptStore.
 * - useViewingMessages: full transcript (ConversationThread / export freeze)
 * - useTranscriptMeta: structural shell fields (no token-level re-renders)
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  sessionTranscriptStore,
  type MessagesReducer,
  type TranscriptMeta,
} from "@/lib/sessionTranscriptStore";
import type { ChatMessage } from "@/lib/session";

export function useViewingMessages(): ChatMessage[] {
  return useSyncExternalStore(
    sessionTranscriptStore.subscribeContent,
    sessionTranscriptStore.getContentSnapshot,
    sessionTranscriptStore.getContentSnapshot,
  );
}

export function useTranscriptMeta(): TranscriptMeta {
  return useSyncExternalStore(
    sessionTranscriptStore.subscribeMeta,
    sessionTranscriptStore.getMetaSnapshot,
    sessionTranscriptStore.getMetaSnapshot,
  );
}

/** Stable API for App event handlers (never causes subscription by itself). */
export function useTranscriptActions() {
  const setMessages = useCallback(
    (next: ChatMessage[] | MessagesReducer) => {
      sessionTranscriptStore.setMessages(next);
    },
    [],
  );
  const patchSessionMessages = useCallback(
    (
      targetSessionId: string | undefined | null,
      reduce: MessagesReducer,
    ) => {
      sessionTranscriptStore.patchSession(targetSessionId, reduce);
    },
    [],
  );
  return { setMessages, patchSessionMessages };
}
