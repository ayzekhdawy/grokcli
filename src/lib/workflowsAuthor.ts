/**
 * Workflows author experience — pure helpers (template scaffold + run history).
 *
 * App surfaces: Settings list/create-from-template/smoke-run only.
 * Full authoring remains the create-workflow skill (`/create-workflow`).
 * No visual graph editor.
 */

import {
  CREATE_WORKFLOW_SKILL_SEGMENTS,
  WORKFLOW_NAME_MAX_LEN,
  grokHomeFromUserHome,
  isValidWorkflowName,
  prepareWorkflowRunLogForDisplay,
  resolveWorkflowDirs,
  type WorkflowRunMode,
  type WorkflowScope,
} from "./workflows";

// ── Name + template ────────────────────────────────────────────────────────

/**
 * Sanitize a raw name into a safe workflow filename stem.
 * Allows alnum, dash, underscore; normalizes spaces/junk; returns null when invalid.
 */
export function sanitizeWorkflowName(
  raw: string | null | undefined,
): string | null {
  let s = (raw ?? "").trim();
  if (!s) return null;

  // Refuse path-like input before normalizing (never turn `../evil` into `evil`).
  if (s.includes("..") || s.includes("/") || s.includes("\\")) return null;

  // Strip extension if the user typed `foo.rhai`.
  s = s.replace(/\.rhai$/i, "").trim();
  // Common separators → dash; keep underscore.
  s = s.replace(/[\s.]+/g, "-");
  s = s.replace(/[^A-Za-z0-9_-]/g, "");
  s = s.replace(/-+/g, "-");
  s = s.replace(/_+/g, "_");
  s = s.replace(/^[-_]+|[-_]+$/g, "");

  if (!s || s.length > WORKFLOW_NAME_MAX_LEN) return null;
  if (s.toLowerCase() === "readme") return null;
  if (!isValidWorkflowName(s)) return null;
  return s;
}

/**
 * Minimal valid-ish Rhai scaffold with pure-literal `let meta`.
 * Honest comments: full authoring is the create-workflow skill; App lists/runs only.
 * Keep short — not a fake multi-agent pipeline.
 */
export function defaultWorkflowTemplate(name: string): string {
  const safe =
    sanitizeWorkflowName(name) ??
    (isValidWorkflowName(name) ? name.trim() : "my-workflow");
  return [
    `// Workflow scaffold: ${safe}`,
    `// Full authoring: create-workflow skill (/create-workflow) or edit this .rhai.`,
    `// This App lists, creates templates, and smoke/runs — no visual graph editor.`,
    `// Optional args: pass an object via the workflow tool \`args\` map when launching.`,
    ``,
    `let meta = #{`,
    `    name: "${safe}",`,
    `    description: "Template scaffold — replace with real orchestration steps",`,
    `};`,
    ``,
    `// Guard optional args (unit \`()\` when absent).`,
    `let _note = if args == () { "no args" } else { "args present" };`,
    `log("template " + meta.name + " ready (" + _note + ") — edit or use /create-workflow");`,
    `complete(#{ summary: "template scaffold", name: meta.name });`,
    ``,
  ].join("\n");
}

// ── Create plan ────────────────────────────────────────────────────────────

export type WorkflowCreateScope = "user" | "project";

export type PlanCreateWorkflowReason =
  | "ok"
  | "invalid_name"
  | "no_project"
  | "host_only";

export type PlanCreateWorkflowResult = {
  ok: boolean;
  reason: PlanCreateWorkflowReason;
  /** Sanitized stem when valid. */
  name: string | null;
  scope: WorkflowCreateScope;
  /** Target directory (absolute when home/project known). */
  dir: string | null;
  /** Full file path plan. */
  path: string | null;
  fileName: string | null;
  /** Soft-fail: browser/non-desktop cannot write without host. */
  hostOnly: boolean;
};

