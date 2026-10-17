import { describe, expect, it } from "vitest";
import {
  PLAN_DRAFT_MAX_CHARS,
  PLAN_REVISED_MARKER_END,
  PLAN_REVISED_MARKER_START,
  buildRequestChangesNoteFromDraft,
  planDraftIsDirty,
  planEditEmptyState,
  sanitizePlanDraft,
  validatePlanDraft,
} from "./planEditCanvas";

describe("sanitizePlanDraft", () => {
  it("returns empty for non-strings", () => {
    expect(sanitizePlanDraft(null)).toBe("");
    expect(sanitizePlanDraft(undefined)).toBe("");
  });

  it("strips NULs", () => {
    expect(sanitizePlanDraft("a\0b\0c")).toBe("abc");
  });

  it("normalizes CRLF and bare CR to LF", () => {
    expect(sanitizePlanDraft("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("preserves interior whitespace and trailing newlines", () => {
    expect(sanitizePlanDraft("  hello  \n")).toBe("  hello  \n");
  });

  it("caps length", () => {
    const long = "x".repeat(PLAN_DRAFT_MAX_CHARS + 50);
    expect(sanitizePlanDraft(long).length).toBe(PLAN_DRAFT_MAX_CHARS);
    expect(sanitizePlanDraft("abcdef", 3)).toBe("abc");
  });
});

describe("planDraftIsDirty", () => {
  it("false when equal after sanitize", () => {
    expect(planDraftIsDirty("# Plan\n", "# Plan\n")).toBe(false);
    expect(planDraftIsDirty("a\r\nb", "a\nb")).toBe(false);
    expect(planDraftIsDirty("a\0b", "ab")).toBe(false);
  });

  it("true when content differs", () => {
    expect(planDraftIsDirty("# A", "# B")).toBe(true);
    expect(planDraftIsDirty("", "x")).toBe(true);
    expect(planDraftIsDirty("x", "")).toBe(true);
  });
});

describe("validatePlanDraft", () => {
  it("rejects empty / whitespace", () => {
    expect(validatePlanDraft("")).toEqual({ ok: false, reason: "empty" });
    expect(validatePlanDraft("  \n\t  ")).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(validatePlanDraft(null)).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects too long", () => {
    const long = "y".repeat(PLAN_DRAFT_MAX_CHARS + 1);
    expect(validatePlanDraft(long)).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("accepts normal markdown", () => {
    expect(validatePlanDraft("# Hello\n\n- step")).toEqual({ ok: true });
  });
});

describe("planEditEmptyState", () => {
  it("not actionable without gate", () => {
    expect(planEditEmptyState({ canAct: false, hasBody: true })).toEqual({
      canEdit: false,
      kind: "not_actionable",
    });
  });

  it("allows edit with empty body (paste full plan)", () => {
    expect(planEditEmptyState({ canAct: true, hasBody: false })).toEqual({
      canEdit: true,
      kind: "no_body",
    });
  });

  it("ready when gate open and body present", () => {
    expect(planEditEmptyState({ canAct: true, hasBody: true })).toEqual({
      canEdit: true,
      kind: "ready",
    });
  });
});

describe("buildRequestChangesNoteFromDraft", () => {
  it("returns only user note when draft is not dirty", () => {
    expect(
      buildRequestChangesNoteFromDraft({
        originalBody: "# Plan",
        draft: "# Plan",
        userNote: "  tweak steps  ",
      }),
    ).toBe("tweak steps");
    expect(
      buildRequestChangesNoteFromDraft({
        originalBody: "# Plan",
        draft: "# Plan",
      }),
    ).toBe("");
  });

  it("includes revised plan markers when dirty", () => {
    const note = buildRequestChangesNoteFromDraft({
      originalBody: "# Old",
      draft: "# New plan\n\n1. Do it",
    });
    expect(note).toContain(PLAN_REVISED_MARKER_START);
    expect(note).toContain(PLAN_REVISED_MARKER_END);
    expect(note).toContain("# New plan\n\n1. Do it");
    expect(note).toMatch(/user edited the plan/i);
  });

  it("prepends user note before revised plan", () => {
    const note = buildRequestChangesNoteFromDraft({
      originalBody: "a",
      draft: "b",
      userNote: "Prefer tests first",
    });
    expect(note.startsWith("Prefer tests first")).toBe(true);
    expect(note.indexOf("Prefer tests first")).toBeLessThan(
      note.indexOf(PLAN_REVISED_MARKER_START),
    );
    expect(note).toContain("b");
  });

  it("sanitizes draft body in the note", () => {
    const note = buildRequestChangesNoteFromDraft({
      originalBody: "a",
      draft: "line1\r\nline2\0x",
    });
    expect(note).toContain("line1\nline2x");
    expect(note).not.toContain("\0");
    expect(note).not.toContain("\r");
  });
});
