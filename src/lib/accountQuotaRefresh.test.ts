import { describe, expect, it } from "vitest";
import type { AccountStatus, BillingSnapshot } from "./api";
import {
  ACCOUNT_QUOTA_AUTO_REFRESH_MS,
  canFetchOfficialQuota,
  mergeAccountStatusPreservingLocalUsage,
  pickFresherAccountStatus,
  shouldAutoRefreshOfficialQuota,
  startOfficialQuotaAutoRefresh,
} from "./accountQuotaRefresh";

function billing(partial: Partial<BillingSnapshot> = {}): BillingSnapshot {
  return {
    available: true,
    source: "remote",
    message: null,
    subscriptionTier: "SuperGrok",
    creditUsagePercent: 20,
    remainingPercent: 80,
    monthlyLimit: null,
    includedUsed: null,
    totalUsed: null,
    prepaidBalance: null,
    onDemandEnabled: null,
    onDemandCap: null,
    onDemandUsed: null,
    billingPeriodStart: null,
    billingPeriodEnd: null,
    resetsAt: null,
    isUnifiedBillingUser: true,
    products: [],
    manageUrl: "https://grok.com/?_s=usage",
    subscribeUrl: "https://grok.com/supergrok",
    fetchedAt: "2026-08-15T00:00:00.000Z",
    ...partial,
  };
}

function account(partial: Partial<AccountStatus> = {}): AccountStatus {
  return {
    profile: {
      signedIn: true,
      authMode: "oauth",
      email: "a@x.ai",
      displayName: "A",
      userId: "u1",
      teamId: null,
      principalType: null,
      expiresAt: null,
      expired: false,
      hasRefresh: true,
      oidcIssuer: null,
    },
    hasOfficialKey: false,
    hasRelayKey: false,
    relayBaseUrl: null,
    cliAuthPresent: true,
    cliFound: true,
    cliPath: "/usr/bin/grok",
    channel: "official_oauth",
    billing: billing(),
    heatmap: [{ date: "2026-08-01", requests: 2, tokens: 10, costUsd: 0 }],
    callLogs: [
      {
        id: "s1",
        title: "chat",
        model: "grok-4.6",
        projectPath: null,
        startedAt: null,
        durationSecs: null,
        turns: 1,
        toolCalls: 0,
        contextTokens: 100,
        errors: 0,
      },
    ],
    usageManageUrl: "https://grok.com/?_s=usage",
    subscribeUrl: "https://grok.com/supergrok",
    ...partial,
  };
}

describe("ACCOUNT_QUOTA_AUTO_REFRESH_MS", () => {
  it("is ten minutes", () => {
    expect(ACCOUNT_QUOTA_AUTO_REFRESH_MS).toBe(10 * 60 * 1000);
  });
});

describe("canFetchOfficialQuota", () => {
  it("is false without an official sign-in or key", () => {
    expect(canFetchOfficialQuota(null)).toBe(false);
    expect(
      canFetchOfficialQuota(
        account({
          profile: { ...account().profile, signedIn: false },
          hasOfficialKey: false,
        }),
      ),
    ).toBe(false);
  });

  it("is true for official OAuth or an official API key", () => {
    expect(canFetchOfficialQuota(account())).toBe(true);
    expect(
      canFetchOfficialQuota(
        account({
          profile: { ...account().profile, signedIn: false },
          hasOfficialKey: true,
        }),
      ),
    ).toBe(true);
  });
});