function joinDirFile(dir: string, fileName: string): string {
  const base = dir.replace(/[/\\]+$/g, "");
  if (!base) return fileName;
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base}${sep}${fileName}`;
}

/**
 * Plan where a new template workflow would be written.
 * Soft-fails: invalid_name | no_project | host_only (no user home for user scope).
 * Pure — does not touch disk; host `workflows_create` performs the write.
 */
export function planCreateWorkflow(opts: {
  name: string;
  scope: WorkflowCreateScope | string;
  projectPath?: string | null;
  userHome?: string | null;
  /** When false, plan still returns paths but marks hostOnly (browser preview). */
  isDesktop?: boolean;
}): PlanCreateWorkflowResult {
  const scopeRaw = String(opts.scope ?? "user")
    .trim()
    .toLowerCase();
  const scope: WorkflowCreateScope =
    scopeRaw === "project" ? "project" : "user";
  const name = sanitizeWorkflowName(opts.name);
  const isDesktop = opts.isDesktop !== false;

  if (!name) {
    return {
      ok: false,
      reason: "invalid_name",
      name: null,
      scope,
      dir: null,
      path: null,
      fileName: null,
      hostOnly: !isDesktop,
    };
  }

  const fileName = `${name}.rhai`;

  if (scope === "project") {
    const proj = (opts.projectPath ?? "").trim().replace(/[/\\]+$/g, "");
    if (!proj) {
      return {
        ok: false,
        reason: "no_project",
        name,
        scope,
        dir: null,
        path: null,
        fileName,
        hostOnly: !isDesktop,
      };
    }
    const dir = joinDirFile(joinDirFile(proj, ".grok"), "workflows");
    return {
      ok: isDesktop,
      reason: isDesktop ? "ok" : "host_only",
      name,
      scope,
      dir,
      path: joinDirFile(dir, fileName),
      fileName,
      hostOnly: !isDesktop,
    };
  }

  // user scope
  const home = (opts.userHome ?? "").trim().replace(/[/\\]+$/g, "");
  if (!home) {
    // Without a home path we cannot plan an absolute write target.
    return {
      ok: false,
      reason: "host_only",
      name,
      scope,
      dir: null,
      path: null,
      fileName,
      hostOnly: true,
    };
  }
  const dirs = resolveWorkflowDirs(home, null);
  return {
    ok: isDesktop,
    reason: isDesktop ? "ok" : "host_only",
    name,
    scope,
    dir: dirs.user,
    path: joinDirFile(dirs.user, fileName),
    fileName,
    hostOnly: !isDesktop,
  };
}

// ── Empty state ────────────────────────────────────────────────────────────

export type WorkflowsAuthorEmptyKind =
  | "no_workflows"
  | "scan_soft_fail"
  | "history_empty"
  | "browser_only";

export type WorkflowsAuthorEmptyState = {
  kind: WorkflowsAuthorEmptyKind;
  /** Stable key segment after `settings.workflows.empty.` */
  key: WorkflowsAuthorEmptyKind;
};

/**
 * Resolve empty-state kind for list / history surfaces.
 * Returns null when the surface has content to show.
 */
export function resolveWorkflowsAuthorEmptyState(opts: {
  /** Discovery count (0 → empty list). */
  workflowCount?: number;
  /** Recent-runs ring length (0 → history empty when surface is history). */
  historyCount?: number;
  /** Soft-fail from discovery. */
  scanError?: boolean;
  /** Desktop host available. */
  isDesktop?: boolean;
  /** Which surface is empty. Default `list`. */
  surface?: "list" | "history";
}): WorkflowsAuthorEmptyState | null {
  const surface = opts.surface ?? "list";
  const isDesktop = opts.isDesktop !== false;

  if (surface === "history") {
    const n = Math.max(0, Math.floor(opts.historyCount ?? 0));
    if (n > 0) return null;
    return { kind: "history_empty", key: "history_empty" };
  }

  if (!isDesktop) {
    return { kind: "browser_only", key: "browser_only" };
  }

  const count = Math.max(0, Math.floor(opts.workflowCount ?? 0));
  if (count > 0) return null;

  if (opts.scanError) {
    return { kind: "scan_soft_fail", key: "scan_soft_fail" };
  }
  return { kind: "no_workflows", key: "no_workflows" };
}

/** Absolute path to bundled create-workflow skill when user home is known. */
export function resolveCreateWorkflowSkillPath(
  userHome: string | null | undefined,
): string | null {
  const home = (userHome ?? "").trim().replace(/[/\\]+$/g, "");
  if (!home) return null;
  const grok = grokHomeFromUserHome(home);
  const sep = grok.includes("\\") && !grok.includes("/") ? "\\" : "/";
  return `${grok}${sep}${CREATE_WORKFLOW_SKILL_SEGMENTS.join(sep)}`;
}

// ── Recent run history (localStorage ring) ─────────────────────────────────

export type WorkflowRunHistoryOutcome = "ok" | "error" | "soft_fail";

export type WorkflowRunHistorySource = "settings" | "unknown";

export type WorkflowRunHistoryRecord = {
  id: string;
  /** Workflow definition name. */
  name: string;
  /** ISO-8601. */
  at: string;
  mode: WorkflowRunMode | string;
  outcome: WorkflowRunHistoryOutcome;
  reason?: string | null;
  /** Redacted short log snippet. */
  logSnippet?: string | null;
  source: WorkflowRunHistorySource;
  durationMs?: number | null;
};

export type WorkflowRunHistoryFilter =
  | "all"
  | WorkflowRunHistoryOutcome
  | "validate"
  | "launch";

export const WORKFLOW_RUN_HISTORY_STORAGE_KEY = "grok.workflowRunHistory";
export const WORKFLOW_RUN_HISTORY_MAX = 20;
export const WORKFLOW_RUN_HISTORY_LOG_MAX = 280;
export const WORKFLOW_RUN_HISTORY_NAME_MAX = 96;
export const WORKFLOW_RUN_HISTORY_ID_MAX = 80;

export const WORKFLOW_RUN_HISTORY_CHANGE_EVENT =
  "grok-workflow-run-history-change";

/** Minimal storage surface so unit tests need no jsdom. */
export interface WorkflowRunHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): WorkflowRunHistoryStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

const OUTCOMES = new Set<string>(["ok", "error", "soft_fail"]);
const SOURCES = new Set<string>(["settings", "unknown"]);

function scrub(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  let s = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  if (!s) return "";
  if (s.length > max) s = s.slice(0, max);
  return s;
}

/** Redact + clamp a log snippet for the history ring. */
export function redactWorkflowRunHistoryLog(
  raw: unknown,
): string | null {
  let text = "";
  if (raw instanceof Error) text = raw.message;
  else if (typeof raw === "string") text = raw;
  else if (raw != null) text = String(raw);
  if (!text.trim()) return null;
  const prepared = prepareWorkflowRunLogForDisplay(
    text,
    WORKFLOW_RUN_HISTORY_LOG_MAX,
  );
  const out = prepared.text.trim();
  return out || null;
}

export function newWorkflowRunHistoryId(now = Date.now()): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return `wr-${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through */
  }
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `wr-${now.toString(36)}-${rand}`;
}

