import { describe, expect, it } from "vitest";
import {
  MEMORY_BROWSER_KIND_FILTERS,
  countMemoryEntriesByKind,
  filterMemoryEntries,
  hasActiveMemoryBrowserFilters,
  normalizeMemoryBrowserKind,
  type MemoryBrowserFilterEntry,
} from "./memoryBrowserFilter";

const entries: MemoryBrowserFilterEntry[] = [
  {
    name: "MEMORY.md",
    relativePath: "MEMORY.md",
    kind: "global",
    preview: "User prefers dark mode",
    path: "/home/.grok/memory/MEMORY.md",
  },
  {
    name: "MEMORY.md",
    relativePath: "proj-abc/MEMORY.md",
    kind: "workspace",
    preview: "Repo uses TypeScript and Vitest",
    workspaceSlug: "proj-abc",
    path: "/home/.grok/memory/proj-abc/MEMORY.md",
  },
  {
    name: "sess-1.md",
    relativePath: "proj-abc/sessions/sess-1.md",
    kind: "session",
    preview: "Discussed login oauth flow",
    workspaceSlug: "proj-abc",
  },
  {
    name: "index.sqlite",
    relativePath: "proj-abc/index.sqlite",
    kind: "index",
    preview: "",
    workspaceSlug: "proj-abc",
  },
  {
    name: "notes.txt",
    relativePath: "proj-abc/notes.txt",
    kind: "other",
    preview: "scratch notes",
    workspaceSlug: "proj-abc",
  },
];

describe("normalizeMemoryBrowserKind", () => {
  it("keeps known kinds", () => {
    expect(normalizeMemoryBrowserKind("global")).toBe("global");
    expect(normalizeMemoryBrowserKind("WORKSPACE")).toBe("workspace");
    expect(normalizeMemoryBrowserKind(" session ")).toBe("session");
    expect(normalizeMemoryBrowserKind("index")).toBe("index");
    expect(normalizeMemoryBrowserKind("other")).toBe("other");
  });

  it("maps unknown / empty to other", () => {
    expect(normalizeMemoryBrowserKind("")).toBe("other");
    expect(normalizeMemoryBrowserKind("mystery")).toBe("other");
  });
});

describe("hasActiveMemoryBrowserFilters", () => {
  it("is false for empty / all", () => {
    expect(hasActiveMemoryBrowserFilters(undefined)).toBe(false);
    expect(hasActiveMemoryBrowserFilters({})).toBe(false);
    expect(hasActiveMemoryBrowserFilters({ query: "  ", kind: "all" })).toBe(
      false,
    );
  });

  it("is true for query or non-all kind", () => {
    expect(hasActiveMemoryBrowserFilters({ query: "oauth" })).toBe(true);
    expect(hasActiveMemoryBrowserFilters({ kind: "session" })).toBe(true);
  });
});

describe("countMemoryEntriesByKind", () => {
  it("counts total and per kind", () => {
    const counts = countMemoryEntriesByKind(entries);
    expect(counts.all).toBe(5);
    expect(counts.global).toBe(1);
    expect(counts.workspace).toBe(1);
    expect(counts.session).toBe(1);
    expect(counts.index).toBe(1);
    expect(counts.other).toBe(1);
  });

  it("buckets unknown kinds under other", () => {
    const counts = countMemoryEntriesByKind([{ kind: "legacy" }, { kind: "global" }]);
    expect(counts.all).toBe(2);
    expect(counts.global).toBe(1);
    expect(counts.other).toBe(1);
  });

  it("returns zeros for empty list", () => {
    expect(countMemoryEntriesByKind([])).toEqual({
      all: 0,
      global: 0,
      workspace: 0,
      session: 0,
      index: 0,
      other: 0,
    });
  });
});

describe("filterMemoryEntries", () => {
  it("returns all entries for empty filter", () => {
    expect(filterMemoryEntries(entries)).toEqual(entries);
    expect(filterMemoryEntries(entries, {})).toEqual(entries);
    expect(filterMemoryEntries(entries, { query: "  ", kind: "all" })).toEqual(
      entries,
    );
  });

  it("filters by kind chip", () => {
    expect(
      filterMemoryEntries(entries, { kind: "session" }).map((e) => e.name),
    ).toEqual(["sess-1.md"]);
    expect(
      filterMemoryEntries(entries, { kind: "index" }).map((e) => e.name),
    ).toEqual(["index.sqlite"]);
  });

  it("filters by free-text on name / path / preview / slug", () => {
    expect(
      filterMemoryEntries(entries, { query: "oauth" }).map((e) => e.name),
    ).toEqual(["sess-1.md"]);
    expect(
      filterMemoryEntries(entries, { query: "TYPESCRIPT" }).map(
        (e) => e.relativePath,
      ),
    ).toEqual(["proj-abc/MEMORY.md"]);
    expect(
      filterMemoryEntries(entries, { query: "proj-abc" }).length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      filterMemoryEntries(entries, { query: "scratch" }).map((e) => e.name),
    ).toEqual(["notes.txt"]);
  });

  it("combines query and kind with AND", () => {
    expect(
      filterMemoryEntries(entries, { query: "MEMORY", kind: "global" }).map(
        (e) => e.relativePath,
      ),
    ).toEqual(["MEMORY.md"]);
    expect(
      filterMemoryEntries(entries, { query: "MEMORY", kind: "session" }),
    ).toEqual([]);
  });

  it("returns empty when nothing matches", () => {
    expect(filterMemoryEntries(entries, { query: "zzz-no-hit" })).toEqual([]);
    expect(filterMemoryEntries(entries, { kind: "session", query: "sqlite" })).toEqual(
      [],
    );
  });

  it("preserves input order", () => {
    const hits = filterMemoryEntries(entries, { query: "proj-abc" });
    expect(hits.map((e) => e.relativePath)).toEqual([
      "proj-abc/MEMORY.md",
      "proj-abc/sessions/sess-1.md",
      "proj-abc/index.sqlite",
      "proj-abc/notes.txt",
    ]);
  });

  it("exposes kind filter chip order", () => {
    expect(MEMORY_BROWSER_KIND_FILTERS).toEqual([
      "all",
      "global",
      "workspace",
      "session",
      "index",
      "other",
    ]);
  });
});
