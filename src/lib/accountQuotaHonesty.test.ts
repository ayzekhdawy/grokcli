import { describe, expect, it } from "vitest";
import {
  classifyQuotaError,
  formatQuotaRemainLabel,
  formatQuotaUnknown,
  isQuotaUsageKnown,
  quotaErrorView,
  resolveQuotaEmptyState,
  resolveQuotaErrorChip,
  resolveQuotaPercents,
  type QuotaBillingLike,
} from "./accountQuotaHonesty";

function billing(partial: Partial<QuotaBillingLike> = {}): QuotaBillingLike {
  return {
    available: false,
    creditUsagePercent: null,
    remainingPercent: null,
    monthlyLimit: null,
    includedUsed: null,
    message: null,
    ...partial,
  };
}

describe("isQuotaUsageKnown", () => {
  it("never invents known usage from available flag alone", () => {
    expect(isQuotaUsageKnown(null)).toBe(false);
    expect(isQuotaUsageKnown(undefined)).toBe(false);
    expect(isQuotaUsageKnown(billing({ available: true }))).toBe(false);
    expect(isQuotaUsageKnown(billing({ available: false }))).toBe(false);
  });

  it("accepts finite credit / remaining / limit path", () => {
    expect(
      isQuotaUsageKnown(billing({ creditUsagePercent: 12.5 })),
    ).toBe(true);
    expect(isQuotaUsageKnown(billing({ remainingPercent: 88 }))).toBe(true);
    expect(
      isQuotaUsageKnown(
        billing({ monthlyLimit: 1000, includedUsed: 250 }),
      ),
    ).toBe(true);
  });

  it("rejects non-finite and incomplete limit pairs", () => {
    expect(isQuotaUsageKnown(billing({ creditUsagePercent: NaN }))).toBe(
      false,
    );
    expect(
      isQuotaUsageKnown(billing({ monthlyLimit: 0, includedUsed: 10 })),
    ).toBe(false);
    expect(
      isQuotaUsageKnown(billing({ monthlyLimit: 100, includedUsed: null })),
    ).toBe(false);
  });
});

describe("resolveQuotaPercents", () => {
  it("returns nulls when host silent — never invents 0/100", () => {
    expect(resolveQuotaPercents(null)).toEqual({
      usedPercent: null,
      remainingPercent: null,
    });
    expect(resolveQuotaPercents(billing({ available: true }))).toEqual({
      usedPercent: null,
      remainingPercent: null,
    });
  });

  it("derives remaining from credit usage and vice versa", () => {
    expect(resolveQuotaPercents(billing({ creditUsagePercent: 30 }))).toEqual({
      usedPercent: 30,
      remainingPercent: 70,
    });
    expect(resolveQuotaPercents(billing({ remainingPercent: 40 }))).toEqual({
      usedPercent: 60,
      remainingPercent: 40,
    });
  });

  it("uses monthly limit ratio when only that is present", () => {
    const p = resolveQuotaPercents(
      billing({ monthlyLimit: 200, includedUsed: 50 }),
    );
    expect(p.usedPercent).toBe(25);
    expect(p.remainingPercent).toBe(75);
  });

  it("clamps remaining to 0..100", () => {
    const p = resolveQuotaPercents(billing({ remainingPercent: 150 }));
    expect(p.remainingPercent).toBe(100);
  });
});

describe("formatQuotaRemainLabel", () => {
  it("never invents a percent string when unknown", () => {
    expect(formatQuotaRemainLabel(null)).toBeNull();
    expect(formatQuotaRemainLabel(undefined)).toBeNull();
    expect(formatQuotaRemainLabel(NaN)).toBeNull();
  });

  it("formats known remaining without inventing extra digits", () => {
    expect(formatQuotaRemainLabel(42.4)).toBe("42%");
    expect(formatQuotaRemainLabel(0)).toBe("0%");
    expect(formatQuotaRemainLabel(100)).toBe("100%");
  });
});

