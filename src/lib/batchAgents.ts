/**
 * Multi-project batch agent dispatch — pure helpers.
 *
 * Select N projects + one prompt → open/queue App sessions, or run headless
 * one-shots and aggregate a soft-fail summary. I/O lives in App / Host; this
 * module stays unit-testable.
 */

import { isProjectFolderMissing } from "./projectPath";
import { pruneSelectedIds, toggleIdInSet } from "./sessionSelect";

/** Soft cap so batch never saturates the process pool by design. */
export const BATCH_AGENTS_MAX_PROJECTS = 16;

/** Default per-project headless timeout (ms). Host may clamp further. */
export const BATCH_AGENTS_HEADLESS_TIMEOUT_MS = 120_000;

export type BatchDispatchMode = "sessions" | "headless";

export const BATCH_DISPATCH_MODES: readonly BatchDispatchMode[] = [
  "sessions",
  "headless",
] as const;

export function isBatchDispatchMode(
  v: string | null | undefined,
): v is BatchDispatchMode {
  return v === "sessions" || v === "headless";
}

export type BatchProjectInput = {
  id: string;
  name: string;
  path: string;
  /** Trusted projects only may receive agent work. Default true when omitted. */
  trusted?: boolean;
  /** Host path-ok flag; false → skip. Default true when omitted. */
  pathOk?: boolean | null;
  /** When set, `path` is a remote OpenSSH cwd — not a local missing-folder. */
  sshAlias?: string | null;
  /** System / general workspace — excluded from batch. */
  system?: boolean;
};

export type BatchSkipReason =
  | "empty_id"
  | "empty_path"
  | "untrusted"
  | "path_missing"
  | "system_project"
  | "over_limit";

export type BatchProjectEligibility =
  | { ok: true; projectId: string }
  | { ok: false; projectId: string; reason: BatchSkipReason };

export type BatchItemStatus =
  | "ok"
  | "soft_fail"
  | "error"
  | "skipped"
  | "queued"
  | "pending";

export type BatchDispatchItemResult = {
  projectId: string;
  projectName: string;
  projectPath: string;
  status: BatchItemStatus;
  /** Machine-ish reason code (skip / soft-fail / error). */
  reason?: string | null;
  /** App session id when sessions mode created one. */
  sessionId?: string | null;
  /** Short headless text / error detail for the summary row. */
  summary?: string | null;
  durationMs?: number | null;
};

export type BatchDispatchPlan = {
  mode: BatchDispatchMode;
  prompt: string;
  promptOk: boolean;
  selected: BatchProjectInput[];
  eligible: BatchProjectInput[];
  skipped: Array<{ project: BatchProjectInput; reason: BatchSkipReason }>;
  overLimit: boolean;
  canDispatch: boolean;
};

export type BatchDispatchSummary = {
  mode: BatchDispatchMode;
  promptPreview: string;
  total: number;
  ok: number;
  softFail: number;
  error: number;
  skipped: number;
  queued: number;
  items: BatchDispatchItemResult[];
};

/** Trim prompt; empty → "". */
export function normalizeBatchPrompt(
  prompt: string | null | undefined,
): string {
  return String(prompt ?? "").trim();
}

/** True when prompt is non-empty after trim. */
export function isBatchPromptReady(
  prompt: string | null | undefined,
): boolean {
  return normalizeBatchPrompt(prompt).length > 0;
}

/**
 * Eligibility gate for one project (no I/O).
 * System / general workspaces are never batch targets.
 */
export function evaluateBatchProject(
  project: BatchProjectInput | null | undefined,
): BatchProjectEligibility {
  if (!project) {
    return { ok: false, projectId: "", reason: "empty_id" };
  }
  const id = String(project.id ?? "").trim();
  if (!id) {
    return { ok: false, projectId: "", reason: "empty_id" };
  }
  if (project.system) {
    return { ok: false, projectId: id, reason: "system_project" };
  }
  const path = String(project.path ?? "").trim();
  if (!path) {
    return { ok: false, projectId: id, reason: "empty_path" };
  }
  if (project.trusted === false) {
    return { ok: false, projectId: id, reason: "untrusted" };
  }
  if (isProjectFolderMissing(project)) {
    return { ok: false, projectId: id, reason: "path_missing" };
  }
  return { ok: true, projectId: id };
}

/** Filter project list by name/path query (case-insensitive). */
export function filterBatchProjects(
  projects: readonly BatchProjectInput[],
  query: string | null | undefined,
): BatchProjectInput[] {
  const q = String(query ?? "")
    .trim()
    .toLowerCase();
  const list = projects.filter((p) => !p.system);
  if (!q) return [...list];
  return list.filter((p) => {
    const name = (p.name || "").toLowerCase();
    const path = (p.path || "").toLowerCase();
    return name.includes(q) || path.includes(q);
  });
}

/** Toggle project id in a selection set. */
export function toggleBatchProjectSelection(
  selected: ReadonlySet<string>,
  projectId: string,
): Set<string> {
  return toggleIdInSet(selected, projectId);
}

