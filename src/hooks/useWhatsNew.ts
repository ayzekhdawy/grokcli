/**
 * Version update notes: auto-show once per version, re-open via event.
 * Hosts must not put this state on App / AppWorkbench.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  APP_VERSION,
  WHATS_NEW_OPEN_EVENT,
  ensureFirstSeenVersion,
  loadFirstSeenVersion,
  loadSeenVersion,
  markWhatsNewSeen,
  notesForAppVersion,
  shouldAutoShowWhatsNew,
  type WhatsNewNotes,
} from "@/lib/whatsNew";

export type UseWhatsNewOpts = {
  locale: string;
  gateReady: boolean;
  setupOpen?: boolean;
  tutorialOpen?: boolean;
};

export function useWhatsNew(opts: UseWhatsNewOpts): {
  open: boolean;
  notes: WhatsNewNotes | null;
  version: string;
  close: () => void;
} {
  const [open, setOpen] = useState(false);
  const notes = useMemo(
    () => notesForAppVersion(opts.locale),
    [opts.locale],
  );

  // Seed first-seen during setup/loading so a fresh install of this version
  // is not mistaken for a legacy upgrade when the gate later becomes ready.
  useEffect(() => {
    if (!opts.gateReady) {
      ensureFirstSeenVersion(APP_VERSION);
    }
  }, [opts.gateReady]);

  useEffect(() => {
    if (
      !shouldAutoShowWhatsNew({
        currentVersion: APP_VERSION,
        seenVersion: loadSeenVersion(),
        firstSeenVersion: loadFirstSeenVersion(),
        gateReady: opts.gateReady,
        setupOpen: Boolean(opts.setupOpen),
        tutorialOpen: Boolean(opts.tutorialOpen),
      })
    ) {
      return;
    }
    const t = window.setTimeout(() => setOpen(true), 900);
    return () => window.clearTimeout(t);
  }, [opts.gateReady, opts.setupOpen, opts.tutorialOpen]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(WHATS_NEW_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(WHATS_NEW_OPEN_EVENT, onOpen);
  }, []);

  const close = useCallback(() => {
    markWhatsNewSeen(APP_VERSION);
    setOpen(false);
  }, []);

  return { open, notes, version: APP_VERSION, close };
}
