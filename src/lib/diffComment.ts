/**
 * Pure helpers: turn a Changes-panel diff hunk + review note into a
 * structured composer prompt (comment → continue in chat).
 *
 * No I/O · no secrets in output (redact + strip NULs) · note/snippet caps.
 */

import { redact } from "./redact";

/** Target hunk for a review comment (UI → pure plan). */
export interface DiffCommentTarget {
  path: string;
  name?: string;
  hunkIndex: number;
  hunkHeader: string;
  hunkSnippet: string;
}

/** Max characters kept for the free-form review note. */
export const DIFF_COMMENT_NOTE_MAX = 4000;

/** Default max body lines in a hunk snippet. */
export const DIFF_COMMENT_SNIPPET_MAX_LINES = 40;

/** Default max characters in a hunk snippet (header + body). */
export const DIFF_COMMENT_SNIPPET_MAX_CHARS = 4000;

export type DiffCommentNoteOk = { ok: true; note: string };
export type DiffCommentNoteErr = {
  ok: false;
  reason: "empty" | "too_long";
};
export type DiffCommentNoteResult = DiffCommentNoteOk | DiffCommentNoteErr;

export type DiffCommentPlanOk = { ok: true; prompt: string };
export type DiffCommentPlanErr = {
  ok: false;
  reason: "empty" | "too_long" | "no_path" | "no_snippet";
};
export type DiffCommentPlanResult = DiffCommentPlanOk | DiffCommentPlanErr;

/** Strip NUL bytes that can break IPC / paste paths. */
export function stripNuls(text: string): string {
  return text.replace(/\u0000/g, "");
}

/**
 * Format a unified hunk for the agent: header + body lines, capped by
 * line count and total characters. Strips NULs; does not invent content.
 */
export function formatHunkSnippet(
  hunk: { header: string; lines: string[] },
  maxLines: number = DIFF_COMMENT_SNIPPET_MAX_LINES,
  maxChars: number = DIFF_COMMENT_SNIPPET_MAX_CHARS,
): string {
  const header = stripNuls(hunk.header || "").trim();
  const lines = Array.isArray(hunk.lines) ? hunk.lines : [];
  const limLines = Number.isFinite(maxLines)
    ? Math.max(0, Math.floor(maxLines))
    : DIFF_COMMENT_SNIPPET_MAX_LINES;
  const limChars = Number.isFinite(maxChars)
    ? Math.max(1, Math.floor(maxChars))
    : DIFF_COMMENT_SNIPPET_MAX_CHARS;

  const body: string[] = [];
  for (let i = 0; i < lines.length && body.length < limLines; i++) {
    body.push(stripNuls(String(lines[i] ?? "")));
  }
  const truncatedByLines = lines.length > limLines;
  const parts: string[] = [];
  if (header) {
    parts.push(header.startsWith("@@") ? header : `@@ ${header} @@`);
  }
  parts.push(...body);
  if (truncatedByLines) {
    parts.push(`… (${lines.length - limLines} more lines omitted)`);
  }
  let out = parts.join("\n");
  if (out.length > limChars) {
    out = `${out.slice(0, Math.max(1, limChars - 1))}…`;
  }
  return out;
}

/**
 * Validate free-form review note: strip NULs, trim, reject empty / too long.
 * Does not auto-clamp — callers surface `too_long` in the UI.
 */
export function validateDiffCommentNote(
  note: string | null | undefined,
): DiffCommentNoteResult {
  const raw = typeof note === "string" ? note : "";
  const cleaned = stripNuls(raw).trim();
  if (!cleaned) return { ok: false, reason: "empty" };
  if (cleaned.length > DIFF_COMMENT_NOTE_MAX) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, note: cleaned };
}

function safeField(value: string | null | undefined, max = 500): string {
  const t = stripNuls(typeof value === "string" ? value : "").trim();
  if (!t) return "";
  let r: string;
  try {
    r = redact(t);
  } catch {
    r = t;
  }
  if (r.length <= max) return r;
  return `${r.slice(0, Math.max(1, max - 1))}…`;
}

function safeMultiline(
  value: string | null | undefined,
  max: number,
): string {
  const t = stripNuls(typeof value === "string" ? value : "");
  if (!t) return "";
  let r: string;
  try {
    r = redact(t);
  } catch {
    r = t;
  }
  // Preserve newlines; cap hard length.
  if (r.length <= max) return r;
  return `${r.slice(0, Math.max(1, max - 1))}…`;
}

/**
 * Build a structured English prompt asking the agent to address a review
 * note on a specific diff hunk. Pure — never includes secrets (redacted).
 */
export function buildDiffCommentPrompt(opts: {
  path: string;
  name?: string;
  hunkHeader?: string;
  hunkSnippet: string;
  note: string;
}): string {
  const path = safeField(opts.path, 800) || "(unknown path)";
  const name = safeField(opts.name, 200);
  const header = safeField(opts.hunkHeader, 300);
  const snippet = safeMultiline(
    opts.hunkSnippet,
    DIFF_COMMENT_SNIPPET_MAX_CHARS,
  );
  // Cap note even if caller skipped validate (defense in depth).
  const note = safeMultiline(opts.note, DIFF_COMMENT_NOTE_MAX);

  const fileLabel = name ? `${path} (${name})` : path;
  const lines: string[] = [
    "Please address the following code-review note on this diff hunk.",
    "Focus only on the cited change unless the note clearly requires broader edits.",
    "Do not invent unrelated refactors. Prefer a minimal, correct fix.",
    "",
    `File: ${fileLabel}`,
  ];
  if (header) {
    lines.push(`Hunk: ${header}`);
  }
  if (snippet) {
    lines.push("", "Diff snippet:", "```diff", snippet, "```");
  }
  lines.push("", "Review note:", note || "(empty note)");
  return lines.join("\n");
}

/**
 * Validate inputs and produce the composer prompt, or a classified soft-fail.
 */
export function planDiffCommentToChat(opts: {
  path: string;
  name?: string;
  hunkHeader?: string;
  hunkSnippet: string;
  note: string;
}): DiffCommentPlanResult {
  const path = stripNuls(typeof opts.path === "string" ? opts.path : "").trim();
  if (!path) return { ok: false, reason: "no_path" };

  const snippet = stripNuls(
    typeof opts.hunkSnippet === "string" ? opts.hunkSnippet : "",
  ).trim();
  if (!snippet) return { ok: false, reason: "no_snippet" };

  const noteRes = validateDiffCommentNote(opts.note);
  if (!noteRes.ok) return { ok: false, reason: noteRes.reason };

  const prompt = buildDiffCommentPrompt({
    path,
    name: opts.name,
    hunkHeader: opts.hunkHeader,
    hunkSnippet: snippet,
    note: noteRes.note,
  });
  return { ok: true, prompt };
}