/** Drop selected ids that left the catalog. */
export function pruneBatchProjectSelection(
  selected: ReadonlySet<string>,
  liveIds: ReadonlySet<string>,
): Set<string> {
  return pruneSelectedIds(selected, liveIds);
}

/**
 * Build a dispatch plan from selection + prompt.
 * Eligible projects are capped at {@link BATCH_AGENTS_MAX_PROJECTS}
 * (stable order = `projects` / selected order).
 */
export function buildBatchDispatchPlan(opts: {
  mode: BatchDispatchMode;
  prompt: string | null | undefined;
  projects: readonly BatchProjectInput[];
  selectedIds: ReadonlySet<string>;
  maxProjects?: number;
}): BatchDispatchPlan {
  const max = Math.max(1, opts.maxProjects ?? BATCH_AGENTS_MAX_PROJECTS);
  const prompt = normalizeBatchPrompt(opts.prompt);
  const promptOk = prompt.length > 0;
  const byId = new Map(
    opts.projects.map((p) => [String(p.id ?? "").trim(), p] as const),
  );

  const selected: BatchProjectInput[] = [];
  for (const id of opts.selectedIds) {
    const p = byId.get(id);
    if (p) selected.push(p);
  }

  const eligible: BatchProjectInput[] = [];
  const skipped: Array<{
    project: BatchProjectInput;
    reason: BatchSkipReason;
  }> = [];

  for (const p of selected) {
    const ev = evaluateBatchProject(p);
    if (!ev.ok) {
      skipped.push({ project: p, reason: ev.reason });
      continue;
    }
    if (eligible.length >= max) {
      skipped.push({ project: p, reason: "over_limit" });
      continue;
    }
    eligible.push(p);
  }

  const overLimit = skipped.some((s) => s.reason === "over_limit");
  const canDispatch = promptOk && eligible.length > 0;

  return {
    mode: opts.mode,
    prompt,
    promptOk,
    selected,
    eligible,
    skipped,
    overLimit,
    canDispatch,
  };
}

/** One-line session title from prompt (truncated). */
export function buildBatchSessionTitle(
  prompt: string,
  opts?: { maxLen?: number; prefix?: string },
): string {
  const prefix = opts?.prefix ?? "Batch";
  const maxLen = opts?.maxLen ?? 48;
  const body = normalizeBatchPrompt(prompt).replace(/\s+/g, " ");
  if (!body) return prefix;
  const room = Math.max(8, maxLen - prefix.length - 2);
  const clip =
    body.length > room ? `${body.slice(0, Math.max(1, room - 1))}…` : body;
  return `${prefix}: ${clip}`;
}

/**
 * Optional header prefix for the agent prompt so sessions show batch origin.
 * Empty prompt → empty string.
 */
export function buildBatchPromptBody(
  prompt: string,
  opts?: { projectName?: string | null; header?: boolean },
): string {
  const body = normalizeBatchPrompt(prompt);
  if (!body) return "";
  if (opts?.header === false) return body;
  const name = (opts?.projectName || "").trim();
  const tag = name ? `[Batch · ${name}]\n\n` : "[Batch]\n\n";
  return tag + body;
}

