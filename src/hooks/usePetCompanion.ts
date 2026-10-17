/**
 * Main-window bridge: compute pet focus and push it to the overlay.
 *
 * liveMap is subscribed outside React render. Unread-clear is a separate
 * window event — idle liveMap rows do not notify subscribeMap.
 */
import { useEffect, useRef } from "react";
import { startPetFocusBridge } from "@/lib/pet/petFocusBridge";
import type { PetFocusSession } from "@/lib/pet";
import {
  PET_COMPOSING_HOLD_MS,
  petBubbleDismissMs,
  petIsComposing,
  petStageSnippetStore,
} from "@/lib/pet";
import { listen } from "@/lib/api/host";
import { petPrefsGet, petPushFocus, petPushTasks } from "@/lib/api/pet";
import type { PetPrefs } from "@/lib/api/pet";
import type { StreamPayload } from "@/lib/session";
import { sessionLiveMapStore } from "@/lib/sessionLiveMapStore";
import { composerDraftStore } from "@/lib/composerDraftStore";

export function usePetCompanion(opts: {
  host: boolean;
  sessions: readonly PetFocusSession[];
}): void {
  const sessionsRef = useRef(opts.sessions);
  sessionsRef.current = opts.sessions;
  const enabledRef = useRef(false);
  const dismissMsRef = useRef(petBubbleDismissMs(undefined));
  const lastTypeAtRef = useRef(0);

  useEffect(() => {
    if (!opts.host) return;
    let gone = false;
    let unlistenPrefs: (() => void) | undefined;
    let unlistenStream: (() => void) | undefined;
    let composingTimer: ReturnType<typeof setTimeout> | null = null;
    const composingNow = () =>
      petIsComposing({
        empty: composerDraftStore.getMetaSnapshot().empty,
        lastTypeAt: lastTypeAtRef.current,
        now: Date.now(),
      });
    const bridge = startPetFocusBridge({
      isEnabled: () => !gone && enabledRef.current,
      getSessions: () => sessionsRef.current,
      getSnippets: () => petStageSnippetStore.getMap(),
      getDismissMs: () => dismissMsRef.current,
      getComposing: composingNow,
      push: (focus) => {
        void petPushFocus(focus);
      },
      pushTasks: (tasks) => {
        void petPushTasks(tasks);
      },
    });

    void petPrefsGet().then((p) => {
      if (gone) return;
      enabledRef.current = p.enabled;
      dismissMsRef.current = petBubbleDismissMs(p);
      bridge.tick();
    });
    void listen<PetPrefs>("pet://prefs", (p) => {
      if (!p) return;
      enabledRef.current = p.enabled;
      dismissMsRef.current = petBubbleDismissMs(p);
      bridge.tick();
    }).then((u) => {
      unlistenPrefs = u;
    });
    const unsubDraft = composerDraftStore.subscribeMeta(() => {
      lastTypeAtRef.current = Date.now();
      if (composingTimer != null) clearTimeout(composingTimer);
      composingTimer = setTimeout(() => {
        composingTimer = null;
        if (!gone && enabledRef.current) bridge.tick();
      }, PET_COMPOSING_HOLD_MS + 40);
      if (!gone && enabledRef.current) bridge.tick();
    });
    void listen<StreamPayload>("session://stream", (chunk) => {
      if (gone || !chunk?.sessionId) return;
      const snap = sessionLiveMapStore.getSnapshot(chunk.sessionId);
      if (
        petStageSnippetStore.applyStream(chunk, snap?.startedAt ?? 0) &&
        enabledRef.current
      ) {
        bridge.tick();
      }
    }).then((u) => {
      unlistenStream = u;
    });

    return () => {
      gone = true;
      bridge.stop();
      unlistenPrefs?.();
      unlistenStream?.();
      unsubDraft();
      if (composingTimer != null) clearTimeout(composingTimer);
    };
  }, [opts.host]);
}
