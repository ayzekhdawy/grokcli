/**
 * Worktree ship flow helpers — push branch + open GitHub PR.
 *
 * Pure functions only (argv builders, sanitizers, eligibility, outcome
 * combination). Host runs `git push` / `gh pr create` with soft-fail envelopes.
 */

import { redact } from "@/lib/redact";

/** Soft-fail / structured push result (mirrors host `git_push_branch`). */
export type ShipPushResult = {
  available: boolean;
  ok: boolean;
  branch?: string | null;
  remote?: string | null;
  stdout?: string | null;
  stderr?: string | null;
  reason?: string | null;
};

/** Soft-fail / structured PR create result (mirrors host `gh_pr_create`). */
export type ShipPrResult = {
  available: boolean;
  ok: boolean;
  url?: string | null;
  repo?: string | null;
  base?: string | null;
  head?: string | null;
  stdout?: string | null;
  stderr?: string | null;
  reason?: string | null;
};

/** Combined frontend ship outcome — never invents success when gh fails. */
export type ShipFlowOutcome = {
  push: ShipPushResult;
  pr: ShipPrResult | null;
  /** True only when every requested step succeeded. */
  ok: boolean;
  /** Primary PR URL when created. */
  prUrl: string | null;
  /** Short machine reason for failure (first hard failure). */
  failReason: string | null;
};

const PR_TITLE_MAX = 256;
const PR_BODY_MAX = 65_536;
const BRANCH_MAX = 256;
const REPO_MAX = 200;

/** Normalize path for argv (slash direction, no trailing slash). */
export function normalizeShipPath(path: string | null | undefined): string {
  const p = (path ?? "").trim().replace(/\\/g, "/");
  if (!p) return "";
  return p.replace(/\/+$/, "") || p;
}

/**
 * Sanitize branch name for `--head` / display.
 * Empty / option-like / control chars → null.
 */
export function sanitizeBranchName(
  raw: string | null | undefined,
): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (s.length > BRANCH_MAX) throw new Error("branch name too long");
  if (s.startsWith("-")) throw new Error("branch must not start with '-'");
  if (/[\0\n\r]/.test(s)) throw new Error("invalid branch name");
  // Allow common branch chars including `/` for `feat/x`.
  if (!/^[A-Za-z0-9._/\-]+$/.test(s)) {
    throw new Error("branch contains invalid characters");
  }
  if (s === "HEAD" || s === "@") return null;
  return s;
}

/** PR title: single line, trimmed, max length. */
export function sanitizePrTitle(raw: string | null | undefined): string {
  const s = (raw ?? "").replace(/[\0\r\n]+/g, " ").trim();
  if (!s) throw new Error("PR title is required");
  if (s.length > PR_TITLE_MAX) {
    throw new Error(`PR title too long (max ${PR_TITLE_MAX})`);
  }
  return s;
}

/** PR body: allow multiline; strip NULs; cap length. Empty → "". */
export function sanitizePrBody(raw: string | null | undefined): string {
  let s = (raw ?? "").replace(/\0/g, "");
  // Normalize newlines
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (s.length > PR_BODY_MAX) {
    throw new Error(`PR body too long (max ${PR_BODY_MAX})`);
  }
  return s;
}

/**
 * Optional `owner/repo` for `gh pr create --repo`.
 * Empty → null (let gh infer from remotes).
 */
export function sanitizeGitHubRepo(
  raw: string | null | undefined,
): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (s.length > REPO_MAX) throw new Error("repo too long");
  if (s.startsWith("-")) throw new Error("repo must not start with '-'");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s)) {
    throw new Error("repo must be owner/name");
  }
  return s;
}

/** Optional base branch (`main`, `master`, …). Empty → null (caller default). */
export function sanitizeBaseBranch(
  raw: string | null | undefined,
): string | null {
  return sanitizeBranchName(raw);
}

/**
 * Default PR title from a branch name.
 * `feat/wt-ship-flow` → `feat: wt ship flow`
 * `fix/foo-bar` → `fix: foo bar`
 * plain `hello` → `hello`
 */
export function defaultPrTitleFromBranch(
  branch: string | null | undefined,
): string {
  const b = (branch ?? "").trim();
  if (!b || b === "HEAD") return "Ship changes";
  const slash = b.indexOf("/");
  if (slash > 0 && slash < b.length - 1) {
    const prefix = b.slice(0, slash).toLowerCase();
    const rest = b
      .slice(slash + 1)
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (
      rest &&
      /^(feat|fix|chore|docs|refactor|test|ci|build|perf|style|revert)$/.test(
        prefix,
      )
    ) {
      return `${prefix}: ${rest}`;
    }
  }
  return b.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || "Ship changes";
}

