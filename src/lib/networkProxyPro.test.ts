import { describe, expect, it } from "vitest";
import { classifyProbeResult } from "./networkProxy";
import {
  formatProbeSummary,
  probeOutcomeOffersRetry,
  resolveNetworkProxyEmptyState,
  resolveProxyApplyHonesty,
} from "./networkProxyPro";

describe("resolveNetworkProxyEmptyState", () => {
  it("returns host_only when not desktop", () => {
    const e = resolveNetworkProxyEmptyState({ isDesktop: false });
    expect(e?.kind).toBe("host_only");
    expect(e?.softFail).toBe(true);
    expect(e?.showRetry).toBe(false);
    expect(e?.titleKey).toBe("settings.netProbe.empty.hostOnly");
  });

  it("returns null while probing", () => {
    expect(
      resolveNetworkProxyEmptyState({ isDesktop: true, probing: true }),
    ).toBeNull();
  });

  it("returns idle when never run", () => {
    const e = resolveNetworkProxyEmptyState({
      isDesktop: true,
      classified: null,
    });
    expect(e?.kind).toBe("idle");
    expect(e?.showRetry).toBe(false);
  });

  it("maps unavailable / error / empty outcomes", () => {
    expect(
      resolveNetworkProxyEmptyState({
        isDesktop: true,
        classified: classifyProbeResult(null, { available: false }),
      })?.kind,
    ).toBe("host_only");

    const err = resolveNetworkProxyEmptyState({
      isDesktop: true,
      classified: classifyProbeResult(null, {
        invokeError: "command network_probe not found",
      }),
    });
    expect(err?.kind).toBe("probe_error");
    expect(err?.showRetry).toBe(true);

    const empty = resolveNetworkProxyEmptyState({
      isDesktop: true,
      classified: classifyProbeResult({ targets: [] }),
    });
    expect(empty?.kind).toBe("empty_targets");
    expect(empty?.showRetry).toBe(true);
  });

  it("returns null when targets exist (ok / partial / fail)", () => {
    const partial = classifyProbeResult({
      targets: [
        { key: "auth", ok: true, status: 200, millis: 10 },
        { key: "api", ok: false, error: "connection refused", millis: 5 },
      ],
    });
    expect(
      resolveNetworkProxyEmptyState({ isDesktop: true, classified: partial }),
    ).toBeNull();

    const allOk = classifyProbeResult({
      targets: [{ key: "auth", ok: true, status: 200, millis: 10 }],
    });
    expect(
      resolveNetworkProxyEmptyState({ isDesktop: true, classified: allOk }),
    ).toBeNull();
  });
});

describe("resolveProxyApplyHonesty", () => {
  it("lists core scopes for system / none without manual invalid", () => {
    const sys = resolveProxyApplyHonesty({ mode: "system" });
    expect(sys.mode).toBe("system");
    expect(sys.valid).toBe(true);
    expect(sys.showManualInvalidBanner).toBe(false);
    expect(sys.manualInvalidMessageKey).toBeNull();
    const scopes = sys.lines.map((l) => l.scope);
    expect(scopes).toContain("saved");
    expect(scopes).toContain("new_agents");
    expect(scopes).toContain("reconnect");
    expect(scopes).toContain("probe_effective");
    expect(scopes).not.toContain("manual_invalid_inherit");
    expect(sys.lines.every((l) => l.tone === "muted")).toBe(true);

    const none = resolveProxyApplyHonesty({ mode: "none", valid: true });
    expect(none.valid).toBe(true);
    expect(none.showManualInvalidBanner).toBe(false);
  });

  it("adds danger manual_invalid when valid is false", () => {
    const bad = resolveProxyApplyHonesty({ mode: "manual", valid: false });
    expect(bad.valid).toBe(false);
    expect(bad.showManualInvalidBanner).toBe(true);
    expect(bad.manualInvalidMessageKey).toBe(
      "settings.proxy.apply.manualInvalidInherit",
    );
    const line = bad.lines.find((l) => l.scope === "manual_invalid_inherit");
    expect(line?.tone).toBe("danger");
    expect(line?.messageKey).toBe(
      "settings.proxy.apply.manualInvalidInherit",
    );
  });

  it("derives valid from url when omitted", () => {
    const ok = resolveProxyApplyHonesty({
      mode: "manual",
      url: "http://127.0.0.1:7890",
    });
    expect(ok.valid).toBe(true);
    expect(ok.showManualInvalidBanner).toBe(false);

    const empty = resolveProxyApplyHonesty({ mode: "manual", url: "" });
    expect(empty.valid).toBe(false);
    expect(empty.showManualInvalidBanner).toBe(true);

    const bare = resolveProxyApplyHonesty({
      mode: "manual",
      url: "127.0.0.1:7890",
    });
    expect(bare.valid).toBe(false);
  });

  it("respects explicit valid over url string", () => {
    const forcedOk = resolveProxyApplyHonesty({
      mode: "manual",
      valid: true,
      url: "",
    });
    expect(forcedOk.valid).toBe(true);
    expect(forcedOk.showManualInvalidBanner).toBe(false);

    const forcedBad = resolveProxyApplyHonesty({
      mode: "manual",
      valid: false,
      url: "http://127.0.0.1:7890",
    });
    expect(forcedBad.valid).toBe(false);
    expect(forcedBad.showManualInvalidBanner).toBe(true);
  });
});

