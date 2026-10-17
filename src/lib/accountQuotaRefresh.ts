/**
 * Official SuperGrok quota auto-refresh policy.
 *
 * Event-driven refreshes (boot, Account tab, user menu, login) stay as they
 * are. This module only decides the 10-minute background tick and how a
 * billing-only snapshot merges into the surfaces that already read `account`.
 */

import type { AccountStatus } from "./api";

/** Background SuperGrok quota probe interval. */
export const ACCOUNT_QUOTA_AUTO_REFRESH_MS = 10 * 60 * 1000;

export type OfficialQuotaAutoRefreshInput = {
  nowMs: number;
  /** Last billing probe attempt (success or fail). Null = never. */
  lastBillingRefreshAtMs: number | null;
  inFlight: boolean;
  canFetchOfficialQuota: boolean;
  intervalMs?: number;
};

/** Official OAuth / pasted official key — SuperGrok billing is reachable. */
export function canFetchOfficialQuota(
  account: {
    profile?: { signedIn?: boolean } | null;
    hasOfficialKey?: boolean;
  } | null,
): boolean {
  if (!account) return false;
  return Boolean(account.profile?.signedIn || account.hasOfficialKey);
}

export function shouldAutoRefreshOfficialQuota(
  input: OfficialQuotaAutoRefreshInput,
): boolean {
  if (!input.canFetchOfficialQuota || input.inFlight) return false;
  const interval = input.intervalMs ?? ACCOUNT_QUOTA_AUTO_REFRESH_MS;
  if (input.lastBillingRefreshAtMs == null) return true;
  return input.nowMs - input.lastBillingRefreshAtMs >= interval;
}

/**
 * Billing-only Host probes skip the heatmap / call-log walk.
 * Keep the last local-usage rows so Account does not flash empty.
 */
export function mergeAccountStatusPreservingLocalUsage(
  prev: AccountStatus | null,
  next: AccountStatus,
): AccountStatus {
  if (!prev) return next;
  if (next.heatmap.length > 0 || next.callLogs.length > 0) return next;
  return {
    ...next,
    heatmap: prev.heatmap,
    callLogs: prev.callLogs,
  };
}

export function accountBillingFetchedAtMs(
  account: AccountStatus | null,
): number | null {
  const raw = account?.billing?.fetchedAt;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/** Prefer the snapshot whose billing `fetchedAt` is later. */
export function pickFresherAccountStatus(
  a: AccountStatus | null,
  b: AccountStatus | null,
): AccountStatus | null {
  if (!a) return b;
  if (!b) return a;
  const ta = accountBillingFetchedAtMs(a);
  const tb = accountBillingFetchedAtMs(b);
  if (tb == null) return a;
  if (ta == null) return b;
  return tb >= ta ? b : a;
}

/** False after `dispose()` — in-flight probes must not apply React state. */
export type QuotaRefreshIsCurrent = () => boolean;

export type OfficialQuotaAutoRefreshHandle = {
  dispose: () => void;
};

export type OfficialQuotaAutoRefreshSchedule = {
  canFetch: () => boolean;
  refresh: (isCurrent: QuotaRefreshIsCurrent) => Promise<void>;
  intervalMs?: number;
  now?: () => number;
  seedLastAtMs?: number;
  setIntervalFn?: (handler: () => void, ms: number) => unknown;
  clearIntervalFn?: (id: unknown) => void;
  addListener?: (type: "visibilitychange", handler: () => void) => void;
  removeListener?: (type: "visibilitychange", handler: () => void) => void;
  getVisibility?: () => DocumentVisibilityState;
};

/**
 * Owns the 10-minute interval + visibility listener.
 * `dispose()` clears both and flips `isCurrent` so a late Host reply is dropped.
 */
export function startOfficialQuotaAutoRefresh(
  opts: OfficialQuotaAutoRefreshSchedule,
): OfficialQuotaAutoRefreshHandle {
  const intervalMs = opts.intervalMs ?? ACCOUNT_QUOTA_AUTO_REFRESH_MS;
  const now = opts.now ?? Date.now;
  const setIntervalFn =
    opts.setIntervalFn ??
    ((handler: () => void, ms: number) => window.setInterval(handler, ms));
  const clearIntervalFn =
    opts.clearIntervalFn ?? ((id: unknown) => window.clearInterval(id as number));
  const addListener =
    opts.addListener ??
    ((type: "visibilitychange", handler: () => void) => {
      document.addEventListener(type, handler);
    });
  const removeListener =
    opts.removeListener ??
    ((type: "visibilitychange", handler: () => void) => {
      document.removeEventListener(type, handler);
    });
  const getVisibility =
    opts.getVisibility ?? (() => document.visibilityState);

  let alive = true;
  let inFlight = false;
  let lastAt = opts.seedLastAtMs ?? now();
  const isCurrent: QuotaRefreshIsCurrent = () => alive;

  const tick = () => {
    if (!alive) return;
    if (
      !shouldAutoRefreshOfficialQuota({
        nowMs: now(),
        lastBillingRefreshAtMs: lastAt,
        inFlight,
        canFetchOfficialQuota: opts.canFetch(),
        intervalMs,
      })
    ) {
      return;
    }
    inFlight = true;
    lastAt = now();
    void opts
      .refresh(isCurrent)
      .catch(() => {
        /* keep last snapshot */
      })
      .finally(() => {
        if (alive) inFlight = false;
      });
  };

  const onVis = () => {
    if (!alive) return;
    if (getVisibility() === "visible") tick();
  };

  const intervalId = setIntervalFn(tick, intervalMs);
  addListener("visibilitychange", onVis);

  return {
    dispose() {
      if (!alive) return;
      alive = false;
      clearIntervalFn(intervalId);
      removeListener("visibilitychange", onVis);
    },
  };
}
