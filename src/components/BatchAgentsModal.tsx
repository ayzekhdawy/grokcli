/**
 * Multi-project batch agent dispatch.
 * Select projects + shared prompt → open/queue sessions or headless soft-fail summary.
 * Templates + results matrix export (copy / download .txt).
 */

import { useEffect, useMemo, useState } from "react";
import type { Locale, MessageKey } from "@/i18n";
import { createT } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import {
  BATCH_AGENTS_MAX_PROJECTS,
  buildBatchDispatchPlan,
  canDispatchBatch,
  filterBatchProjects,
  pruneBatchProjectSelection,
  toggleBatchProjectSelection,
  type BatchDispatchItemResult,
  type BatchDispatchMode,
  type BatchDispatchSummary,
  type BatchProjectInput,
} from "@/lib/batchAgents";
import {
  applyBatchTemplate,
  classifyBatchResultRow,
  DEFAULT_BATCH_TEMPLATES,
  planBatchExport,
  summarizeBatchEligibility,
  type BatchExportLabels,
  type BatchTemplateId,
} from "@/lib/batchAgentsPro";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

export type BatchAgentsModalProps = {
  open: boolean;
  locale: Locale;
  projects: readonly BatchProjectInput[];
  onClose: () => void;
  /**
   * Parent runs the real I/O (sessions create/send or headless host).
   * Must update progress via onProgress and return the final summary.
   */
  onDispatch: (opts: {
    mode: BatchDispatchMode;
    prompt: string;
    projects: BatchProjectInput[];
    onProgress: (items: BatchDispatchItemResult[]) => void;
  }) => Promise<BatchDispatchSummary>;
};

function statusLabel(status: BatchDispatchItemResult["status"], t: TFn): string {
  switch (status) {
    case "ok":
      return t("batchAgents.status.ok");
    case "soft_fail":
      return t("batchAgents.status.softFail");
    case "error":
      return t("batchAgents.status.error");
    case "skipped":
      return t("batchAgents.status.skipped");
    case "queued":
      return t("batchAgents.status.queued");
    default:
      return t("batchAgents.status.pending");
  }
}

/** Prefer honesty kinds (ok_empty / partial) over raw status when present. */
function resultStatusLabel(
  item: BatchDispatchItemResult,
  t: TFn,
): string {
  const row = classifyBatchResultRow(item);
  switch (row.kind) {
    case "ok_empty":
      return t("batchAgents.status.okEmpty");
    case "partial":
      return t("batchAgents.status.partial");
    default:
      return statusLabel(item.status, t);
  }
}

function statusClass(status: BatchDispatchItemResult["status"]): string {
  switch (status) {
    case "ok":
      return "batch-agents__status--ok";
    case "soft_fail":
      return "batch-agents__status--soft";
    case "error":
      return "batch-agents__status--error";
    case "skipped":
      return "batch-agents__status--skipped";
    case "queued":
      return "batch-agents__status--queued";
    default:
      return "batch-agents__status--pending";
  }
}

function statusClassForItem(item: BatchDispatchItemResult): string {
  const row = classifyBatchResultRow(item);
  if (row.kind === "ok_empty") return "batch-agents__status--ok-empty";
  if (row.kind === "partial") return "batch-agents__status--partial";
  return statusClass(item.status);
}

