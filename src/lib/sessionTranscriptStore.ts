/**
 * External transcript store for the viewing session.
 *
 * Stream tokens update messages without forcing the whole App shell to
 * re-render: ConversationThread subscribes to full snapshots; App shell
 * only subscribes to a cheap structural meta snapshot.
 *
 * **Ownership invariant (P0 multi-session):** `this.messages` always belongs
 * to `messagesOwnerSessionId`. `openSession` points `viewingSessionId` at the
 * target *before* disk load finishes — any stream/rehydrate/clear that reduced
 * against the *previous* chat's array under the new id wrote cross-project
 * pollution into the wrong cache (#529). Reducers must never treat a foreign
 * transcript as `prev` for another session.
 */

import type { ChatMessage } from "@/lib/session";
import { resolveTranscriptContentNotifyMs } from "@/lib/streamRenderPolicy";

export type TranscriptMeta = {
  /** Message count in the viewing transcript. */
  length: number;
  lastUserId: string | null;
  hasError: boolean;
  /** Any assistant row still marked streaming. */
  hasStreamingAssistant: boolean;
  /** Last message id (structural identity). */
  tailId: string | null;
  /**
   * Bumps only on structural changes (add/remove/role/streaming flag/error),
   * not on content growth of an existing streaming row.
   */
  structuralRev: number;
  /**
   * Viewing session journal has not finished its first disk load in this
   * process. Distinguishes "start chatting" from "loading conversation".
   */
  journalLoading: boolean;
  /**
   * Viewing session journal has been read at least once this process
   * (including a confirmed empty journal).
   */
  journalHydrated: boolean;
};

export type MessagesReducer = (prev: ChatMessage[]) => ChatMessage[];

function computeMeta(messages: readonly ChatMessage[]): Omit<
  TranscriptMeta,
  "structuralRev" | "journalLoading" | "journalHydrated"
> {
  let lastUserId: string | null = null;
  let hasError = false;
  let hasStreamingAssistant = false;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role === "user") lastUserId = m.id;
    if (m.isError) hasError = true;
    if (m.role === "assistant" && m.streaming) hasStreamingAssistant = true;
  }
  const tail = messages.length > 0 ? messages[messages.length - 1]! : null;
  return {
    length: messages.length,
    lastUserId,
    hasError,
    hasStreamingAssistant,
    tailId: tail?.id ?? null,
  };
}

function metaStructuralEqual(
  a: Omit<TranscriptMeta, "structuralRev" | "journalLoading" | "journalHydrated">,
  b: Omit<TranscriptMeta, "structuralRev" | "journalLoading" | "journalHydrated">,
): boolean {
  return (
    a.length === b.length &&
    a.lastUserId === b.lastUserId &&
    a.hasError === b.hasError &&
    a.hasStreamingAssistant === b.hasStreamingAssistant &&
    a.tailId === b.tailId
  );
}

type Listener = () => void;

class SessionTranscriptStore {
  private messages: ChatMessage[] = [];
  /**
   * Session id that `this.messages` currently represents.
   * Distinct from viewing id during the openSession handoff window.
   */
  private messagesOwnerSessionId: string | null = null;
  private meta: TranscriptMeta = {
    length: 0,
    lastUserId: null,
    hasError: false,
    hasStreamingAssistant: false,
    tailId: null,
    structuralRev: 0,
    journalLoading: false,
    journalHydrated: false,
  };
  private bySession = new Map<string, ChatMessage[]>();
  /** Session ids whose App journal has been read at least once this process. */
  private hydratedSessionIds = new Set<string>();
  /** Session currently waiting on its first journal read. */
  private loadingSessionId: string | null = null;
  private viewingSessionId: string | null = null;
  /** Prefer App's viewingSessionIdRef when set (ahead of React session state). */
  private viewingIdResolver: (() => string | null) | null = null;
  private contentListeners = new Set<Listener>();
  private metaListeners = new Set<Listener>();
  /** Leading+trailing throttle for non-structural content growth. */
  private contentThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  private contentNotifyQueued = false;

  /** Full viewing messages — for ConversationThread / export. */
  subscribeContent = (listener: Listener): (() => void) => {
    this.contentListeners.add(listener);
    return () => {
      this.contentListeners.delete(listener);
    };
  };

  getContentSnapshot = (): ChatMessage[] => this.messages;