export function parseWorkflowRunHistoryRecord(
  raw: unknown,
): WorkflowRunHistoryRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const outcomeRaw = scrub(o.outcome, 32).toLowerCase();
  if (!OUTCOMES.has(outcomeRaw)) return null;
  const outcome = outcomeRaw as WorkflowRunHistoryOutcome;

  const name =
    scrub(o.name ?? o.workflowName ?? o.workflow_name, WORKFLOW_RUN_HISTORY_NAME_MAX) ||
    "";
  if (!name) return null;

  const id =
    scrub(o.id, WORKFLOW_RUN_HISTORY_ID_MAX) || newWorkflowRunHistoryId();
  const atRaw = scrub(o.at ?? o.ts ?? o.timestamp, 64);
  const at = atRaw || new Date(0).toISOString();

  const modeRaw = scrub(o.mode, 32).toLowerCase();
  const mode: WorkflowRunMode | string =
    modeRaw === "launch" || modeRaw === "run" || modeRaw === "start"
      ? "launch"
      : "validate";

  const sourceRaw = scrub(o.source, 32).toLowerCase();
  const source: WorkflowRunHistorySource = SOURCES.has(sourceRaw)
    ? (sourceRaw as WorkflowRunHistorySource)
    : "unknown";

  const reason = scrub(o.reason, 64) || null;
  const logSnippet = redactWorkflowRunHistoryLog(
    o.logSnippet ?? o.log_snippet ?? o.log,
  );

  let durationMs: number | null = null;
  const d = o.durationMs ?? o.duration_ms;
  if (typeof d === "number" && Number.isFinite(d) && d >= 0) {
    durationMs = Math.round(d);
  }

  return {
    id,
    name,
    at,
    mode,
    outcome,
    source,
    ...(reason ? { reason } : {}),
    ...(logSnippet ? { logSnippet } : {}),
    ...(durationMs != null ? { durationMs } : {}),
  };
}

export function parseWorkflowRunHistory(
  raw: unknown,
  max = WORKFLOW_RUN_HISTORY_MAX,
): WorkflowRunHistoryRecord[] {
  const lim =
    typeof max === "number" && Number.isFinite(max) && max > 0
      ? Math.min(100, Math.floor(max))
      : WORKFLOW_RUN_HISTORY_MAX;

  let list: unknown[] = [];
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    try {
      const parsed = JSON.parse(t) as unknown;
      if (Array.isArray(parsed)) list = parsed;
      else return [];
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    list = raw;
  } else {
    return [];
  }

  const out: WorkflowRunHistoryRecord[] = [];
  for (const item of list) {
    const e = parseWorkflowRunHistoryRecord(item);
    if (!e) continue;
    out.push(e);
    if (out.length >= lim) break;
  }
  return out;
}

/** Pure ring-buffer push: newest first, max length. */
export function pushWorkflowRunHistory(
  existing: readonly WorkflowRunHistoryRecord[],
  entry: WorkflowRunHistoryRecord | Record<string, unknown>,
  max = WORKFLOW_RUN_HISTORY_MAX,
): WorkflowRunHistoryRecord[] {
  const next = parseWorkflowRunHistoryRecord(entry);
  if (!next) return parseWorkflowRunHistory(existing, max);
  const cleaned = parseWorkflowRunHistory(existing, max);
  const without = cleaned.filter((e) => e.id !== next.id);
  return parseWorkflowRunHistory([next, ...without], max);
}

