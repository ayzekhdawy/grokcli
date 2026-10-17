/**
 * Worktree compare helpers — file list + short stats vs main (or any sibling).
 *
 * Pure functions only (plan soft-fail, parse `git diff --name-status`, summarize,
 * display cap). Host runs the actual git diff; no merge/apply in this module.
 */

import {
  normalizeWorktreePath,
  pathsEqual,
} from "@/lib/gitWorktree";

/** Soft-fail plan reasons before invoking host. */
export type WorktreeComparePlanReason =
  | "same_path"
  | "missing_path"
  | "not_git";

export type WorktreeComparePlan =
  | {
      ok: true;
      basePath: string;
      otherPath: string;
      baseBranch?: string | null;
      otherBranch?: string | null;
    }
  | {
      ok: false;
      reason: WorktreeComparePlanReason;
      basePath: string;
      otherPath: string;
    };

/**
 * Plan a worktree compare. Soft-fails on empty/same paths or when either side
 * is known non-git (`baseAvailable` / `otherAvailable` === false).
 *
 * Does not hit the filesystem — missing directories are reported by the host.
 */
export function planWorktreeCompare(opts: {
  basePath: string | null | undefined;
  otherPath: string | null | undefined;
  baseBranch?: string | null | undefined;
  otherBranch?: string | null | undefined;
  /** When false, base is not a git work tree (soft-fail `not_git`). */
  baseAvailable?: boolean | null | undefined;
  /** When false, other is not a git work tree (soft-fail `not_git`). */
  otherAvailable?: boolean | null | undefined;
}): WorktreeComparePlan {
  const basePath = normalizeWorktreePath(opts.basePath);
  const otherPath = normalizeWorktreePath(opts.otherPath);

  if (!basePath || !otherPath) {
    return { ok: false, reason: "missing_path", basePath, otherPath };
  }
  if (pathsEqual(basePath, otherPath)) {
    return { ok: false, reason: "same_path", basePath, otherPath };
  }
  if (opts.baseAvailable === false || opts.otherAvailable === false) {
    return { ok: false, reason: "not_git", basePath, otherPath };
  }

  const baseBranch = (opts.baseBranch ?? "").trim() || null;
  const otherBranch = (opts.otherBranch ?? "").trim() || null;

  return {
    ok: true,
    basePath,
    otherPath,
    baseBranch,
    otherBranch,
  };
}

/** One row from `git diff --name-status` (A/M/D/R… + path, optional rename source). */
export type NameStatusEntry = {
  /** Status letter or code: A, M, D, R, C, T, U, X, or full token e.g. `R100`. */
  status: string;
  /** Path (rename/copy destination when oldPath is set). */
  path: string;
  /** Rename/copy source path when present. */
  oldPath?: string;
};

/**
 * Parse `git diff --name-status` stdout into entries.
 *
 * Lines: `<status>\t<path>` or `<status>\t<old>\t<new>` for rename/copy.
 * Status may include a score (`R100`, `C080`). Blank lines ignored.
 */
export function parseNameStatus(raw: string): NameStatusEntry[] {
  const text = (raw ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) return [];

  const out: NameStatusEntry[] = [];
  for (const line of text.split("\n")) {
    const t = line.trimEnd();
    if (!t.trim()) continue;

    // Prefer tab-separated (standard name-status). Fall back to runs of spaces.
    const parts = t.includes("\t")
      ? t.split("\t")
      : t.trim().split(/\s+/);
    if (parts.length < 2) continue;

    const status = (parts[0] ?? "").trim();
    if (!status) continue;

    if (parts.length >= 3) {
      // Rename / copy: status old new
      const oldPath = normalizeRelPath(parts[1] ?? "");
      const path = normalizeRelPath(parts[2] ?? "");
      if (!path && !oldPath) continue;
      out.push({
        status,
        path: path || oldPath,
        oldPath: oldPath || undefined,
      });
    } else {
      const path = normalizeRelPath(parts[1] ?? "");
      if (!path) continue;
      out.push({ status, path });
    }
  }
  return out;
}

