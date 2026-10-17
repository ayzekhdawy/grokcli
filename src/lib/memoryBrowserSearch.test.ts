import { describe, expect, it } from "vitest";
import {
  applyMemoryBrowserKindFilter,
  buildMemoryBrowserDisplayRows,
  clampMemorySearchLimit,
  countMemoryBrowserContentHits,
  memoryBrowserMatchBadge,
  memoryBrowserMatchSummary,
  memoryEntryNameMatches,
  mergeMemoryBrowserRows,
  MEMORY_SEARCH_DEFAULT_LIMIT,
  MEMORY_SEARCH_MAX_LIMIT,
  resolveMemoryBrowserEmptyState,
  shouldRunMemoryContentSearch,
  type MemoryListEntryLike,
  type MemorySearchHitLike,
} from "./memoryBrowserSearch";

const entry = (
  partial: Partial<MemoryListEntryLike> & Pick<MemoryListEntryLike, "path" | "name">,
): MemoryListEntryLike => ({
  relativePath: partial.relativePath ?? partial.name,
  kind: partial.kind ?? "workspace",
  size: partial.size ?? 10,
  mtimeMs: partial.mtimeMs ?? 0,
  preview: partial.preview ?? "",
  matched: partial.matched ?? true,
  workspaceSlug: partial.workspaceSlug,
  path: partial.path,
  name: partial.name,
});

describe("clampMemorySearchLimit", () => {
  it("defaults and clamps", () => {
    expect(clampMemorySearchLimit(undefined)).toBe(MEMORY_SEARCH_DEFAULT_LIMIT);
    expect(clampMemorySearchLimit(null)).toBe(MEMORY_SEARCH_DEFAULT_LIMIT);
    expect(clampMemorySearchLimit(0)).toBe(1);
    expect(clampMemorySearchLimit(-3)).toBe(1);
    expect(clampMemorySearchLimit(12)).toBe(12);
    expect(clampMemorySearchLimit(999)).toBe(MEMORY_SEARCH_MAX_LIMIT);
  });
});

describe("shouldRunMemoryContentSearch", () => {
  it("requires non-empty trimmed query", () => {
    expect(shouldRunMemoryContentSearch("")).toBe(false);
    expect(shouldRunMemoryContentSearch("   ")).toBe(false);
    expect(shouldRunMemoryContentSearch(null)).toBe(false);
    expect(shouldRunMemoryContentSearch("api")).toBe(true);
  });
});

describe("memoryEntryNameMatches", () => {
  it("matches name relative path preview kind", () => {
    const e = entry({
      path: "/m/a.md",
      name: "MEMORY.md",
      relativePath: "proj/MEMORY.md",
      preview: "hello widgets",
      kind: "workspace",
    });
    expect(memoryEntryNameMatches(e, "memory")).toBe(true);
    expect(memoryEntryNameMatches(e, "WIDGETS")).toBe(true);
    expect(memoryEntryNameMatches(e, "proj/")).toBe(true);
    expect(memoryEntryNameMatches(e, "zzz")).toBe(false);
    expect(memoryEntryNameMatches(e, "")).toBe(true);
  });
});

