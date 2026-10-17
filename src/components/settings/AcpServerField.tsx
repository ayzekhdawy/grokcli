/**
 * ACP API-mode field: validate on blur, TCP health probe, status chip.
 */
import { useState } from "react";
import * as api from "@/lib/api";
import {
  normalizeAcpServerAddrForSettings,
  parseAcpServerAddr,
} from "@/lib/acpServerAddr";
import type { Vars } from "@/i18n";

/**
 * ACP API-mode field: validate on blur, TCP health probe, status chip.
 * Empty = local CLI spawn; non-empty host:port = connect over TCP.
 */
export function AcpServerField({
  value,
  onChange,
  onBlurCommit,
  onOpenAgentServe,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Persist after blur when empty or valid (normalized host:port). */
  onBlurCommit: (v: string) => void;
  /** Deep-link to Agent serve controls on the same Connection tab. */
  onOpenAgentServe?: () => void;
  t: (k: string, vars?: Vars) => string;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<api.AcpServerProbeResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const addr = value.trim();
  const parsed = parseAcpServerAddr(addr);
  const port = parsed.ok ? String(parsed.port) : "8799";
  const setupCmd = `socat TCP-LISTEN:${port},reuseaddr,fork EXEC:'grok agent --no-leader stdio'`;

  const errorLabel = (code: string): string => {
    switch (code) {
      case "empty_host":
        return t("settings.acpErrEmptyHost");
      case "missing_port":
        return t("settings.acpErrMissingPort");
      case "invalid_port":
        return t("settings.acpErrInvalidPort");
      case "invalid_host":
        return t("settings.acpErrInvalidHost");
      case "junk":
        return t("settings.acpErrJunk");
      default:
        return t("settings.acpErrJunk");
    }
  };

  const handleBlur = () => {
    const normalized = normalizeAcpServerAddrForSettings(value);
    if (!normalized.ok) {
      setValidationError(errorLabel(normalized.error));
      setResult(null);
      return;
    }
    setValidationError(null);
    const next = normalized.value ?? "";
    if (next !== value) onChange(next);
    onBlurCommit(next);
  };

  const runTest = async () => {
    if (!api.isTauri()) return;
    const check = parseAcpServerAddr(addr);
    if (!check.ok) {
      setValidationError(errorLabel(check.error === "empty" ? "missing_port" : check.error));
      setResult(null);
      return;
    }
    setValidationError(null);
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.acpServerProbe(check.normalized));
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  };
  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(setupCmd);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="settings-row settings-row--stack">
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.acpServer")}</div>
        <div className="settings-row__desc">{t("settings.acpServerDesc")}</div>
      </div>
      <div className="settings-row__hint">{t("settings.acpServerModeHelp")}</div>
      <div className="settings-acp-field">
        <input
          className={
            "settings-input" + (validationError ? " is-invalid" : "")
          }
          value={value}
          placeholder="e.g. 127.0.0.1:8799"
          aria-invalid={validationError ? true : undefined}
          aria-describedby={
            validationError ? "settings-acp-validation" : undefined
          }
          onChange={(e) => {
            onChange(e.target.value);
            setValidationError(null);
            setResult(null);
          }}
          onBlur={handleBlur}
        />
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!addr || testing || !!validationError}
          onClick={() => void runTest()}
        >
          {testing ? t("settings.acpTesting") : t("settings.acpTest")}
        </button>
      </div>
      {validationError ? (
        <div
          id="settings-acp-validation"
          className="settings-row__hint is-danger"
          role="alert"
        >
          {t("settings.acpInvalid", { error: validationError })}
        </div>
      ) : null}
      {result ? (
        <div
          className={
            "settings-acp-chip" + (result.ok ? " is-ok" : " is-fail")
          }
          role="status"
        >
          <span className="settings-acp-chip__dot" aria-hidden />
          <span className="settings-acp-chip__label">
            {result.ok ? t("settings.acpStatusOk") : t("settings.acpStatusFail")}
          </span>
          <span className="settings-acp-chip__meta">
            {result.ok
              ? t("settings.acpProbeOk", {
                  ms: result.latencyMs ?? 0,
                })
              : t("settings.acpProbeFail", {
                  error: result.error || "unknown",
                })}
          </span>
        </div>
      ) : null}
      {onOpenAgentServe ? (
        <div className="settings-row__hint">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onOpenAgentServe}
          >
            {t("settings.acpServerServeLink")}
          </button>
        </div>
      ) : null}
      {addr ? (
        <div className="settings-row__hint">
          <div>{t("settings.acpSetupHint")}</div>
          <code className="settings-acp-cmd">{setupCmd}</code>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void copyCmd()}
          >
            {copied ? t("message.copied") : t("message.copy")}
          </button>
        </div>
      ) : (
        <div className="settings-row__hint">{t("settings.acpServerLocalHint")}</div>
      )}
    </div>
  );
}
