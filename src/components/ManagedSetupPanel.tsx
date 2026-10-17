/**
 * Settings → Runtime: managed configuration via `grok setup` / `grok setup --json`.
 * Guided steps, honest signature status (never invent verified), secret-safe preview.
 * Install confirms with GlassModal (never window.confirm).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import { createT, type Locale, type MessageKey } from "@/i18n";
import {
  buildManagedSetupSteps,
  buildSignatureView,
  classifySetupError,
  emptyManagedLocalStatus,
  extractPreviewMeta,
  signatureRecoveryId,
  summarizeSetupJson,
  type ManagedLocalStatus,
  type ManagedPreviewMeta,
  type ManagedSetupErrorKind,
  type ManagedSetupStep,
  type ManagedSetupStepId,
  type ManagedSetupSummary,
  type ManagedSignatureRecoveryId,
  type ManagedSignatureStatus,
  type ManagedSignatureView,
} from "@/lib/managedSetup";
import { isCliMissingError } from "@/lib/extensionsUi";
import { GlassModal } from "@/components/GlassModal";
import { IconRefresh } from "@/components/icons";

export interface ManagedSetupPanelProps {
  locale: Locale;
  cliFound?: boolean;
  onOpenAccount?: () => void;
}

function mapApiStatus(
  res: api.ManagedSetupStatusResult | null | undefined,
): ManagedLocalStatus {
  if (!res) return emptyManagedLocalStatus({ ok: false, reason: "unavailable" });
  return {
    ok: res.ok !== false,
    cliFound: !!res.cliFound,
    grokHome: res.grokHome ?? null,
    managedConfigPresent: !!res.managedConfigPresent,
    requirementsPresent: !!res.requirementsPresent,
    configSignaturePresent: !!res.configSignaturePresent,
    identitySignaturePresent: !!res.identitySignaturePresent,
    systemManagedConfigPresent: !!res.systemManagedConfigPresent,
    managedSettingsActive: res.managedSettingsActive ?? null,
    managedSettingsExists: res.managedSettingsExists ?? null,
    managedSettingsPath: res.managedSettingsPath ?? null,
    signatureVerified: res.signatureVerified ?? null,
    signatureVerifySource: res.signatureVerifySource ?? null,
    presenceOnly: res.presenceOnly ?? res.signatureVerified == null,
    reason: res.reason ?? null,
  };
}

function stepLabelKey(id: ManagedSetupStepId): MessageKey {
  switch (id) {
    case "cli":
      return "managedSetup.step.cli";
    case "auth":
      return "managedSetup.step.auth";
    case "preview":
      return "managedSetup.step.preview";
    case "install":
      return "managedSetup.step.install";
    case "verify":
      return "managedSetup.step.verify";
  }
}

function stepStateKey(state: ManagedSetupStep["state"]): MessageKey {
  switch (state) {
    case "done":
      return "managedSetup.stepState.done";
    case "current":
      return "managedSetup.stepState.current";
    case "blocked":
      return "managedSetup.stepState.blocked";
    case "soft":
      return "managedSetup.stepState.soft";
    case "todo":
    default:
      return "managedSetup.stepState.todo";
  }
}

function signatureLabelKey(status: ManagedSignatureStatus): MessageKey {
  switch (status) {
    case "absent":
      return "managedSetup.sig.absent";
    case "present_unverified":
      return "managedSetup.sig.presentUnverified";
    case "verify_ok":
      return "managedSetup.sig.verifyOk";
    case "verify_failed":
      return "managedSetup.sig.verifyFailed";
    case "soft_fail":
    default:
      return "managedSetup.sig.softFail";
  }
}

function recoveryKey(id: ManagedSignatureRecoveryId): MessageKey {
  switch (id) {
    case "absent":
      return "managedSetup.recovery.absent";
    case "present_unverified":
      return "managedSetup.recovery.presentUnverified";
    case "verify_ok":
      return "managedSetup.recovery.verifyOk";
    case "verify_failed":
      return "managedSetup.recovery.verifyFailed";
    case "cli_missing":
      return "managedSetup.recovery.cliMissing";
    case "inspect_soft":
      return "managedSetup.recovery.inspectSoft";
    case "soft_fail":
    default:
      return "managedSetup.recovery.softFail";
  }
}

function chipClassForStatus(status: ManagedSignatureStatus): string {
  switch (status) {
    case "verify_ok":
      return "ext-badge ext-badge--ok";
    case "verify_failed":
      return "ext-badge ext-badge--fail";
    case "present_unverified":
      return "ext-badge ext-badge--warn";
    case "soft_fail":
    case "absent":
    default:
      return "ext-badge ext-badge--muted";
  }
}

function factLabelKey(id: string): MessageKey | null {
  switch (id) {
    case "managed_config.toml":
      return "managedSetup.chip.configToml";
    case "managed_config.sig.json":
      return "managedSetup.chip.configSig";
    case "managed_identity.sig.json":
      return "managedSetup.chip.identitySig";
    case "requirements.toml":
      return "managedSetup.chip.requirements";
    case "system_managed_config":
      return "managedSetup.chip.systemConfig";
    case "managed_settings_active":
      return "managedSetup.chip.managedActive";
    case "signature_verified":
      return "managedSetup.detail.signatureVerified";
    default:
      return null;
  }
}

export function ManagedSetupPanel({
  locale,
  cliFound = true,
  onOpenAccount,
}: ManagedSetupPanelProps) {
  const tr = useMemo(() => createT(locale), [locale]);

  const [local, setLocal] = useState<ManagedLocalStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [summary, setSummary] = useState<ManagedSetupSummary | null>(null);
  const [previewMeta, setPreviewMeta] = useState<ManagedPreviewMeta | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [previewDone, setPreviewDone] = useState(false);
  const [installDone, setInstallDone] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ManagedSetupErrorKind | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const refreshLocal = useCallback(async () => {
    if (!api.isTauri()) {
      setLocal(
        emptyManagedLocalStatus({
          ok: false,
          cliFound: false,
          reason: "need-tauri",
        }),
      );
      return;
    }
    setLoadingStatus(true);
    try {
      const res = await api.managedSetupStatus();
      setLocal(mapApiStatus(res));
    } catch (e) {
      // Soft-fail: keep panel usable without status.
      setLocal(
        emptyManagedLocalStatus({
          ok: false,
          cliFound,
          reason: String(e),
        }),
      );
    } finally {
      setLoadingStatus(false);
    }
  }, [cliFound]);

  useEffect(() => {
    void refreshLocal();
  }, [refreshLocal]);

  const effectiveCliFound = local?.cliFound ?? cliFound;

  const signatureView: ManagedSignatureView = useMemo(
    () =>
      buildSignatureView({
        local,
        previewMeta,
        errorKind,
        installOk: installDone,
      }),
    [local, previewMeta, errorKind, installDone],
  );

  const signatureStatus = signatureView.status;

  const recoveryId = useMemo(
    () =>
      signatureRecoveryId({
        status: signatureStatus,
        local,
        errorKind,
      }),
    [signatureStatus, local, errorKind],
  );

  const steps = useMemo(
    () =>
      buildManagedSetupSteps({
        cliFound: effectiveCliFound,
        previewDone,
        installDone,
        errorKind,
        local,
        signatureStatus,
      }),
    [effectiveCliFound, previewDone, installDone, errorKind, local, signatureStatus],
  );

  const applyError = useCallback(
    (msg: string, kind?: ManagedSetupErrorKind | null) => {
      const text = (msg ?? "").trim() || tr("managedSetup.error.generic");
      setError(text);
      setErrorKind(kind ?? classifySetupError(text));
      setStatus(null);
    },
    [tr],
  );

  const onPreview = useCallback(async () => {
    if (!api.isTauri()) {
      applyError(tr("managedSetup.needTauri"), "other");
      return;
    }
    setLoadingPreview(true);
    setError(null);
    setErrorKind(null);
    setStatus(null);
    setPreviewNote(null);
    try {
      const res = await api.setupPreview();
      if (!res.ok) {
        setSummary(null);
        setPreviewMeta(null);
        setPreviewDone(false);
        applyError(
          res.error?.trim() || tr("managedSetup.error.generic"),
          (res.errorKind ?? classifySetupError(res.error)) as ManagedSetupErrorKind,
        );
        return;
      }
      if (res.payload != null) {
        setSummary(summarizeSetupJson(res.payload));
        setPreviewMeta(extractPreviewMeta(res.payload));
        setPreviewNote(null);
      } else if (res.message?.trim()) {
        setSummary(summarizeSetupJson(res.message));
        setPreviewMeta(extractPreviewMeta(res.message));
        setPreviewNote(res.message.trim());
      } else {
        setSummary(null);
        setPreviewMeta(null);
        setPreviewNote(null);
      }
      setPreviewDone(true);
      setStatus(tr("managedSetup.previewOk"));
    } catch (e) {
      setSummary(null);
      setPreviewMeta(null);
      setPreviewDone(false);
      applyError(String(e));
    } finally {
      setLoadingPreview(false);
    }
  }, [applyError, tr]);

  const runInstall = useCallback(async () => {
    if (!api.isTauri()) {
      applyError(tr("managedSetup.needTauri"), "other");
      setConfirmOpen(false);
      return;
    }
    setInstalling(true);
    setError(null);
    setErrorKind(null);
    setStatus(null);
    try {
      const res = await api.setupInstall();
      if (!res.ok) {
        setInstallDone(false);
        applyError(
          res.error?.trim() || tr("managedSetup.error.generic"),
          (res.errorKind ?? classifySetupError(res.error)) as ManagedSetupErrorKind,
        );
        return;
      }
      setInstallDone(true);
      setStatus(res.message?.trim() || tr("managedSetup.installOk"));
      void refreshLocal();
    } catch (e) {
      setInstallDone(false);
      applyError(String(e));
    } finally {
      setInstalling(false);
      setConfirmOpen(false);
    }
  }, [applyError, refreshLocal, tr]);

  const busy = loadingPreview || installing || loadingStatus;
  const cliMissing =
    !effectiveCliFound ||
    errorKind === "cli_missing" ||
    isCliMissingError(error);

  const kindHint =
    errorKind === "missing_auth"
      ? tr("managedSetup.error.missingAuth")
      : errorKind === "rejected"
        ? tr("managedSetup.error.rejected")
        : errorKind === "signature_rejected"
          ? tr("managedSetup.error.signatureRejected")
          : errorKind === "cli_missing"
            ? tr("managedSetup.error.cliBody")
            : null;

  const hasLocalArtifacts =
    signatureView.hasArtifacts || signatureView.hasSigFiles;

  return (
    <div className="managed-setup" data-testid="managed-setup-panel">
      <div className="settings-row settings-row--stack" style={{ borderBottom: "none" }}>
        <div className="settings-row__text">
          <div className="settings-row__label">{tr("managedSetup.title")}</div>
          <div className="settings-row__desc">{tr("managedSetup.desc")}</div>
        </div>
        <div className="settings-row__hint">{tr("managedSetup.authHint")}</div>

        {/* Guided steps */}
        <ol className="managed-setup__steps" data-testid="managed-setup-steps">
          {steps.map((s, i) => (
            <li
              key={s.id}
              className={
                "managed-setup__step" +
                (s.state === "done" ? " is-done" : "") +
                (s.state === "current" ? " is-current" : "") +
                (s.state === "blocked" ? " is-blocked" : "") +
                (s.state === "soft" ? " is-soft" : "")
              }
              data-step={s.id}
              data-state={s.state}
            >
              <span className="managed-setup__step-idx" aria-hidden>
                {i + 1}
              </span>
              <span className="managed-setup__step-label">
                {tr(stepLabelKey(s.id))}
              </span>
              <span className="managed-setup__step-state">
                {tr(stepStateKey(s.state))}
              </span>
            </li>
          ))}
        </ol>
        <p className="settings-row__hint managed-setup__steps-hint">
          {tr("managedSetup.stepsHint")}
        </p>

        {/* Signature / local status card */}
        <div
          className="managed-setup__status"
          data-testid="managed-setup-status"
          data-sig={signatureStatus}
          role="status"
        >
          <div className="managed-setup__status-row">
            <span className="settings-row__label">
              {tr("managedSetup.sig.cardTitle")}
            </span>
            <div className="managed-setup__status-actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={busy}
                onClick={() => setDetailOpen(true)}
                title={tr("managedSetup.sig.detail")}
                aria-label={tr("managedSetup.sig.detail")}
              >
                {tr("managedSetup.sig.detail")}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={busy}
                onClick={() => void refreshLocal()}
                title={tr("managedSetup.refreshStatus")}
                aria-label={tr("managedSetup.refreshStatus")}
              >
                <IconRefresh size={14} />
                <span>
                  {loadingStatus
                    ? tr("managedSetup.refreshing")
                    : tr("managedSetup.refreshStatus")}
                </span>
              </button>
            </div>
          </div>

          <div className="managed-setup__chips">
            <span
              className={chipClassForStatus(signatureStatus)}
              data-sig={signatureStatus}
              data-testid="managed-setup-sig-chip"
            >
              {tr(signatureLabelKey(signatureStatus))}
            </span>
            {signatureView.presenceOnly && (
              <span
                className="ext-badge ext-badge--muted"
                data-testid="managed-setup-presence-only"
              >
                {tr("managedSetup.sig.presenceOnly")}
              </span>
            )}
            {signatureView.verifySource && (
              <span className="ext-badge ext-badge--muted">
                {tr("managedSetup.sig.verifySource", {
                  source: signatureView.verifySource,
                })}
              </span>
            )}
            {local?.managedSettingsActive === true && (
              <span className="ext-badge">
                {tr("managedSetup.chip.managedActive")}
              </span>
            )}
            {local?.managedConfigPresent && (
              <span className="ext-badge ext-badge--muted">
                {tr("managedSetup.chip.configToml")}
              </span>
            )}
            {local?.configSignaturePresent && (
              <span className="ext-badge ext-badge--muted">
                {tr("managedSetup.chip.configSig")}
              </span>
            )}
            {local?.identitySignaturePresent && (
              <span className="ext-badge ext-badge--muted">
                {tr("managedSetup.chip.identitySig")}
              </span>
            )}
            {local?.requirementsPresent && (
              <span className="ext-badge ext-badge--muted">
                {tr("managedSetup.chip.requirements")}
              </span>
            )}
            {local?.systemManagedConfigPresent && (
              <span className="ext-badge ext-badge--muted">
                {tr("managedSetup.chip.systemConfig")}
              </span>
            )}
          </div>

          <p className="settings-row__hint managed-setup__recovery" data-testid="managed-setup-recovery">
            {tr(recoveryKey(recoveryId))}
          </p>
          <p className="settings-row__hint">{tr("managedSetup.sigHint")}</p>
          {local?.grokHome && (
            <p className="settings-row__hint managed-setup__path">
              {tr("managedSetup.grokHome", { path: local.grokHome })}
            </p>
          )}
          {local?.managedSettingsPath && (
            <p className="settings-row__hint managed-setup__path">
              {tr("managedSetup.managedSettingsPath", {
                path: local.managedSettingsPath,
              })}
            </p>
          )}
          {local?.reason && !hasLocalArtifacts && (
            <p className="settings-row__hint">{local.reason}</p>
          )}
        </div>

        <div className="settings-row__actions">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => void onPreview()}
          >
            {loadingPreview
              ? tr("managedSetup.previewing")
              : tr("managedSetup.preview")}
          </button>
          <button
            type="button"
            className="btn btn--solid"
            disabled={busy || cliMissing}
            onClick={() => setConfirmOpen(true)}
          >
            {installing
              ? tr("managedSetup.installing")
              : tr("managedSetup.install")}
          </button>
          {onOpenAccount && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={onOpenAccount}
            >
              {tr("managedSetup.openAccount")}
            </button>
          )}
        </div>
      </div>

      {status && !error && (
        <p className="settings-row__hint" role="status">
          {status}
        </p>
      )}

      {cliMissing && (
        <div className="ext-alert ext-alert--error" role="alert">
          <div className="ext-alert__title">{tr("managedSetup.error.cliTitle")}</div>
          <p className="ext-alert__body">{tr("managedSetup.error.cliBody")}</p>
        </div>
      )}

      {!cliMissing && error && (
        <div className="ext-alert ext-alert--error" role="alert">
          <div className="ext-alert__title">
            {errorKind === "missing_auth"
              ? tr("managedSetup.error.missingAuthTitle")
              : errorKind === "rejected"
                ? tr("managedSetup.error.rejectedTitle")
                : errorKind === "signature_rejected"
                  ? tr("managedSetup.error.signatureRejectedTitle")
                  : tr("managedSetup.error.title")}
          </div>
          {kindHint && <p className="ext-alert__body">{kindHint}</p>}
          <pre className="ext-alert__detail" style={{ whiteSpace: "pre-wrap" }}>
            {error}
          </pre>
          {(errorKind === "missing_auth" || errorKind === "rejected") &&
            onOpenAccount && (
              <button
                type="button"
                className="btn btn--ghost ext-alert__cta"
                onClick={onOpenAccount}
              >
                {tr("managedSetup.openAccount")}
              </button>
            )}
        </div>
      )}

      {summary && (
        <div className="managed-setup__preview" data-testid="managed-setup-preview">
          <div className="settings-row__label" style={{ marginBottom: 6 }}>
            {tr("managedSetup.previewTitle")}
          </div>
          {previewMeta && (previewMeta.deploymentId || previewMeta.teamId) && (
            <ul className="managed-setup__facts">
              {previewMeta.deploymentId && (
                <li>
                  <span className="managed-setup__fact-key">deploymentId</span>
                  <span className="managed-setup__fact-val">
                    {previewMeta.deploymentId}
                  </span>
                </li>
              )}
              {previewMeta.teamId && (
                <li>
                  <span className="managed-setup__fact-key">teamId</span>
                  <span className="managed-setup__fact-val">
                    {previewMeta.teamId}
                  </span>
                </li>
              )}
              {previewMeta.failClosed != null && (
                <li>
                  <span className="managed-setup__fact-key">failClosed</span>
                  <span className="managed-setup__fact-val">
                    {previewMeta.failClosed ? "true" : "false"}
                  </span>
                </li>
              )}
              {previewMeta.hasSignatureBlock && (
                <li>
                  <span className="managed-setup__fact-key">signatures</span>
                  <span className="managed-setup__fact-val">
                    {tr("managedSetup.preview.sigBlock")}
                  </span>
                </li>
              )}
            </ul>
          )}
          {summary.facts.length > 0 && (
            <ul className="managed-setup__facts">
              {summary.facts.map((f) => (
                <li key={f.key}>
                  <span className="managed-setup__fact-key">{f.key}</span>
                  <span className="managed-setup__fact-val">{f.value}</span>
                </li>
              ))}
            </ul>
          )}
          {summary.sectionCounts.length > 0 && (
            <p className="settings-row__hint">
              {tr("managedSetup.sections", {
                list: summary.sectionCounts
                  .map((s) => `${s.key} (${s.count})`)
                  .join(" · "),
              })}
            </p>
          )}
          {previewNote && !summary.topLevelKeys.length && (
            <p className="settings-row__hint">{previewNote}</p>
          )}
          <pre
            className="ext-details-pre managed-setup__json"
            data-testid="managed-setup-json"
          >
            {summary.redactedJson}
          </pre>
          <p className="settings-row__hint">{tr("managedSetup.redactNote")}</p>
        </div>
      )}

      <GlassModal
        open={confirmOpen}
        onClose={() => {
          if (!installing) setConfirmOpen(false);
        }}
        title={tr("managedSetup.confirmTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={installing}
              onClick={() => setConfirmOpen(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={installing}
              onClick={() => void runInstall()}
            >
              {installing
                ? tr("managedSetup.installing")
                : tr("managedSetup.install")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">{tr("managedSetup.confirmBody")}</p>
      </GlassModal>

      <GlassModal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={tr("managedSetup.sig.detailTitle")}
        size="md"
        closeLabel={tr("common.close")}
        footer={
          <button
            type="button"
            className="btn btn--solid"
            onClick={() => setDetailOpen(false)}
          >
            {tr("common.close")}
          </button>
        }
      >
        <div className="managed-setup__detail" data-testid="managed-setup-sig-detail">
          <p className="app-dialog__msg">
            <span className={chipClassForStatus(signatureStatus)}>
              {tr(signatureLabelKey(signatureStatus))}
            </span>
          </p>
          <p className="settings-row__hint">{tr(recoveryKey(recoveryId))}</p>
          <p className="settings-row__hint">{tr("managedSetup.sigHint")}</p>
          {signatureView.presenceOnly && (
            <p className="settings-row__hint">
              {tr("managedSetup.sig.presenceOnlyDetail")}
            </p>
          )}
          {signatureView.verifySource && (
            <p className="settings-row__hint">
              {tr("managedSetup.sig.verifySource", {
                source: signatureView.verifySource,
              })}
            </p>
          )}
          <ul className="managed-setup__facts">
            {signatureView.facts.map((f) => {
              const label = factLabelKey(f.id);
              return (
                <li key={f.id}>
                  <span className="managed-setup__fact-key">
                    {label ? tr(label) : f.id}
                  </span>
                  <span className="managed-setup__fact-val">
                    {f.detail
                      ? f.detail
                      : f.present
                        ? tr("managedSetup.detail.present")
                        : tr("managedSetup.detail.absent")}
                  </span>
                </li>
              );
            })}
          </ul>
          {local?.grokHome && (
            <p className="settings-row__hint managed-setup__path">
              {tr("managedSetup.grokHome", { path: local.grokHome })}
            </p>
          )}
          {local?.managedSettingsPath && (
            <p className="settings-row__hint managed-setup__path">
              {tr("managedSetup.managedSettingsPath", {
                path: local.managedSettingsPath,
              })}
            </p>
          )}
          {local?.reason && (
            <p className="settings-row__hint">{local.reason}</p>
          )}
        </div>
      </GlassModal>
    </div>
  );
}