export function loadWorkflowRunHistory(
  storage: WorkflowRunHistoryStorage = defaultStorage(),
  max = WORKFLOW_RUN_HISTORY_MAX,
): WorkflowRunHistoryRecord[] {
  try {
    return parseWorkflowRunHistory(
      storage.getItem(WORKFLOW_RUN_HISTORY_STORAGE_KEY),
      max,
    );
  } catch {
    return [];
  }
}

export function saveWorkflowRunHistory(
  entries: readonly WorkflowRunHistoryRecord[],
  storage: WorkflowRunHistoryStorage = defaultStorage(),
  max = WORKFLOW_RUN_HISTORY_MAX,
): void {
  const clean = parseWorkflowRunHistory(entries, max);
  try {
    storage.setItem(WORKFLOW_RUN_HISTORY_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    /* private mode / quota */
  }
}

/**
 * Record an observed Settings smoke/run: load → push → save → notify.
 */
export function recordWorkflowRunHistory(
  input: {
    name: string;
    mode?: WorkflowRunMode | string | null;
    outcome: WorkflowRunHistoryOutcome;
    reason?: string | null;
    log?: unknown;
    durationMs?: number | null;
    source?: WorkflowRunHistorySource;
    id?: string;
    at?: string;
  },
  storage: WorkflowRunHistoryStorage = defaultStorage(),
  max = WORKFLOW_RUN_HISTORY_MAX,
): WorkflowRunHistoryRecord[] {
  const name = scrub(input.name, WORKFLOW_RUN_HISTORY_NAME_MAX) || "workflow";
  const modeRaw = scrub(input.mode, 32).toLowerCase();
  const mode: WorkflowRunMode =
    modeRaw === "launch" || modeRaw === "run" || modeRaw === "start"
      ? "launch"
      : "validate";

  const entry: WorkflowRunHistoryRecord = {
    id: input.id || newWorkflowRunHistoryId(),
    name,
    at: input.at || new Date().toISOString(),
    mode,
    outcome: input.outcome,
    source: input.source ?? "settings",
    ...(input.reason ? { reason: scrub(input.reason, 64) } : {}),
    ...(redactWorkflowRunHistoryLog(input.log)
      ? { logSnippet: redactWorkflowRunHistoryLog(input.log) }
      : {}),
    ...(typeof input.durationMs === "number" &&
    Number.isFinite(input.durationMs) &&
    input.durationMs >= 0
      ? { durationMs: Math.round(input.durationMs) }
      : {}),
  };
  const next = pushWorkflowRunHistory(
    loadWorkflowRunHistory(storage, max),
    entry,
    max,
  );
  saveWorkflowRunHistory(next, storage, max);
  notifyWorkflowRunHistoryChange(next);
  return next;
}

/**
 * Filter history by outcome or mode chip.
 * `all` returns cleaned list; mode filters use validate|launch.
 */
export function filterWorkflowRunHistory(
  history: readonly WorkflowRunHistoryRecord[],
  filter: WorkflowRunHistoryFilter = "all",
): WorkflowRunHistoryRecord[] {
  const cleaned = parseWorkflowRunHistory(history);
  if (filter === "all") return cleaned;
  if (filter === "validate" || filter === "launch") {
    return cleaned.filter((e) => e.mode === filter);
  }
  return cleaned.filter((e) => e.outcome === filter);
}

export function clearWorkflowRunHistory(
  storage: WorkflowRunHistoryStorage = defaultStorage(),
): WorkflowRunHistoryRecord[] {
  saveWorkflowRunHistory([], storage);
  notifyWorkflowRunHistoryChange([]);
  return [];
}

function notifyWorkflowRunHistoryChange(
  next: readonly WorkflowRunHistoryRecord[],
): void {
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(WORKFLOW_RUN_HISTORY_CHANGE_EVENT, {
          detail: next,
        }),
      );
    } catch {
      /* ignore */
    }
  }
}

/** Map a run result to a history outcome. */
export function workflowRunResultToHistoryOutcome(result: {
  ok?: boolean | null;
  reason?: string | null;
}): WorkflowRunHistoryOutcome {
  if (result.ok) return "ok";
  const r = (result.reason ?? "").trim().toLowerCase();
  if (r === "ok") return "ok";
  // Hard-ish failures still soft-fail in product, but label as error for chips.
  if (
    r === "cli_missing" ||
    r === "spawn_failed" ||
    r === "timeout" ||
    r === "nonzero_exit"
  ) {
    return "error";
  }
  return "soft_fail";
}

/** Scope label helper re-export for author UI typing. */
export type { WorkflowScope };
