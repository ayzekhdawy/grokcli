/**
 * Diagnostics: import/paste ACP-shaped NDJSON (`--output-format streaming-json`,
 * CLI 0.2.117+) or run a short headless probe; list event types/counts; copy summary.
 *
 * Distinct from `streaming-messages-json`.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { createT, type Locale } from "@/i18n";
import * as api from "@/lib/api";
import {
  exportRawStreamNdjson,
  streamSessionExportFilename,
  streamSessionExportMimeType,
} from "@/lib/streamSessionExport";
import {
  formatAcpNdjsonSummaryText,
  STREAMING_ACP_NDJSON_MIN_CLI,
  STREAMING_ACP_NDJSON_OUTPUT_FORMAT,
  STREAMING_MESSAGES_JSON_OUTPUT_FORMAT,
  summarizeAcpNdjsonText,
  type AcpNdjsonSummary,
} from "@/lib/streamingAcpNdjson";

function downloadText(filename: string, body: string, mime: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type StreamingAcpNdjsonPanelProps = {
  locale: Locale;
  /** Optional manual CLI path from Settings. */
  manualCliPath?: string;
  /** Optional project cwd for the headless probe. */
  projectPath?: string | null;
  /** Toast helper from Settings. */
  showToast?: (msg: string, ms?: number) => void;
};

