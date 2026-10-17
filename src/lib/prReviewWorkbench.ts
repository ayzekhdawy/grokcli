/**
 * PR Review workbench — pure prompt builders for CI fails and PR comments → Grok.
 *
 * Never invents check/comment data; only formats caller-supplied fields.
 * Soft-fails empty inputs with empty / classified strings (no network).
 */

import type { GitPrCheckEntry, PrChecksSummary } from "./gitPrHub";
import { redact } from "./redact";

/** Cap failed-check rows included in a Fix-CI prompt. */
export const FIX_CI_CHECKS_CAP = 25;
/** Cap characters per check description / state line. */
export const FIX_CI_DESC_CAP = 400;
/** Cap PR body excerpt in Fix-CI prompt. */
export const FIX_CI_BODY_EXCERPT_CAP = 2_000;
/** Cap comment body in comment → Grok prompt. */
export const PR_COMMENT_BODY_CAP = 4_000;
/** Soft cap on total prompt length (extra safety after field caps). */
export const PR_REVIEW_PROMPT_TOTAL_CAP = 12_000;
/** Cap title / ref / author display fields. */
export const PR_REVIEW_FIELD_CAP = 200;

export type PrReviewActionErrorKind =
  | "empty_prompt"
  | "empty_pr"
  | "empty_comment"
  | "no_failed_checks"
  | "other"
  | null;

function clampText(
  raw: string | null | undefined,
  max: number,
): string {
  const s = String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}

function clampField(raw: string | null | undefined): string {
  return clampText(raw, PR_REVIEW_FIELD_CAP);
}

/** Redact secrets then clamp. Never invents content. */
function safeClip(
  raw: string | null | undefined,
  max: number,
): string {
  return clampText(redact(String(raw ?? "")), max);
}

/**
 * True when the checks rollup indicates CI failure worth a "Fix with Grok" action.
 * - overall `fail`, or
 * - overall `mixed` with fail &gt; 0, or
 * - raw fail count &gt; 0 (belt if overall was mis-set)
 */
export function canSuggestFixCi(
  summary: PrChecksSummary | null | undefined,
): boolean {
  if (!summary) return false;
  if (summary.fail > 0) return true;
  if (summary.overall === "fail") return true;
  if (summary.overall === "mixed" && summary.fail > 0) return true;
  return false;
}

/**
 * Filter to failed check rows only (bucket === "fail").
 * Preserves order; does not invent names or rewrite states.
 */
export function listFailedChecks(
  checks: GitPrCheckEntry[] | null | undefined,
): GitPrCheckEntry[] {
  if (!checks || checks.length === 0) return [];
  return checks.filter((c) => {
    const bucket = (c.bucket || "").trim().toLowerCase();
    if (bucket === "fail") return true;
    // Fallback when bucket missing but state looks failed.
    if (!bucket) {
      const state = (c.state || "").trim().toUpperCase();
      return (
        state === "FAILURE" ||
        state === "FAILED" ||
        state === "ERROR" ||
        state === "TIMED_OUT" ||
        state === "ACTION_REQUIRED" ||
        state === "STARTUP_FAILURE"
      );
    }
    return false;
  });
}

export type FixCiPromptOpts = {
  prNumber: number;
  title: string;
  url?: string | null;
  headRef?: string | null;
  baseRef?: string | null;
  failedChecks: {
    name: string;
    state: string;
    description?: string | null;
  }[];
  bodyExcerpt?: string | null;
};

/**
 * Build a composer draft asking Grok to fix failing CI for a PR.
 * Only includes checks the caller supplied — never invents CI data.
 * Empty / invalid PR number → empty string.
 */
