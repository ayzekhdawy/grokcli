/**
 * Chat fenced-code font scale (Appearance → Interface).
 * localStorage-only — no Rust AppSettings (avoids prefs schema conflicts).
 * Applied via `data-code-font` on `document.documentElement`.
 */

export type CodeFontScale = "sm" | "md" | "lg";

export const CODE_FONT_SCALE_STORAGE_KEY = "grok.codeFontScale";
export const DEFAULT_CODE_FONT_SCALE: CodeFontScale = "md";

export const CODE_FONT_SCALES: readonly CodeFontScale[] = [
  "sm",
  "md",
  "lg",
] as const;

/** Pixel values for CSS var --code-fs (chat code blocks / pre). */
export type CodeFontScaleVars = {
  fs: number;
};

const SCALE_VARS: Record<CodeFontScale, CodeFontScaleVars> = {
  sm: { fs: 11.5 },
  md: { fs: 12.5 },
  lg: { fs: 14 },
};

export interface CodeFontScaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isCodeFontScale(value: unknown): value is CodeFontScale {
  return value === "sm" || value === "md" || value === "lg";
}

export function parseCodeFontScale(raw: unknown): CodeFontScale {
  if (typeof raw === "string" && isCodeFontScale(raw)) return raw;
  return DEFAULT_CODE_FONT_SCALE;
}

export function codeFontScaleVars(scale: CodeFontScale): CodeFontScaleVars {
  return SCALE_VARS[scale] ?? SCALE_VARS[DEFAULT_CODE_FONT_SCALE];
}

export function loadCodeFontScale(
  storage: CodeFontScaleStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): CodeFontScale {
  try {
    return parseCodeFontScale(storage.getItem(CODE_FONT_SCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_CODE_FONT_SCALE;
  }
}

export function saveCodeFontScale(
  scale: CodeFontScale,
  storage: CodeFontScaleStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): void {
  try {
    storage.setItem(CODE_FONT_SCALE_STORAGE_KEY, scale);
  } catch {
    /* private mode / quota */
  }
}

/** Minimal DOM surface so unit tests need no jsdom. */
export interface CodeFontScaleRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute?(name: string): void;
}

/**
 * Apply scale via `data-code-font` (html[data-code-font] .code-block / pre).
 * Always sets the attribute so sm/md/lg are explicit and CSS overrides apply.
 */
export function applyCodeFontScale(
  scale: CodeFontScale,
  root: CodeFontScaleRoot = typeof document !== "undefined"
    ? document.documentElement
    : { setAttribute: () => {} },
): void {
  root.setAttribute("data-code-font", scale);
}

/** Persist + apply in one step (Settings onChange). */
export function setCodeFontScale(
  scale: CodeFontScale,
  storage?: CodeFontScaleStorage,
  root?: CodeFontScaleRoot,
): void {
  saveCodeFontScale(scale, storage);
  applyCodeFontScale(scale, root);
}
