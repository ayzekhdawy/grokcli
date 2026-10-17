/**
 * Probe Grok endpoints through the effective proxy (path only, not auth).
 */
import { useState } from "react";
import * as api from "@/lib/api";
import type { NetworkProbeEffective } from "@/lib/api/system";
import {
  classifyProbeResult,
  probeTargetClassMessageKey,
  type ClassifiedProbeResult,
} from "@/lib/networkProxy";
import { formatProbeSummary } from "@/lib/networkProxyPro";
import type { MessageKey, Vars } from "@/i18n";

const SOURCE_KEYS: Record<string, MessageKey> = {
  manual: "settings.netProbe.source.manual",
  env: "settings.netProbe.source.env",
  system_http: "settings.netProbe.source.system_http",
  system_socks: "settings.netProbe.source.system_socks",
  system_pac: "settings.netProbe.source.system_pac",
  none: "settings.netProbe.source.none",
  direct: "settings.netProbe.source.direct",
};

function effectiveSourceLabel(
  source: string | undefined,
  t: (k: string, vars?: Vars) => string,
): string {
  const s = (source || "none").trim().toLowerCase();
  const key = SOURCE_KEYS[s];
  return key ? t(key) : s;
}

function formatEffectiveLine(
  effective: NetworkProbeEffective | null | undefined,
  t: (k: string, vars?: Vars) => string,
): { text: string; softFail: boolean } | null {
  if (!effective) return null;
  const decision = (effective.decision || "").trim().toLowerCase();
  const source = effectiveSourceLabel(effective.source, t);
  if (decision === "use" && effective.url) {
    return {
      text: t("settings.netProbe.effective.use", {
        url: effective.url,
        source,
      }),
      softFail: false,
    };
  }
  if (decision === "inherit") {
    return {
      text: t("settings.netProbe.effective.inherit", { source }),
      softFail: false,
    };
  }
  if (decision === "direct") {
    return {
      text: t("settings.netProbe.effective.direct"),
      softFail: false,
    };
  }
  // none / empty — the usual “need TUN or Manual” case
  return {
    text: t("settings.netProbe.effective.none"),
    softFail: true,
  };
}

/** Probe Grok endpoints through the effective proxy (path only, not auth). */
export function NetworkProbeField({ t }: { t: (k: string, vars?: Vars) => string }) {
  const [testing, setTesting] = useState(false);
  const [classified, setClassified] = useState<ClassifiedProbeResult | null>(
    null,
  );
  const [effective, setEffective] = useState<NetworkProbeEffective | null>(
    null,
  );
  const isDesktop = api.isTauri();

  const runTest = async () => {
    if (!api.isTauri()) {
      setClassified(classifyProbeResult(null, { available: false }));
      setEffective(null);
      return;
    }
    setTesting(true);
    try {
      const raw = await api.networkProbe();
      setClassified(classifyProbeResult(raw));
      setEffective(raw?.effective ?? null);
    } catch (e) {
      setClassified(
        classifyProbeResult(null, { invokeError: String(e) }),
      );
      setEffective(null);
    } finally {
      setTesting(false);
    }
  };

  const effectiveLine = formatEffectiveLine(effective, t);

  const summary = formatProbeSummary({
    classified,
    isDesktop,
    probing: testing,
  });

  return (
    <div className="settings-row settings-row--stack">
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.netProbe")}</div>
        <div className="settings-row__desc">{t("settings.netProbeDesc")}</div>
      </div>
      <div className="settings-row__hint">{t("settings.netProbeHonesty")}</div>
      {effectiveLine ? (
        <div
          className={
            "settings-row__hint" +
            (effectiveLine.softFail ? " is-danger" : "")
          }
          role="status"
        >
          {effectiveLine.text}
        </div>
      ) : null}
      <div className="settings-netprobe">
        <div className="settings-netprobe__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={testing || !isDesktop}
            onClick={() => void runTest()}
          >
            {t(summary.primaryActionKey as MessageKey)}
          </button>
          {summary.showRetry &&
          !testing &&
          isDesktop &&
          !summary.empty?.showRetry ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => void runTest()}
            >
              {t("settings.netProbeRetry")}
            </button>
          ) : null}
          {summary.showChip && summary.outcomeKey ? (
            <div
              className={
                "settings-acp-chip settings-netprobe__chip " + summary.toneClass
              }
              role="status"
            >
              <span className="settings-acp-chip__dot" aria-hidden />
              <span className="settings-acp-chip__label">
                {t(summary.outcomeKey as MessageKey)}
              </span>
              {summary.showCounts ? (
                <span className="settings-acp-chip__meta">
                  {t("settings.netProbe.summaryCounts", {
                    ok: summary.okCount,
                    fail: summary.failCount,
                  })}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        {summary.empty ? (
          <div
            className={
              "settings-netprobe__empty" +
              (summary.empty.softFail ? " is-soft" : "")
            }
            data-kind={summary.empty.kind}
            role="status"
          >
            <div className="settings-netprobe__empty-title">
              {t(summary.empty.titleKey as MessageKey)}
            </div>
            <div className="settings-netprobe__empty-hint">
              {t(summary.empty.hintKey as MessageKey)}
            </div>
            {summary.empty.showRetry && isDesktop && !testing ? (
              <div className="settings-netprobe__empty-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void runTest()}
                >
                  {t("settings.netProbeRetry")}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {summary.invokeError ? (
          <div className="settings-row__hint is-danger" role="alert">
            {summary.invokeError}
          </div>
        ) : null}
        {summary.showTargetList && classified ? (
          <ul className="settings-netprobe__list" role="list">
            {classified.targets.map((tg) => (
              <li
                key={tg.key}
                className={
                  "settings-netprobe__item" + (tg.ok ? " is-ok" : " is-fail")
                }
              >
                <span className="settings-netprobe__mark" aria-hidden>
                  {tg.ok ? "✓" : "✗"}
                </span>
                <span className="settings-netprobe__key">{tg.key}</span>
                <span className="settings-netprobe__url">{tg.url}</span>
                <span
                  className={
                    "settings-acp-chip settings-netprobe__target-chip " +
                    (tg.ok ? "is-ok" : "is-fail")
                  }
                >
                  <span className="settings-acp-chip__dot" aria-hidden />
                  <span className="settings-acp-chip__label">
                    {t(probeTargetClassMessageKey(tg.klass) as MessageKey)}
                  </span>
                  <span className="settings-acp-chip__meta">
                    {tg.ok
                      ? `${tg.status ?? ""} · ${tg.millis}ms`
                      : tg.error || t("settings.netProbeFailed")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
