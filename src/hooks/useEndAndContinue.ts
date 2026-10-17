import { useCallback, useRef, useState } from "react";
import type { MessageKey } from "@/i18n";
import * as api from "@/lib/api";
import {
  END_AND_CONTINUE_READY_MS,
  runChipContinue,
  runEndAndContinue,
  waitForHostReady,
  type ContinueSendArgs,
} from "@/lib/endAndContinue";

type SendContinue = (args: ContinueSendArgs) => Promise<unknown>;

/**
 * End-and-continue and the end-of-turn Continue chip.
 * Busy is a ref set before the first await so a second click is ignored.
 * The clicked session id is captured up front and is not re-read after a switch.
 */
export function useEndAndContinue(opts: {
  stop: (sessionId?: string | null) => Promise<boolean>;
  sendContinue: SendContinue;
  showToast: (msg: string, ms?: number) => void;
  tr: (key: MessageKey) => string;
  readHostState: (sessionId: string) => string | null | undefined;
  readViewedSessionId: () => string | null | undefined;
}) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const busyRef = useRef(false);
  const [endAndContinueBusy, setBusy] = useState(false);

  const endAndContinue = useCallback(async (sessionId: string) => {
    if (busyRef.current) return;
    const sid = sessionId.trim();
    if (!sid) return;
    busyRef.current = true;
    setBusy(true);
    const o = optsRef.current;
    try {
      await runEndAndContinue({
        alreadyBusy: false,
        sessionId: sid,
        stop: (id) => o.stop(id),
        readHostUntil: (id) =>
          waitForHostReady(id, o.readHostState, END_AND_CONTINUE_READY_MS),
        send: (args) => o.sendContinue(args),
        storedDisplay: o.tr("endOfTurn.continuePrompt"),
        notifyNotSent: () => o.showToast(o.tr("agent.streamStallContinueNotReady")),
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const onThreadContinueInterrupted = useCallback((reason: string) => {
    if (busyRef.current) return;
    const o = optsRef.current;
    const sid = o.readViewedSessionId()?.trim() || "";
    if (!sid) return;
    busyRef.current = true;
    setBusy(true);
    void (async () => {
      try {
        await runChipContinue({
          alreadyBusy: false,
          sessionId: sid,
          reason,
          hostState: o.readHostState(sid),
          loadInterruptContext: () => api.sessionInterruptContext(sid),
          send: (args) => o.sendContinue(args),
          storedDisplay: o.tr("endOfTurn.continuePrompt"),
          notifyNotReady: () =>
            o.showToast(o.tr("agent.streamStallContinueNotReady")),
        });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }, []);

  return { endAndContinueBusy, endAndContinue, onThreadContinueInterrupted };
}