describe("shouldAutoRefreshOfficialQuota", () => {
  const base = {
    nowMs: 1_000_000,
    lastBillingRefreshAtMs: 1_000_000 - ACCOUNT_QUOTA_AUTO_REFRESH_MS,
    inFlight: false,
    canFetchOfficialQuota: true,
  };

  it("refreshes when the interval has elapsed and official quota can be fetched", () => {
    expect(shouldAutoRefreshOfficialQuota(base)).toBe(true);
    expect(
      shouldAutoRefreshOfficialQuota({
        ...base,
        lastBillingRefreshAtMs: null,
      }),
    ).toBe(true);
  });

  it("does not refresh while in flight, unsigned, or still inside the interval", () => {
    expect(shouldAutoRefreshOfficialQuota({ ...base, inFlight: true })).toBe(
      false,
    );
    expect(
      shouldAutoRefreshOfficialQuota({
        ...base,
        canFetchOfficialQuota: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoRefreshOfficialQuota({
        ...base,
        lastBillingRefreshAtMs: base.nowMs - ACCOUNT_QUOTA_AUTO_REFRESH_MS + 1,
      }),
    ).toBe(false);
  });
});

describe("mergeAccountStatusPreservingLocalUsage", () => {
  it("keeps the previous heatmap and call logs when a billing-only refresh returns empty usage", () => {
    const prev = account({
      billing: billing({ remainingPercent: 80 }),
    });
    const next = account({
      billing: billing({ remainingPercent: 61, fetchedAt: "2026-08-15T00:10:00.000Z" }),
      heatmap: [],
      callLogs: [],
    });
    const merged = mergeAccountStatusPreservingLocalUsage(prev, next);
    expect(merged.billing.remainingPercent).toBe(61);
    expect(merged.heatmap).toEqual(prev.heatmap);
    expect(merged.callLogs).toEqual(prev.callLogs);
  });

  it("uses the next snapshot when there is no previous account", () => {
    const next = account({ heatmap: [], callLogs: [] });
    expect(mergeAccountStatusPreservingLocalUsage(null, next)).toBe(next);
  });
});

describe("pickFresherAccountStatus", () => {
  it("prefers the snapshot with the later billing fetchedAt", () => {
    const older = account({
      billing: billing({ remainingPercent: 80, fetchedAt: "2026-08-15T00:00:00.000Z" }),
    });
    const newer = account({
      billing: billing({ remainingPercent: 55, fetchedAt: "2026-08-15T00:10:00.000Z" }),
    });
    expect(pickFresherAccountStatus(older, newer)?.billing.remainingPercent).toBe(
      55,
    );
    expect(pickFresherAccountStatus(newer, older)?.billing.remainingPercent).toBe(
      55,
    );
  });

  it("falls back to the other side when one snapshot is missing", () => {
    const only = account();
    expect(pickFresherAccountStatus(null, only)).toBe(only);
    expect(pickFresherAccountStatus(only, null)).toBe(only);
    expect(pickFresherAccountStatus(null, null)).toBeNull();
  });
});

describe("startOfficialQuotaAutoRefresh", () => {
  const intervalMs = ACCOUNT_QUOTA_AUTO_REFRESH_MS;

  function startHarness(refresh: (isCurrent: () => boolean) => Promise<void>) {
    const intervals = new Set<number>();
    const vis = new Set<() => void>();
    let intervalTick: () => void = () => {};
    let nextId = 1;
    const handle = startOfficialQuotaAutoRefresh({
      intervalMs,
      now: () => intervalMs,
      seedLastAtMs: 0,
      canFetch: () => true,
      refresh,
      setIntervalFn: (fn) => {
        intervalTick = fn;
        const id = nextId++;
        intervals.add(id);
        return id;
      },
      clearIntervalFn: (id) => {
        intervals.delete(Number(id));
      },
      addListener: (_type, fn) => {
        vis.add(fn);
      },
      removeListener: (_type, fn) => {
        vis.delete(fn);
      },
      getVisibility: () => "visible",
    });
    return { handle, intervals, vis, fireInterval: () => intervalTick() };
  }

  it("clears the interval and visibility listener on dispose", () => {
    const { handle, intervals, vis } = startHarness(async () => {});
    expect(intervals.size).toBe(1);
    expect(vis.size).toBe(1);
    handle.dispose();
    expect(intervals.size).toBe(0);
    expect(vis.size).toBe(0);
    handle.dispose();
  });

  it("does not start a new refresh after dispose", () => {
    let started = 0;
    const { handle, fireInterval } = startHarness(async () => {
      started += 1;
    });
    handle.dispose();
    fireInterval();
    expect(started).toBe(0);
  });

  it("does not apply an in-flight refresh after dispose", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let applied = 0;
    const { handle, fireInterval } = startHarness(async (isCurrent) => {
      await gate;
      if (!isCurrent()) return;
      applied += 1;
    });
    fireInterval();
    handle.dispose();
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).toBe(0);
  });
});