describe("classifyQuotaError / quotaErrorView", () => {
  it("classifies host_only | network | auth | other", () => {
    expect(classifyQuotaError("need tauri")).toBe("host_only");
    expect(classifyQuotaError({ code: "host_only" })).toBe("host_only");
    expect(
      classifyQuotaError("Account requires Tauri desktop runtime"),
    ).toBe("host_only");
    expect(classifyQuotaError("network offline")).toBe("network");
    expect(classifyQuotaError(new Error("Failed to fetch"))).toBe("network");
    expect(classifyQuotaError({ code: "timeout" })).toBe("network");
    expect(classifyQuotaError("401 unauthorized")).toBe("auth");
    expect(classifyQuotaError({ code: "token_expired" })).toBe("auth");
    expect(classifyQuotaError("sign-in expired")).toBe("auth");
    expect(classifyQuotaError("something weird")).toBe("other");
    expect(classifyQuotaError(null)).toBe("other");
  });

  it("error view is always soft-fail with i18n keys", () => {
    const v = quotaErrorView("need_tauri");
    expect(v.softFail).toBe(true);
    expect(v.kind).toBe("host_only");
    expect(v.titleKey).toBe("account.quota.err.host_only");
    expect(v.hintKey).toBe("account.quota.err.host_onlyHint");
  });

  it("resolveQuotaErrorChip null for empty", () => {
    expect(resolveQuotaErrorChip(null)).toBeNull();
    expect(resolveQuotaErrorChip("")).toBeNull();
    const chip = resolveQuotaErrorChip({ code: "network" });
    expect(chip?.softFail).toBe(true);
    expect(chip?.kind).toBe("network");
  });
});

describe("resolveQuotaEmptyState", () => {
  it("loading wins only when usage not yet known", () => {
    const s = resolveQuotaEmptyState({
      loading: true,
      membership: true,
      usageKnown: false,
    });
    expect(s?.kind).toBe("loading");
    expect(s?.softFail).toBe(false);
    expect(s?.chipKey).toBe("account.quota.chip.loading");

    // Background refresh: keep known bar.
    expect(
      resolveQuotaEmptyState({
        loading: true,
        membership: true,
        usageKnown: true,
      }),
    ).toBeNull();
  });

  it("signed_out when no membership — never invent remaining", () => {
    const s = resolveQuotaEmptyState({
      loading: false,
      membership: false,
      usageKnown: false,
    });
    expect(s?.kind).toBe("signed_out");
    expect(s?.softFail).toBe(false);
    expect(formatQuotaRemainLabel(null)).toBeNull();
  });

  it("error soft-fail when probe fails and usage unknown", () => {
    const s = resolveQuotaEmptyState({
      loading: false,
      membership: true,
      usageKnown: false,
      error: { code: "network", message: "offline" },
    });
    expect(s?.kind).toBe("error");
    expect(s?.softFail).toBe(true);
    expect(s?.error?.kind).toBe("network");
    expect(s?.showRefresh).toBe(true);
    expect(s?.chipKey).toBe("account.quota.chip.err.network");
  });

  it("auth soft-fail when token expired", () => {
    const s = resolveQuotaEmptyState({
      loading: false,
      membership: true,
      usageKnown: false,
      error: "token expired — sign in again",
    });
    expect(s?.kind).toBe("error");
    expect(s?.error?.kind).toBe("auth");
  });

  it("unknown when membership present but host silent", () => {
    const s = resolveQuotaEmptyState({
      loading: false,
      membership: true,
      usageKnown: false,
    });
    expect(s?.kind).toBe("unknown");
    expect(s?.softFail).toBe(true);
    expect(s?.titleKey).toBe("account.quotaUnknown");
    expect(s?.bodyKey).toBe("account.billingUnavailable");
    expect(s?.chipKey).toBe("account.quota.chip.unknown");
  });

  it("returns null when usage is known (render bar)", () => {
    expect(
      resolveQuotaEmptyState({
        loading: false,
        membership: true,
        usageKnown: true,
      }),
    ).toBeNull();

    // Known usage with soft error → still show bar (chip may be separate).
    expect(
      resolveQuotaEmptyState({
        loading: false,
        membership: true,
        usageKnown: true,
        error: "network offline",
      }),
    ).toBeNull();
  });
});

describe("formatQuotaUnknown", () => {
  it("returns honesty label keys — never a numeric percent", () => {
    for (const kind of [
      "loading",
      "signed_out",
      "unknown",
      "error",
      "network",
      "auth",
      "host_only",
      "other",
      null,
      undefined,
    ] as const) {
      const labels = formatQuotaUnknown(kind);
      expect(labels.chipKey.startsWith("account.quota.")).toBe(true);
      expect(labels.titleKey.startsWith("account.")).toBe(true);
      expect(labels.chipKey).not.toMatch(/%/);
      expect(labels.titleKey).not.toMatch(/\d+%/);
    }
  });

  it("maps error kinds to account.quota.err.*", () => {
    expect(formatQuotaUnknown("network").titleKey).toBe(
      "account.quota.err.network",
    );
    expect(formatQuotaUnknown("auth").chipKey).toBe(
      "account.quota.chip.err.auth",
    );
    expect(formatQuotaUnknown("host_only").bodyKey).toBe(
      "account.quota.err.host_onlyHint",
    );
  });
});