export function StreamingAcpNdjsonPanel({
  locale,
  manualCliPath,
  projectPath,
  showToast,
}: StreamingAcpNdjsonPanelProps) {
  const t = useMemo(() => createT(locale), [locale]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState("");
  const [summary, setSummary] = useState<AcpNdjsonSummary | null>(null);
  const [probeMeta, setProbeMeta] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyText = useCallback((raw: string) => {
    setText(raw);
    setError(null);
    setProbeMeta(null);
    if (!raw.trim()) {
      setSummary(null);
      return;
    }
    setSummary(summarizeAcpNdjsonText(raw));
  }, []);

  const onParse = useCallback(() => {
    if (!text.trim()) {
      setSummary(null);
      setError(t("streamAcpNdjson.emptyPaste"));
      return;
    }
    setError(null);
    setSummary(summarizeAcpNdjsonText(text));
  }, [text]);

  const onClear = useCallback(() => {
    setText("");
    setSummary(null);
    setProbeMeta(null);
    setError(null);
  }, []);

  const onCopy = useCallback(async () => {
    if (!summary) return;
    const body = formatAcpNdjsonSummaryText(summary);
    try {
      await navigator.clipboard.writeText(body);
    } catch {
      setError(t("streamAcpNdjson.copyFailed"));
    }
  }, [summary]);

  /** Redacted NDJSON save (never writes secrets unredacted). */
  const onSaveNdjson = useCallback(() => {
    const result = exportRawStreamNdjson(text, "streaming-json");
    if (result.empty || !result.body) {
      setError(t("streamAcpNdjson.emptyPaste"));
      return;
    }
    downloadText(
      streamSessionExportFilename("streaming-json", "acp-capture", null),
      result.body,
      streamSessionExportMimeType("streaming-json"),
    );
  }, [text]);

  /** Redacted NDJSON copy. */
  const onCopyNdjson = useCallback(async () => {
    const result = exportRawStreamNdjson(text, "streaming-json");
    if (result.empty || !result.body) {
      setError(t("streamAcpNdjson.emptyPaste"));
      return;
    }
    try {
      await navigator.clipboard.writeText(result.body);
    } catch {
      setError(t("streamAcpNdjson.copyFailed"));
    }
  }, [text]);

  const onImportFile = useCallback(
    (file: File | null) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const raw = typeof reader.result === "string" ? reader.result : "";
        applyText(raw);
      };
      reader.onerror = () => setError(t("streamAcpNdjson.importFailed"));
      reader.readAsText(file);
    },
    [applyText],
  );

  const onProbe = useCallback(async () => {
    if (!api.isDesktopHost()) {
      setError(t("streamAcpNdjson.desktopOnly"));
      return;
    }
    setBusy(true);
    setError(null);
    setProbeMeta(null);
    try {
      const res = await api.probeStreamingAcpNdjson({
        manualPath: manualCliPath || undefined,
        cwd: projectPath || undefined,
      });
      const support =
        res.supported === true
          ? t("streamAcpNdjson.supportedYes")
          : res.supported === false
            ? t("streamAcpNdjson.supportedNo")
            : t("streamAcpNdjson.supportedUnknown");
      setProbeMeta(
        t("streamAcpNdjson.probeMeta", {
          version: res.version || "—",
          support,
          ms: res.durationMs,
          exit: res.exitCode ?? "—",
        }),
      );
      if (res.error && !res.stdout.trim()) {
        setError(res.error);
        setSummary(null);
        return;
      }
      if (res.stdout.trim()) {
        applyText(res.stdout);
      } else if (res.timedOut) {
        setError(t("streamAcpNdjson.probeTimeout"));
      } else {
        setError(res.error || t("streamAcpNdjson.probeEmpty"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [applyText, manualCliPath, projectPath, showToast, t]);

  const typeRows = summary?.typeCounts.filter((r) => r.kind !== "empty") ?? [];

  return (
    <div className="stream-acp-ndjson">
      <p className="settings-row__desc stream-acp-ndjson__lead">
        {t("streamAcpNdjson.lead", {
          format: STREAMING_ACP_NDJSON_OUTPUT_FORMAT,
          min: STREAMING_ACP_NDJSON_MIN_CLI,
          other: STREAMING_MESSAGES_JSON_OUTPUT_FORMAT,
        })}
      </p>

      <div className="stream-acp-ndjson__toolbar">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {t("streamAcpNdjson.import")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.ndjson,.jsonl,.txt,application/json,text/plain"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            onImportFile(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onParse}
          disabled={busy || !text.trim()}
        >
          {t("streamAcpNdjson.parse")}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => void onProbe()}
          disabled={busy}
        >
          {busy ? t("streamAcpNdjson.probing") : t("streamAcpNdjson.probe")}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => void onCopy()}
          disabled={!summary}
        >
          {t("streamAcpNdjson.copySummary")}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onSaveNdjson}
          disabled={busy || !text.trim()}
        >
          {t("streamAcpNdjson.saveNdjson")}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => void onCopyNdjson()}
          disabled={busy || !text.trim()}
        >
          {t("streamAcpNdjson.copyNdjson")}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onClear}
          disabled={busy && !text}
        >
          {t("streamAcpNdjson.clear")}
        </button>
      </div>

      <label className="stream-acp-ndjson__label" htmlFor="stream-acp-ndjson-paste">
        {t("streamAcpNdjson.pasteLabel")}
      </label>
      <textarea
        id="stream-acp-ndjson-paste"
        className="settings-input stream-acp-ndjson__textarea"
        rows={8}
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("streamAcpNdjson.pastePlaceholder")}
        disabled={busy}
      />

      {probeMeta ? (
        <p className="settings-row__hint stream-acp-ndjson__meta">{probeMeta}</p>
      ) : null}
      {error ? (
        <p className="settings-row__hint stream-acp-ndjson__error" role="alert">
          {error}
        </p>
      ) : null}

      {summary ? (
        <div className="stream-acp-ndjson__summary">
          <div className="stream-acp-ndjson__stats">
            <span>
              {t("streamAcpNdjson.statLines", {
                total: summary.totalLines,
                nonEmpty: summary.nonEmptyLines,
              })}
            </span>
            <span>
              {t("streamAcpNdjson.statAcp", {
                acp: summary.acpShapedCount,
                non: summary.nonAcpCount,
                bad: summary.invalidCount,
              })}
            </span>
            {summary.sessionIds.length > 0 ? (
              <span>
                {t("streamAcpNdjson.statSessions", {
                  ids: summary.sessionIds.join(", "),
                })}
              </span>
            ) : null}
          </div>
          {typeRows.length === 0 ? (
            <p className="settings-row__desc">{t("streamAcpNdjson.noEvents")}</p>
          ) : (
            <table className="stream-acp-ndjson__table">
              <thead>
                <tr>
                  <th scope="col">{t("streamAcpNdjson.colType")}</th>
                  <th scope="col">{t("streamAcpNdjson.colCount")}</th>
                </tr>
              </thead>
              <tbody>
                {typeRows.map((row) => (
                  <tr key={row.kind}>
                    <td>
                      <code>{row.kind}</code>
                    </td>
                    <td>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {summary.assistantText ? (
            <p className="settings-row__hint stream-acp-ndjson__preview">
              {t("streamAcpNdjson.assistantPreview", {
                text: summary.assistantText.slice(0, 200),
              })}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="settings-row__desc stream-acp-ndjson__empty">
          {t("streamAcpNdjson.emptyHint")}
        </p>
      )}

      <p className="settings-row__hint stream-acp-ndjson__footnote">
        {t("streamAcpNdjson.softGateNote", {
          min: STREAMING_ACP_NDJSON_MIN_CLI,
        })}
      </p>
    </div>
  );
}
