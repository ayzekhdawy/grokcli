/**
 * Batch agents pro — templates, result-row honesty, export matrix.
 *
 * Pure helpers only. UI resolves i18n keys for template title/body;
 * English catalog bodies are the source of truth for default wording.
 */

import {
  formatBatchSummaryText,
  summarizeBatchResults,
  truncateBatchText,
  type BatchDispatchItemResult,
  type BatchDispatchMode,
  type BatchDispatchSummary,
  type BatchItemStatus,
} from "./batchAgents";

// ── Templates ──────────────────────────────────────────────────────────

/** Built-in template ids (stable machine codes). */
export type BatchTemplateId = "code_review" | "fix_tests" | "summarize";

/**
 * Prompt template: ids + i18n keys only (no hardcoded Chinese).
 * UI looks up `titleKey` / `bodyKey` via `createT(locale)`.
 */
export type BatchPromptTemplate = {
  id: BatchTemplateId;
  /** Message key for chip title, e.g. `batchAgents.tpl.codeReview.title`. */
  titleKey: string;
  /** Message key for body (may include `{project}` placeholder). */
  bodyKey: string;
};

/**
 * Three short honest defaults: code review, fix tests, summarize.
 * Titles/bodies live in i18n catalogs under `batchAgents.tpl.*`.
 */
export const DEFAULT_BATCH_TEMPLATES: readonly BatchPromptTemplate[] = [
  {
    id: "code_review",
    titleKey: "batchAgents.tpl.codeReview.title",
    bodyKey: "batchAgents.tpl.codeReview.body",
  },
  {
    id: "fix_tests",
    titleKey: "batchAgents.tpl.fixTests.title",
    bodyKey: "batchAgents.tpl.fixTests.body",
  },
  {
    id: "summarize",
    titleKey: "batchAgents.tpl.summarize.title",
    bodyKey: "batchAgents.tpl.summarize.body",
  },
] as const;

export function isBatchTemplateId(
  v: string | null | undefined,
): v is BatchTemplateId {
  return v === "code_review" || v === "fix_tests" || v === "summarize";
}

/** Look up a default template by id; unknown → null. */
export function getBatchTemplate(
  id: string | null | undefined,
): BatchPromptTemplate | null {
  if (!isBatchTemplateId(id)) return null;
  return DEFAULT_BATCH_TEMPLATES.find((t) => t.id === id) ?? null;
}

/**
 * Apply optional `{project}` substitution in a template body.
 * - When `projectName` is non-empty: replace every `{project}` with the name.
 * - When empty/omitted: leave `{project}` untouched (honest shared prompt).
 * Trims the body; empty body → "".
 */
export function applyBatchTemplate(
  templateBody: string | null | undefined,
  projectName?: string | null,
): string {
  const body = String(templateBody ?? "").trim();
  if (!body) return "";
  const name = String(projectName ?? "").trim();
  if (!name) return body;
  return body.replaceAll("{project}", name);
}

// ── Result row honesty ─────────────────────────────────────────────────

/**
 * Row honesty kinds for the results matrix.
 * Distinguishes empty detail vs partial output from raw status alone.
 */
export type BatchResultRowKind =
  | "ok"
  | "ok_empty"
  | "partial"
  | "soft_fail"
  | "error"
  | "skipped"
  | "queued"
  | "pending";

export type BatchResultRowClass = {
  kind: BatchResultRowKind;
  status: BatchItemStatus;
  /** True when summary/reason gives the user something to read. */
  hasDetail: boolean;
  /** True when status is terminal (not pending/queued). */
  terminal: boolean;
  /** Short machine-ish note for export (English; UI may re-label). */
  note: string | null;
};

function hasNonEmptyText(v: string | null | undefined): boolean {
  return String(v ?? "").trim().length > 0;
}

/**
 * Classify one result row for matrix honesty.
 * - `ok` with no summary → `ok_empty` (success claimed, no detail)
 * - `soft_fail` / `error` with truncated/short summary → still soft_fail/error;
 *   `partial` when status is ok-ish host soft path with incomplete text flag via reason
 * - empty/missing item → pending-like empty honesty
 */
