/**
 * Background SuperGrok quota probe — 10 minutes.
 * Updates the same `account` snapshot the Account page, user menu, and tray read.
 *
 * Dispose (unmount / disable) clears the interval + visibility listener and
 * flips `isCurrent` so a late Host reply cannot setState on a dead tree.
 */

import { useEffect, useRef } from "react";
import {
  startOfficialQuotaAutoRefresh,
  type QuotaRefreshIsCurrent,
} from "@/lib/accountQuotaRefresh";

export function useAccountQuotaAutoRefresh(opts: {
  enabled: boolean;
  canFetch: boolean;
  refresh: (isCurrent: QuotaRefreshIsCurrent) => Promise<void>;
}): void {
  const refreshRef = useRef(opts.refresh);
  refreshRef.current = opts.refresh;
  const canFetchRef = useRef(opts.canFetch);
  canFetchRef.current = opts.canFetch;

  useEffect(() => {
    if (!opts.enabled) return;
    const session = startOfficialQuotaAutoRefresh({
      canFetch: () => canFetchRef.current,
      refresh: (isCurrent) => refreshRef.current(isCurrent),
    });
    return () => {
      session.dispose();
    };
  }, [opts.enabled]);
}
