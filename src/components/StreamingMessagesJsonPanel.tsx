/**
 * Settings → Runtime → Tools: streaming-messages-json diagnostics.
 * Offline NDJSON import + optional headless probe (CLI 0.2.117+).
 * Pure parse/reconstruct lives in `streamingMessagesJson.ts` — this panel only wires UI.
 */
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import * as api from "@/lib/api";
import { isDesktopHost } from "@/lib/api";
import { createT, type Locale, type MessageKey } from "@/i18n";
import {
  exportRawStreamNdjson,
  streamSessionExportFilename,
  streamSessionExportMimeType,
} from "@/lib/streamSessionExport";
import {
  STREAMING_MESSAGES_JSON_FORMAT,
  STREAMING_MESSAGES_JSON_MIN_CLI,
  exportSmjPreviewText,
  formatSmjDocumentStats,
  formatSmjMessageSummary,
  parseStreamingMessagesJson,
  redactStreamingMessagesJsonSource,
  type SmjDocument,
} from "@/lib/streamingMessagesJson";

function downloadText(filename: string, body: string, mime: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function StreamingMessagesJsonPanel({
  locale,
  cliVersion,
  onToast,
}: {
  locale: Locale;
  /** Optional probed CLI version for soft-gate copy. */
  cliVersion?: string | null;
  onToast?: (message: string, ms?: number) => void;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const t = useCallback(
    (k: MessageKey, vars?: Record<string, string | number>) => tr(k, vars),
    [tr],
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string>("");
  const [sourceLabel, setSourceLabel] = useState<string>("");
  const [doc, setDoc] = useState<SmjDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [includePartial, setIncludePartial] = useState(false);
  const [probeMeta, setProbeMeta] = useState<string>("");
  const [error, setError] = useState<string>("");

  const applySource = useCallback(
    (raw: string, label: string) => {
      const redacted = redactStreamingMessagesJsonSource(raw);
      setSource(redacted);
      setSourceLabel(label);
      const parsed = parseStreamingMessagesJson(redacted);
      setDoc(parsed);
      setError(parsed.parseErrors > 0 ? t("smj.parseWarnings", { n: parsed.parseErrors }) : "");
    },
    [t],
  );

  const onImportClick = () => fileRef.current?.click();

  const onFileChange = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      applySource(text, file.name);
    } catch {
      setError(t("smj.importFailed"));
    }
  };

  const onProbe = async () => {
    if (!isDesktopHost()) {
      setError(t("smj.probeDesktopOnly"));
      return;
    }
    setBusy(true);
    setError("");
    setProbeMeta("");
    try {
      const res = await api.streamingMessagesJsonProbe({
        includePartial,
      });
      if (!res.ok) {
        const key =
          res.reason === "cli_missing"
            ? "smj.probeCliMissing"
            : res.reason === "cli_too_old"
              ? "smj.probeCliTooOld"
              : res.reason === "empty"
                ? "smj.probeEmpty"
                : "smj.probeFailed";
        setError(
          t(key, {
            min: res.minVersion || STREAMING_MESSAGES_JSON_MIN_CLI,
            version: res.cliVersion || cliVersion || "?",
            reason: res.reason,
          }),
        );
        setProbeMeta(
          t("smj.probeMeta", {
            ms: res.durationMs,
            lines: res.lineCount,
            version: res.cliVersion || "?",
          }),
        );
        return;
      }
      const raw = res.rawNdjson ?? "";
      applySource(
        raw,
        res.outputPath
          ? t("smj.sourceProbeFile", { path: res.outputPath })
          : t("smj.sourceProbe"),
      );
      setProbeMeta(
        t("smj.probeMeta", {
          ms: res.durationMs,
          lines: res.lineCount,
          version: res.cliVersion || "?",
        }) + (res.truncated ? ` · ${t("smj.truncated")}` : ""),
      );
    } catch (e) {
      setError(t("smj.probeFailed", { reason: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const onClear = () => {
    setSource("");
    setSourceLabel("");
    setDoc(null);
    setError("");
    setProbeMeta("");
  };

  const onExportPreview = () => {
    if (!doc) return;
    const body = exportSmjPreviewText(doc);
    downloadText(
      "streaming-messages-preview.txt",
      body,
      "text/plain;charset=utf-8",
    );
  };

  const onExportNdjson = () => {
    const result = exportRawStreamNdjson(source, "streaming-messages-json");
    if (result.empty || !result.body) return;
    downloadText(
      streamSessionExportFilename(
        "streaming-messages-json",
        "smj-capture",
        null,
      ),
      result.body,
      streamSessionExportMimeType("streaming-messages-json"),
    );
  };

  const onCopyPreview = async () => {
    if (!doc) return;
    const ok = await copyText(exportSmjPreviewText(doc));
    if (!ok) onToast?.(t("smj.copyFailed"), 1800);
  };

  const stats = doc ? formatSmjDocumentStats(doc) : null;

  return (
    <div className="smj-panel">
      <p className="settings-row__desc smj-panel__lead">{t("smj.lead")}</p>
      <p className="settings-row__hint smj-panel__flag" title={STREAMING_MESSAGES_JSON_FORMAT}>
        {t("smj.formatHint", {
          format: STREAMING_MESSAGES_JSON_FORMAT,
          min: STREAMING_MESSAGES_JSON_MIN_CLI,
        })}
      </p>

      <div className="smj-panel__toolbar">
        <input
          ref={fileRef}
          type="file"
          accept=".ndjson,.jsonl,.json,application/x-ndjson,application/jsonl,text/plain"
          className="sr-only"
          onChange={onFileChange}
          aria-hidden
          tabIndex={-1}
        />
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onImportClick}
          disabled={busy}
        >
          {t("smj.import")}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => void onProbe()}
          disabled={busy}
        >
          {busy ? t("smj.probing") : t("smj.probe")}
        </button>
        <label className="smj-panel__check">
          <input
            type="checkbox"
            checked={includePartial}
            disabled={busy}
            onChange={(e) => setIncludePartial(e.target.checked)}
          />
          <span>{t("smj.includePartial")}</span>
        </label>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onClear}
          disabled={busy || (!source && !doc)}
        >
          {t("smj.clear")}
        </button>
      </div>

      {probeMeta ? (
        <div className="settings-row__hint" role="status">
          {probeMeta}
        </div>
      ) : null}
      {error ? (
        <div className="smj-panel__error" role="alert">
          {error}
        </div>
      ) : null}

      {sourceLabel ? (
        <div className="settings-row__hint smj-panel__source">{sourceLabel}</div>
      ) : null}

      {stats && doc ? (
        <>
          <div className="smj-panel__stats" aria-live="polite">
            <span className="ext-badge">
              {t("smj.statLines", { n: stats.lines })}
            </span>
            <span className="ext-badge">
              {t("smj.statMessages", { n: stats.messages })}
            </span>
            <span className="ext-badge">
              {t("smj.statTools", { n: stats.tools })}
            </span>
            {stats.streamEvents > 0 ? (
              <span className="ext-badge ext-badge--muted">
                {t("smj.statStreamEvents", { n: stats.streamEvents })}
              </span>
            ) : null}
            {stats.stopReason ? (
              <span className="ext-badge ext-badge--muted">
                {t("smj.statStop", { reason: stats.stopReason })}
              </span>
            ) : null}
            {stats.usageLabel ? (
              <span className="ext-badge ext-badge--muted">
                {t("smj.statUsage", { usage: stats.usageLabel })}
              </span>
            ) : null}
            {doc.model ? (
              <span className="ext-badge ext-badge--muted">{doc.model}</span>
            ) : null}
          </div>

          <div className="smj-panel__toolbar smj-panel__toolbar--secondary">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => void onCopyPreview()}
            >
              {t("smj.copyPreview")}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onExportPreview}
            >
              {t("smj.exportPreview")}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onExportNdjson}
              disabled={!source}
            >
              {t("smj.exportNdjson")}
            </button>
          </div>

          {doc.messages.length === 0 ? (
            <div className="smj-panel__empty" role="status">
              {t("smj.emptyMessages")}
            </div>
          ) : (
            <ul className="smj-panel__list" aria-label={t("smj.messagesAria")}>
              {doc.messages.map((m, i) => (
                <li key={`${m.sourceLineIndex}-${i}`} className="smj-panel__item">
                  <div className="smj-panel__item-head">
                    <span className="smj-panel__role">{m.role}</span>
                    {m.stopReason ? (
                      <span className="settings-row__hint">
                        stop={m.stopReason}
                      </span>
                    ) : null}
                    <span className="settings-row__hint">
                      L{m.sourceLineIndex}
                    </span>
                  </div>
                  <div className="smj-panel__item-sum">
                    {formatSmjMessageSummary(m)}
                  </div>
                  {m.toolUses.length > 0 ? (
                    <div className="smj-panel__tools">
                      {m.toolUses.map((tu) => (
                        <code key={tu.id || tu.name} className="smj-panel__code">
                          {tu.name || "tool"}
                          {tu.id ? ` · ${tu.id.slice(0, 12)}` : ""}
                        </code>
                      ))}
                    </div>
                  ) : null}
                  {m.text ? (
                    <pre className="smj-panel__body">{m.text}</pre>
                  ) : null}
                  {!m.text && m.thinking ? (
                    <pre className="smj-panel__body smj-panel__body--muted">
                      {m.thinking}
                    </pre>
                  ) : null}
                  {m.usage ? (
                    <div className="settings-row__hint">
                      {t("smj.msgUsage", {
                        in: m.usage.inputTokens ?? "—",
                        out: m.usage.outputTokens ?? "—",
                      })}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {doc.result?.resultText ? (
            <div className="smj-panel__result">
              <div className="settings-row__label">{t("smj.resultLabel")}</div>
              <pre className="smj-panel__body">{doc.result.resultText}</pre>
            </div>
          ) : null}
        </>
      ) : (
        <div className="smj-panel__empty" role="status">
          {t("smj.empty")}
        </div>
      )}
    </div>
  );
}