export function classifyBatchResultRow(
  item: BatchDispatchItemResult | null | undefined,
): BatchResultRowClass {
  if (!item) {
    return {
      kind: "pending",
      status: "pending",
      hasDetail: false,
      terminal: false,
      note: "empty_row",
    };
  }
  const status = item.status;
  const hasSummary = hasNonEmptyText(item.summary);
  const hasReason = hasNonEmptyText(item.reason);
  const hasDetail = hasSummary || hasReason;

  switch (status) {
    case "ok": {
      if (!hasSummary) {
        return {
          kind: "ok_empty",
          status,
          hasDetail: hasReason,
          terminal: true,
          note: hasReason ? String(item.reason).trim() : "no_detail",
        };
      }
      return {
        kind: "ok",
        status,
        hasDetail: true,
        terminal: true,
        note: null,
      };
    }
    case "soft_fail": {
      // Only mark partial when the host/reason explicitly says so —
      // short summaries alone (e.g. "timed out") are still soft_fail.
      const reason = String(item.reason ?? "");
      const summary = String(item.summary ?? "");
      const partial = /partial|incomplete|truncated/i.test(
        `${reason} ${summary}`,
      );
      return {
        kind: partial ? "partial" : "soft_fail",
        status,
        hasDetail,
        terminal: true,
        note: hasReason
          ? reason.trim()
          : hasSummary
            ? null
            : "soft_fail_empty",
      };
    }
    case "error":
      return {
        kind: "error",
        status,
        hasDetail,
        terminal: true,
        note: hasReason
          ? String(item.reason).trim()
          : hasSummary
            ? null
            : "error_empty",
      };
    case "skipped":
      return {
        kind: "skipped",
        status,
        hasDetail: hasReason,
        terminal: true,
        note: hasReason ? String(item.reason).trim() : "skipped",
      };
    case "queued":
      return {
        kind: "queued",
        status,
        hasDetail: false,
        terminal: false,
        note: "queued",
      };
    default:
      return {
        kind: "pending",
        status: "pending",
        hasDetail: false,
        terminal: false,
        note: "pending",
      };
  }
}

// ── Export matrix ──────────────────────────────────────────────────────

export type BatchExportLabels = {
  modeSessions?: string;
  modeHeadless?: string;
  statusOk?: string;
  statusOkEmpty?: string;
  statusPartial?: string;
  statusSoftFail?: string;
  statusError?: string;
  statusSkipped?: string;
  statusQueued?: string;
  statusPending?: string;
  emptyExport?: string;
  matrixHeader?: string;
  colProject?: string;
  colStatus?: string;
  colReason?: string;
  colDetail?: string;
};

export type BatchExportPlan =
  | {
      ok: true;
      text: string;
      filename: string;
      rowCount: number;
      /** Counts derived from items (honest; includes empty-detail oks). */
      okCount: number;
      softFail: number;
      error: number;
      skipped: number;
      emptyDetail: number;
    }
  | {
      ok: false;
      reason: "empty";
      text: string;
      filename: null;
      rowCount: 0;
    };

function defaultFilename(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `batch-agents-${y}${m}${d}-${hh}${mm}.txt`;
}

function asSummary(
  results:
    | BatchDispatchSummary
    | readonly BatchDispatchItemResult[]
    | null
    | undefined,
  fallback?: { mode?: BatchDispatchMode; prompt?: string },
): BatchDispatchSummary | null {
  if (results == null) return null;
  if (Array.isArray(results)) {
    if (results.length === 0) return null;
    return summarizeBatchResults({
      mode: fallback?.mode ?? "sessions",
      prompt: fallback?.prompt ?? "",
      items: results as BatchDispatchItemResult[],
    });
  }
  const sum = results as BatchDispatchSummary;
  if (!sum.items || sum.items.length === 0) return null;
  return sum;
}

/**
 * Plain-text results matrix for copy/download.
 * Marks ok-without-detail and partial rows honestly; never invents outcomes.
 */
