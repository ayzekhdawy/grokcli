/**
 * Settings → Runtime → Connection: SDK Connect wizard for agent serve.
 *
 * Steps:
 * 1. Start local serve
 * 2. Show masked secret + ws URL
 * 3. TCP health
 * 4. Copy curl / ws examples for external clients
 * 5. Optional paste remote serve URL + probe
 *
 * Secrets are never logged; full connection URL is held only in-session after start.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MessageKey, Vars } from "@/i18n";
import * as api from "@/lib/api";
import type { ServeStatus, ServeTcpProbeResult } from "@/lib/api";
import {
  buildServeClientExamples,
  buildServeConnectionUrlMasked,
  DEFAULT_SERVE_BIND,
  maskServerKeyInUrl,
  maskServeExampleText,
  parseServeConnectUrl,
  resolveServeProbeTarget,
} from "@/lib/serveConnect";

type CopyKind = "ws" | "curl" | "websocat" | "grok" | null;

export function SdkConnectWizard({
  t,
}: {
  t: (k: MessageKey, vars?: Vars) => string;
}) {
  const [serve, setServe] = useState<ServeStatus | null>(null);
  /** One-time full connection URL from serve_start (not re-fetched by status). */
  const [connectionUrl, setConnectionUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"refresh" | "start" | "stop" | "localProbe" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [localProbe, setLocalProbe] = useState<ServeTcpProbeResult | null>(null);
  const [copied, setCopied] = useState<CopyKind>(null);

  // Step 5 — remote
  const [remoteRaw, setRemoteRaw] = useState("");
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteProbing, setRemoteProbing] = useState(false);
  const [remoteProbe, setRemoteProbe] = useState<ServeTcpProbeResult | null>(null);

  const refresh = useCallback(async () => {
    setBusy("refresh");
    setError(null);
    try {
      const st = await api.serveStatus();
      setServe(st);
      if (st.state !== "running") {
        setConnectionUrl(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, 8000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const state = serve?.state ?? "stopped";
  const running = state === "running";
  const unsupported = state === "unsupported" || serve?.cliSupportsServe === false;
  const canStart =
    !busy &&
    !running &&
    !unsupported &&
    serve?.cliFound !== false &&
    serve?.cliSupportsServe !== false;
  const canStop = !busy && (running || state === "error");

  const stateLabel =
    state === "running"
      ? t("settings.serve.stateRunning")
      : state === "error"
        ? t("settings.serve.stateError")
        : state === "unsupported"
          ? t("settings.serve.stateUnsupported")
          : t("settings.serve.stateStopped");

  const serveTone =
    state === "running"
      ? "ok"
      : state === "error" || state === "unsupported"
        ? "err"
        : "muted";

  const bind = serve?.bind || DEFAULT_SERVE_BIND;
  const secretMasked =
    serve?.secretMasked ||
    (serve?.secretLast4 ? `••••${serve.secretLast4}` : null);
  /** Always-visible URL — secret masked. Full token only via copy after start. */
  const displayUrlSafe = connectionUrl
    ? maskServerKeyInUrl(connectionUrl)
    : secretMasked
      ? `ws://${bind}/ws?server-key=${secretMasked}`
      : buildServeConnectionUrlMasked(bind, null);

  /** Full snippets for clipboard only (secret present after serve_start). */
  const examplesFull = useMemo(
    () =>
      buildServeClientExamples({
        bind,
        connectionUrl,
        secret: null,
      }),
    [bind, connectionUrl],
  );
  /** Always-masked snippets for on-screen display (never show full token). */
  const examplesDisplay = useMemo(
    () =>
      buildServeClientExamples({
        bind,
        connectionUrl: null,
        secret: null,
      }),
    [bind],
  );

  const onStart = async () => {
    setBusy("start");
    setError(null);
    setLocalProbe(null);
    try {
      const st = await api.serveStart();
      setServe(st);
      if (st.connectionUrl) {
        setConnectionUrl(st.connectionUrl);
      }
      // Auto TCP health after start
      if (st.bind) {
        try {
          setLocalProbe(await api.serveTcpProbe(st.bind));
        } catch {
          /* optional */
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      try {
        setServe(await api.serveStatus());
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(null);
    }
  };

  const onStop = async () => {
    setBusy("stop");
    setError(null);
    setLocalProbe(null);
    try {
      const st = await api.serveStop();
      setServe(st);
      setConnectionUrl(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      try {
        setServe(await api.serveStatus());
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(null);
    }
  };

  const onLocalProbe = async () => {
    if (!api.isTauri()) return;
    setBusy("localProbe");
    setError(null);
    try {
      setLocalProbe(await api.serveTcpProbe(bind));
      // Also refresh status for portOpen chip
      setServe(await api.serveStatus());
    } catch (e) {
      setLocalProbe({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        target: bind,
      });
    } finally {
      setBusy(null);
    }
  };

  const copyText = async (text: string, kind: CopyKind) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remoteParseErrorLabel = (code: string): string => {
    switch (code) {
      case "empty":
        return t("settings.sdkConnect.errEmpty");
      case "empty_host":
        return t("settings.sdkConnect.errEmptyHost");
      case "missing_port":
        return t("settings.sdkConnect.errMissingPort");
      case "invalid_port":
        return t("settings.sdkConnect.errInvalidPort");
      case "invalid_host":
        return t("settings.sdkConnect.errInvalidHost");
      default:
        return t("settings.sdkConnect.errJunk");
    }
  };

  const onRemoteProbe = async () => {
    if (!api.isTauri()) return;
    const target = resolveServeProbeTarget(remoteRaw);
    if (!target.ok) {
      setRemoteError(remoteParseErrorLabel(target.error));
      setRemoteProbe(null);
      return;
    }
    setRemoteError(null);
    setRemoteProbing(true);
    setRemoteProbe(null);
    try {
      // Only bare host:port is sent to the host — secret never leaves the field.
      setRemoteProbe(await api.serveTcpProbe(target.bind));
    } catch (e) {
      setRemoteProbe({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        target: target.bind,
      });
    } finally {
      setRemoteProbing(false);
    }
  };

  const remoteParsed = parseServeConnectUrl(remoteRaw.trim());

  return (
    <div className="settings-card" id="settings-anchor-sdkConnect">
      <div className="settings-row settings-row--stack" id="settings-anchor-agentServe">
        <div className="settings-row__text">
          <div className="settings-row__label">{t("settings.sdkConnect.title")}</div>
          <div className="settings-row__desc">{t("settings.sdkConnect.desc")}</div>
        </div>
        <div className="rim-btn-row" style={{ alignItems: "center", gap: 8 }}>
          <span
            className={
              "account-badge" +
              (serveTone === "ok"
                ? " account-badge--ok"
                : serveTone === "err"
                  ? " account-badge--warn"
                  : " account-badge--muted")
            }
          >
            {stateLabel}
          </span>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={!!busy}
            onClick={() => void refresh()}
          >
            {t("settings.serve.refresh")}
          </button>
        </div>
      </div>

      {unsupported ? (
        <div className="settings-row settings-row--stack">
          <div className="settings-row__hint is-danger" role="status">
            {serve?.message || t("settings.serve.unsupportedBody")}
          </div>
        </div>
      ) : (
        <>
          {/* ── 1. Local serve start ─────────────────────────────────────── */}
          <div className="settings-row settings-row--stack sdk-connect-step">
            <div className="sdk-connect-step__label">
              <span className="sdk-connect-step__n" aria-hidden>
                1
              </span>
              <span className="settings-row__label">
                {t("settings.sdkConnect.step1")}
              </span>
            </div>
            <div className="rim-btn-row">
              <button
                type="button"
                className="btn btn--primary"
                disabled={!canStart}
                onClick={() => void onStart()}
              >
                {busy === "start" ? t("settings.serve.starting") : t("settings.serve.start")}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={!canStop}
                onClick={() => void onStop()}
              >
                {busy === "stop" ? t("settings.serve.stopping") : t("settings.serve.stop")}
              </button>
            </div>
            <div className="settings-row__hint">{t("settings.sdkConnect.step1Hint")}</div>
          </div>

          {/* ── 2. Masked secret + ws URL ────────────────────────────────── */}
          <div className="settings-row settings-row--stack sdk-connect-step">
            <div className="sdk-connect-step__label">
              <span className="sdk-connect-step__n" aria-hidden>
                2
              </span>
              <span className="settings-row__label">
                {t("settings.sdkConnect.step2")}
              </span>
            </div>
            <div className="settings-row__text">
              <div className="settings-row__hint">
                {t("settings.serve.bind")}:{" "}
                <code className="sdk-connect-mono">{bind}</code>
              </div>
              <div className="settings-row__hint">
                {t("settings.serve.secret")}:{" "}
                <code className="sdk-connect-mono">
                  {secretMasked || t("settings.serve.secretNone")}
                </code>
              </div>
              <div className="settings-row__hint">
                {t("settings.sdkConnect.wsUrl")}:{" "}
                <code className="sdk-connect-mono sdk-connect-mono--wrap">
                  {displayUrlSafe}
                </code>
              </div>
              <div className="settings-row__hint">{t("settings.serve.secretHint")}</div>
            </div>
          </div>

          {/* ── 3. TCP health ────────────────────────────────────────────── */}
          <div className="settings-row settings-row--stack sdk-connect-step">
            <div className="sdk-connect-step__label">
              <span className="sdk-connect-step__n" aria-hidden>
                3
              </span>
              <span className="settings-row__label">
                {t("settings.sdkConnect.step3")}
              </span>
            </div>
            <div className="rim-btn-row" style={{ alignItems: "center", gap: 8 }}>
              <span
                className={
                  "account-badge" +
                  (serve?.portOpen
                    ? " account-badge--ok"
                    : running
                      ? " account-badge--warn"
                      : " account-badge--muted")
                }
              >
                {serve?.portOpen
                  ? t("settings.serve.portOpen")
                  : t("settings.serve.portClosed")}
              </span>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={!!busy}
                onClick={() => void onLocalProbe()}
              >
                {busy === "localProbe"
                  ? t("settings.sdkConnect.probing")
                  : t("settings.sdkConnect.probe")}
              </button>
            </div>
            {localProbe ? (
              <div
                className={
                  "settings-acp-chip" + (localProbe.ok ? " is-ok" : " is-fail")
                }
                role="status"
              >
                <span className="settings-acp-chip__dot" aria-hidden />
                <span className="settings-acp-chip__label">
                  {localProbe.ok
                    ? t("settings.sdkConnect.probeOk")
                    : t("settings.sdkConnect.probeFail")}
                </span>
                <span className="settings-acp-chip__meta">
                  {localProbe.ok
                    ? t("settings.sdkConnect.probeOkMeta", {
                        ms: localProbe.latencyMs ?? 0,
                        target: localProbe.target,
                      })
                    : t("settings.sdkConnect.probeFailMeta", {
                        error: localProbe.error || "unknown",
                        target: localProbe.target,
                      })}
                </span>
              </div>
            ) : null}
          </div>

          {/* ── 4. Client examples ───────────────────────────────────────── */}
          <div className="settings-row settings-row--stack sdk-connect-step">
            <div className="sdk-connect-step__label">
              <span className="sdk-connect-step__n" aria-hidden>
                4
              </span>
              <span className="settings-row__label">
                {t("settings.sdkConnect.step4")}
              </span>
            </div>
            <div className="settings-row__hint">{t("settings.sdkConnect.step4Hint")}</div>

            <div className="sdk-connect-example">
              <div className="sdk-connect-example__head">
                <span>{t("settings.sdkConnect.exWs")}</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!connectionUrl}
                  title={
                    connectionUrl
                      ? t("settings.serve.copyUrlHint")
                      : t("settings.serve.copyUrlUnavailable")
                  }
                  onClick={() =>
                    void copyText(connectionUrl || examplesFull.wsUrl, "ws")
                  }
                >
                  {copied === "ws" ? t("settings.serve.copied") : t("message.copy")}
                </button>
              </div>
              <code className="settings-acp-cmd">
                {connectionUrl
                  ? maskServerKeyInUrl(connectionUrl)
                  : examplesDisplay.wsUrlMasked}
              </code>
            </div>

            <div className="sdk-connect-example">
              <div className="sdk-connect-example__head">
                <span>{t("settings.sdkConnect.exCurl")}</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() =>
                    void copyText(
                      connectionUrl ? examplesFull.curl : examplesDisplay.curl,
                      "curl",
                    )
                  }
                >
                  {copied === "curl" ? t("settings.serve.copied") : t("message.copy")}
                </button>
              </div>
              <code className="settings-acp-cmd">
                {connectionUrl
                  ? maskServeExampleText(examplesFull.curl)
                  : examplesDisplay.curl}
              </code>
            </div>

            <div className="sdk-connect-example">
              <div className="sdk-connect-example__head">
                <span>{t("settings.sdkConnect.exWebsocat")}</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() =>
                    void copyText(
                      connectionUrl
                        ? examplesFull.websocat
                        : examplesDisplay.websocat,
                      "websocat",
                    )
                  }
                >
                  {copied === "websocat"
                    ? t("settings.serve.copied")
                    : t("message.copy")}
                </button>
              </div>
              <code className="settings-acp-cmd">
                {connectionUrl
                  ? maskServeExampleText(examplesFull.websocat)
                  : examplesDisplay.websocat}
              </code>
            </div>

            <div className="sdk-connect-example">
              <div className="sdk-connect-example__head">
                <span>{t("settings.sdkConnect.exGrok")}</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() =>
                    void copyText(
                      connectionUrl
                        ? examplesFull.grokRemote
                        : examplesDisplay.grokRemote,
                      "grok",
                    )
                  }
                >
                  {copied === "grok" ? t("settings.serve.copied") : t("message.copy")}
                </button>
              </div>
              <code className="settings-acp-cmd">
                {connectionUrl
                  ? maskServeExampleText(examplesFull.grokRemote)
                  : examplesDisplay.grokRemote}
              </code>
            </div>
          </div>

          {/* ── 5. Remote serve URL + probe ──────────────────────────────── */}
          <div className="settings-row settings-row--stack sdk-connect-step">
            <div className="sdk-connect-step__label">
              <span className="sdk-connect-step__n" aria-hidden>
                5
              </span>
              <span className="settings-row__label">
                {t("settings.sdkConnect.step5")}
              </span>
            </div>
            <div className="settings-row__hint">{t("settings.sdkConnect.step5Hint")}</div>
            <div className="settings-acp-field">
              <input
                className={
                  "settings-input" + (remoteError ? " is-invalid" : "")
                }
                value={remoteRaw}
                placeholder={t("settings.sdkConnect.remotePlaceholder")}
                aria-invalid={remoteError ? true : undefined}
                aria-describedby={
                  remoteError ? "settings-sdk-connect-remote-err" : undefined
                }
                onChange={(e) => {
                  setRemoteRaw(e.target.value);
                  setRemoteError(null);
                  setRemoteProbe(null);
                }}
              />
              <button
                type="button"
                className="btn btn--ghost"
                disabled={!remoteRaw.trim() || remoteProbing}
                onClick={() => void onRemoteProbe()}
              >
                {remoteProbing
                  ? t("settings.sdkConnect.probing")
                  : t("settings.sdkConnect.probe")}
              </button>
            </div>
            {remoteError ? (
              <div
                id="settings-sdk-connect-remote-err"
                className="settings-row__hint is-danger"
                role="alert"
              >
                {remoteError}
              </div>
            ) : null}
            {remoteParsed.ok && remoteRaw.trim() ? (
              <div className="settings-row__hint">
                {t("settings.sdkConnect.remoteParsed", {
                  bind: remoteParsed.bind,
                  display: remoteParsed.displayUrl,
                })}
              </div>
            ) : null}
            {remoteProbe ? (
              <div
                className={
                  "settings-acp-chip" + (remoteProbe.ok ? " is-ok" : " is-fail")
                }
                role="status"
              >
                <span className="settings-acp-chip__dot" aria-hidden />
                <span className="settings-acp-chip__label">
                  {remoteProbe.ok
                    ? t("settings.sdkConnect.probeOk")
                    : t("settings.sdkConnect.probeFail")}
                </span>
                <span className="settings-acp-chip__meta">
                  {remoteProbe.ok
                    ? t("settings.sdkConnect.probeOkMeta", {
                        ms: remoteProbe.latencyMs ?? 0,
                        target: remoteProbe.target,
                      })
                    : t("settings.sdkConnect.probeFailMeta", {
                        error: remoteProbe.error || "unknown",
                        target: remoteProbe.target,
                      })}
                </span>
              </div>
            ) : null}
          </div>
        </>
      )}

      {(error || (serve?.message && state === "error")) && (
        <div className="settings-row settings-row--stack">
          <div className="settings-row__hint is-danger" role="alert">
            {error || serve?.message}
          </div>
        </div>
      )}
    </div>
  );
}
