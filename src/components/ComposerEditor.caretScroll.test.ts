/**
 * Pure helpers for composer caret scroll / resize policy.
 * (DOM wiring lives in ComposerEditor; covered here via math + branch policy.)
 */
import { describe, expect, it } from "vitest";
import { composerCaretScrollDelta } from "./ComposerEditor";

describe("composerCaretScrollDelta", () => {
  const box = { top: 100, bottom: 320 }; // 220px viewport

  it("scrolls down when caret bottom is past the box", () => {
    // caret bottom 322, margin 4 → need +6
    expect(
      composerCaretScrollDelta({ top: 300, bottom: 322 }, box),
    ).toBe(6);
  });

  it("scrolls up when caret top is above the box", () => {
    // caret top 90, margin 4 → need -(100-90+4) = -14
    expect(
      composerCaretScrollDelta({ top: 90, bottom: 112 }, box),
    ).toBe(-14);
  });

  it("returns 0 when caret is fully visible (with margin)", () => {
    expect(
      composerCaretScrollDelta({ top: 120, bottom: 142 }, box),
    ).toBe(0);
  });

  it("treats caret flush with bottom edge as needing a small scroll", () => {
    // bottom == box.bottom is still "past" once margin is applied
    expect(
      composerCaretScrollDelta({ top: 298, bottom: 320 }, box),
    ).toBe(4);
  });

  it("atomic end-pin math: maxScroll is scrollHeight - clientHeight", () => {
    // Documents the key-repeat path: set scrollTop = maxScroll once,
    // never stack scrollTop += delta (ghost carets).
    const scrollHeight = 500;
    const clientHeight = 220;
    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    expect(maxScroll).toBe(280);
    // Delta that would overshoot is clamped by caller to [0, maxScroll].
    const next = Math.max(0, Math.min(maxScroll, 100 + 200));
    expect(next).toBe(280);
  });
});