describe("probeOutcomeOffersRetry / formatProbeSummary", () => {
  it("offers retry for re-runnable fail outcomes only on desktop", () => {
    expect(probeOutcomeOffersRetry("error", true)).toBe(true);
    expect(probeOutcomeOffersRetry("empty", true)).toBe(true);
    expect(probeOutcomeOffersRetry("all_fail", true)).toBe(true);
    expect(probeOutcomeOffersRetry("partial", true)).toBe(true);
    expect(probeOutcomeOffersRetry("all_ok", true)).toBe(false);
    expect(probeOutcomeOffersRetry("unavailable", true)).toBe(false);
    expect(probeOutcomeOffersRetry("error", false)).toBe(false);
    expect(probeOutcomeOffersRetry(null, true)).toBe(false);
  });

  it("formats host-only empty + muted chip", () => {
    const s = formatProbeSummary({
      classified: null,
      isDesktop: false,
    });
    expect(s.empty?.kind).toBe("host_only");
    expect(s.showRetry).toBe(false);
    expect(s.showTargetList).toBe(false);
    expect(s.outcome).toBe("unavailable");
    expect(s.primaryActionKey).toBe("settings.netProbeRun");
    expect(s.outcomeKey).toBe("settings.netProbe.outcome.unavailable");
  });

  it("formats idle before first run", () => {
    const s = formatProbeSummary({
      classified: null,
      isDesktop: true,
    });
    expect(s.empty?.kind).toBe("idle");
    expect(s.showChip).toBe(false);
    expect(s.primaryActionKey).toBe("settings.netProbeRun");
  });

  it("formats probing as Testing with no empty", () => {
    const s = formatProbeSummary({
      classified: null,
      isDesktop: true,
      probing: true,
    });
    expect(s.primaryActionKey).toBe("settings.netProbeTesting");
    expect(s.empty).toBeNull();
    expect(s.showRetry).toBe(false);
  });

  it("formats partial with counts, list, and Retry CTA", () => {
    const classified = classifyProbeResult({
      targets: [
        { key: "auth", ok: true, status: 200, millis: 12 },
        { key: "chat", ok: false, error: "timed out", millis: 800 },
      ],
    });
    const s = formatProbeSummary({ classified, isDesktop: true });
    expect(s.outcome).toBe("partial");
    expect(s.showCounts).toBe(true);
    expect(s.okCount).toBe(1);
    expect(s.failCount).toBe(1);
    expect(s.showTargetList).toBe(true);
    expect(s.showRetry).toBe(true);
    expect(s.primaryActionKey).toBe("settings.netProbeRun");
    expect(s.empty).toBeNull();
    expect(s.toneClass).toBe("is-warn");
  });

  it("formats all_ok without Retry CTA", () => {
    const classified = classifyProbeResult({
      targets: [{ key: "auth", ok: true, status: 200, millis: 8 }],
    });
    const s = formatProbeSummary({ classified, isDesktop: true });
    expect(s.outcome).toBe("all_ok");
    expect(s.showRetry).toBe(false);
    expect(s.primaryActionKey).toBe("settings.netProbeRun");
    expect(s.toneClass).toBe("is-ok");
  });

  it("formats invoke error with empty + retry", () => {
    const classified = classifyProbeResult(null, {
      invokeError: "network_probe boom",
    });
    const s = formatProbeSummary({ classified, isDesktop: true });
    expect(s.empty?.kind).toBe("probe_error");
    expect(s.showRetry).toBe(true);
    expect(s.empty?.showRetry).toBe(true);
    expect(s.primaryActionKey).toBe("settings.netProbeRun");
    expect(s.invokeError).toContain("network_probe");
    expect(s.showTargetList).toBe(false);
  });
});
