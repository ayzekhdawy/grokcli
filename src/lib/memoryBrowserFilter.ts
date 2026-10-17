/**
 * Pure filter helpers for Settings → Agent → Memory browser.
 *
 * Entries come from host `memory_list` (`MemoryFileEntry`); UI applies
 * free-text search + kind chips client-side without re-fetching.
 */

/** Known memory artifact kinds from host classify_memory_relative. */
export type MemoryBrowserKind =
  | "global"
  | "workspace"
  | "session"
  | "index"
  | "other";

/** Kind chip selection; `"all"` shows every kind. */
export type MemoryBrowserKindFilter = "all" | MemoryBrowserKind;

export const MEMORY_BROWSER_KIND_FILTERS: readonly MemoryBrowserKindFilter[] = [
  "all",
  "global",
  "workspace",
  "session",
  "index",
  "other",
] as const;

const KNOWN_KINDS = new Set<string>([
  "global",
  "workspace",
  "session",
  "index",
  "other",
]);

/** Minimal entry shape required for filtering (matches MemoryFileEntry). */
export type MemoryBrowserFilterEntry = {
  name: string;
  relativePath: string;
  kind: string;
  preview: string;
  workspaceSlug?: string | null;
  path?: string;
};

export type MemoryBrowserFilter = {
  /** Free-text over name / relativePath / kind / preview / workspaceSlug. */
  query?: string;
  /** Kind chip; default `"all"`. Unknown kinds treated as `"other"`. */
  kind?: MemoryBrowserKindFilter;
};

/** Normalize host kind strings to a known filter bucket. */
export function normalizeMemoryBrowserKind(kind: string): MemoryBrowserKind {
  const k = (kind || "").trim().toLowerCase();
  if (KNOWN_KINDS.has(k)) return k as MemoryBrowserKind;
  return "other";
}

/** Whether any filter is active (non-empty query or non-all kind). */
export function hasActiveMemoryBrowserFilters(
  filter: MemoryBrowserFilter | undefined,
): boolean {
  if (!filter) return false;
  if ((filter.query ?? "").trim().length > 0) return true;
  const kind = filter.kind ?? "all";
  return kind !== "all";
}

/** Per-kind counts plus total (`all`). Used for chip badges. */
export type MemoryBrowserKindCounts = Record<MemoryBrowserKindFilter, number>;

export function countMemoryEntriesByKind(
  entries: Array<{ kind: string }>,
): MemoryBrowserKindCounts {
  const counts: MemoryBrowserKindCounts = {
    all: entries.length,
    global: 0,
    workspace: 0,
    session: 0,
    index: 0,
    other: 0,
  };
  for (const e of entries) {
    counts[normalizeMemoryBrowserKind(e.kind)] += 1;
  }
  return counts;
}

/**
 * Filter memory entries by free-text query and/or kind chip.
 * Filters combine with AND. Empty/whitespace query and kind `"all"`
 * leave that dimension open. Preserves input order.
 */
export function filterMemoryEntries<T extends MemoryBrowserFilterEntry>(
  entries: T[],
  filter: MemoryBrowserFilter = {},
): T[] {
  const kind = filter.kind ?? "all";
  let out = entries;
  if (kind !== "all") {
    out = out.filter((e) => normalizeMemoryBrowserKind(e.kind) === kind);
  }
  const q = (filter.query ?? "").trim().toLowerCase();
  if (!q) return out;
  return out.filter((e) => {
    const hay = [
      e.name,
      e.relativePath,
      e.kind,
      e.preview,
      e.workspaceSlug || "",
      e.path || "",
    ]
      .join("\n")
      .toLowerCase();
    return hay.includes(q);
  });
}
