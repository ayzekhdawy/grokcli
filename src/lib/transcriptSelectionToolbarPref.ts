/**
 * User preference: floating copy / add-to-chat bar after selecting
 * transcript text. localStorage-only — does not touch Host AppSettings.
 * Default: true (current behavior). Right-click context menu is independent.
 */

export const TRANSCRIPT_SELECTION_TOOLBAR_STORAGE_KEY =
  "grok.transcriptSelectionToolbar";

/** Fired on `window` after a successful save (detail = boolean enabled). */
export const TRANSCRIPT_SELECTION_TOOLBAR_CHANGE_EVENT =
  "grok-transcript-selection-toolbar-change";

export const DEFAULT_TRANSCRIPT_SELECTION_TOOLBAR = true;

/** Minimal storage surface so unit tests need no jsdom. */
export interface TranscriptSelectionToolbarStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): TranscriptSelectionToolbarStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → default true. */
export function parseTranscriptSelectionToolbarPref(raw: unknown): boolean {
  if (raw === "0" || raw === "false" || raw === false) return false;
  if (raw === "1" || raw === "true" || raw === true) return true;
  return DEFAULT_TRANSCRIPT_SELECTION_TOOLBAR;
}

export function loadTranscriptSelectionToolbarPref(
  storage: TranscriptSelectionToolbarStorage = defaultStorage(),
): boolean {
  try {
    return parseTranscriptSelectionToolbarPref(
      storage.getItem(TRANSCRIPT_SELECTION_TOOLBAR_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_TRANSCRIPT_SELECTION_TOOLBAR;
  }
}

export function saveTranscriptSelectionToolbarPref(
  enabled: boolean,
  storage: TranscriptSelectionToolbarStorage = defaultStorage(),
): void {
  try {
    storage.setItem(
      TRANSCRIPT_SELECTION_TOOLBAR_STORAGE_KEY,
      enabled ? "1" : "0",
    );
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(TRANSCRIPT_SELECTION_TOOLBAR_CHANGE_EVENT, {
          detail: enabled,
        }),
      );
    } catch {
      /* ignore */
    }
  }
}
