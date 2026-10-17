import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHOW_REPLY_LENGTH,
  SHOW_REPLY_LENGTH_STORAGE_KEY,
  computeMessageLength,
  countChars,
  countWords,
  loadShowReplyLengthPref,
  parseShowReplyLengthPref,
  saveShowReplyLengthPref,
  type MessageLengthStorage,
} from "./messageLength";

function memoryStorage(
  initial: Record<string, string> = {},
): MessageLengthStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

describe("countChars", () => {
  it("counts empty as 0", () => {
    expect(countChars("")).toBe(0);
  });

  it("counts ASCII including spaces and newlines", () => {
    expect(countChars("hi")).toBe(2);
    expect(countChars("a b")).toBe(3);
    expect(countChars("a\nb")).toBe(3);
  });

  it("counts Unicode code points (emoji-safe)", () => {
    expect(countChars("你好")).toBe(2);
    expect(countChars("👍")).toBe(1);
    expect(countChars("a👍b")).toBe(3);
  });
});

describe("countWords", () => {
  it("returns 0 for empty / whitespace-only", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("\n\t")).toBe(0);
  });

  it("splits Latin on whitespace runs", () => {
    expect(countWords("hello")).toBe(1);
    expect(countWords("hello world")).toBe(2);
    expect(countWords("  one   two\tthree\nfour  ")).toBe(4);
  });

  it("counts each CJK character as a word (simple CJK-friendly)", () => {
    expect(countWords("你好世界")).toBe(4);
    expect(countWords("你好 世界")).toBe(4);
    expect(countWords("你好 world")).toBe(3);
    expect(countWords("こんにちは")).toBe(5);
    expect(countWords("한글")).toBe(2);
  });
});

describe("computeMessageLength", () => {
  it("marks empty / whitespace-only as empty with zero counts", () => {
    expect(computeMessageLength("")).toEqual({
      chars: 0,
      words: 0,
      empty: true,
    });
    expect(computeMessageLength("  \n ")).toEqual({
      chars: 0,
      words: 0,
      empty: true,
    });
  });

  it("returns chars and words for non-empty text", () => {
    expect(computeMessageLength("hi there")).toEqual({
      chars: 8,
      words: 2,
      empty: false,
    });
    expect(computeMessageLength("你好")).toEqual({
      chars: 2,
      words: 2,
      empty: false,
    });
  });

  it("preserves internal whitespace in char count", () => {
    const stats = computeMessageLength("a  b");
    expect(stats.empty).toBe(false);
    expect(stats.chars).toBe(4);
    expect(stats.words).toBe(2);
  });
});

describe("show reply length preference", () => {
  it("defaults to false", () => {
    expect(DEFAULT_SHOW_REPLY_LENGTH).toBe(false);
    expect(parseShowReplyLengthPref(null)).toBe(false);
    expect(parseShowReplyLengthPref("")).toBe(false);
    expect(parseShowReplyLengthPref("maybe")).toBe(false);
    expect(loadShowReplyLengthPref(memoryStorage())).toBe(false);
  });

  it("parses true/false variants", () => {
    expect(parseShowReplyLengthPref("1")).toBe(true);
    expect(parseShowReplyLengthPref("true")).toBe(true);
    expect(parseShowReplyLengthPref(true)).toBe(true);
    expect(parseShowReplyLengthPref("0")).toBe(false);
    expect(parseShowReplyLengthPref("false")).toBe(false);
    expect(parseShowReplyLengthPref(false)).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveShowReplyLengthPref(true, s);
    expect(s.data[SHOW_REPLY_LENGTH_STORAGE_KEY]).toBe("1");
    expect(loadShowReplyLengthPref(s)).toBe(true);
    saveShowReplyLengthPref(false, s);
    expect(s.data[SHOW_REPLY_LENGTH_STORAGE_KEY]).toBe("0");
    expect(loadShowReplyLengthPref(s)).toBe(false);
  });
});