/**
 * Parse `git@host:org/repo.git` / `https://host/org/repo.git` → `org/repo`.
 */
export function parseGitHubOwnerRepo(
  url: string | null | undefined,
): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  let s = raw.replace(/\\/g, "/");
  s = s.replace(/\.git$/i, "").replace(/\/+$/, "");

  // SSH: git@github.com:org/repo
  const ssh = s.match(/^[^@\s]+@[^:\s]+:(.+)$/);
  if (ssh) {
    const path = ssh[1].replace(/^\/+/, "");
    const parts = path.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }
  }

  // HTTPS / scp-like without user
  try {
    const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)
      ? s
      : s.includes("://")
        ? s
        : "";
    if (withProto) {
      const u = new URL(withProto);
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        return `${parts[0]}/${parts[1]}`;
      }
    }
  } catch {
    /* fall through */
  }

  // Path tail: …/org/repo
  const parts = s.split("/").filter(Boolean);
  if (parts.length >= 2) {
    const org = parts[parts.length - 2];
    const repo = parts[parts.length - 1];
    if (org && repo && !org.includes("@")) {
      return `${org}/${repo}`;
    }
  }
  return null;
}

/** Owner segment of `owner/repo`, or null. */
export function githubOwner(
  ownerRepo: string | null | undefined,
): string | null {
  const s = (ownerRepo ?? "").trim();
  const i = s.indexOf("/");
  if (i <= 0) return null;
  const o = s.slice(0, i).trim();
  return o || null;
}

/**
 * Build `gh pr create --head` value.
 * Cross-fork: `owner:branch`; same repo: bare branch.
 */
export function buildGhHead(
  branch: string | null | undefined,
  originOwnerRepo: string | null | undefined,
  baseOwnerRepo: string | null | undefined,
): string | null {
  const b = sanitizeBranchName(branch);
  if (!b) return null;
  const originOwner = githubOwner(originOwnerRepo);
  const baseOwner = githubOwner(baseOwnerRepo);
  if (originOwner && baseOwner && originOwner !== baseOwner) {
    return `${originOwner}:${b}`;
  }
  return b;
}

/**
 * Resolve --repo / --base / --head from remotes + branch.
 * Prefers `upstream` as the PR target repo when present (fork workflow).
 */
export function resolveShipRemotes(opts: {
  branch: string | null | undefined;
  originUrl?: string | null;
  upstreamUrl?: string | null;
  base?: string | null;
  repo?: string | null;
  head?: string | null;
}): {
  repo: string | null;
  base: string;
  head: string | null;
  originOwnerRepo: string | null;
  baseOwnerRepo: string | null;
} {
  const originOwnerRepo = parseGitHubOwnerRepo(opts.originUrl);
  const upstreamOwnerRepo = parseGitHubOwnerRepo(opts.upstreamUrl);
  const baseOwnerRepo =
    sanitizeGitHubRepo(opts.repo) ||
    upstreamOwnerRepo ||
    originOwnerRepo ||
    null;
  const base =
    sanitizeBaseBranch(opts.base) || "main";
  let head: string | null = null;
  if (opts.head?.trim()) {
    // Allow `owner:branch` form without going through sanitizeBranchName alone.
    const h = opts.head.trim();
    if (h.startsWith("-") || /[\0\n\r]/.test(h) || h.length > BRANCH_MAX + 80) {
      throw new Error("invalid head");
    }
    head = h;
  } else {
    head = buildGhHead(opts.branch, originOwnerRepo, baseOwnerRepo);
  }
  return {
    repo: baseOwnerRepo,
    base,
    head,
    originOwnerRepo,
    baseOwnerRepo,
  };
}

/**
 * Whether the UI should offer Ship / Open PR for this checkout.
 * Detached HEAD and empty branch → no. Main is allowed (push/PR still useful).
 */
export function canShipWorktree(opts: {
  branch?: string | null;
  detached?: boolean | null;
  available?: boolean | null;
}): boolean {
  if (opts.available === false) return false;
  if (opts.detached) return false;
  const b = (opts.branch ?? "").trim();
  if (!b || b === "HEAD") return false;
  try {
    return !!sanitizeBranchName(b);
  } catch {
    return false;
  }
}

