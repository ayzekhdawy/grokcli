/**
 * Settings → Permissions: edit compact [permission] allow / deny / ask rules
 * in the active GROK_HOME config.toml.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Select } from "@/components/Select";
import { GlassModal } from "@/components/GlassModal";
import { IconPlus, IconShield, IconTrash } from "@/components/icons";
import * as api from "@/lib/api";
import {
  addRule,
  normalizeRules,
  PERMISSION_RULE_ACTIONS,
  removeRule,
  rulePlaceholder,
  ruleRowKey,
  simulatePermissionDecision,
  type PermissionRuleAction,
  type PermissionRulesLike,
} from "@/lib/permissionRules";
import {
  countRulesByAction,
  flattenFilteredRules,
  formatSimulationResult,
  resolvePermissionRulesEmptyState,
  suggestSampleToolCalls,
} from "@/lib/permissionRulesPro";
import type { MessageKey } from "@/i18n";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

export type PermissionRulesPanelProps = {
  t: TFn;
  /** Fired after a successful write (toast, etc.). */
  onSaved?: () => void;
  onError?: (message: string) => void;
};

const emptyRules = (): PermissionRulesLike => ({
  allow: [],
  deny: [],
  ask: [],
});

const SAMPLE_TOOL_CALLS = suggestSampleToolCalls();