describe("mergeMemoryBrowserRows", () => {
  const list: MemoryListEntryLike[] = [
    entry({
      path: "/m/MEMORY.md",
      name: "MEMORY.md",
      relativePath: "MEMORY.md",
      kind: "global",
      preview: "prefs",
    }),
    entry({
      path: "/m/ws/MEMORY.md",
      name: "MEMORY.md",
      relativePath: "ws/MEMORY.md",
      kind: "workspace",
      preview: "short",
      workspaceSlug: "ws",
    }),
    entry({
      path: "/m/ws/sessions/log.md",
      name: "log.md",
      relativePath: "ws/sessions/log.md",
      kind: "session",
      preview: "session log",
      workspaceSlug: "ws",
    }),
  ];

  it("returns all list rows when query empty", () => {
    const rows = mergeMemoryBrowserRows(list, [], "");
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => !r.snippet)).toBe(true);
  });

  it("prefers content hits and attaches snippets", () => {
    const hits: MemorySearchHitLike[] = [
      {
        path: "/m/ws/MEMORY.md",
        name: "MEMORY.md",
        relativePath: "ws/MEMORY.md",
        kind: "workspace",
        workspaceSlug: "ws",
        size: 100,
        mtimeMs: 1,
        snippet: "…deep unique-body-fact here…",
        contentMatch: true,
        matched: true,
      },
      {
        path: "/m/MEMORY.md",
        name: "MEMORY.md",
        relativePath: "MEMORY.md",
        kind: "global",
        size: 10,
        mtimeMs: 1,
        snippet: "",
        contentMatch: false,
        matched: true,
      },
    ];
    const rows = mergeMemoryBrowserRows(list, hits, "unique-body-fact");
    expect(rows[0]?.path).toBe("/m/ws/MEMORY.md");
    expect(rows[0]?.contentMatch).toBe(true);
    expect(rows[0]?.snippet).toContain("unique-body-fact");
    expect(rows.some((r) => r.path === "/m/MEMORY.md")).toBe(true);
  });

  it("includes client name matches not yet in hits", () => {
    const rows = mergeMemoryBrowserRows(list, [], "sessions");
    expect(rows.some((r) => r.relativePath.includes("sessions"))).toBe(true);
  });

  it("can surface host-only hits missing from list", () => {
    const hits: MemorySearchHitLike[] = [
      {
        path: "/m/extra.md",
        name: "extra.md",
        relativePath: "extra.md",
        kind: "other",
        size: 1,
        mtimeMs: 0,
        snippet: "hit body",
        contentMatch: true,
        matched: true,
      },
    ];
    const rows = mergeMemoryBrowserRows(list, hits, "hit");
    expect(rows.some((r) => r.path === "/m/extra.md" && r.fromSearch)).toBe(true);
  });
});

describe("applyMemoryBrowserKindFilter", () => {
  it("passes through for all", () => {
    const rows = mergeMemoryBrowserRows(
      [
        entry({ path: "/a", name: "a", kind: "global" }),
        entry({ path: "/b", name: "b", kind: "session" }),
      ],
      [],
      "",
    );
    expect(applyMemoryBrowserKindFilter(rows, "all")).toHaveLength(2);
  });

  it("filters by normalized kind", () => {
    const rows = [
      entry({ path: "/a", name: "a", kind: "GLOBAL" }),
      entry({ path: "/b", name: "b", kind: "session" }),
      entry({ path: "/c", name: "c", kind: "mystery" }),
    ];
    expect(applyMemoryBrowserKindFilter(rows, "global").map((r) => r.path)).toEqual([
      "/a",
    ]);
    expect(applyMemoryBrowserKindFilter(rows, "other").map((r) => r.path)).toEqual([
      "/c",
    ]);
  });
});

describe("buildMemoryBrowserDisplayRows", () => {
  const list: MemoryListEntryLike[] = [
    entry({
      path: "/m/MEMORY.md",
      name: "MEMORY.md",
      relativePath: "MEMORY.md",
      kind: "global",
      preview: "prefs",
    }),
    entry({
      path: "/m/ws/MEMORY.md",
      name: "MEMORY.md",
      relativePath: "ws/MEMORY.md",
      kind: "workspace",
      preview: "short",
      workspaceSlug: "ws",
    }),
    entry({
      path: "/m/ws/sessions/log.md",
      name: "log.md",
      relativePath: "ws/sessions/log.md",
      kind: "session",
      preview: "session log",
      workspaceSlug: "ws",
    }),
  ];

  it("applies kind after empty-query list", () => {
    const rows = buildMemoryBrowserDisplayRows(list, [], "", "session");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("session");
  });

  it("applies kind after content merge (regression: kind chips on search)", () => {
    const hits: MemorySearchHitLike[] = [
      {
        path: "/m/ws/MEMORY.md",
        name: "MEMORY.md",
        relativePath: "ws/MEMORY.md",
        kind: "workspace",
        workspaceSlug: "ws",
        size: 100,
        mtimeMs: 1,
        snippet: "…body…",
        contentMatch: true,
        matched: true,
      },
      {
        path: "/m/ws/sessions/log.md",
        name: "log.md",
        relativePath: "ws/sessions/log.md",
        kind: "session",
        workspaceSlug: "ws",
        size: 10,
        mtimeMs: 1,
        snippet: "…body…",
        contentMatch: true,
        matched: true,
      },
    ];
    const rows = buildMemoryBrowserDisplayRows(list, hits, "body", "session");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.path).toBe("/m/ws/sessions/log.md");
    expect(rows[0]?.contentMatch).toBe(true);
  });
});

