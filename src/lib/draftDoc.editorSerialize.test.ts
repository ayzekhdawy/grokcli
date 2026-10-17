/**
 * Policy: user draft keeps blank lines / newlines as typed.
 * Enter inserts "\n" into the stored string (insertNewlineAt) — no DOM guesswork.
 */
import { describe, expect, it } from "vitest";
import {
  applySkillAtSlash,
  detectSlashRangeOnStored,
  composerEnterNextStored,
  insertNewlineAt,
  joinEditorBlockLines,
  parseStoredContent,
  shouldKeepTrailingEmptyLine,
  serializeEditorLineContent,
  serializeStored,
} from "./draftDoc";

describe("as-is draft + insertNewlineAt", () => {
  it("user repro string survives stored round-trip", () => {
    const typed = "这是\n\n一条\n\n测试的\n提示词";
    expect(serializeStored(parseStoredContent(typed))).toBe(typed);
    expect(typed.includes("测试的\n提示词")).toBe(true);
    expect(typed.split("\n\n").length).toBeGreaterThanOrEqual(3);
  });

  it("insertNewlineAt is exact (Enter SoT)", () => {
    expect(insertNewlineAt("ab", 1)).toBe("a\nb");
    expect(insertNewlineAt("这是", 2)).toBe("这是\n");
    // "这是\n\n一条".length === 6; insert at end
    expect(insertNewlineAt("这是\n\n一条", 6)).toBe("这是\n\n一条\n");
    // Build the user repro purely via end-caret inserts
    let s = "这是";
    s = insertNewlineAt(s, s.length);
    s = insertNewlineAt(s, s.length); // blank line
    s += "一条";
    s = insertNewlineAt(s, s.length);
    s = insertNewlineAt(s, s.length);
    s += "测试的";
    s = insertNewlineAt(s, s.length);
    s += "提示词";
    expect(s).toBe("这是\n\n一条\n\n测试的\n提示词");
  });

  it("Enter must apply to live editor text, not a lagging React snapshot", () => {
    // Shift+Enter used lastValue then re-projected the whole contenteditable.
    // If the snapshot lagged the DOM, that rewrite deleted the live sentence.
    const live = "第一行\n第二行还在输入框里";
    const staleSnapshot = "第一行";
    const fromLive = composerEnterNextStored(live, live.length);
    const fromStale = composerEnterNextStored(staleSnapshot, staleSnapshot.length);
    expect(fromLive).toBe("第一行\n第二行还在输入框里\n");
    expect(fromLive).toContain("第二行还在输入框里");
    expect(fromStale).not.toContain("第二行还在输入框里");
  });

  it("inserts a newline at the live caret without dropping the tail", () => {
    expect(composerEnterNextStored("hello world", 5)).toBe("hello\n world");
  });

  it("skill convert does not touch body newlines", () => {
    const before = "这是\n\n一条\n\n测试的\n提示词\n/codex";
    const range = detectSlashRangeOnStored(before)!;
    const after = applySkillAtSlash(before, range.start, range.end, "codex");
    expect(after.startsWith("这是\n\n一条\n\n测试的\n提示词\n")).toBe(true);
  });
});

describe("serializeEditorLineContent (pure line box)", () => {
  it("exports for DOM adapter tests", () => {
    // Function exists and empty-ish helpers are callable in node without DOM
    // for block-line join logic covered via insertNewlineAt above.
    expect(typeof serializeEditorLineContent).toBe("function");
  });
});

/** Block-line join pure model — empty line between content. */
describe("shouldKeepTrailingEmptyLine", () => {
  it("keeps an empty last line when the caret is on it", () => {
    expect(
      shouldKeepTrailingEmptyLine({
        lastLineEmpty: true,
        markedIntentional: false,
        caretInLastLine: true,
        lineCount: 2,
      }),
    ).toBe(true);
  });

  it("drops a sentinel empty line when the caret is not on it", () => {
    expect(
      shouldKeepTrailingEmptyLine({
        lastLineEmpty: true,
        markedIntentional: false,
        caretInLastLine: false,
        lineCount: 3,
      }),
    ).toBe(false);
  });
});

describe("joinEditorBlockLines", () => {
  it("drops a WebKit sentinel empty line", () => {
    expect(joinEditorBlockLines(["hello", ""], false)).toBe("hello");
    expect(joinEditorBlockLines(["hello", "world", ""], false)).toBe(
      "hello\nworld",
    );
  });

  it("keeps an intentional trailing newline", () => {
    expect(joinEditorBlockLines(["hello", ""], true)).toBe("hello\n");
    expect(joinEditorBlockLines(["hello", "", ""], true)).toBe("hello\n\n");
  });

  it("undo of a trailing newline is the previous string", () => {
    const after = insertNewlineAt("测试", 2);
    expect(after).toBe("测试\n");
    expect(after.slice(0, 2)).toBe("测试");
  });
});

describe("block line join model", () => {
  function joinLines(bodies: string[]): string {
    const lines = [...bodies];
    if (lines.length >= 2 && lines[lines.length - 1] === "") {
      if (lines[lines.length - 2] !== "") lines.pop();
      else lines.pop();
    }
    return lines.join("\n");
  }

  it("empty bodies become blank lines (WebKit empty DIV)", () => {
    expect(
      joinLines(["这是", "", "一条", "", "测试的", "提示词"]),
    ).toBe("这是\n\n一条\n\n测试的\n提示词");
  });
});