export function PermissionRulesPanel({
  t,
  onSaved,
  onError,
}: PermissionRulesPanelProps) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState<PermissionRulesLike>(emptyRules);
  const [configPath, setConfigPath] = useState("");
  const [addAction, setAddAction] = useState<PermissionRuleAction>("allow");
  const [addText, setAddText] = useState("");
  /** Local list filter only — never written to config. */
  const [filter, setFilter] = useState("");
  /** Local try-call input only — never written to config. */
  const [simText, setSimText] = useState("");
  const [copyFlash, setCopyFlash] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{
    action: PermissionRuleAction;
    rule: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const dto = await api.permissionRulesGet();
      setRules(
        normalizeRules({
          allow: dto.allow,
          deny: dto.deny,
          ask: dto.ask,
        }),
      );
      setConfigPath(dto.configPath || "");
    } catch (e) {
      onError?.(
        e instanceof Error ? e.message : t("settings.permissionRulesError"),
      );
    } finally {
      setLoading(false);
    }
  }, [onError, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => countRulesByAction(rules), [rules]);

  const flat = useMemo(
    () => flattenFilteredRules(rules, filter),
    [rules, filter],
  );

  const emptyState = useMemo(
    () =>
      resolvePermissionRulesEmptyState({
        allow: rules.allow,
        deny: rules.deny,
        ask: rules.ask,
        filter,
      }),
    [rules, filter],
  );

  const simResult = useMemo(
    () => simulatePermissionDecision(rules, simText),
    [rules, simText],
  );

  const simPresentation = useMemo(
    () => formatSimulationResult(simResult, simText),
    [simResult, simText],
  );

  const actionLabel = (action: PermissionRuleAction) =>
    t(
      (
        {
          allow: "settings.permissionRulesAction.allow",
          deny: "settings.permissionRulesAction.deny",
          ask: "settings.permissionRulesAction.ask",
        } as const
      )[action],
    );

  const simDecisionLabel = () =>
    t(simPresentation.labelKey as MessageKey);

  const persist = async (next: PermissionRulesLike) => {
    setBusy(true);
    try {
      const dto = await api.permissionRulesSet(next);
      setRules(
        normalizeRules({
          allow: dto.allow,
          deny: dto.deny,
          ask: dto.ask,
        }),
      );
      setConfigPath(dto.configPath || configPath);
      onSaved?.();
    } catch (e) {
      onError?.(
        e instanceof Error ? e.message : t("settings.permissionRulesError"),
      );
      // Reload from disk so UI matches failed write.
      await load();
    } finally {
      setBusy(false);
    }
  };

  const onAdd = async () => {
    const next = addRule(rules, addAction, addText);
    if (!next) return;
    setAddText("");
    await persist(next);
  };

  const confirmRemove = async () => {
    const target = removeTarget;
    if (!target) return;
    setRemoveTarget(null);
    const next = removeRule(rules, target.action, target.rule);
    if (!next) return;
    await persist(next);
  };

  const onCopyMatchSummary = async () => {
    const text = simPresentation.matchSummary;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyFlash(true);
      window.setTimeout(() => setCopyFlash(false), 1600);
    } catch {
      onError?.(t("settings.permissionRulesSimCopyFailed"));
    }
  };

  /* Flat section inside parent settings-card — no nested card chrome. */
  return (
    <div className="perm-rules">
      <div className="settings-row settings-row--stack perm-rules__head">
        <div className="settings-row__text">
          <div className="settings-row__label">
            <IconShield size={16} />
            {t("settings.permissionRules")}
          </div>
          <div className="settings-row__desc">
            {t("settings.permissionRulesDesc")}
          </div>
          {configPath ? (
            <div className="settings-row__hint perm-rules__path" title={configPath}>
              {t("settings.permissionRulesPath", { path: configPath })}
            </div>
          ) : null}
        </div>
      </div>

      {loading ? (
        <p className="perm-rules__empty">{t("settings.permissionRulesLoading")}</p>
      ) : (
        <>
          {counts.total > 0 ? (
            <div
              className="perm-rules__counts"
              aria-label={t("settings.permissionRulesCountsAria", {
                deny: counts.deny,
                ask: counts.ask,
                allow: counts.allow,
              })}
            >
              <span className="perm-rules__count-chip perm-rules__badge perm-rules__badge--deny">
                {actionLabel("deny")}{" "}
                <span className="perm-rules__count-n">{counts.deny}</span>
              </span>
              <span className="perm-rules__count-chip perm-rules__badge perm-rules__badge--ask">
                {actionLabel("ask")}{" "}
                <span className="perm-rules__count-n">{counts.ask}</span>
              </span>
              <span className="perm-rules__count-chip perm-rules__badge perm-rules__badge--allow">
                {actionLabel("allow")}{" "}
                <span className="perm-rules__count-n">{counts.allow}</span>
              </span>
            </div>
          ) : null}

          {counts.total > 0 ? (
            <div className="perm-rules__filter-row">
              <input
                className="perm-rules__input perm-rules__filter"
                type="search"
                value={filter}
                placeholder={t("settings.permissionRulesFilterPlaceholder")}
                onChange={(e) => setFilter(e.target.value)}
                aria-label={t("settings.permissionRulesFilterPlaceholder")}
              />
              {filter.trim() ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setFilter("")}
                >
                  {t("settings.permissionRulesFilterClear")}
                </button>
              ) : null}
            </div>
          ) : null}

          {emptyState ? (
            <div className="perm-rules__empty-block">
              <p className="perm-rules__empty">{t(emptyState.titleKey as MessageKey)}</p>
              {emptyState.hintKey ? (
                <p className="perm-rules__empty-hint">
                  {t(emptyState.hintKey as MessageKey)}
                </p>
              ) : null}
              {emptyState.showClearFilter ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setFilter("")}
                >
                  {t("settings.permissionRulesFilterClear")}
                </button>
              ) : null}
            </div>
          ) : (
            <ul className="perm-rules__list" role="list">
              {flat.map(({ action, rule }) => (
                <li
                  key={ruleRowKey(action, rule)}
                  className="perm-rules__item"
                >
                  <span
                    className={`perm-rules__badge perm-rules__badge--${action}`}
                  >
                    {actionLabel(action)}
                  </span>
                  <code className="perm-rules__rule" title={rule}>
                    {rule}
                  </code>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm perm-rules__remove"
                    disabled={busy}
                    onClick={() => setRemoveTarget({ action, rule })}
                    aria-label={t("settings.permissionRulesRemove")}
                  >
                    <IconTrash size={14} />
                    <span>{t("settings.permissionRulesRemove")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="perm-rules__add">
            <Select
              value={addAction}
              onChange={(v) =>
                setAddAction((normalizeActionSafe(v) ?? "allow") as PermissionRuleAction)
              }
              options={PERMISSION_RULE_ACTIONS.map((a) => ({
                value: a,
                label: actionLabel(a),
              }))}
            />
            <input
              className="perm-rules__input"
              type="text"
              value={addText}
              disabled={busy}
              placeholder={
                t("settings.permissionRulesPlaceholder") ||
                rulePlaceholder(addAction)
              }
              onChange={(e) => setAddText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onAdd();
                }
              }}
              aria-label={t("settings.permissionRulesPlaceholder")}
            />
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy || !addText.trim()}
              onClick={() => void onAdd()}
            >
              <IconPlus size={14} />
              <span>
                {busy
                  ? t("settings.permissionRulesAddWorking")
                  : t("settings.permissionRulesAdd")}
              </span>
            </button>
          </div>

          <div className="perm-rules__sim">
            <div className="perm-rules__sim-head">
              <div className="perm-rules__sim-label">
                {t("settings.permissionRulesSim")}
              </div>
              <div className="perm-rules__sim-desc">
                {t("settings.permissionRulesSimDesc")}
              </div>
            </div>

            <div
              className="perm-rules__samples"
              role="group"
              aria-label={t("settings.permissionRulesSimSamples")}
            >
              {SAMPLE_TOOL_CALLS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={
                    "perm-rules__sample-chip" +
                    (simText.trim() === s.toolCall ? " is-active" : "")
                  }
                  title={s.toolCall}
                  onClick={() => setSimText(s.toolCall)}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="perm-rules__sim-row">
              <input
                className="perm-rules__input"
                type="text"
                value={simText}
                placeholder={t("settings.permissionRulesSimPlaceholder")}
                onChange={(e) => setSimText(e.target.value)}
                aria-label={t("settings.permissionRulesSimPlaceholder")}
              />
              {simPresentation.hasInput ? (
                <span
                  className={`perm-rules__badge perm-rules__badge--${simPresentation.decision === "none" ? "none" : simPresentation.decision} perm-rules__badge--sev-${simPresentation.severity}`}
                  title={
                    simPresentation.matchedRule
                      ? t("settings.permissionRulesSimMatched", {
                          rule: simPresentation.matchedRule,
                        })
                      : undefined
                  }
                >
                  {simDecisionLabel()}
                </span>
              ) : null}
              {simPresentation.hasInput ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void onCopyMatchSummary()}
                  aria-label={t("settings.permissionRulesSimCopy")}
                >
                  {copyFlash
                    ? t("settings.permissionRulesSimCopied")
                    : t("settings.permissionRulesSimCopy")}
                </button>
              ) : null}
            </div>
            {simPresentation.hasInput && simPresentation.honestyKey ? (
              <div className="perm-rules__sim-honesty">
                {t(simPresentation.honestyKey as MessageKey)}
              </div>
            ) : null}
            {simPresentation.hasInput && simPresentation.matchedRule ? (
              <div className="perm-rules__sim-match">
                {t("settings.permissionRulesSimMatched", {
                  rule: simPresentation.matchedRule,
                })}
              </div>
            ) : null}
          </div>
        </>
      )}

      <GlassModal
        open={!!removeTarget}
        onClose={() => {
          if (!busy) setRemoveTarget(null);
        }}
        title={t("settings.permissionRulesRemoveTitle")}
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => setRemoveTarget(null)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={busy}
              onClick={() => void confirmRemove()}
            >
              {t("settings.permissionRulesRemove")}
            </button>
          </>
        }
      >
        <p className="perm-rules__confirm">
          {t("settings.permissionRulesRemoveConfirm", {
            action: removeTarget
              ? actionLabel(removeTarget.action)
              : "",
            rule: removeTarget?.rule ?? "",
          })}
        </p>
      </GlassModal>
    </div>
  );
}

function normalizeActionSafe(v: string): PermissionRuleAction | null {
  const t = v.trim().toLowerCase();
  if (t === "allow" || t === "deny" || t === "ask") return t;
  return null;
}
