import { describe, expect, it } from "vitest";
import {
  RESOURCE_TREE_VIRTUALIZE_THRESHOLD,
  TREE_WIDTH_DEFAULT,
  TREE_WIDTH_MAX,
  TREE_WIDTH_MIN,
  clampTreeWidth,
  ancestorRelativePaths,
  expandKeysForResourcePath,
  expandKeysForResourceTreeFilter,
  filterResourceTreeNodes,
  flattenVisibleResourceTree,
  loadTreeExpanded,
  loadTreeWidth,
  mergeTreeExpandedForFilter,
  persistTreeWidth,
  replaceResourceTreeChildren,
  saveTreeExpanded,
  sessionChangePathsKey,
  type ResourceTreeNodeLike,
} from "./resourceTree";

function memStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  } as Storage;
}

const sample: ResourceTreeNodeLike[] = [
  {
    name: "src",
    relativePath: "src",
    isDir: true,
    children: [
      {
        name: "App.tsx",
        relativePath: "src/App.tsx",
        isDir: false,
      },
      {
        name: "lib",
        relativePath: "src/lib",
        isDir: true,
        children: [
          {
            name: "resourceTabs.ts",
            relativePath: "src/lib/resourceTabs.ts",
            isDir: false,
          },
        ],
      },
    ],
  },
  {
    name: "README.md",
    relativePath: "README.md",
    isDir: false,
  },
];

describe("clampTreeWidth / persistTreeWidth / loadTreeWidth", () => {
  it("clamps to min/max and container fraction", () => {
    expect(clampTreeWidth(50, 800)).toBe(TREE_WIDTH_MIN);
    expect(clampTreeWidth(9999, 800)).toBe(
      Math.min(TREE_WIDTH_MAX, Math.floor(800 * 0.55)),
    );
    expect(clampTreeWidth(200, 800)).toBe(200);
    expect(clampTreeWidth(Number.NaN, 800)).toBe(TREE_WIDTH_DEFAULT);
  });

  it("persists rounded clamped width", () => {
    const s = memStorage();
    const w = persistTreeWidth(199.6, 800, s);
    expect(w).toBe(200);
    expect(loadTreeWidth(s)).toBe(200);
  });

  it("loadTreeWidth falls back on garbage", () => {
    const s = memStorage({ "grok-app.resourceTreeWidth": "nope" });
    expect(loadTreeWidth(s)).toBe(TREE_WIDTH_DEFAULT);
  });
});

describe("tree expand persist", () => {
  it("round-trips expanded keys", () => {
    const s = memStorage();
    saveTreeExpanded("/proj", { "": true, src: true, "src/lib": true }, s);
    expect(loadTreeExpanded("/proj", s)).toEqual({
      "": true,
      src: true,
      "src/lib": true,
    });
  });

  it("always keeps root open on empty storage", () => {
    expect(loadTreeExpanded("/x", memStorage())).toEqual({ "": true });
  });
});

describe("filterResourceTreeNodes", () => {
  it("returns all when query empty", () => {
    expect(filterResourceTreeNodes(sample, "")).toBe(sample);
  });

  it("keeps ancestors of matching files", () => {
    const filtered = filterResourceTreeNodes(sample, "resourceTabs");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.name).toBe("src");
    expect(filtered[0]!.children).toHaveLength(1);
    expect(filtered[0]!.children![0]!.name).toBe("lib");
    expect(filtered[0]!.children![0]!.children![0]!.name).toBe(
      "resourceTabs.ts",
    );
  });

  it("matches by basename", () => {
    const filtered = filterResourceTreeNodes(sample, "readme");
    expect(filtered.map((n) => n.name)).toEqual(["README.md"]);
  });
});

describe("flattenVisibleResourceTree", () => {
  it("omits children of collapsed dirs", () => {
    const rows = flattenVisibleResourceTree(sample, { "": true });
    expect(rows.map((r) => r.node.relativePath)).toEqual(["src", "README.md"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 0]);
  });

  it("walks expanded dirs in depth-first order", () => {
    const rows = flattenVisibleResourceTree(sample, {
      "": true,
      src: true,
      "src/lib": true,
    });
    expect(rows.map((r) => r.node.relativePath)).toEqual([
      "src",
      "src/App.tsx",
      "src/lib",
      "src/lib/resourceTabs.ts",
      "README.md",
    ]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 2, 0]);
  });

  it("include skips a node and its descendants", () => {
    const rows = flattenVisibleResourceTree(
      sample,
      { "": true, src: true, "src/lib": true },
      (n) => n.isDir === true || n.name.toLowerCase().includes("readme"),
    );
    expect(rows.map((r) => r.node.relativePath)).toEqual([
      "src",
      "src/lib",
      "README.md",
    ]);
  });

  it("windowing threshold is below a 5000-row expanded listing", () => {
    const many: ResourceTreeNodeLike[] = Array.from({ length: 5000 }, (_, i) => ({
      name: `f${i}.ts`,
      relativePath: `f${i}.ts`,
      isDir: false,
    }));
    const rows = flattenVisibleResourceTree(many, { "": true });
    expect(rows).toHaveLength(5000);
    expect(rows.length).toBeGreaterThan(RESOURCE_TREE_VIRTUALIZE_THRESHOLD);
  });
});

describe("expandKeysForResourcePath", () => {
  it("lists ancestors and optionally the dir itself", () => {
    expect(ancestorRelativePaths("src/lib/a.ts")).toEqual([
      "src",
      "src/lib",
      "src/lib/a.ts",
    ]);
    expect(expandKeysForResourcePath("src/lib/a.ts")).toEqual([
      "src",
      "src/lib",
    ]);
    expect(
      expandKeysForResourcePath("src/lib", { includeSelfIfDir: true }),
    ).toEqual(["src", "src/lib"]);
  });
});

describe("expandKeysForResourceTreeFilter / mergeTreeExpandedForFilter", () => {
  it("forces ancestor dirs open for hits", () => {
    const keys = expandKeysForResourceTreeFilter(sample, "resourceTabs");
    expect(keys).toEqual(expect.arrayContaining(["src", "src/lib"]));
  });

  it("merge does not collapse existing expands", () => {
    const merged = mergeTreeExpandedForFilter(
      { "": true, other: true },
      ["src", "src/lib"],
    );
    expect(merged).toEqual({
      "": true,
      other: true,
      src: true,
      "src/lib": true,
    });
  });
});

describe("session change tree soft-refresh (#863)", () => {
  it("sessionChangePathsKey is stable and ignores blanks", () => {
    expect(sessionChangePathsKey(["b", "a", "a", ""])).toBe("a\nb");
    expect(sessionChangePathsKey([])).toBe("");
    expect(sessionChangePathsKey(null)).toBe("");
  });

  it("replaceResourceTreeChildren swaps root or a nested dir", () => {
    const nextRoot = replaceResourceTreeChildren(sample, "", [
      { name: "new.ts", relativePath: "new.ts", isDir: false },
    ]);
    expect(nextRoot.map((n) => n.name)).toEqual(["new.ts"]);

    const withLib = replaceResourceTreeChildren(sample, "src/lib", [
      {
        name: "resourceTabs.ts",
        relativePath: "src/lib/resourceTabs.ts",
        isDir: false,
      },
      { name: "fresh.ts", relativePath: "src/lib/fresh.ts", isDir: false },
    ]);
    const lib = withLib
      .find((n) => n.relativePath === "src")!
      .children!.find((n) => n.relativePath === "src/lib")!;
    expect(lib.children!.map((c) => c.name)).toEqual([
      "resourceTabs.ts",
      "fresh.ts",
    ]);
  });
});

