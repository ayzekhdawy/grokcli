/**
 * Composer editor choice.
 *
 * `legacy` = the upstream built-in composer (default, upstream-identical).
 * `tiptap` = the experimental Markdown editor under `components/composer/tiptap`.
 *
 * The value is optional in AppSettings; a missing/unknown value means `legacy`
 * (no one-shot migration — read sites normalize).
 */
export const COMPOSER_EDITORS = ["legacy", "tiptap"] as const;

export type ComposerEditorId = (typeof COMPOSER_EDITORS)[number];

export const DEFAULT_COMPOSER_EDITOR: ComposerEditorId = "legacy";

/** Anything that is not the experimental `tiptap` id stays on the built-in editor. */
export function normalizeComposerEditor(raw: unknown): ComposerEditorId {
  return raw === "tiptap" ? "tiptap" : DEFAULT_COMPOSER_EDITOR;
}