  /** Structural meta — for App shell (welcome empty, a11y stream edge, …). */
  subscribeMeta = (listener: Listener): (() => void) => {
    this.metaListeners.add(listener);
    return () => {
      this.metaListeners.delete(listener);
    };
  };

  getMetaSnapshot = (): TranscriptMeta => this.meta;

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  getMessagesRef(): ChatMessage[] {
    return this.messages;
  }

  /** Which session `getMessages()` currently represents (tests / diagnostics). */
  getMessagesOwnerSessionId(): string | null {
    return this.messagesOwnerSessionId;
  }

  getBySessionMap(): Map<string, ChatMessage[]> {
    return this.bySession;
  }

  getCached(sessionId: string): ChatMessage[] | undefined {
    return this.bySession.get(sessionId);
  }

  setViewingSessionId(sessionId: string | null): void {
    this.viewingSessionId = sessionId;
    this.syncJournalMeta();
  }

  /** App wires this to `() => viewingSessionIdRef.current`. */
  setViewingIdResolver(fn: (() => string | null) | null): void {
    this.viewingIdResolver = fn;
  }

  getViewingSessionId(): string | null {
    if (this.viewingIdResolver) {
      const id = this.viewingIdResolver();
      if (id !== undefined) return id;
    }
    return this.viewingSessionId;
  }

  private flushContentListeners(): void {
    for (const l of this.contentListeners) l();
  }

  /**
   * Content listeners: structural changes notify immediately; pure token growth
   * uses leading+trailing throttle so ConversationThread is not re-rendered on
   * every coalesced stream flush.
   */
  private scheduleContentNotify(immediate: boolean): void {
    if (immediate) {
      if (this.contentThrottleTimer != null) {
        clearTimeout(this.contentThrottleTimer);
        this.contentThrottleTimer = null;
      }
      this.contentNotifyQueued = false;
      this.flushContentListeners();
      return;
    }
    if (this.contentThrottleTimer == null) {
      // Leading edge.
      this.flushContentListeners();
      this.contentThrottleTimer = setTimeout(() => {
        this.contentThrottleTimer = null;
        if (this.contentNotifyQueued) {
          this.contentNotifyQueued = false;
          this.flushContentListeners();
        }
      }, resolveTranscriptContentNotifyMs());
      return;
    }
    this.contentNotifyQueued = true;
  }

  private notifyMeta(): void {
    for (const l of this.metaListeners) l();
  }

  /**
   * Base list for a session reducer: own cache → owned viewing messages → [].
   * Never returns another session's transcript.
   */
  private baseForSession(sessionId: string): ChatMessage[] {
    if (this.bySession.has(sessionId)) {
      return this.bySession.get(sessionId)!;
    }
    if (
      this.messagesOwnerSessionId === sessionId &&
      this.getViewingSessionId() === sessionId
    ) {
      return this.messages;
    }
    return [];
  }

  private commitViewing(
    next: ChatMessage[],
    opts?: { forceStructural?: boolean; ownerSessionId?: string | null },
  ): void {
    const prevMetaCore = {
      length: this.meta.length,
      lastUserId: this.meta.lastUserId,
      hasError: this.meta.hasError,
      hasStreamingAssistant: this.meta.hasStreamingAssistant,
      tailId: this.meta.tailId,
    };
    const nextCore = computeMeta(next);
    const structural =
      !!opts?.forceStructural || !metaStructuralEqual(prevMetaCore, nextCore);

    this.messages = next;
    const viewing =
      opts?.ownerSessionId !== undefined
        ? opts.ownerSessionId
        : this.getViewingSessionId();
    if (viewing) {
      this.bySession.set(viewing, next);
      this.messagesOwnerSessionId = viewing;
    }

    if (structural) {
      this.meta = {
        ...nextCore,
        structuralRev: this.meta.structuralRev + 1,
        ...this.journalFlags(),
      };
      this.notifyMeta();
    } else {
      // Keep structuralRev stable; still refresh non-rev fields if needed.
      this.meta = {
        ...nextCore,
        structuralRev: this.meta.structuralRev,
        ...this.journalFlags(),
      };
    }
    this.scheduleContentNotify(structural);
  }

  private journalLoadingNow(): boolean {
    const viewing = this.getViewingSessionId();
    return !!viewing && this.loadingSessionId === viewing;
  }

