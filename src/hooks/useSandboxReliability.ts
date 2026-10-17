/**
 * Sandbox wizard + reliability center chrome.
 * Wizard dismiss persistence lives here. Profile apply stays with the host.
 */
import { useCallback, useState } from "react";
import {
  loadSandboxWizardDismissed,
  markSandboxWizardDismissed,
  shouldOfferSandboxWizard,
  type SandboxWizardMode,
} from "@/lib/sandboxWizard";
import {
  DEFAULT_RELIABILITY_MAX_ERRORS,
  prependReliabilityRing,
  type ReliabilityErrorEntry,
  type ReliabilityStallSignal,
} from "@/lib/reliabilityCenter";

export function useSandboxWizard(opts: { sandboxProfile: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SandboxWizardMode>("trust");

  const maybeOfferAfterTrust = useCallback(() => {
    try {
      if (
        !shouldOfferSandboxWizard({
          justTrusted: true,
          currentProfile: opts.sandboxProfile,
          dismissed: loadSandboxWizardDismissed(),
        })
      ) {
        return;
      }
      setMode("trust");
      window.setTimeout(() => setOpen(true), 0);
    } catch {
      /* private storage / ignore */
    }
  }, [opts.sandboxProfile]);

  const openGuide = useCallback(() => {
    setMode("info");
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const skip = useCallback(
    (optsSkip: { dontOfferAgain: boolean }) => {
      if (mode === "trust" && optsSkip.dontOfferAgain) {
        markSandboxWizardDismissed();
      }
      setOpen(false);
    },
    [mode],
  );

  const finishApply = useCallback((optsApply: { dontOfferAgain: boolean }) => {
    if (optsApply.dontOfferAgain) {
      markSandboxWizardDismissed();
    }
    setOpen(false);
  }, []);

  return {
    open,
    mode,
    maybeOfferAfterTrust,
    openGuide,
    close,
    skip,
    finishApply,
  };
}

export function useReliabilityCenter() {
  const [open, setOpen] = useState(false);
  const [recentStallSignals, setRecentStallSignals] = useState<
    ReliabilityStallSignal[]
  >([]);
  const [recentErrorEntries, setRecentErrorEntries] = useState<
    ReliabilityErrorEntry[]
  >([]);

  const openCenter = useCallback(() => setOpen(true), []);
  const closeCenter = useCallback(() => setOpen(false), []);

  const recordError = useCallback((entry: ReliabilityErrorEntry) => {
    setRecentErrorEntries((prev) =>
      prependReliabilityRing(prev, entry, DEFAULT_RELIABILITY_MAX_ERRORS),
    );
  }, []);

  return {
    open,
    openCenter,
    closeCenter,
    recentStallSignals,
    setRecentStallSignals,
    recentErrorEntries,
    recordError,
  };
}
