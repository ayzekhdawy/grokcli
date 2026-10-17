import { describe, expect, it } from "vitest";
import {
  DIFF_COMMENT_NOTE_MAX,
  buildDiffCommentPrompt,
  formatHunkSnippet,
  planDiffCommentToChat,
  stripNuls,
  validateDiffCommentNote,
} from "./diffComment";

const SAMPLE_HUNK = {
  header: "@@ -1,3 +1,3 @@",
  lines: [" line1", "-line2", "+line2-edited", " line3"],
};

describe("stripNuls", () => {
  it("removes NUL bytes", () => {
    expect(stripNuls("a\u0000b")).toBe("ab");
  });
});

describe("formatHunkSnippet", () => {
  it("includes header and body lines", () => {
    const s = formatHunkSnippet(SAMPLE_HUNK);
    expect(s).toContain("@@ -1,3 +1,3 @@");
    expect(s).toContain("-line2");
    expect(s).toContain("+line2-edited");
  });

  it("caps by maxLines and marks omission", () => {
    const many = {
      header: "@@ -1 +1 @@",
      lines: Array.from({ length: 50 }, (_, i) => `+line${i}`),
    };
    const s = formatHunkSnippet(many, 5, 4000);
    expect(s.split("\n").filter((l) => l.startsWith("+")).length).toBe(5);
    expect(s).toContain("more lines omitted");
  });

  it("caps by maxChars", () => {
    const long = {
      header: "@@ -1 +1 @@",
      lines: ["+" + "x".repeat(200)],
    };
    const s = formatHunkSnippet(long, 40, 40);
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith("…")).toBe(true);
  });

  it("strips NULs from lines", () => {
    const s = formatHunkSnippet({
      header: "@@ -1 +1 @@",
      lines: ["+hi\u0000there"],
    });
    expect(s).not.toContain("\u0000");
    expect(s).toContain("+hithere");
  });
});

describe("validateDiffCommentNote", () => {
  it("rejects empty / whitespace", () => {
    expect(validateDiffCommentNote("")).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(validateDiffCommentNote("   \n\t  ")).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(validateDiffCommentNote(null)).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("rejects too long", () => {
    const long = "a".repeat(DIFF_COMMENT_NOTE_MAX + 1);
    expect(validateDiffCommentNote(long)).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("accepts trimmed note and strips NULs", () => {
    const r = validateDiffCommentNote("  fix\u0000 this  ");
    expect(r).toEqual({ ok: true, note: "fix this" });
  });

  it("accepts note at max length", () => {
    const exact = "b".repeat(DIFF_COMMENT_NOTE_MAX);
    expect(validateDiffCommentNote(exact)).toEqual({
      ok: true,
      note: exact,
    });
  });
});

describe("buildDiffCommentPrompt", () => {
  it("includes path, header, snippet, and note", () => {
    const p = buildDiffCommentPrompt({
      path: "src/foo.ts",
      name: "foo.ts",
      hunkHeader: "@@ -1,3 +1,3 @@",
      hunkSnippet: "-old\n+new",
      note: "Prefer const here",
    });
    expect(p).toContain("src/foo.ts");
    expect(p).toContain("foo.ts");
    expect(p).toContain("@@ -1,3 +1,3 @@");
    expect(p).toContain("```diff");
    expect(p).toContain("-old");
    expect(p).toContain("Prefer const here");
    expect(p.toLowerCase()).toContain("review note");
  });

  it("redacts common secrets and strips NULs", () => {
    const p = buildDiffCommentPrompt({
      path: "a.ts",
      hunkSnippet: "sk-abcdefghijklmnopqrstuvwxyz0123456789",
      note: "token\u0000 is sk-abcdefghijklmnopqrstuvwxyz0123456789",
    });
    expect(p).not.toContain("\u0000");
    expect(p).toContain("[REDACTED]");
    expect(p).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
  });
});

describe("planDiffCommentToChat", () => {
  it("returns prompt when valid", () => {
    const r = planDiffCommentToChat({
      path: "hello.txt",
      name: "hello.txt",
      hunkHeader: SAMPLE_HUNK.header,
      hunkSnippet: formatHunkSnippet(SAMPLE_HUNK),
      note: "Rename for clarity",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.prompt).toContain("hello.txt");
      expect(r.prompt).toContain("Rename for clarity");
      expect(r.prompt).toContain("+line2-edited");
    }
  });

  it("fails empty note", () => {
    expect(
      planDiffCommentToChat({
        path: "a.ts",
        hunkSnippet: "+x",
        note: "  ",
      }),
    ).toEqual({ ok: false, reason: "empty" });
  });

  it("fails too_long note", () => {
    expect(
      planDiffCommentToChat({
        path: "a.ts",
        hunkSnippet: "+x",
        note: "z".repeat(DIFF_COMMENT_NOTE_MAX + 10),
      }),
    ).toEqual({ ok: false, reason: "too_long" });
  });

  it("fails no_path", () => {
    expect(
      planDiffCommentToChat({
        path: "  ",
        hunkSnippet: "+x",
        note: "hi",
      }),
    ).toEqual({ ok: false, reason: "no_path" });
  });

  it("fails no_snippet", () => {
    expect(
      planDiffCommentToChat({
        path: "a.ts",
        hunkSnippet: "",
        note: "hi",
      }),
    ).toEqual({ ok: false, reason: "no_snippet" });
  });
});
