/**
 * MCP OAuth recovery wizard (GlassModal steps).
 *
 * Prefers host `mcp_oauth_start` (PKCE + loopback): auto-open browser, poll
 * until tokens land, then re-run doctor. Falls back to TUI instructions only
 * when the host command is missing / fails.
 */

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { Locale, MessageKey } from "@/i18n";
import { createT } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import {
  IconDoctor,
  IconExternalLink,
  IconRefresh,
} from "@/components/icons";
import * as api from "@/lib/api";
import {
  redactMcpOauthText,
  sanitizeMcpAuthUrl,
  type McpOauthAction,
} from "@/lib/mcpOauth";
import {
  emptyMcpOauthWizardState,
  evaluateMcpOauthDoctorRefresh,
  mcpOauthWizardCanConfirmAuthorized,
  mcpOauthWizardHasOpenableUrl,
  mcpOauthWizardSoftFailLabelKey,
  mcpOauthWizardStepIndex,
  mcpOauthWizardStepLabelKey,
  mcpOauthWizardTitleKey,
  MCP_OAUTH_WIZARD_PROGRESS_TOTAL,
  reduceMcpOauthWizard,
  sanitizeMcpOauthWizardLog,
  type McpOauthWizardState,
} from "@/lib/mcpOauthWizard";
import type { McpDoctorReportLike } from "@/lib/mcpStatus";

export type McpOauthWizardDoctorRefreshResult = {
  report?: McpDoctorReportLike | null;
  error?: string | null;
};

export type McpOauthWizardProps = {
  open: boolean;
  locale: Locale;
  /** Classified OAuth action; required when open. */
  action: McpOauthAction | null;
  /** Optional redacted reason from doctor status / finding. */
  statusReason?: string | null;
  onClose: () => void;
  /**
   * Soft-fail open browser URL (defaults to host `openExternalUrl`).
   * Callers only receive sanitized http(s).
   */
  onOpenExternalUrl?: (url: string) => void | Promise<void>;
  /**
   * Re-run doctor after the user confirms authorization.
   * Should update parent doctor state and return the latest report.
   */
  onRefreshDoctor?: (
    serverName: string | null,
  ) => Promise<McpOauthWizardDoctorRefreshResult>;
};

function softFailBadgeClass(
  soft: McpOauthWizardState["softFail"],
  step: McpOauthWizardState["step"],
): string {
  if (step === "success" || soft === "none") return "ext-badge--ok";
  if (soft === "doctor_failed") return "ext-badge--fail";
  // Soft guidance / still needs auth — warn, not hard crash.
  return "ext-badge--warn";
}

