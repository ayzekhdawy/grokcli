/**
 * Settings → Agent: safe viewer for agent config.toml (redacted secrets).
 * View-first — open folder / reveal / copy path / open in editor; no freeform write.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/api";
import type { AgentConfigTomlReadResult } from "@/lib/api";
import { createT, type Locale, type MessageKey } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import {
  extractTomlSections,
  redactConfigToml,
  sectionAnchorId,
  type TomlSection,
} from "@/lib/configTomlView";
import {
  IconCopy,
  IconExternalLink,
  IconFolder,
  IconRefresh,
} from "@/components/icons";

export function AgentConfigTomlPanel({ locale }: { locale: Locale }) {
  const tr = useMemo(() => createT(locale), [locale]);
  const t = useCallback(
    (k: MessageKey, vars?: Record<string, string | number>) => tr(k, vars),
    [tr],
  );

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AgentConfigTomlReadResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const lineRefs = useRef<Map<number, HTMLSpanElement>>(new Map());

  const load = useCallback(async () => {
    if (!api.isTauri()) {
      setResult(null);
      setError(t("settings.configTomlView.needTauri"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.agentConfigTomlRead();
      // Defensive second pass (host already redacts).
      const text = redactConfigToml(res.text ?? "");
      setResult({
        ...res,
        text,
        sections: res.sections?.length
          ? res.sections
          : extractTomlSections(text).map((s) => s.name),
      });
    } catch (e) {
      setResult(null);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const sections: TomlSection[] = useMemo(() => {
    if (!result?.text) return [];
    return extractTomlSections(result.text);
  }, [result?.text]);

  const jumpTo = (sec: TomlSection) => {
    setActiveSection(sec.name);
    const el = lineRefs.current.get(sec.line);
    if (el) {
      el.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    // Fallback: approximate scroll by line height inside pre.
    const pre = preRef.current;
    if (!pre) return;
    const lineHeight = 18;
    pre.scrollTop = Math.max(0, sec.line * lineHeight - 24);
  };

  const copyPath = async () => {
    const path = result?.path;
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      setError(String(e));
    }
  };

  const reveal = async () => {
    const path = result?.path;
    if (!path || !api.isTauri()) return;
    try {
      await api.pathReveal(path);
    } catch (e) {
      setError(String(e));
    }
  };

  const openInEditor = async () => {
    const path = result?.path;
    if (!path || !api.isTauri() || !result?.exists) return;
    try {
      await api.pathOpen(path);
    } catch (e) {
      setError(String(e));
    }
  };

  const lines = useMemo(
    () => (result?.text != null ? result.text.split("\n") : []),
    [result?.text],
  );

  const modeKey: MessageKey =
    result?.mode === "shared"
      ? "settings.configTomlView.mode.shared"
      : "settings.configTomlView.mode.independent";

  return (
    <div
      className={"settings-row settings-row--stack" + " settings-config-toml"}
      id="settings-anchor-configTomlView"
    >
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.configTomlView")}</div>
        <div className="settings-row__desc">{t("settings.configTomlViewDesc")}</div>
      </div>
      <div className="settings-row__actions">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setOpen(true)}
        >
          {t("settings.configTomlView.open")}
        </button>
      </div>

      <GlassModal
        open={open}
        onClose={() => setOpen(false)}
        title={t("settings.configTomlView.title")}
        size="lg"
        className="config-toml-modal"
        wrapBody
        bodyClassName="config-toml-modal__body"
        closeLabel={t("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={loading}
              onClick={() => void load()}
            >
              <IconRefresh size={14} />
              <span>{t("settings.configTomlView.refresh")}</span>
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setOpen(false)}>
              {t("common.close")}
            </button>
          </>
        }
      >
        {loading && !result ? (
          <p className="ext-field-hint">{t("settings.configTomlView.loading")}</p>
        ) : null}

        {error ? (
          <div className="ext-alert ext-alert--error" role="alert">
            <div className="ext-alert__title">{t("settings.configTomlView.error")}</div>
            <p className="ext-alert__body">{error}</p>
          </div>
        ) : null}

        {result ? (
          <>
            <div className="config-toml-modal__meta">
              <div className="config-toml-modal__path" title={result.path}>
                <span className="config-toml-modal__path-label">
                  {t("settings.configTomlView.path")}
                </span>
                <code className="config-toml-modal__path-value">{result.path}</code>
              </div>
              <div className="config-toml-modal__badges">
                <span className="ext-badge ext-badge--muted">{t(modeKey)}</span>
                {!result.exists ? (
                  <span className="ext-badge">{t("settings.configTomlView.missing")}</span>
                ) : null}
                {result.truncated ? (
                  <span className="ext-badge">{t("settings.configTomlView.truncated")}</span>
                ) : null}
              </div>
            </div>

            {result.mode === "shared" ? (
              <div className="ext-alert ext-alert--warn" role="status">
                <p className="ext-alert__body" style={{ margin: 0 }}>
                  {t("settings.configTomlView.sharedWarning")}
                </p>
              </div>
            ) : null}

            <p className="ext-field-hint config-toml-modal__redact-note">
              {t("settings.configTomlView.redactNote")}
            </p>

            <div className="config-toml-modal__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!result.path}
                onClick={() => void copyPath()}
              >
                <IconCopy size={13} />
                <span>
                  {copied
                    ? t("settings.configTomlView.pathCopied")
                    : t("settings.configTomlView.copyPath")}
                </span>
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!result.path || !api.isTauri()}
                onClick={() => void reveal()}
              >
                <IconFolder size={13} />
                <span>{t("settings.configTomlView.reveal")}</span>
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!result.exists || !api.isTauri()}
                onClick={() => void openInEditor()}
              >
                <IconExternalLink size={13} />
                <span>{t("settings.configTomlView.openEditor")}</span>
              </button>
            </div>

            {sections.length > 0 ? (
              <div className="config-toml-modal__sections" aria-label={t("settings.configTomlView.sections")}>
                <span className="config-toml-modal__sections-label">
                  {t("settings.configTomlView.sections")}
                </span>
                <div className="config-toml-modal__section-chips">
                  {sections.map((sec) => (
                    <button
                      key={`${sec.line}-${sec.name}`}
                      type="button"
                      className={
                        "config-toml-modal__chip" +
                        (activeSection === sec.name ? " is-active" : "")
                      }
                      onClick={() => jumpTo(sec)}
                      title={sec.name}
                    >
                      {sec.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {!result.exists ? (
              <p className="ext-field-hint">{t("settings.configTomlView.empty")}</p>
            ) : (
              <pre
                ref={preRef}
                className="config-toml-modal__pre"
                tabIndex={0}
                aria-label={t("settings.configTomlView.title")}
              >
                {lines.map((line, i) => {
                  const isHeader =
                    line.trim().startsWith("[") &&
                    line.trim().endsWith("]") &&
                    line.trim().length >= 3;
                  return (
                    <span
                      key={i}
                      ref={(el) => {
                        if (el) lineRefs.current.set(i, el);
                        else lineRefs.current.delete(i);
                      }}
                      id={
                        isHeader
                          ? sectionAnchorId(line.trim(), i)
                          : undefined
                      }
                      className={
                        "config-toml-modal__line" +
                        (isHeader ? " config-toml-modal__line--header" : "")
                      }
                    >
                      {line || " "}
                      {"\n"}
                    </span>
                  );
                })}
              </pre>
            )}
          </>
        ) : null}
      </GlassModal>
    </div>
  );
}