export function exportBatchResultsSummary(
  results:
    | BatchDispatchSummary
    | readonly BatchDispatchItemResult[]
    | null
    | undefined,
  labels?: BatchExportLabels,
  opts?: { mode?: BatchDispatchMode; prompt?: string },
): string {
  const summary = asSummary(results, opts);
  if (!summary) {
    return labels?.emptyExport ?? "No batch results to export.";
  }

  const statusWord = (kind: BatchResultRowKind): string => {
    switch (kind) {
      case "ok":
        return labels?.statusOk ?? "ok";
      case "ok_empty":
        return labels?.statusOkEmpty ?? labels?.statusOk ?? "ok (no detail)";
      case "partial":
        return labels?.statusPartial ?? "partial";
      case "soft_fail":
        return labels?.statusSoftFail ?? "soft-fail";
      case "error":
        return labels?.statusError ?? "error";
      case "skipped":
        return labels?.statusSkipped ?? "skipped";
      case "queued":
        return labels?.statusQueued ?? "queued";
      default:
        return labels?.statusPending ?? "pending";
    }
  };

  // Reuse count header from base formatter, then append a clearer matrix.
  const base = formatBatchSummaryText(summary, {
    modeSessions: labels?.modeSessions,
    modeHeadless: labels?.modeHeadless,
    statusOk: labels?.statusOk,
    statusSoftFail: labels?.statusSoftFail,
    statusError: labels?.statusError,
    statusSkipped: labels?.statusSkipped,
    statusQueued: labels?.statusQueued,
    statusPending: labels?.statusPending,
  });

  let emptyDetail = 0;
  const colProject = labels?.colProject ?? "Project";
  const colStatus = labels?.colStatus ?? "Status";
  const colReason = labels?.colReason ?? "Reason";
  const colDetail = labels?.colDetail ?? "Detail";
  const matrixTitle = labels?.matrixHeader ?? "Results matrix";

  const matrixLines: string[] = [
    "",
    matrixTitle,
    `${colProject}\t${colStatus}\t${colReason}\t${colDetail}`,
  ];

  for (const it of summary.items) {
    const row = classifyBatchResultRow(it);
    if (row.kind === "ok_empty") emptyDetail += 1;
    const name = it.projectName || it.projectId || "—";
    const reason = (it.reason || row.note || "").trim() || "—";
    const detail = truncateBatchText(it.summary, 160) || "—";
    matrixLines.push(
      `${name}\t${statusWord(row.kind)}\t${reason}\t${detail}`,
    );
  }

  if (emptyDetail > 0) {
    matrixLines.push("");
    matrixLines.push(
      `note: ${emptyDetail} row(s) marked ok without detail (empty summary)`,
    );
  }

  return `${base}\n${matrixLines.join("\n")}`;
}

/**
 * Plan a copy/download export. Soft-fails when there are no rows
 * (never claims success with invented content).
 */
export function planBatchExport(
  results:
    | BatchDispatchSummary
    | readonly BatchDispatchItemResult[]
    | null
    | undefined,
  labels?: BatchExportLabels,
  opts?: {
    mode?: BatchDispatchMode;
    prompt?: string;
    now?: Date;
    filename?: string;
  },
): BatchExportPlan {
  const summary = asSummary(results, opts);
  const emptyText = labels?.emptyExport ?? "No batch results to export.";
  if (!summary) {
    return {
      ok: false,
      reason: "empty",
      text: emptyText,
      filename: null,
      rowCount: 0,
    };
  }

  let emptyDetail = 0;
  for (const it of summary.items) {
    if (classifyBatchResultRow(it).kind === "ok_empty") emptyDetail += 1;
  }

  const text = exportBatchResultsSummary(summary, labels, opts);
  return {
    ok: true,
    text,
    filename: opts?.filename ?? defaultFilename(opts?.now),
    rowCount: summary.items.length,
    okCount: summary.ok,
    softFail: summary.softFail,
    error: summary.error,
    skipped: summary.skipped,
    emptyDetail,
  };
}

// ── Eligibility matrix (selection clarity) ─────────────────────────────

export type BatchEligibilityCounts = {
  selected: number;
  eligible: number;
  skipped: number;
  /** Skip reasons → count (stable order not required). */
  byReason: Record<string, number>;
};

/**
 * Summarize plan selection for the eligibility strip
 * (ready vs skipped, with reason tallies).
 */
export function summarizeBatchEligibility(opts: {
  selectedCount: number;
  eligibleCount: number;
  skipped: readonly { reason: string }[];
}): BatchEligibilityCounts {
  const byReason: Record<string, number> = {};
  for (const s of opts.skipped) {
    const r = String(s.reason || "skipped").trim() || "skipped";
    byReason[r] = (byReason[r] ?? 0) + 1;
  }
  return {
    selected: Math.max(0, opts.selectedCount | 0),
    eligible: Math.max(0, opts.eligibleCount | 0),
    skipped: opts.skipped.length,
    byReason,
  };
}