export function McpOauthWizard({
  open,
  locale,
  action,
  statusReason,
  onClose,
  onOpenExternalUrl,
  onRefreshDoctor,
}: McpOauthWizardProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [state, dispatch] = useReducer(
    reduceMcpOauthWizard,
    undefined,
    emptyMcpOauthWizardState,
  );
  const [busy, setBusy] = useState(false);
  /** Host PKCE start error (shown above soft-fail chip). */
  const [hostStartError, setHostStartError] = useState<string | null>(null);
  const [hostBooting, setHostBooting] = useState(false);

  const openExternal = useCallback(
    async (url: string) => {
      if (onOpenExternalUrl) {
        await onOpenExternalUrl(url);
        return;
      }
      if (!api.isTauri()) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      await api.openExternalUrl(url);
    },
    [onOpenExternalUrl],
  );

  const applyAuthUrlAndOpen = useCallback(
    async (rawUrl: string) => {
      const preferUrl = sanitizeMcpAuthUrl(rawUrl) ?? rawUrl.trim();
      if (!preferUrl || !action) return false;
      const enriched: McpOauthAction = {
        ...action,
        preferredUrl: preferUrl,
        authUrls: [preferUrl, ...(action.authUrls ?? []).filter((u) => u !== preferUrl)],
      };
      dispatch({
        type: "init",
        input: {
          action: enriched,
          reason: statusReason ?? null,
          preferUrl,
        },
      });
      // intro → auth
      dispatch({ type: "continue" });
      try {
        await openExternal(preferUrl);
        dispatch({ type: "open_url_ok" });
        // auth → waiting (host is listening on loopback)
        dispatch({ type: "continue" });
        return true;
      } catch (e) {
        dispatch({
          type: "open_url_error",
          error: redactMcpOauthText(String(e)).slice(0, 240),
        });
        return false;
      }
    },
    [action, openExternal, statusReason],
  );

  /** Start host OAuth (PKCE) and open browser — used on open + retry button. */
  const startHostBrowserOauth = useCallback(async () => {
    if (!action?.server?.trim()) {
      setHostStartError(tr("mcpOauth.wizard.hostNoServer"));
      return;
    }
    if (!api.isTauri()) {
      setHostStartError(tr("ext.needTauri"));
      return;
    }
    setHostBooting(true);
    setHostStartError(null);
    setBusy(true);
    try {
      const started = await api.mcpOauthStart(action.server.trim());
      const url = (started?.authUrl || "").trim();
      if (!url) {
        setHostStartError(
          started?.message?.trim() || tr("mcpOauth.wizard.hostNoUrl"),
        );
        // Still seed wizard so user sees steps / TUI fallback.
        dispatch({
          type: "init",
          input: { action, reason: statusReason ?? null },
        });
        return;
      }
      await applyAuthUrlAndOpen(url);
    } catch (e) {
      const msg = redactMcpOauthText(String(e)).slice(0, 320);
      setHostStartError(msg || tr("mcpOauth.wizard.hostStartFailed"));
      dispatch({
        type: "init",
        input: {
          action,
          reason: statusReason ?? msg,
        },
      });
      try {
        console.warn("[mcp-oauth-wizard] host oauth start failed", msg);
      } catch {
        /* ignore */
      }
    } finally {
      setHostBooting(false);
      setBusy(false);
    }
  }, [action, applyAuthUrlAndOpen, statusReason, tr]);

  // Seed when opened: immediately try host browser OAuth.
  useEffect(() => {
    if (!open || !action) {
      if (!open) {
        dispatch({ type: "reset" });
        setBusy(false);
        setHostStartError(null);
        setHostBooting(false);
      }
      return;
    }
    // Seed skeleton immediately so modal is not blank while host boots.
    dispatch({
      type: "init",
      input: { action, reason: statusReason ?? null },
    });
    void startHostBrowserOauth();
  }, [
    open,
    action?.server,
    action?.kind,
    action?.isRetry,
    statusReason,
    // intentionally not depending on startHostBrowserOauth identity every render
  ]);

  const handleOpenUrl = useCallback(async () => {
    // Prefer re-starting host flow (fresh loopback port) when no URL yet.
    if (!state.authUrl) {
      await startHostBrowserOauth();
      return;
    }
    setBusy(true);
    try {
      await openExternal(state.authUrl);
      dispatch({ type: "open_url_ok" });
    } catch (e) {
      dispatch({
        type: "open_url_error",
        error: redactMcpOauthText(String(e)).slice(0, 240),
      });
    } finally {
      setBusy(false);
    }
  }, [openExternal, startHostBrowserOauth, state.authUrl]);

  const runDoctorRefresh = useCallback(async () => {
    const server = state.server;
    dispatch({ type: "doctor_start" });
    setBusy(true);
    try {
      let result: McpOauthWizardDoctorRefreshResult;
      if (onRefreshDoctor) {
        result = await onRefreshDoctor(server);
      } else if (api.isTauri()) {
        try {
          const report = await api.mcpDoctor(server);
          result = { report, error: null };
        } catch (e) {
          result = {
            report: null,
            error: redactMcpOauthText(String(e)).slice(0, 240),
          };
        }
      } else {
        result = {
          report: null,
          error: tr("ext.needTauri"),
        };
      }

      const evaluated = evaluateMcpOauthDoctorRefresh({
        report: result.report,
        serverName: server,
        doctorError: result.error,
      });
      dispatch({
        type: "doctor_result",
        stillNeedsAuth: evaluated.stillNeedsAuth,
        reason: evaluated.reason,
        doctorError:
          evaluated.softFail === "doctor_failed"
            ? evaluated.reason ?? result.error
            : null,
      });
      try {
        console.info(
          "[mcp-oauth-wizard] doctor_result",
          sanitizeMcpOauthWizardLog({
            ...state,
            step: evaluated.ok ? "success" : "fail",
            softFail: evaluated.softFail,
            softFailNonBlocking:
              evaluated.softFail !== "none" &&
              evaluated.softFail !== "doctor_failed",
            reason: evaluated.reason,
            errorMessage: evaluated.reason,
            refreshAttempts: state.refreshAttempts + 1,
          }),
        );
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  }, [onRefreshDoctor, state, tr]);

  const handleIAuthorized = useCallback(() => {
    if (!mcpOauthWizardCanConfirmAuthorized(state)) return;
    void runDoctorRefresh();
  }, [runDoctorRefresh, state]);

  // Poll host OAuth callback status while wizard is open on waiting/auth.
  useEffect(() => {
    if (!open || !action?.server?.trim() || !api.isTauri()) return;
    if (state.step !== "waiting" && state.step !== "auth") return;
    let cancelled = false;
    const server = action.server.trim();
    const tick = async () => {
      try {
        const st = await api.mcpOauthStatus(server);
        if (cancelled) return;
        if (st.phase === "success") {
          void runDoctorRefresh();
        } else if (st.phase === "error") {
          dispatch({
            type: "doctor_result",
            stillNeedsAuth: true,
            reason: st.message || st.error || "OAuth failed",
            doctorError: null,
          });
        }
      } catch {
        /* soft-fail poll */
      }
    };
    const id = window.setInterval(() => void tick(), 1500);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open, action?.server, state.step, runDoctorRefresh]);

  const handleClose = useCallback(() => {
    if (busy && state.step === "refreshing") return;
    dispatch({ type: "reset" });
    onClose();
  }, [busy, onClose, state.step]);

  const serverName =
    state.server || tr("mcpModal.oauth.unknownServer");
  const stepIdx = mcpOauthWizardStepIndex(state.step);
  const progressLabel = tr("mcpOauth.wizard.progress", {
    n: Math.min(stepIdx + 1, MCP_OAUTH_WIZARD_PROGRESS_TOTAL),
    total: MCP_OAUTH_WIZARD_PROGRESS_TOTAL,
  });
  const hasUrl = mcpOauthWizardHasOpenableUrl(state);
  const showSoftChip =
    state.softFail !== "none" ||
    state.step === "success" ||
    state.step === "fail";

  const footer = (
    <>
      {state.step === "intro" || state.step === "auth" ? (
        <>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={handleClose}
            disabled={hostBooting}
          >
            {tr("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn--solid"
            disabled={busy || hostBooting}
            onClick={() => void startHostBrowserOauth()}
          >
            <IconExternalLink size={14} />
            <span>
              {hostBooting || busy
                ? tr("mcpOauth.wizard.openingUrl")
                : tr("mcpOauth.wizard.startBrowser")}
            </span>
          </button>
          {hasUrl ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy || hostBooting}
              onClick={() => void handleOpenUrl()}
            >
              <span>{tr("mcpModal.oauth.openUrl")}</span>
            </button>
          ) : null}
        </>
      ) : null}

      {state.step === "waiting" ? (
        <>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => dispatch({ type: "back" })}
          >
            {tr("mcpOauth.wizard.back")}
          </button>
          {hasUrl ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => void handleOpenUrl()}
            >
              <IconExternalLink size={14} />
              <span>{tr("mcpModal.oauth.openUrl")}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--solid"
            disabled={busy}
            onClick={handleIAuthorized}
          >
            <IconDoctor size={14} />
            <span>{tr("mcpOauth.wizard.iAuthorized")}</span>
          </button>
        </>
      ) : null}

      {state.step === "refreshing" ? (
        <button type="button" className="btn btn--solid" disabled>
          <IconRefresh size={14} />
          <span>{tr("mcpOauth.wizard.refreshing")}</span>
        </button>
      ) : null}

      {state.step === "success" ? (
        <button
          type="button"
          className="btn btn--solid"
          onClick={handleClose}
        >
          {tr("common.close")}
        </button>
      ) : null}

      {state.step === "fail" ? (
        <>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => dispatch({ type: "retry_auth" })}
          >
            {tr("mcpOauth.wizard.retryAuth")}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => {
              dispatch({ type: "retry_refresh" });
            }}
          >
            {tr("mcpOauth.wizard.retryRefresh")}
          </button>
          <button
            type="button"
            className="btn btn--solid"
            disabled={busy}
            onClick={() => void runDoctorRefresh()}
          >
            <IconDoctor size={14} />
            <span>{tr("mcpOauth.wizard.iAuthorized")}</span>
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={handleClose}
          >
            {tr("common.close")}
          </button>
        </>
      ) : null}
    </>
  );

  return (
    <GlassModal
      open={open && !!action}
      onClose={handleClose}
      title={tr(mcpOauthWizardTitleKey(state) as MessageKey, {
        name: serverName,
      })}
      size="md"
      closeLabel={tr("common.close")}
      wrapBody
      className="mcp-oauth-wizard"
      bodyClassName="mcp-oauth-wizard__body"
      closeOnOverlay={!busy || state.step !== "refreshing"}
      showClose={!busy || state.step !== "refreshing"}
      footer={footer}
    >
      <div className="mcp-oauth-wizard__progress" role="status">
        <span className="mcp-oauth-wizard__progress-label">
          {progressLabel}
        </span>
        <span className="mcp-oauth-wizard__progress-step">
          {tr(mcpOauthWizardStepLabelKey(state.step) as MessageKey)}
        </span>
        <div
          className="mcp-oauth-wizard__dots"
          aria-hidden
        >
          {Array.from({ length: MCP_OAUTH_WIZARD_PROGRESS_TOTAL }, (_, i) => (
            <span
              key={i}
              className={
                "mcp-oauth-wizard__dot" +
                (i <= stepIdx ? " is-active" : "") +
                (i === stepIdx ? " is-current" : "") +
                (state.step === "success" && i === stepIdx
                  ? " is-ok"
                  : "") +
                (state.step === "fail" && i === stepIdx ? " is-fail" : "")
              }
            />
          ))}
        </div>
      </div>

      {hostBooting ? (
        <p className="modal-status" role="status">
          {tr("mcpOauth.wizard.hostBooting")}
        </p>
      ) : null}
      {hostStartError ? (
        <p className="modal-status modal-status--error" role="alert">
          {tr("mcpOauth.wizard.hostStartFailed")}: {hostStartError}
        </p>
      ) : null}

      {/* Hide "no headless CLI" chip when we already have a browser URL / host path. */}
      {showSoftChip &&
      state.softFail !== "none" &&
      !(hasUrl || state.urlOpened) ? (
        <p className="mcp-oauth-wizard__chip-row">
          <span
            className={
              "ext-badge " + softFailBadgeClass(state.softFail, state.step)
            }
          >
            {tr(mcpOauthWizardSoftFailLabelKey(state.softFail) as MessageKey)}
          </span>
          {state.softFailNonBlocking ? (
            <span className="mcp-oauth-wizard__soft-hint">
              {tr("mcpOauth.wizard.softHint")}
            </span>
          ) : null}
        </p>
      ) : null}

      {(state.step === "intro" || state.step === "auth") && (
        <div className="mcp-oauth-wizard__panel">
          <p className="app-dialog__msg">
            {hasUrl
              ? tr("mcpOauth.wizard.authLeadUrl")
              : state.isRetry
                ? tr("mcpModal.oauth.retryLead")
                : tr("mcpModal.oauth.authorizeLead")}
          </p>
          <dl className="mcp-oauth-wizard__meta">
            <div>
              <dt>{tr("mcpOauth.wizard.serverLabel")}</dt>
              <dd title={serverName}>{serverName}</dd>
            </div>
            {state.reason ? (
              <div>
                <dt>{tr("mcpOauth.wizard.reasonLabel")}</dt>
                <dd>{state.reason}</dd>
              </div>
            ) : null}
          </dl>
          {hasUrl && state.authUrl ? (
            <p className="mcp-modal__oauth-url" title={state.authUrl}>
              <span className="mcp-modal__oauth-url-label">
                {tr("mcpModal.oauth.urlLabel")}
              </span>{" "}
              <code className="mcp-modal__oauth-url-value">
                {state.authUrl}
              </code>
            </p>
          ) : null}
          {state.errorMessage ? (
            <p className="modal-status modal-status--error">
              {state.errorMessage}
            </p>
          ) : null}
          {state.urlOpened ? (
            <p className="modal-status" role="status">
              {tr("mcpOauth.wizard.urlOpened")}
            </p>
          ) : null}
          <p className="ext-field-hint">{tr("mcpModal.oauth.stepBrowser")}</p>
          {!hasUrl ? (
            <p className="ext-field-hint">{tr("mcpModal.oauth.stepTui")}</p>
          ) : null}
        </div>
      )}

      {state.step === "waiting" ? (
        <div className="mcp-oauth-wizard__panel">
          <p className="app-dialog__msg">
            {tr("mcpOauth.wizard.waitingLeadBrowser")}
          </p>
          <p className="ext-field-hint">
            {tr("mcpOauth.wizard.waitingHint")}
          </p>
          {state.authUrl ? (
            <p className="mcp-modal__oauth-url" title={state.authUrl}>
              <code className="mcp-modal__oauth-url-value">
                {state.authUrl}
              </code>
            </p>
          ) : null}
        </div>
      ) : null}

      {state.step === "refreshing" ? (
        <div className="mcp-oauth-wizard__panel">
          <p className="modal-status" role="status">
            {tr("mcpOauth.wizard.refreshingDetail", { name: serverName })}
          </p>
        </div>
      ) : null}

      {state.step === "success" ? (
        <div className="mcp-oauth-wizard__panel">
          <p className="app-dialog__msg mcp-oauth-wizard__success">
            {tr("mcpOauth.wizard.successLead", { name: serverName })}
          </p>
          {state.reason ? (
            <p className="ext-mcp-status-reason">{state.reason}</p>
          ) : null}
        </div>
      ) : null}

      {state.step === "fail" ? (
        <div className="mcp-oauth-wizard__panel">
          <p className="app-dialog__msg">
            {state.softFail === "doctor_failed"
              ? tr("mcpOauth.wizard.failDoctor")
              : tr("mcpOauth.wizard.failStillAuth", { name: serverName })}
          </p>
          {state.errorMessage || state.reason ? (
            <p className="ext-mcp-status-reason">
              {state.errorMessage || state.reason}
            </p>
          ) : null}
          <ol className="ext-mcp-auth-steps">
            <li>{tr("mcpModal.oauth.stepTui")}</li>
            <li>{tr("ext.mcp.auth.stepReadd")}</li>
            <li>{tr("mcpModal.oauth.stepDoctor")}</li>
          </ol>
          <p className="ext-field-hint">{tr("mcpModal.oauth.noCliHelper")}</p>
        </div>
      ) : null}
    </GlassModal>
  );
}