/** Truncate for list previews / summary rows. */
export function truncateBatchText(
  text: string | null | undefined,
  maxLen = 120,
): string {
  const s = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(1, maxLen - 1))}…`;
}

/** Aggregate per-project results into counts + ordered items. */
export function summarizeBatchResults(opts: {
  mode: BatchDispatchMode;
  prompt: string;
  items: readonly BatchDispatchItemResult[];
}): BatchDispatchSummary {
  let ok = 0;
  let softFail = 0;
  let error = 0;
  let skipped = 0;
  let queued = 0;
  for (const it of opts.items) {
    switch (it.status) {
      case "ok":
        ok += 1;
        break;
      case "soft_fail":
        softFail += 1;
        break;
      case "error":
        error += 1;
        break;
      case "skipped":
        skipped += 1;
        break;
      case "queued":
        queued += 1;
        break;
      default:
        break;
    }
  }
  return {
    mode: opts.mode,
    promptPreview: truncateBatchText(opts.prompt, 80),
    total: opts.items.length,
    ok,
    softFail,
    error,
    skipped,
    queued,
    items: [...opts.items],
  };
}

/**
 * Plain-text summary for copy / toast detail.
 * Never embeds secrets beyond the user-supplied prompt preview.
 */
export function formatBatchSummaryText(
  summary: BatchDispatchSummary,
  labels?: {
    modeSessions?: string;
    modeHeadless?: string;
    statusOk?: string;
    statusSoftFail?: string;
    statusError?: string;
    statusSkipped?: string;
    statusQueued?: string;
    statusPending?: string;
  },
): string {
  const modeLabel =
    summary.mode === "headless"
      ? labels?.modeHeadless ?? "headless"
      : labels?.modeSessions ?? "sessions";
  const statusWord = (s: BatchItemStatus): string => {
    switch (s) {
      case "ok":
        return labels?.statusOk ?? "ok";
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
  const lines: string[] = [
    `Batch (${modeLabel}) · ${summary.total} project(s)`,
    `ok ${summary.ok} · soft-fail ${summary.softFail} · error ${summary.error} · skipped ${summary.skipped}` +
      (summary.queued ? ` · queued ${summary.queued}` : ""),
  ];
  if (summary.promptPreview) {
    lines.push(`prompt: ${summary.promptPreview}`);
  }
  lines.push("");
  for (const it of summary.items) {
    const name = it.projectName || it.projectId;
    const reason = it.reason ? ` (${it.reason})` : "";
    const snip = it.summary ? ` — ${truncateBatchText(it.summary, 80)}` : "";
    lines.push(`· ${name}: ${statusWord(it.status)}${reason}${snip}`);
  }
  return lines.join("\n");
}

/** Map skip reason → stable machine code for results. */
export function skipReasonToResult(
  project: BatchProjectInput,
  reason: BatchSkipReason,
): BatchDispatchItemResult {
  return {
    projectId: project.id,
    projectName: project.name || project.id,
    projectPath: project.path || "",
    status: "skipped",
    reason,
    sessionId: null,
    summary: null,
  };
}

/**
 * Seed pending result rows from a plan (eligible + skipped) before I/O.
 * Useful for progressive UI fill.
 */
export function seedBatchResultRows(
  plan: BatchDispatchPlan,
): BatchDispatchItemResult[] {
  const rows: BatchDispatchItemResult[] = [];
  for (const p of plan.eligible) {
    rows.push({
      projectId: p.id,
      projectName: p.name || p.id,
      projectPath: p.path || "",
      status: "pending",
      reason: null,
      sessionId: null,
      summary: null,
    });
  }
  for (const s of plan.skipped) {
    rows.push(skipReasonToResult(s.project, s.reason));
  }
  return rows;
}

/**
 * Merge an updated item into a result list by projectId (immutable).
 * Unknown projectIds are appended.
 */
export function upsertBatchResultItem(
  items: readonly BatchDispatchItemResult[],
  next: BatchDispatchItemResult,
): BatchDispatchItemResult[] {
  let found = false;
  const out = items.map((it) => {
    if (it.projectId === next.projectId) {
      found = true;
      return next;
    }
    return it;
  });
  if (!found) out.push(next);
  return out;
}

/**
 * Whether the dispatch button should be enabled.
 * Same as plan.canDispatch but accepts partial form state.
 */
export function canDispatchBatch(opts: {
  prompt: string | null | undefined;
  eligibleCount: number;
  running?: boolean;
}): boolean {
  if (opts.running) return false;
  return isBatchPromptReady(opts.prompt) && opts.eligibleCount > 0;
}

/**
 * Soft-fail classification for host/CLI errors (string match, no secrets).
 * Used by FE when wrapping session/headless I/O.
 */
export function classifyBatchError(
  err: unknown,
): { status: "soft_fail" | "error"; reason: string; summary: string } {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const msg = raw.trim() || "unknown";
  const lower = msg.toLowerCase();
  if (
    lower.includes("cli_not_found") ||
    lower.includes("cli missing") ||
    lower.includes("cli_missing")
  ) {
    return { status: "soft_fail", reason: "cli_missing", summary: msg };
  }
  if (lower.includes("cli_too_old") || lower.includes("too old")) {
    return { status: "soft_fail", reason: "cli_too_old", summary: msg };
  }
  if (lower.includes("process_limit") || lower.includes("process limit")) {
    return { status: "soft_fail", reason: "process_limit", summary: msg };
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return { status: "soft_fail", reason: "timeout", summary: msg };
  }
  if (lower.includes("auth") || lower.includes("login")) {
    return { status: "soft_fail", reason: "auth", summary: msg };
  }
  if (lower.includes("connect") || lower.includes("spawn")) {
    return { status: "soft_fail", reason: "connect_failed", summary: msg };
  }
  return { status: "error", reason: "error", summary: msg };
}

/** Headless host result shape (mirrors Tauri DTO; FE-only type). */
export type BatchHeadlessHostResult = {
  ok: boolean;
  reason?: string | null;
  text?: string | null;
  durationMs?: number | null;
  cliPath?: string | null;
  cliVersion?: string | null;
};

/** Map a host headless DTO into a dispatch item result. */
export function mapHeadlessHostResult(
  project: BatchProjectInput,
  host: BatchHeadlessHostResult,
): BatchDispatchItemResult {
  const base = {
    projectId: project.id,
    projectName: project.name || project.id,
    projectPath: project.path || "",
    sessionId: null as string | null,
    durationMs: host.durationMs ?? null,
  };
  if (host.ok) {
    return {
      ...base,
      status: "ok",
      reason: null,
      summary: truncateBatchText(host.text, 200) || null,
    };
  }
  const reason = (host.reason || "soft_fail").trim() || "soft_fail";
  return {
    ...base,
    status: "soft_fail",
    reason,
    summary: truncateBatchText(host.text || reason, 200) || reason,
  };
}
