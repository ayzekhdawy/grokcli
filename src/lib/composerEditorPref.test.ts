import { describe, expect, it } from "vitest";
import {
  COMPOSER_EDITORS,
  DEFAULT_COMPOSER_EDITOR,
  normalizeComposerEditor,
} from "./composerEditorPref";

describe("composerEditorPref", () => {
  it("ships legacy first as the default", () => {
    expect(COMPOSER_EDITORS).toEqual(["legacy", "tiptap"]);
    expect(DEFAULT_COMPOSER_EDITOR).toBe("legacy");
  });

  it("keeps known ids and folds everything else to legacy", () => {
    expect(normalizeComposerEditor("legacy")).toBe("legacy");
    expect(normalizeComposerEditor("tiptap")).toBe("tiptap");
    expect(normalizeComposerEditor(undefined)).toBe("legacy");
    expect(normalizeComposerEditor(null)).toBe("legacy");
    expect(normalizeComposerEditor("TipTap")).toBe("legacy");
    expect(normalizeComposerEditor(42)).toBe("legacy");
  });
});