function downloadText(filename: string, body: string) {
  const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function BatchAgentsModal({
  open,
  locale,
  projects,
  onClose,
  onDispatch,
}: BatchAgentsModalProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<BatchDispatchMode>("sessions");
  const [running, setRunning] = useState(false);
  const [resultItems, setResultItems] = useState<BatchDispatchItemResult[] | null>(
    null,
  );
  const [summary, setSummary] = useState<BatchDispatchSummary | null>(null);
  const [copyDone, setCopyDone] = useState(false);
  const [downloadDone, setDownloadDone] = useState(false);
  const [activeTemplateId, setActiveTemplateId] = useState<BatchTemplateId | null>(
    null,
  );
  const [exportNote, setExportNote] = useState<string | null>(null);

  const liveIds = useMemo(
    () => new Set(projects.filter((p) => !p.system).map((p) => p.id)),
    [projects],
  );

  useEffect(() => {
    setSelectedIds((prev) => pruneBatchProjectSelection(prev, liveIds));
  }, [liveIds]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelectedIds(new Set());
      setPrompt("");
      setMode("sessions");
      setRunning(false);
      setResultItems(null);
      setSummary(null);
      setCopyDone(false);
      setDownloadDone(false);
      setActiveTemplateId(null);
      setExportNote(null);
    }
  }, [open]);

  const filtered = useMemo(
    () => filterBatchProjects(projects, query),
    [projects, query],
  );

  const plan = useMemo(
    () =>
      buildBatchDispatchPlan({
        mode,
        prompt,
        projects,
        selectedIds,
      }),
    [mode, prompt, projects, selectedIds],
  );

  const eligibility = useMemo(
    () =>
      summarizeBatchEligibility({
        selectedCount: plan.selected.length,
        eligibleCount: plan.eligible.length,
        skipped: plan.skipped.map((s) => ({ reason: s.reason })),
      }),
    [plan],
  );

  const canGo = canDispatchBatch({
    prompt,
    eligibleCount: plan.eligible.length,
    running,
  });

  const filteredIds = useMemo(
    () => new Set(filtered.map((p) => p.id)),
    [filtered],
  );

  const visibleSelectedCount = useMemo(() => {
    let n = 0;
    for (const id of selectedIds) {
      if (filteredIds.has(id)) n += 1;
    }
    return n;
  }, [selectedIds, filteredIds]);

  const allVisibleSelected =
    filtered.length > 0 && visibleSelectedCount === filtered.length;

  const exportLabels = useMemo((): BatchExportLabels => {
    return {
      modeSessions: tr("batchAgents.mode.sessions"),
      modeHeadless: tr("batchAgents.mode.headless"),
      statusOk: tr("batchAgents.status.ok"),
      statusOkEmpty: tr("batchAgents.status.okEmpty"),
      statusPartial: tr("batchAgents.status.partial"),
      statusSoftFail: tr("batchAgents.status.softFail"),
      statusError: tr("batchAgents.status.error"),
      statusSkipped: tr("batchAgents.status.skipped"),
      statusQueued: tr("batchAgents.status.queued"),
      statusPending: tr("batchAgents.status.pending"),
      emptyExport: tr("batchAgents.exportEmpty"),
    };
  }, [tr]);

  const toggleRow = (id: string) => {
    if (running) return;
    setSelectedIds((prev) => toggleBatchProjectSelection(prev, id));
    setResultItems(null);
    setSummary(null);
    setExportNote(null);
  };

  const toggleSelectAllVisible = () => {
    if (running) return;
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const id of filteredIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of filteredIds) next.add(id);
      return next;
    });
    setResultItems(null);
    setSummary(null);
    setExportNote(null);
  };

  const applyTemplate = (id: BatchTemplateId) => {
    if (running) return;
    const tpl = DEFAULT_BATCH_TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    const body = tr(tpl.bodyKey as MessageKey);
    setPrompt(applyBatchTemplate(body));
    setActiveTemplateId(id);
    setResultItems(null);
    setSummary(null);
    setExportNote(null);
  };

  const handleDispatch = async () => {
    if (!canGo || running) return;
    setRunning(true);
    setResultItems(null);
    setSummary(null);
    setCopyDone(false);
    setDownloadDone(false);
    setExportNote(null);
    try {
      const sum = await onDispatch({
        mode: plan.mode,
        prompt: plan.prompt,
        projects: plan.eligible,
        onProgress: (items) => setResultItems(items),
      });
      setSummary(sum);
      setResultItems(sum.items);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSummary({
        mode: plan.mode,
        promptPreview: plan.prompt.slice(0, 80),
        total: 0,
        ok: 0,
        softFail: 0,
        error: 1,
        skipped: 0,
        queued: 0,
        items: [
          {
            projectId: "_",
            projectName: tr("batchAgents.dispatchFailed"),
            projectPath: "",
            status: "error",
            reason: "error",
            summary: msg,
          },
        ],
      });
      setResultItems([
        {
          projectId: "_",
          projectName: tr("batchAgents.dispatchFailed"),
          projectPath: "",
          status: "error",
          reason: "error",
          summary: msg,
        },
      ]);
    } finally {
      setRunning(false);
    }
  };

  const handleCopySummary = async () => {
    const planEx = planBatchExport(summary, exportLabels);
    if (!planEx.ok) {
      setExportNote(tr("batchAgents.exportEmpty"));
      return;
    }
    try {
      await navigator.clipboard.writeText(planEx.text);
      setCopyDone(true);
      setExportNote(null);
      window.setTimeout(() => setCopyDone(false), 2000);
    } catch {
      setExportNote(tr("batchAgents.exportFailed"));
    }
  };

  const handleDownloadSummary = () => {
    const planEx = planBatchExport(summary, exportLabels);
    if (!planEx.ok) {
      setExportNote(tr("batchAgents.exportEmpty"));
      return;
    }
    try {
      downloadText(planEx.filename, planEx.text);
      setDownloadDone(true);
      setExportNote(null);
      window.setTimeout(() => setDownloadDone(false), 2000);
    } catch {
      setExportNote(tr("batchAgents.exportFailed"));
    }
  };

  return (
    <GlassModal
      open={open}
      onClose={() => {
        if (running) return;
        onClose();
      }}
      title={tr("batchAgents.title")}
      titleId="batch-agents-title"
      closeLabel={tr("common.close")}
      size="lg"
      className="batch-agents-modal"
      wrapBody
      bodyClassName="batch-agents-modal__body"
      footer={
        <div className="batch-agents-modal__footer">
          <div className="batch-agents-modal__footer-actions">
            {summary ? (
              <>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={handleCopySummary}
                  disabled={running}
                >
                  {copyDone
                    ? tr("batchAgents.copied")
                    : tr("batchAgents.copySummary")}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={handleDownloadSummary}
                  disabled={running}
                >
                  {downloadDone
                    ? tr("batchAgents.downloaded")
                    : tr("batchAgents.downloadSummary")}
                </button>
              </>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            disabled={running}
          >
            {tr("common.close")}
          </button>
          <button
            type="button"
            className="btn btn--solid"
            onClick={handleDispatch}
            disabled={!canGo}
          >
            {running
              ? tr("batchAgents.running")
              : tr("batchAgents.dispatch", {
                  n: plan.eligible.length || selectedIds.size,
                })}
          </button>
        </div>
      }
    >
      <p className="batch-agents__hint">{tr("batchAgents.hint")}</p>

      <div
        className="batch-agents__modes"
        role="tablist"
        aria-label={tr("batchAgents.modeLabel")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "sessions"}
          className={
            "batch-agents__mode" + (mode === "sessions" ? " is-active" : "")
          }
          onClick={() => {
            if (running) return;
            setMode("sessions");
            setResultItems(null);
            setSummary(null);
          }}
          disabled={running}
        >
          {tr("batchAgents.mode.sessions")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "headless"}
          className={
            "batch-agents__mode" + (mode === "headless" ? " is-active" : "")
          }
          onClick={() => {
            if (running) return;
            setMode("headless");
            setResultItems(null);
            setSummary(null);
          }}
          disabled={running}
        >
          {tr("batchAgents.mode.headless")}
        </button>
      </div>
      <p className="batch-agents__mode-hint">
        {mode === "headless"
          ? tr("batchAgents.mode.headlessHint")
          : tr("batchAgents.mode.sessionsHint")}
      </p>

      <div className="batch-agents__templates">
        <span className="batch-agents__templates-label" id="batch-agents-tpls">
          {tr("batchAgents.templatesLabel")}
        </span>
        <div
          className="batch-agents__chips"
          role="group"
          aria-labelledby="batch-agents-tpls"
        >
          {DEFAULT_BATCH_TEMPLATES.map((tpl) => {
            const active = activeTemplateId === tpl.id;
            return (
              <button
                key={tpl.id}
                type="button"
                className={
                  "batch-agents__chip" + (active ? " is-active" : "")
                }
                onClick={() => applyTemplate(tpl.id)}
                disabled={running}
              >
                {tr(tpl.titleKey as MessageKey)}
              </button>
            );
          })}
        </div>
      </div>

      <label className="batch-agents__label" htmlFor="batch-agents-prompt">
        {tr("batchAgents.promptLabel")}
      </label>
      <textarea
        id="batch-agents-prompt"
        className="settings-input batch-agents__prompt"
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
          setActiveTemplateId(null);
          setResultItems(null);
          setSummary(null);
        }}
        placeholder={tr("batchAgents.promptPlaceholder")}
        rows={4}
        disabled={running}
        spellCheck
      />

      <div className="batch-agents__toolbar">
        <input
          type="search"
          className="settings-input batch-agents__search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr("batchAgents.searchPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          aria-label={tr("batchAgents.searchPlaceholder")}
          disabled={running}
        />
        <span className="batch-agents__sel-count">
          {tr("batchAgents.selectedCount", {
            n: selectedIds.size,
            max: BATCH_AGENTS_MAX_PROJECTS,
          })}
        </span>
      </div>

      {plan.selected.length > 0 ? (
        <p
          className={
            "batch-agents__eligibility" +
            (eligibility.eligible === 0
              ? " batch-agents__eligibility--none"
              : "")
          }
        >
          {eligibility.eligible === 0
            ? tr("batchAgents.eligibilityNone")
            : tr("batchAgents.eligibilitySummary", {
                ready: eligibility.eligible,
                skip: eligibility.skipped,
                selected: eligibility.selected,
              })}
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <div className="batch-agents__empty">
          <p className="batch-agents__empty-title">
            {tr("batchAgents.emptyProjects")}
          </p>
          <p className="batch-agents__empty-hint">
            {tr("batchAgents.emptyProjectsHint")}
          </p>
        </div>
      ) : (
        <>
          <div className="batch-agents__select-bar">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={toggleSelectAllVisible}
              disabled={running}
            >
              {allVisibleSelected
                ? tr("batchAgents.deselectAll")
                : tr("batchAgents.selectAll")}
            </button>
          </div>
          <ul className="batch-agents__list" role="listbox" aria-multiselectable>
            {filtered.map((p) => {
              const selected = selectedIds.has(p.id);
              const elig = plan.selected.some((s) => s.id === p.id)
                ? plan.eligible.some((e) => e.id === p.id)
                : null;
              const skip = plan.skipped.find((s) => s.project.id === p.id);
              return (
                <li
                  key={p.id}
                  className={
                    "batch-agents__row" + (selected ? " is-selected" : "")
                  }
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className="batch-agents__row-btn"
                    onClick={() => toggleRow(p.id)}
                    disabled={running}
                  >
                    <span
                      className={
                        "batch-agents__check" + (selected ? " is-on" : "")
                      }
                      aria-hidden
                    >
                      {selected ? "✓" : ""}
                    </span>
                    <span className="batch-agents__row-body">
                      <span className="batch-agents__name">{p.name || p.id}</span>
                      <span className="batch-agents__path">{p.path}</span>
                      {selected && skip ? (
                        <span className="batch-agents__skip">
                          {tr(`batchAgents.skip.${skip.reason}` as MessageKey)}
                        </span>
                      ) : null}
                      {selected && elig === true ? (
                        <span className="batch-agents__ok-tag">
                          {tr("batchAgents.eligible")}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {plan.overLimit ? (
        <p className="batch-agents__warn">
          {tr("batchAgents.overLimit", { max: BATCH_AGENTS_MAX_PROJECTS })}
        </p>
      ) : null}

      {exportNote ? (
        <p className="batch-agents__export-note" role="status">
          {exportNote}
        </p>
      ) : null}

      {resultItems && resultItems.length > 0 ? (
        <div className="batch-agents__results">
          <h3 className="batch-agents__results-title">
            {tr("batchAgents.resultsTitle")}
            {summary ? (
              <span className="batch-agents__results-meta">
                {tr("batchAgents.resultsMeta", {
                  ok: summary.ok,
                  soft: summary.softFail,
                  err: summary.error,
                  skip: summary.skipped,
                })}
              </span>
            ) : null}
          </h3>
          <ul className="batch-agents__result-list">
            {resultItems.map((it) => (
              <li key={it.projectId} className="batch-agents__result-row">
                <span
                  className={`batch-agents__status ${statusClassForItem(it)}`}
                >
                  {resultStatusLabel(it, (k, v) => tr(k, v))}
                </span>
                <span className="batch-agents__result-name">
                  {it.projectName}
                </span>
                {it.reason ? (
                  <span className="batch-agents__result-reason">
                    {it.reason}
                  </span>
                ) : null}
                {it.summary ? (
                  <span className="batch-agents__result-summary" title={it.summary}>
                    {it.summary}
                  </span>
                ) : classifyBatchResultRow(it).kind === "ok_empty" ? (
                  <span className="batch-agents__result-summary batch-agents__result-summary--empty">
                    —
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </GlassModal>
  );
}