/**
 * Build argv for `git push -u origin HEAD` (no binary name).
 * Layout: `[-C <project>] push -u origin HEAD`
 */
export function buildGitPushArgs(projectPath: string): string[] {
  const project = normalizeShipPath(projectPath);
  if (!project) throw new Error("empty path");
  if (project.startsWith("-")) throw new Error("invalid project path");
  return ["-C", project, "push", "-u", "origin", "HEAD"];
}

export type GhPrCreateArgOpts = {
  /** Working directory project (used only for validation; gh runs with -C via host). */
  title: string;
  body?: string | null;
  draft?: boolean;
  base?: string | null;
  head?: string | null;
  repo?: string | null;
};

/**
 * Build argv for `gh pr create` (no binary name).
 * Never passes a shell; body/title as discrete args.
 */
export function buildGhPrCreateArgs(opts: GhPrCreateArgOpts): string[] {
  const title = sanitizePrTitle(opts.title);
  const body = sanitizePrBody(opts.body);
  const base = sanitizeBaseBranch(opts.base) || "main";
  const repo = sanitizeGitHubRepo(opts.repo);
  let head: string | null = null;
  if (opts.head?.trim()) {
    const h = opts.head.trim();
    if (h.startsWith("-") || /[\0\n\r]/.test(h)) {
      throw new Error("invalid head");
    }
    head = h;
  }

  const args: string[] = ["pr", "create", "--title", title, "--body", body];
  if (repo) {
    args.push("--repo", repo);
  }
  args.push("--base", base);
  if (head) {
    args.push("--head", head);
  }
  if (opts.draft) {
    args.push("--draft");
  }
  return args;
}

/**
 * Extract first GitHub PR URL from `gh pr create` stdout/stderr.
 */
export function parseGhPrUrl(
  output: string | null | undefined,
): string | null {
  const text = output ?? "";
  const m = text.match(
    /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/i,
  );
  return m ? m[0] : null;
}

/** Redact secret-looking spans in git/gh tool output for UI/logs. */
export function redactShipOutput(
  text: string | null | undefined,
  max = 4000,
): string {
  const scrubbed = redact(text ?? "");
  if (scrubbed.length <= max) return scrubbed;
  return scrubbed.slice(0, max) + "…";
}

/**
 * Combine push + optional PR results without fake success.
 * - Push-only: ok iff push.ok
 * - With PR: ok iff pr.ok (push failure still recorded; PR may still succeed
 *   when branch was already on remote)
 */
export function combineShipOutcome(
  push: ShipPushResult,
  pr: ShipPrResult | null,
  opts?: { createPr?: boolean },
): ShipFlowOutcome {
  const createPr = opts?.createPr !== false && pr != null;
  const prUrl = pr?.url?.trim() || parseGhPrUrl(pr?.stdout) || null;

  if (createPr) {
    const ok = !!(pr && pr.ok && prUrl);
    const failReason = ok
      ? null
      : pr?.reason?.trim() ||
        (pr && !pr.available
          ? pr.reason || "gh not available"
          : null) ||
        (pr && !pr.ok ? "gh pr create failed" : null) ||
        (!prUrl && pr?.ok ? "PR created but URL missing" : null) ||
        "ship failed";
    // Even if push failed, do not claim overall ok without a real PR URL.
    return {
      push,
      pr,
      ok,
      prUrl: ok ? prUrl : prUrl,
      failReason: ok ? null : failReason,
    };
  }

  const ok = !!push.ok;
  return {
    push,
    pr: null,
    ok,
    prUrl: null,
    failReason: ok
      ? null
      : push.reason?.trim() ||
        (push.available ? "git push failed" : push.reason || "git not available"),
  };
}

/** Human-readable one-line status for toast / log (English machine text). */
export function shipOutcomeSummary(outcome: ShipFlowOutcome): string {
  const parts: string[] = [];
  if (outcome.push.ok) {
    parts.push("pushed");
  } else if (!outcome.push.available) {
    parts.push(`push skipped (${outcome.push.reason || "unavailable"})`);
  } else {
    parts.push(`push failed (${outcome.push.reason || "error"})`);
  }
  if (outcome.pr) {
    if (outcome.pr.ok && outcome.prUrl) {
      parts.push(`PR ${outcome.prUrl}`);
    } else if (!outcome.pr.available) {
      parts.push(`PR skipped (${outcome.pr.reason || "gh unavailable"})`);
    } else {
      parts.push(`PR failed (${outcome.pr.reason || "error"})`);
    }
  }
  return parts.join(" · ");
}