function normalizeRelPath(p: string): string {
  return (p ?? "").trim().replace(/\\/g, "/");
}

/** Coarse status letter from a name-status token (`R100` → `R`). */
export function nameStatusLetter(status: string | null | undefined): string {
  const s = (status ?? "").trim();
  if (!s) return "?";
  const letter = s[0]!.toUpperCase();
  return /[A-Z]/.test(letter) ? letter : "?";
}

export type CompareSummary = {
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
  other: number;
  total: number;
};

/** Bucket name-status entries into coarse counts. */
export function summarizeCompareEntries(
  entries: NameStatusEntry[] | null | undefined,
): CompareSummary {
  const list = entries ?? [];
  let added = 0;
  let modified = 0;
  let deleted = 0;
  let renamed = 0;
  let other = 0;

  for (const e of list) {
    const letter = nameStatusLetter(e.status);
    switch (letter) {
      case "A":
        added += 1;
        break;
      case "M":
      case "T": // typechange treated as modified
        modified += 1;
        break;
      case "D":
        deleted += 1;
        break;
      case "R":
      case "C": // copy → renamed bucket for short stats
        renamed += 1;
        break;
      default:
        other += 1;
        break;
    }
  }

  return {
    added,
    modified,
    deleted,
    renamed,
    other,
    total: list.length,
  };
}

/**
 * Short human summary line, e.g. `+3 ~2 −1 →1 · 7 files`.
 * Empty / zero total → `No changes`.
 */
export function formatCompareSummaryLine(summary: CompareSummary): string {
  if (!summary || summary.total <= 0) return "No changes";
  const parts: string[] = [];
  if (summary.added) parts.push(`+${summary.added}`);
  if (summary.modified) parts.push(`~${summary.modified}`);
  if (summary.deleted) parts.push(`−${summary.deleted}`);
  if (summary.renamed) parts.push(`→${summary.renamed}`);
  if (summary.other) parts.push(`?${summary.other}`);
  const head = parts.length ? parts.join(" ") : "0";
  const noun = summary.total === 1 ? "file" : "files";
  return `${head} · ${summary.total} ${noun}`;
}

/** Default max rows shown in the compare modal (overflow reported honestly). */
export const COMPARE_ENTRY_DISPLAY_CAP = 500;

export type CappedCompareEntries = {
  shown: NameStatusEntry[];
  /** Number of entries not shown (total − shown.length). */
  overflow: number;
  total: number;
  cap: number;
};

/**
 * Cap entries for UI display. Full list stays available for stats;
 * overflow count is honest (never silently drop without reporting).
 */
export function capCompareEntries(
  entries: NameStatusEntry[] | null | undefined,
  cap: number = COMPARE_ENTRY_DISPLAY_CAP,
): CappedCompareEntries {
  const list = entries ?? [];
  const limit =
    Number.isFinite(cap) && cap > 0
      ? Math.floor(cap)
      : COMPARE_ENTRY_DISPLAY_CAP;
  if (list.length <= limit) {
    return { shown: list, overflow: 0, total: list.length, cap: limit };
  }
  return {
    shown: list.slice(0, limit),
    overflow: list.length - limit,
    total: list.length,
    cap: limit,
  };
}

/**
 * Join worktree root + relative path for reveal / copy.
 * Returns null when either side is empty.
 */
export function joinWorktreeRelPath(
  root: string | null | undefined,
  rel: string | null | undefined,
): string | null {
  const base = normalizeWorktreePath(root);
  const r = normalizeRelPath(rel ?? "");
  if (!base || !r) return null;
  // Refuse absolute / traversal-looking rel paths for safety in UI helpers.
  if (r.startsWith("/") || /^[a-zA-Z]:\//.test(r) || r.split("/").includes("..")) {
    return null;
  }
  return normalizeWorktreePath(`${base}/${r}`);
}

/** Soft-fail reason label key fragment for i18n (caller maps). */
export function comparePlanReasonKey(
  reason: WorktreeComparePlanReason,
): string {
  return reason;
}
