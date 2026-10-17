/**
 * User preference for whether completed thinking/reasoning blocks stay expanded.
 * Live streaming still auto-opens; when the turn finishes we collapse unless
 * the user prefers expanded.
 */

const STORAGE_KEY = "grok.thinkingExpanded";

/** Fired on `window` after a successful save so open Thinking blocks can re-read. */
export const THINKING_PREF_EVENT = "grok-thinking-pref";

export type ThinkingExpandPref = "auto-collapse" | "keep-open";

export function loadThinkingExpandPref(
  storage: Storage = localStorage,
): ThinkingExpandPref {
  try {
    const v = storage.getItem(STORAGE_KEY);
    if (v === "keep-open") return "keep-open";
    if (v === "auto-collapse") return "auto-collapse";
  } catch {
    /* private mode */
  }
  // Default: collapse when done (community request — focus on the answer).
  return "auto-collapse";
}

export function saveThinkingExpandPref(
  pref: ThinkingExpandPref,
  storage: Storage = localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
  // Notify live UI (Settings → Thinking blocks) without a full reload.
  // Only when writing default localStorage — unit tests inject memory Storage.
  if (
    typeof window !== "undefined" &&
    typeof localStorage !== "undefined" &&
    storage === localStorage
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(THINKING_PREF_EVENT, { detail: pref }),
      );
    } catch {
      /* ignore */
    }
  }
}

/** Whether a finished thought block should start open. */
export function thinkingDefaultOpenWhenDone(
  pref: ThinkingExpandPref = loadThinkingExpandPref(),
): boolean {
  return pref === "keep-open";
}
