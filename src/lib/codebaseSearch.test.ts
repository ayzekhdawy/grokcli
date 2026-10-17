import { describe, expect, it } from "vitest";
import {
  CODEBASE_SEARCH_DEFAULT_LIMIT,
  CODEBASE_SEARCH_MAX_LIMIT,
  classifyCodebaseSearchSoftFail,
  clampCodebaseSearchLimit,
  codebaseSearchMatchBadge,
  codebaseSearchMatchSummary,
  countCodebaseContentHits,
  formatCodebaseSearchSize,
  normalizeCodebaseSearchEngine,
  normalizeCodebaseSearchHits,
  normalizeCodebaseSearchMode,
  resolveCodebaseSearchEmptyState,
  resolveCodebaseSearchKind,
  shouldRunCodebaseSearch,
} from "./codebaseSearch";

describe("clampCodebaseSearchLimit", () => {
  it("defaults and clamps", () => {
    expect(clampCodebaseSearchLimit(null)).toBe(CODEBASE_SEARCH_DEFAULT_LIMIT);
    expect(clampCodebaseSearchLimit(undefined)).toBe(
      CODEBASE_SEARCH_DEFAULT_LIMIT,
    );
    expect(clampCodebaseSearchLimit(0)).toBe(1);
    expect(clampCodebaseSearchLimit(10_000)).toBe(CODEBASE_SEARCH_MAX_LIMIT);
    expect(clampCodebaseSearchLimit(25)).toBe(25);
  });
});

describe("normalizeCodebaseSearchMode", () => {
  it("maps aliases", () => {
    expect(normalizeCodebaseSearchMode(null)).toBe("all");
    expect(normalizeCodebaseSearchMode("name")).toBe("name");
    expect(normalizeCodebaseSearchMode("path")).toBe("name");
    expect(normalizeCodebaseSearchMode("content")).toBe("content");
    expect(normalizeCodebaseSearchMode("body")).toBe("content");
    expect(normalizeCodebaseSearchMode("weird")).toBe("all");
  });
});

describe("shouldRunCodebaseSearch", () => {
  it("requires non-empty trimmed query", () => {
    expect(shouldRunCodebaseSearch("")).toBe(false);
    expect(shouldRunCodebaseSearch("  ")).toBe(false);
    expect(shouldRunCodebaseSearch("foo")).toBe(true);
  });
});

describe("classifyCodebaseSearchSoftFail", () => {
  it("classifies known reasons", () => {
    expect(classifyCodebaseSearchSoftFail("path_missing")).toBe("path_missing");
    expect(classifyCodebaseSearchSoftFail("not_a_dir")).toBe("not_a_dir");
    expect(classifyCodebaseSearchSoftFail("untrusted_project")).toBe(
      "untrusted_project",
    );
    expect(classifyCodebaseSearchSoftFail("path_unreadable:io")).toBe(
      "path_unreadable",
    );
    expect(
      classifyCodebaseSearchSoftFail(null, { isTauri: false }),
    ).toBe("need_tauri");
    expect(
      classifyCodebaseSearchSoftFail(null, { projectPath: "" }),
    ).toBe("no_project");
    expect(
      classifyCodebaseSearchSoftFail(null, {
        projectPath: "/x",
        hostError: true,
      }),
    ).toBe("host_error");
    expect(
      classifyCodebaseSearchSoftFail(null, { projectPath: "/x" }),
    ).toBe(null);
  });
});

describe("resolveCodebaseSearchKind / engine honesty", () => {
  it("never invents embeddings or graph engines", () => {
    expect(resolveCodebaseSearchKind("embedding")).toBe("keyword");
    expect(resolveCodebaseSearchKind("semantic")).toBe("keyword");
    expect(resolveCodebaseSearchKind(null)).toBe("keyword");
    expect(normalizeCodebaseSearchEngine("rg")).toBe("rg");
    expect(normalizeCodebaseSearchEngine("walk")).toBe("walk");
    expect(normalizeCodebaseSearchEngine("graph")).toBe("none");
    expect(normalizeCodebaseSearchEngine("embedding")).toBe("none");
  });
});