describe("memoryBrowserMatchBadge / summary", () => {
  it("badges content vs name under active query", () => {
    expect(memoryBrowserMatchBadge({ contentMatch: true }, "api")).toBe("content");
    expect(memoryBrowserMatchBadge({ contentMatch: false }, "api")).toBe("name");
    expect(memoryBrowserMatchBadge({ contentMatch: true }, "")).toBe(null);
  });

  it("counts content hits and builds summary", () => {
    const rows = [
      { ...entry({ path: "/a", name: "a" }), contentMatch: true },
      { ...entry({ path: "/b", name: "b" }), contentMatch: false },
    ];
    expect(countMemoryBrowserContentHits(rows)).toBe(1);
    expect(memoryBrowserMatchSummary(rows, "x", "all")).toEqual({
      total: 2,
      contentHits: 1,
      queryActive: true,
      kindActive: false,
    });
    expect(memoryBrowserMatchSummary(rows, "", "all")).toBe(null);
    expect(memoryBrowserMatchSummary([], "x", "all")).toBe(null);
  });
});

describe("resolveMemoryBrowserEmptyState", () => {
  const base = {
    experimentalMemory: true,
    loading: false,
    searching: false,
    entryCount: 3,
    rowCount: 0,
    query: "",
    kind: "all" as const,
    embedConfigured: null as boolean | null,
  };

  it("returns null when rows exist", () => {
    expect(
      resolveMemoryBrowserEmptyState({ ...base, rowCount: 2 }),
    ).toBe(null);
  });

  it("memory off", () => {
    const r = resolveMemoryBrowserEmptyState({
      ...base,
      experimentalMemory: false,
      entryCount: 0,
    });
    expect(r?.kind).toBe("off");
    expect(r?.titleKey).toBe("settings.memoryBrowser.off");
    expect(r?.showClearFilters).toBe(false);
  });

  it("loading empty catalog", () => {
    const r = resolveMemoryBrowserEmptyState({
      ...base,
      loading: true,
      entryCount: 0,
    });
    expect(r?.kind).toBe("loading");
  });

  it("empty catalog with honest hint", () => {
    const r = resolveMemoryBrowserEmptyState({
      ...base,
      entryCount: 0,
    });
    expect(r?.kind).toBe("empty_catalog");
    expect(r?.hintKey).toBe("settings.memoryBrowser.emptyHint");
  });

  it("searching with no interim matches", () => {
    const r = resolveMemoryBrowserEmptyState({
      ...base,
      query: "oauth",
      searching: true,
    });
    expect(r?.kind).toBe("searching");
    expect(r?.hintKey).toBe("settings.memoryBrowser.searchingHint");
    expect(r?.showClearFilters).toBe(false);
  });

  it("kind-only filtered empty offers clear", () => {
    const r = resolveMemoryBrowserEmptyState({
      ...base,
      kind: "index",
    });
    expect(r?.kind).toBe("filtered");
    expect(r?.hintKey).toBe("settings.memoryBrowser.filterEmptyHintKind");
    expect(r?.showClearFilters).toBe(true);
  });

  it("kind + query filtered empty", () => {
    const r = resolveMemoryBrowserEmptyState({
      ...base,
      kind: "session",
      query: "zzz",
    });
    expect(r?.kind).toBe("filtered");
    expect(r?.hintKey).toBe("settings.memoryBrowser.filterEmptyHint");
  });

  it("no matches keyword honesty when embed unset", () => {
    const r = resolveMemoryBrowserEmptyState({
      ...base,
      query: "nope",
      embedConfigured: false,
    });
    expect(r?.kind).toBe("no_matches");
    expect(r?.hintKey).toBe("settings.memoryBrowser.searchEmptyHintKeyword");
    expect(r?.showEmbedLink).toBe(true);
    expect(r?.showClearFilters).toBe(true);
  });

  it("no matches hybrid_unavailable honesty when embed on", () => {
    const r = resolveMemoryBrowserEmptyState({
      ...base,
      query: "nope",
      embedConfigured: true,
    });
    expect(r?.kind).toBe("no_matches");
    expect(r?.hintKey).toBe(
      "settings.memoryBrowser.searchEmptyHintHybridUnavailable",
    );
    expect(r?.showEmbedLink).toBe(true);
  });

  it("no matches neutral keyword hint when embed unknown", () => {
    expect(
      resolveMemoryBrowserEmptyState({
        ...base,
        query: "nope",
        embedConfigured: null,
      })?.hintKey,
    ).toBe("settings.memoryBrowser.searchEmptyHint");
    expect(
      resolveMemoryBrowserEmptyState({
        ...base,
        query: "nope",
        embedConfigured: null,
      })?.showEmbedLink,
    ).toBe(false);
  });
});