  private journalHydratedNow(): boolean {
    const viewing = this.getViewingSessionId();
    return !!viewing && this.hydratedSessionIds.has(viewing);
  }

  private journalFlags(): Pick<TranscriptMeta, "journalLoading" | "journalHydrated"> {
    return {
      journalLoading: this.journalLoadingNow(),
      journalHydrated: this.journalHydratedNow(),
    };
  }

  private syncJournalMeta(): void {
    const next = this.journalFlags();
    if (
      this.meta.journalLoading === next.journalLoading &&
      this.meta.journalHydrated === next.journalHydrated
    ) {
      return;
    }
    this.meta = { ...this.meta, ...next };
    this.notifyMeta();
  }

  isJournalHydrated(sessionId: string): boolean {
    return this.hydratedSessionIds.has(sessionId);
  }

  isJournalLoading(sessionId: string): boolean {
    return this.loadingSessionId === sessionId;
  }

  /** Mark the viewing session as waiting on its first disk journal read. */
  beginJournalLoad(sessionId: string): void {
    this.loadingSessionId = sessionId;
    this.syncJournalMeta();
  }

  /** Journal read finished (including a confirmed empty journal). */
  finishJournalLoad(sessionId: string): void {
    this.hydratedSessionIds.add(sessionId);
    if (this.loadingSessionId === sessionId) {
      this.loadingSessionId = null;
    }
    this.syncJournalMeta();
  }

  /** Load failed or was abandoned before any journal rows were known. */
  abortJournalLoad(sessionId: string): void {
    if (this.loadingSessionId !== sessionId) return;
    this.loadingSessionId = null;
    this.syncJournalMeta();
  }

  /** New draft — not a session journal load. */
  clearJournalLoad(): void {
    this.loadingSessionId = null;
    this.syncJournalMeta();
  }

  /**
   * Replace viewing messages (open session / clear / optimistic full set).
   *
   * Functional updates use the **viewing session's** base, not a foreign
   * transcript that may still be painted during openSession handoff.
   */
  setMessages(next: ChatMessage[] | MessagesReducer): void {
    const viewing = this.getViewingSessionId();
    const resolved =
      typeof next === "function"
        ? (next as MessagesReducer)(
            viewing ? this.baseForSession(viewing) : this.messages,
          )
        : next;
    this.commitViewing(resolved);
  }

  /**
   * Apply reducer to a session. Only notifies React when the target is the
   * viewing session (background sessions stay in the cache only).
   *
   * Always reduces against that session's own cache (or empty) — never against
   * a still-painted previous chat when viewing id already moved (#529).
   */
  patchSession(
    targetSessionId: string | null | undefined,
    reduce: MessagesReducer,
  ): void {
    if (!targetSessionId) return;
    const base = this.baseForSession(targetSessionId);
    const next = reduce(base);
    this.bySession.set(targetSessionId, next);
    if (this.getViewingSessionId() === targetSessionId) {
      this.commitViewing(next);
    }
  }

  /** Cache helper used when switching sessions (leave behind). */
  cacheSession(sessionId: string, messages: ChatMessage[]): void {
    this.bySession.set(sessionId, messages);
  }

  deleteSession(sessionId: string): void {
    this.bySession.delete(sessionId);
    this.hydratedSessionIds.delete(sessionId);
    if (this.loadingSessionId === sessionId) {
      this.loadingSessionId = null;
      this.syncJournalMeta();
    }
    if (this.messagesOwnerSessionId === sessionId) {
      this.messagesOwnerSessionId = null;
    }
  }

  /** Test / hot-reload reset. */
  resetForTests(): void {
    if (this.contentThrottleTimer != null) {
      clearTimeout(this.contentThrottleTimer);
      this.contentThrottleTimer = null;
    }
    this.contentNotifyQueued = false;
    this.messages = [];
    this.messagesOwnerSessionId = null;
    this.hydratedSessionIds.clear();
    this.loadingSessionId = null;
    this.meta = {
      length: 0,
      lastUserId: null,
      hasError: false,
      hasStreamingAssistant: false,
      tailId: null,
      structuralRev: 0,
      journalLoading: false,
      journalHydrated: false,
    };
    this.bySession.clear();
    this.viewingSessionId = null;
    this.viewingIdResolver = null;
  }
}

/** App-wide singleton (one desktop window = one viewing transcript). */
export const sessionTranscriptStore = new SessionTranscriptStore();