describe("match badge and summary", () => {
  it("badges content vs name", () => {
    expect(codebaseSearchMatchBadge({ contentMatch: true }, "q")).toBe(
      "content",
    );
    expect(codebaseSearchMatchBadge({ contentMatch: false }, "q")).toBe(
      "name",
    );
    expect(codebaseSearchMatchBadge({ contentMatch: true }, "")).toBe(null);
  });

  it("summarizes hits", () => {
    const hits = [
      {
        path: "/a",
        name: "a",
        relativePath: "a",
        size: 1,
        mtimeMs: 0,
        snippet: "x",
        contentMatch: true,
      },
      {
        path: "/b",
        name: "b",
        relativePath: "b",
        size: 1,
        mtimeMs: 0,
        snippet: "",
        contentMatch: false,
      },
    ];
    expect(countCodebaseContentHits(hits)).toBe(1);
    expect(codebaseSearchMatchSummary(hits, "q")).toEqual({
      total: 2,
      contentHits: 1,
    });
    expect(codebaseSearchMatchSummary(hits, "")).toBe(null);
  });
});

describe("resolveCodebaseSearchEmptyState", () => {
  it("soft-fails without inventing semantic empty claims", () => {
    expect(
      resolveCodebaseSearchEmptyState({
        isTauri: false,
        query: "",
        searching: false,
        hitCount: 0,
      })?.kind,
    ).toBe("need_tauri");

    expect(
      resolveCodebaseSearchEmptyState({
        isTauri: true,
        projectPath: null,
        query: "x",
        searching: false,
        hitCount: 0,
      })?.kind,
    ).toBe("no_project");

    expect(
      resolveCodebaseSearchEmptyState({
        isTauri: true,
        projectPath: "/p",
        query: "x",
        searching: false,
        hitCount: 0,
        softFail: "path_missing",
      })?.kind,
    ).toBe("path_missing");

    expect(
      resolveCodebaseSearchEmptyState({
        isTauri: true,
        projectPath: "/p",
        query: "",
        searching: false,
        hitCount: 0,
      })?.kind,
    ).toBe("idle");

    expect(
      resolveCodebaseSearchEmptyState({
        isTauri: true,
        projectPath: "/p",
        query: "foo",
        searching: true,
        hitCount: 0,
      })?.kind,
    ).toBe("searching");

    const noMatch = resolveCodebaseSearchEmptyState({
      isTauri: true,
      projectPath: "/p",
      query: "foo",
      searching: false,
      hitCount: 0,
    });
    expect(noMatch?.kind).toBe("no_matches");
    expect(noMatch?.hintKey).toBe("settings.codebaseSearch.noMatchesHint");

    expect(
      resolveCodebaseSearchEmptyState({
        isTauri: true,
        projectPath: "/p",
        query: "foo",
        searching: false,
        hitCount: 3,
      }),
    ).toBe(null);
  });
});

describe("normalizeCodebaseSearchHits", () => {
  it("maps host hits without inventing content", () => {
    const hits = normalizeCodebaseSearchHits({
      hits: [
        {
          path: "/proj/src/a.ts",
          name: "a.ts",
          relativePath: "src/a.ts",
          size: 10,
          mtimeMs: 1,
          snippet: "hello",
          contentMatch: true,
          line: 4,
        },
      ],
      searchKind: "keyword",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].relativePath).toBe("src/a.ts");
    expect(hits[0].contentMatch).toBe(true);
    expect(hits[0].line).toBe(4);
  });
});

describe("formatCodebaseSearchSize", () => {
  it("formats sizes", () => {
    expect(formatCodebaseSearchSize(100)).toBe("100 B");
    expect(formatCodebaseSearchSize(2048)).toBe("2.0 KB");
    expect(formatCodebaseSearchSize(-1)).toBe("—");
  });
});
