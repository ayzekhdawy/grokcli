/**
 * Composer empty-state minimum height (General → Composer).
 * localStorage-only — no Rust AppSettings (avoids prefs schema conflicts).
 * Applied via `data-composer-min-rows` on `document.documentElement`.
 *
 * Values are approximate visible text rows (line-height 22px).
 * Default `2` matches a compact empty input without feeling cramped.
 */

export type ComposerMinRows = "2" | "3" | "5" | "8";

export const COMPOSER_MIN_ROWS_STORAGE_KEY = "grok.composerMinRows";
export const DEFAULT_COMPOSER_MIN_ROWS: ComposerMinRows = "2";
export const COMPOSER_MIN_ROWS_ATTR = "data-composer-min-rows";
/** Optional window event after save/apply (detail = preference). */
export const COMPOSER_MIN_ROWS_CHANGE_EVENT = "grok-composer-min-rows";

export const COMPOSER_MIN_ROWS_OPTIONS: readonly ComposerMinRows[] = [
  "2",
  "3",
  "5",
  "8",
] as const;

/** Content-box min-height (px) for CSS; line-height is 22px. */
export const COMPOSER_MIN_ROWS_PX: Record<ComposerMinRows, number> = {
  "2": 44,
  "3": 66,
  "5": 110,
  "8": 176,
};

export interface ComposerMinRowsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isComposerMinRows(value: unknown): value is ComposerMinRows {
  return (
    value === "2" || value === "3" || value === "5" || value === "8"
  );
}

/**
 * Accept string row tokens and bare numbers (2|3|5|8).
 * Unknown / empty → default.
 */
export function parseComposerMinRows(raw: unknown): ComposerMinRows {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return parseComposerMinRows(String(Math.trunc(raw)));
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (isComposerMinRows(trimmed)) return trimmed;
  }
  return DEFAULT_COMPOSER_MIN_ROWS;
}

export function loadComposerMinRows(
  storage: ComposerMinRowsStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): ComposerMinRows {
  try {
    return parseComposerMinRows(storage.getItem(COMPOSER_MIN_ROWS_STORAGE_KEY));
  } catch {
    return DEFAULT_COMPOSER_MIN_ROWS;
  }
}

export function saveComposerMinRows(
  rows: ComposerMinRows,
  storage: ComposerMinRowsStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): void {
  try {
    storage.setItem(COMPOSER_MIN_ROWS_STORAGE_KEY, rows);
  } catch {
    /* private mode / quota */
  }
}

/** Minimal DOM surface so unit tests need no jsdom. */
export interface ComposerMinRowsRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute?(name: string): void;
}

/**
 * Apply preference via `data-composer-min-rows`.
 * CSS: `html[data-composer-min-rows="2|3|5|8"] .composer__input { min-height: … }`.
 * Always sets the attribute so overrides apply explicitly.
 */
export function applyComposerMinRows(
  rows: ComposerMinRows,
  root: ComposerMinRowsRoot = typeof document !== "undefined"
    ? document.documentElement
    : { setAttribute: () => {} },
): void {
  root.setAttribute(COMPOSER_MIN_ROWS_ATTR, rows);
}

/** Fire optional change event for listeners (no-op outside browser). */
export function dispatchComposerMinRowsChange(rows: ComposerMinRows): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(COMPOSER_MIN_ROWS_CHANGE_EVENT, { detail: rows }),
    );
  } catch {
    /* ignore */
  }
}

/** Persist + apply (+ optional event) in one step (Settings onChange). */
export function setComposerMinRows(
  rows: ComposerMinRows,
  storage?: ComposerMinRowsStorage,
  root?: ComposerMinRowsRoot,
): void {
  saveComposerMinRows(rows, storage);
  applyComposerMinRows(rows, root);
  dispatchComposerMinRowsChange(rows);
}
