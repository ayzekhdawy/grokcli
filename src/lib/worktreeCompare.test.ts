import { describe, expect, it } from "vitest";
import {
  COMPARE_ENTRY_DISPLAY_CAP,
  capCompareEntries,
  formatCompareSummaryLine,
  joinWorktreeRelPath,
  nameStatusLetter,
  parseNameStatus,
  planWorktreeCompare,
  summarizeCompareEntries,
} from "./worktreeCompare";

describe("planWorktreeCompare", () => {
  it("accepts distinct paths", () => {
    const plan = planWorktreeCompare({
      basePath: "/Users/me/repo",
      otherPath: "/Users/me/repo-feat",
      baseBranch: "main",
      otherBranch: "feat/x",
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.basePath).toBe("/Users/me/repo");
      expect(plan.otherPath).toBe("/Users/me/repo-feat");
      expect(plan.baseBranch).toBe("main");
      expect(plan.otherBranch).toBe("feat/x");
    }
  });

  it("soft-fails same_path (including trailing slash / case)", () => {
    const plan = planWorktreeCompare({
      basePath: "/Users/me/repo/",
      otherPath: "/Users/me/repo",
    });
    expect(plan).toMatchObject({ ok: false, reason: "same_path" });
  });

  it("soft-fails missing_path", () => {
    expect(
      planWorktreeCompare({ basePath: "", otherPath: "/x" }).ok,
    ).toBe(false);
    expect(
      planWorktreeCompare({ basePath: "/x", otherPath: null }),
    ).toMatchObject({ ok: false, reason: "missing_path" });
  });

  it("soft-fails not_git when either side unavailable", () => {
    expect(
      planWorktreeCompare({
        basePath: "/a",
        otherPath: "/b",
        baseAvailable: false,
      }),
    ).toMatchObject({ ok: false, reason: "not_git" });
    expect(
      planWorktreeCompare({
        basePath: "/a",
        otherPath: "/b",
        otherAvailable: false,
      }),
    ).toMatchObject({ ok: false, reason: "not_git" });
  });

  it("treats null available as unknown (ok when paths fine)", () => {
    const plan = planWorktreeCompare({
      basePath: "/a",
      otherPath: "/b",
      baseAvailable: null,
      otherAvailable: undefined,
    });
    expect(plan.ok).toBe(true);
  });
});

describe("parseNameStatus", () => {
  it("parses A/M/D lines", () => {
    const raw = ["A\tsrc/new.ts", "M\tREADME.md", "D\told.txt", ""].join("\n");
    const entries = parseNameStatus(raw);
    expect(entries).toEqual([
      { status: "A", path: "src/new.ts" },
      { status: "M", path: "README.md" },
      { status: "D", path: "old.txt" },
    ]);
  });

  it("parses rename and copy with score", () => {
    const raw = [
      "R100\told/name.ts\tnew/name.ts",
      "C080\tsrc/a.ts\tsrc/b.ts",
    ].join("\n");
    const entries = parseNameStatus(raw);
    expect(entries).toEqual([
      { status: "R100", path: "new/name.ts", oldPath: "old/name.ts" },
      { status: "C080", path: "src/b.ts", oldPath: "src/a.ts" },
    ]);
  });

  it("normalizes backslashes and ignores blanks", () => {
    const entries = parseNameStatus("M\tsrc\\lib\\x.ts\n\n\n");
    expect(entries).toEqual([{ status: "M", path: "src/lib/x.ts" }]);
  });

  it("returns empty for blank input", () => {
    expect(parseNameStatus("")).toEqual([]);
    expect(parseNameStatus("   \n\n")).toEqual([]);
  });
});

describe("summarizeCompareEntries + formatCompareSummaryLine", () => {
  it("buckets letters including R/C and T", () => {
    const summary = summarizeCompareEntries([
      { status: "A", path: "a" },
      { status: "A", path: "b" },
      { status: "M", path: "c" },
      { status: "T", path: "d" },
      { status: "D", path: "e" },
      { status: "R100", path: "f", oldPath: "g" },
      { status: "C050", path: "h", oldPath: "i" },
      { status: "U", path: "j" },
    ]);
    expect(summary).toEqual({
      added: 2,
      modified: 2,
      deleted: 1,
      renamed: 2,
      other: 1,
      total: 8,
    });
    expect(formatCompareSummaryLine(summary)).toBe(
      "+2 ~2 −1 →2 ?1 · 8 files",
    );
  });

  it("formats empty / singular", () => {
    expect(formatCompareSummaryLine(summarizeCompareEntries([]))).toBe(
      "No changes",
    );
    expect(
      formatCompareSummaryLine(
        summarizeCompareEntries([{ status: "M", path: "x" }]),
      ),
    ).toBe("~1 · 1 file");
  });
});

describe("nameStatusLetter", () => {
  it("extracts first letter", () => {
    expect(nameStatusLetter("R100")).toBe("R");
    expect(nameStatusLetter("m")).toBe("M");
    expect(nameStatusLetter("")).toBe("?");
  });
});

describe("capCompareEntries", () => {
  it("reports overflow honestly", () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      status: "M",
      path: `f${i}.ts`,
    }));
    const capped = capCompareEntries(entries, 5);
    expect(capped.shown).toHaveLength(5);
    expect(capped.overflow).toBe(7);
    expect(capped.total).toBe(12);
    expect(capped.cap).toBe(5);
  });

  it("no overflow under default cap", () => {
    const entries = [{ status: "A", path: "a" }];
    const capped = capCompareEntries(entries);
    expect(capped.overflow).toBe(0);
    expect(capped.cap).toBe(COMPARE_ENTRY_DISPLAY_CAP);
  });
});

describe("joinWorktreeRelPath", () => {
  it("joins root + rel", () => {
    expect(joinWorktreeRelPath("/Users/me/repo", "src/a.ts")).toBe(
      "/Users/me/repo/src/a.ts",
    );
  });

  it("rejects empty, absolute, or traversal rel", () => {
    expect(joinWorktreeRelPath("", "a")).toBeNull();
    expect(joinWorktreeRelPath("/repo", "")).toBeNull();
    expect(joinWorktreeRelPath("/repo", "/abs")).toBeNull();
    expect(joinWorktreeRelPath("/repo", "../escape")).toBeNull();
  });
});
