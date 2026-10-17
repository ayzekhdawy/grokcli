/**
 * Plan edit canvas — pure helpers for editable plan drafts before approve.
 *
 * Drafts stay local until the user sends them via request-changes.
 * No DOM / Tauri / i18n side effects.
 */

/** Soft cap on plan draft markdown (~200 KiB of characters). */
export const PLAN_DRAFT_MAX_CHARS = 200_000;

/** Clear markers wrapping a user-revised plan in agent feedback. */
export const PLAN_REVISED_MARKER_START = "--- revised plan (user edit) ---";
export const PLAN_REVISED_MARKER_END = "--- end revised plan ---";

/**
 * Strip NULs, normalize newlines to `\n`, and cap length.
 * Does not trim — trailing newlines are meaningful for dirty checks.
 */
export function sanitizePlanDraft(
  raw: string | null | undefined,
  maxLen: number = PLAN_DRAFT_MAX_CHARS,
): string {
  if (typeof raw !== "string") return "";
  let s = raw.replace(/\0/g, "");
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const cap = maxLen > 0 ? maxLen : 0;
  if (cap <= 0) return "";
  if (s.length > cap) return s.slice(0, cap);
  return s;
}

/**
 * True when the draft differs from the original after sanitize.
 * Both sides are sanitized so CR/LF and NULs cannot false-positive.
 */
export function planDraftIsDirty(
  original: string | null | undefined,
  draft: string | null | undefined,
): boolean {
  return sanitizePlanDraft(original) !== sanitizePlanDraft(draft);
}

export type PlanDraftValidation =
  | { ok: true }
  | { ok: false; reason: "empty" | "too_long" };

/**
 * Validate a plan draft before sending as request-changes feedback.
 * Empty / whitespace-only → `empty`. Pre-cap length over max → `too_long`.
 */
export function validatePlanDraft(
  draft: string | null | undefined,
  maxLen: number = PLAN_DRAFT_MAX_CHARS,
): PlanDraftValidation {
  if (typeof draft !== "string") {
    return { ok: false, reason: "empty" };
  }
  // Length check after NUL strip + newline normalize, before cap.
  const cleaned = draft.replace(/\0/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!cleaned.trim()) {
    return { ok: false, reason: "empty" };
  }
  const cap = maxLen > 0 ? maxLen : 0;
  if (cleaned.length > cap) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true };
}

export type PlanEditEmptyKind = "not_actionable" | "no_body" | "ready";

/**
 * Honesty helper: when can the plan body be edited in the review canvas?
 * Edit is offered when the exit_plan_mode gate is open (`canAct`).
 * `no_body` still allows edit (user may paste a full revised plan).
 */
export function planEditEmptyState(input: {
  canAct: boolean;
  hasBody: boolean;
}): { canEdit: boolean; kind: PlanEditEmptyKind } {
  if (!input.canAct) {
    return { canEdit: false, kind: "not_actionable" };
  }
  if (!input.hasBody) {
    return { canEdit: true, kind: "no_body" };
  }
  return { canEdit: true, kind: "ready" };
}

/**
 * Build the feedback string for request-changes.
 *
 * - When the draft is dirty: include clear markers + revised markdown;
 *   optional `userNote` is prepended.
 * - When not dirty: return trimmed `userNote` only (may be empty).
 */
export function buildRequestChangesNoteFromDraft(opts: {
  originalBody: string;
  draft: string;
  userNote?: string;
}): string {
  const userNote =
    typeof opts.userNote === "string" ? opts.userNote.trim() : "";
  const dirty = planDraftIsDirty(opts.originalBody, opts.draft);

  if (!dirty) {
    return userNote;
  }

  const revised = sanitizePlanDraft(opts.draft);
  const blocks: string[] = [];
  if (userNote) {
    blocks.push(userNote);
    blocks.push("");
  }
  blocks.push(
    "The user edited the plan in the review panel. Treat the following as the proposed revised plan:",
  );
  blocks.push("");
  blocks.push(PLAN_REVISED_MARKER_START);
  blocks.push(revised);
  blocks.push(PLAN_REVISED_MARKER_END);
  return blocks.join("\n");
}
