/**
 * Pure helpers for “parallel task” = create a git worktree + open a new chat.
 * I/O-free for unit tests; host (App) owns gitWorktreeAdd / sessionCreate / draft.
 */

import { sanitizeWorktreeName } from "@/lib/gitWorktree";

/** Soft cap for optional first prompt stored on create (composer still owns send). */
export const PARALLEL_TASK_PROMPT_MAX = 8_000;

/** Max length for slug fragments before uniqueness suffix. */
const SLUG_MAX = 40;

/**
 * Safe branch/worktree name fragment from an optional task title or prompt.
 * Empty / junk → empty string (caller adds `task` + time fallback).
 */
export function slugifyParallelTaskName(raw: string | null | undefined): string {
  const s = (raw ?? "")
    .trim()
    .toLowerCase()
    // First line only (prompt titles often multi-line)
    .split(/\r?\n/, 1)[0]
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  // Must not start with '-' after edge truncation
  if (!s || s === "." || s === "..") return "";
  if (s.startsWith("-")) return s.replace(/^-+/, "") || "";
  return s;
}

function timeSuffix(now: Date): string {
  return Math.abs(now.getTime()).toString(36).slice(-6);
}

function normalizeExistingNames(names: readonly string[] | undefined): Set<string> {
  const set = new Set<string>();
  for (const n of names ?? []) {
    const t = (n ?? "").trim().toLowerCase();
    if (t) set.add(t);
  }
  return set;
}

/**
 * Suggest a unique worktree/branch name for a parallel task.
 * Prefers slug from title; falls back to `task-<time>`; appends `-2`, `-3`, …
 * when colliding with `existingNames`.
 */
export function suggestParallelWorktreeName(opts: {
  title?: string | null;
  existingNames?: string[];
  now?: Date;
}): string {
  const now = opts.now ?? new Date();
  const existing = normalizeExistingNames(opts.existingNames);
  const baseSlug = slugifyParallelTaskName(opts.title);
  const base = baseSlug || `task-${timeSuffix(now)}`;

  let candidate = base;
  let n = 2;
  while (existing.has(candidate.toLowerCase()) || candidate.length > 64) {
    const suffix = `-${n}`;
    const head = base.slice(0, Math.max(1, 64 - suffix.length)).replace(/-+$/, "");
    candidate = `${head || "task"}${suffix}`;
    n += 1;
    if (n > 999) {
      candidate = `task-${timeSuffix(now)}-${n}`;
      break;
    }
  }
  // Final hard-safe pass via sanitize (throws only on empty / illegal).
  try {
    return sanitizeWorktreeName(candidate);
  } catch {
    return sanitizeWorktreeName(`task-${timeSuffix(now)}`);
  }
}

export type ParallelTaskPreflightReason =
  | "host_only"
  | "no_project"
  | "untrusted"
  | "not_git";

export type ParallelTaskPreflight =
  | { ok: true }
  | { ok: false; reason: ParallelTaskPreflightReason };

/**
 * Gate for palette / menu “Parallel task (worktree)”.
 * Honest soft-fail reasons only — never invents a project or git status.
 */
export function evaluateParallelTaskPreflight(opts: {
  isTauri: boolean;
  projectPath?: string | null;
  trusted?: boolean;
  gitAvailable?: boolean | null;
}): ParallelTaskPreflight {
  if (!opts.isTauri) return { ok: false, reason: "host_only" };
  const path = (opts.projectPath ?? "").trim();
  if (!path) return { ok: false, reason: "no_project" };
  if (opts.trusted === false) return { ok: false, reason: "untrusted" };
  if (opts.gitAvailable === false) return { ok: false, reason: "not_git" };
  return { ok: true };
}

/** i18n message key for a preflight soft-fail (host maps via tr). */
export function parallelTaskPreflightMessageKey(
  reason: ParallelTaskPreflightReason,
): string {
  switch (reason) {
    case "host_only":
      return "composer.parallelTaskHostOnly";
    case "no_project":
      return "composer.parallelTaskNoProject";
    case "untrusted":
      return "composer.parallelTaskUntrusted";
    case "not_git":
      return "composer.parallelTaskNotGit";
    default:
      return "composer.parallelTaskNoProject";
  }
}

export type ParallelTaskPlan = {
  name: string;
  firstPrompt: string | null;
  autoSend: boolean;
  sessionTitle: string;
};

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0]?.trim() || "";
}

/**
 * Sanitize create options for a parallel task.
 * - name via {@link sanitizeWorktreeName} (throws on illegal)
 * - prompt trimmed, capped to {@link PARALLEL_TASK_PROMPT_MAX}, empty → null
 * - sessionTitle from name, or first line of prompt when name is a generic task-*
 */
export function planParallelTask(opts: {
  name: string;
  firstPrompt?: string | null;
  autoSend?: boolean;
}): ParallelTaskPlan {
  const name = sanitizeWorktreeName(opts.name);
  let prompt = (opts.firstPrompt ?? "").trim();
  if (prompt.length > PARALLEL_TASK_PROMPT_MAX) {
    prompt = prompt.slice(0, PARALLEL_TASK_PROMPT_MAX);
  }
  const firstPrompt = prompt.length > 0 ? prompt : null;
  const autoSend = !!opts.autoSend && !!firstPrompt;

  let sessionTitle = name;
  if (firstPrompt) {
    const line = firstLine(firstPrompt);
    if (line && /^task-[a-z0-9]+$/i.test(name)) {
      // Generic auto-name: prefer a short title from the prompt
      sessionTitle = line.length > 48 ? `${line.slice(0, 47)}…` : line;
    }
  }

  return { name, firstPrompt, autoSend, sessionTitle };
}

/**
 * Composer draft for the new parallel-task chat.
 * Optional short honest context prefix (branch / path when known) then the user prompt.
 * Never invents paths or branches.
 */
export function buildParallelTaskComposerText(
  firstPrompt: string,
  meta: { branch?: string | null; path?: string | null } = {},
): string {
  const body = firstPrompt.trim();
  if (!body) return "";

  const bits: string[] = [];
  const branch = (meta.branch ?? "").trim();
  const path = (meta.path ?? "").trim();
  if (branch) bits.push(`branch: ${branch}`);
  if (path) bits.push(`cwd: ${path}`);

  if (bits.length === 0) return body;
  return `[parallel task · ${bits.join(" · ")}]\n\n${body}`;
}