export function buildFixCiPrompt(opts: FixCiPromptOpts): string {
  const n = Math.trunc(Number(opts.prNumber));
  if (!Number.isFinite(n) || n <= 0) return "";

  const title = clampField(opts.title) || "(no title)";
  const url = clampText(opts.url, 500);
  const headRef = clampField(opts.headRef);
  const baseRef = clampField(opts.baseRef);
  const bodyExcerpt = safeClip(opts.bodyExcerpt, FIX_CI_BODY_EXCERPT_CAP);

  const lines: string[] = [];
  lines.push(
    `Please help fix the failing CI checks on pull request #${n}: ${title}`,
  );
  lines.push("");
  lines.push("## PR context");
  lines.push(`- Number: #${n}`);
  lines.push(`- Title: ${title}`);
  if (url) lines.push(`- URL: ${url}`);
  if (headRef || baseRef) {
    const branch =
      headRef && baseRef
        ? `${headRef} → ${baseRef}`
        : headRef || baseRef;
    lines.push(`- Branch: ${branch}`);
  }

  lines.push("");
  lines.push("## Failed checks");
  const checks = Array.isArray(opts.failedChecks) ? opts.failedChecks : [];
  const limited = checks.slice(0, FIX_CI_CHECKS_CAP);
  if (limited.length === 0) {
    lines.push(
      "(No individual failed-check rows were provided. Investigate recent CI failures for this PR using the project workspace and `gh pr checks` if available — do not invent check names.)",
    );
  } else {
    for (const c of limited) {
      const name = clampField(c.name) || "(unnamed check)";
      const state = clampField(c.state) || "fail";
      const desc = safeClip(c.description, FIX_CI_DESC_CAP);
      if (desc) {
        lines.push(`- **${name}** — ${state}: ${desc}`);
      } else {
        lines.push(`- **${name}** — ${state}`);
      }
    }
    if (checks.length > FIX_CI_CHECKS_CAP) {
      lines.push(
        `…and ${checks.length - FIX_CI_CHECKS_CAP} more failed check(s) omitted.`,
      );
    }
  }

  if (bodyExcerpt) {
    lines.push("");
    lines.push("## PR body (excerpt)");
    lines.push(bodyExcerpt);
  }

  lines.push("");
  lines.push("## Task");
  lines.push(
    "Diagnose the failures from the project workspace (read logs / failing tests / related files).",
  );
  lines.push(
    "Propose and apply minimal fixes so CI can pass. Explain what you changed and how to re-run checks. Do not invent CI results you have not observed.",
  );

  return clampText(lines.join("\n"), PR_REVIEW_PROMPT_TOTAL_CAP);
}

export type PrCommentPromptOpts = {
  prNumber: number;
  title: string;
  comment: {
    author: string;
    body: string;
    kind?: string;
    state?: string | null;
    url?: string | null;
  };
};

/**
 * Build a composer draft asking Grok to address a PR review comment.
 * Empty PR number or empty comment body → empty string.
 */
export function buildPrCommentPrompt(opts: PrCommentPromptOpts): string {
  const n = Math.trunc(Number(opts.prNumber));
  if (!Number.isFinite(n) || n <= 0) return "";

  const title = clampField(opts.title) || "(no title)";
  const author = clampField(opts.comment?.author) || "unknown";
  const body = safeClip(opts.comment?.body, PR_COMMENT_BODY_CAP);
  if (!body) return "";

  const kindRaw = (opts.comment?.kind ?? "comment").trim().toLowerCase();
  const kind =
    kindRaw === "review" ? "review" : kindRaw === "comment" ? "comment" : kindRaw || "comment";
  const state = clampField(opts.comment?.state);
  const commentUrl = clampText(opts.comment?.url, 500);

  const lines: string[] = [];
  lines.push(
    `Please help address this ${kind} on pull request #${n}: ${title}`,
  );
  lines.push("");
  lines.push("## PR context");
  lines.push(`- Number: #${n}`);
  lines.push(`- Title: ${title}`);
  lines.push("");
  lines.push("## Comment");
  lines.push(`- Author: ${author}`);
  lines.push(`- Kind: ${kind}`);
  if (state) lines.push(`- Review state: ${state}`);
  if (commentUrl) lines.push(`- URL: ${commentUrl}`);
  lines.push("");
  lines.push("### Body");
  lines.push(body);
  lines.push("");
  lines.push("## Task");
  lines.push(
    "Understand the feedback, inspect the relevant code in the project workspace, and implement or propose concrete changes that address it.",
  );
  lines.push(
    "If the comment is a question, answer it from the codebase. If it requests changes, make minimal focused edits. Do not invent review history beyond what is shown above.",
  );

  return clampText(lines.join("\n"), PR_REVIEW_PROMPT_TOTAL_CAP);
}

/**
 * Soft classification for draft / action failures (UI mapping only).
 */
export function classifyPrReviewActionError(
  reason: string | null | undefined,
): PrReviewActionErrorKind {
  const r = (reason ?? "").trim().toLowerCase();
  if (!r) return null;
  if (
    r === "empty_prompt" ||
    r.includes("empty prompt") ||
    r.includes("empty draft")
  ) {
    return "empty_prompt";
  }
  if (
    r === "empty_pr" ||
    r.includes("invalid pr") ||
    r.includes("empty pr") ||
    r.includes("missing pr")
  ) {
    return "empty_pr";
  }
  if (
    r === "empty_comment" ||
    r.includes("empty comment") ||
    r.includes("no comment body")
  ) {
    return "empty_comment";
  }
  if (
    r === "no_failed_checks" ||
    r.includes("no failed") ||
    r.includes("no check")
  ) {
    return "no_failed_checks";
  }
  return "other";
}
