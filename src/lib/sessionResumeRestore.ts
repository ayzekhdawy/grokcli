/**
 * Pure helpers for “Resume with code restore” (open existing session on a
 * clean git worktree). Reuses the fork dirty-gate so uncommitted work is never
 * force-checked out. Host/UI create the worktree + rebind project; helpers
 * stay I/O-free.
 *
 * CLI analogy: `--resume` / `--continue` + optional `--restore-code` — agent
 * session continuity stays on the App journal / agentSessionId; restore-code
 * is the workspace isolation path (sibling worktree at HEAD).
 */

import { sanitizeWorktreeName } from "@/lib/gitWorktree";
import {
  canOfferForkAgentSession,
  canRestoreCodeOnFork,
  defaultForkAgentChecked,
  isGitWorkingTreeDirty,
  resolveForkAgentCheckbox,
  resolveForkAgentSession,
  sanitizeForkNameFragment,
  type ForkGitStatusSnapshot,
  type ForkRestoreCodeGate,
} from "@/lib/sessionFork";

export type { ForkGitStatusSnapshot as ResumeGitStatusSnapshot };
export type ResumeCodeRestoreGate = ForkRestoreCodeGate;

/** Re-export dirty check used by both fork and resume restore-code paths. */
export { isGitWorkingTreeDirty };

/** Re-export CLI `--fork-session` offer / honesty helpers for resume UI. */
export {
  canOfferForkAgentSession,
  defaultForkAgentChecked,
  resolveForkAgentCheckbox,
  resolveForkAgentSession,
};

/**
 * Gate for restore-code on resume (same rules as fork):
 * - no_project: chat has no bound folder
 * - unavailable: not a git work tree / git missing
 * - dirty: uncommitted changes — never force checkout / destroy work
 */
export function canRestoreCodeOnResume(
  projectPath: string | null | undefined,
  status: ForkGitStatusSnapshot | null | undefined,
): ResumeCodeRestoreGate {
  return canRestoreCodeOnFork(projectPath, status);
}

/**
 * Whether the session menu / palette should offer “Resume with code restore…”.
 * Needs a bound project path. When `gitAvailable === false`, hide (known
 * non-git). When unknown, show optimistically and gate at run time.
 */
export function canOfferResumeWithCodeRestore(
  projectPath: string | null | undefined,
  opts?: { gitAvailable?: boolean | null },
): boolean {
  const path = (projectPath ?? "").trim();
  if (!path) return false;
  if (opts?.gitAvailable === false) return false;
  return true;
}

/**
 * Unique-ish worktree / branch name for a resume restore:
 *   `resume-<sessionFrag>-<base36time>[-<attempt>]`
 *
 * Safe for `git worktree add -b` via {@link sanitizeWorktreeName}.
 */
export function buildResumeWorktreeName(
  sourceSessionId: string | null | undefined,
  opts?: { attempt?: number; now?: number },
): string {
  const frag = sanitizeForkNameFragment(sourceSessionId, 8);
  const now = opts?.now ?? Date.now();
  const attempt = Math.max(0, opts?.attempt ?? 0);
  const time = Math.abs(now).toString(36);
  let candidate =
    attempt > 0
      ? `resume-${frag}-${time}-${attempt}`
      : `resume-${frag}-${time}`;
  if (candidate.length > 64) {
    candidate = candidate.slice(0, 64).replace(/-+$/, "") || `resume-${time}`;
  }
  if (candidate.startsWith("-")) {
    candidate = `resume${candidate}`;
  }
  return sanitizeWorktreeName(candidate);
}

/**
 * Whether it is safe to record HEAD as a baseline commit at restore time.
 * MVP: capture only when git is available, tree is clean, and no prior
 * baseline is stored. Pure decision — caller reads/writes storage.
 */
export function shouldCaptureBaselineCommit(input: {
  storedCommit?: string | null;
  gitAvailable?: boolean | null;
  status?: ForkGitStatusSnapshot | null;
}): { capture: true } | { capture: false; reason: "has_stored" | "unsafe" } {
  const stored = (input.storedCommit ?? "").trim();
  if (stored) return { capture: false, reason: "has_stored" };
  if (input.gitAvailable === false) return { capture: false, reason: "unsafe" };
  if (!input.status?.available) return { capture: false, reason: "unsafe" };
  if (isGitWorkingTreeDirty(input.status)) {
    return { capture: false, reason: "unsafe" };
  }
  return { capture: true };
}
