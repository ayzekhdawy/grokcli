/**
 * Pure helpers for Settings → Agent → Memory browser content search.
 *
 * Host `memory_search` scans file bodies under GROK_HOME/memory (capped);
 * the UI merges list rows with search hits and shows redacted snippets.
 *
 * App browser search is always keyword — never invents embeddings.
 * CLI hybrid needs embedding.model (see memoryEmbedConfig).
 */

import {
  hasActiveMemoryBrowserFilters,
  normalizeMemoryBrowserKind,
  type MemoryBrowserKindFilter,
} from "./memoryBrowserFilter";

export const MEMORY_SEARCH_DEFAULT_LIMIT = 50;
export const MEMORY_SEARCH_MAX_LIMIT = 50;
/** Debounce before calling host content search (ms). */
export const MEMORY_SEARCH_DEBOUNCE_MS = 280;

export type MemorySearchHitLike = {
  path: string;
  name: string;
  relativePath: string;
  kind: string;
  workspaceSlug?: string | null;
  size: number;
  mtimeMs: number;
  snippet: string;
  contentMatch: boolean;
  matched: boolean;
};

export type MemoryListEntryLike = {
  path: string;
  name: string;
  relativePath: string;
  kind: string;
  workspaceSlug?: string | null;
  size: number;
  mtimeMs: number;
  preview: string;
  matched: boolean;
};

/** Display row for the memory browser list (list entry + optional search hit). */
export type MemoryBrowserRow = MemoryListEntryLike & {
  /** Redacted content snippet when host search found a body match. */
  snippet?: string;
  contentMatch?: boolean;
  /** True when the row is shown only because of a search hit (not in empty-query list). */
  fromSearch?: boolean;
};

/** Clamp host search limit into the hard range. */
export function clampMemorySearchLimit(limit?: number | null): number {
  if (limit == null || !Number.isFinite(limit)) {
    return MEMORY_SEARCH_DEFAULT_LIMIT;
  }
  const n = Math.floor(Number(limit));
  if (n < 1) return 1;
  if (n > MEMORY_SEARCH_MAX_LIMIT) return MEMORY_SEARCH_MAX_LIMIT;
  return n;
}

/** Whether the free-text query should trigger host content search. */
export function shouldRunMemoryContentSearch(query: string | undefined | null): boolean {
  return (query ?? "").trim().length > 0;
}

/**
 * Case-insensitive name / path / preview match for instant client filter
 * while host content search is in flight (or as a soft fallback).
 */
export function memoryEntryNameMatches(
  entry: Pick<MemoryListEntryLike, "name" | "relativePath" | "preview" | "kind" | "workspaceSlug">,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    entry.name,
    entry.relativePath,
    entry.kind,
    entry.preview,
    entry.workspaceSlug || "",
  ]
    .join("\n")
    .toLowerCase();
  return hay.includes(q);
}

/**
 * Merge list entries with host search hits for display.
 *
 * - Empty query → all list entries (no snippets).
 * - Non-empty query → union of name-matching list rows and search hits;
 *   content matches first, then name-only; preserves stable path order within tier.
 */
export function mergeMemoryBrowserRows(
  entries: MemoryListEntryLike[],
  hits: MemorySearchHitLike[] | undefined | null,
  query: string,
): MemoryBrowserRow[] {
  const q = query.trim();
  if (!q) {
    return entries.map((e) => ({ ...e }));
  }

  const hitByPath = new Map<string, MemorySearchHitLike>();
  for (const h of hits ?? []) {
    if (h?.path) hitByPath.set(h.path, h);
  }

  const seen = new Set<string>();
  const rows: MemoryBrowserRow[] = [];

  // Content hits first (host already ranks content_match first, but re-assert).
  const orderedHits = [...(hits ?? [])].sort((a, b) => {
    if (a.contentMatch !== b.contentMatch) return a.contentMatch ? -1 : 1;
    return a.relativePath.localeCompare(b.relativePath, undefined, {
      sensitivity: "base",
    });
  });

  for (const h of orderedHits) {
    if (!h.path || seen.has(h.path)) continue;
    seen.add(h.path);
    const base = entries.find((e) => e.path === h.path);
    if (base) {
      rows.push({
        ...base,
        snippet: h.snippet || undefined,
        contentMatch: h.contentMatch,
        fromSearch: true,
      });
    } else {
      rows.push({
        path: h.path,
        name: h.name,
        relativePath: h.relativePath,
        kind: h.kind,
        workspaceSlug: h.workspaceSlug,
        size: h.size,
        mtimeMs: h.mtimeMs,
        preview: "",
        matched: h.matched,
        snippet: h.snippet || undefined,
        contentMatch: h.contentMatch,
        fromSearch: true,
      });
    }
  }

  // Name/preview matches from the list that host may not have returned yet
  // (or while search is still loading).
  for (const e of entries) {
    if (seen.has(e.path)) continue;
    if (!memoryEntryNameMatches(e, q)) continue;
    seen.add(e.path);
    const h = hitByPath.get(e.path);
    rows.push({
      ...e,
      snippet: h?.snippet || undefined,
      contentMatch: h?.contentMatch,
      fromSearch: false,
    });
  }

  return rows;
}

/** Human-friendly truncated flag line for the toolbar. */
export function memorySearchTruncatedHint(truncated: boolean, hitCount: number): boolean {
  return truncated && hitCount > 0;
}

/**
 * Apply kind chip to merged (or list) rows.
 * `"all"` leaves the list unchanged. Unknown host kinds bucket as `"other"`.
 */
export function applyMemoryBrowserKindFilter<T extends { kind: string }>(
  rows: T[],
  kind: MemoryBrowserKindFilter = "all",
): T[] {
  if (kind === "all") return rows;
  return rows.filter((r) => normalizeMemoryBrowserKind(r.kind) === kind);
}

/**
 * Merge list + host content hits, then apply kind chip.
 * Kind filter was previously applied only to the client name filter —
 * content-search integration must re-apply it to display rows.
 */
export function buildMemoryBrowserDisplayRows(
  entries: MemoryListEntryLike[],
  hits: MemorySearchHitLike[] | undefined | null,
  query: string,
  kind: MemoryBrowserKindFilter = "all",
): MemoryBrowserRow[] {
  return applyMemoryBrowserKindFilter(
    mergeMemoryBrowserRows(entries, hits, query),
    kind,
  );
}

/** Compact match badge for a display row under an active query. */
export type MemoryBrowserMatchBadge = "content" | "name";

/**
 * Badge when free-text is active:
 * - content → host body match
 * - name → name/path/preview match without content hit
 * - null → no query / no match flags
 */
export function memoryBrowserMatchBadge(
  row: Pick<MemoryBrowserRow, "contentMatch">,
  query: string,
): MemoryBrowserMatchBadge | null {
  if (!shouldRunMemoryContentSearch(query)) return null;
  if (row.contentMatch) return "content";
  return "name";
}

export function countMemoryBrowserContentHits(
  rows: Array<{ contentMatch?: boolean }>,
): number {
  let n = 0;
  for (const r of rows) {
    if (r.contentMatch) n += 1;
  }
  return n;
}

/**
 * Toolbar match summary under an active query (or kind filter).
 * Returns null when nothing useful to show (empty query + all kinds, or empty list).
 */
export function memoryBrowserMatchSummary(
  rows: MemoryBrowserRow[],
  query: string,
  kind: MemoryBrowserKindFilter = "all",
): { total: number; contentHits: number; queryActive: boolean; kindActive: boolean } | null {
  const queryActive = shouldRunMemoryContentSearch(query);
  const kindActive = kind !== "all";
  if (!queryActive && !kindActive) return null;
  if (rows.length === 0) return null;
  return {
    total: rows.length,
    contentHits: countMemoryBrowserContentHits(rows),
    queryActive,
    kindActive,
  };
}

/**
 * Empty-state kinds for Settings → Memory browser.
 * `null` from the resolver means there are rows — no empty UI.
 */
export type MemoryBrowserEmptyKind =
  | "off"
  | "loading"
  | "searching"
  | "empty_catalog"
  | "no_matches"
  | "filtered";

export type MemoryBrowserEmptyTitleKey =
  | "settings.memoryBrowser.off"
  | "settings.memoryBrowser.loading"
  | "settings.memoryBrowser.searching"
  | "settings.memoryBrowser.empty"
  | "settings.memoryBrowser.searchEmpty"
  | "settings.memoryBrowser.filterEmpty";

export type MemoryBrowserEmptyHintKey =
  | "settings.memoryBrowser.emptyHint"
  | "settings.memoryBrowser.searchingHint"
  | "settings.memoryBrowser.searchEmptyHint"
  | "settings.memoryBrowser.searchEmptyHintKeyword"
  | "settings.memoryBrowser.searchEmptyHintHybridUnavailable"
  | "settings.memoryBrowser.filterEmptyHint"
  | "settings.memoryBrowser.filterEmptyHintKind";

export type MemoryBrowserEmptyPresentation = {
  kind: MemoryBrowserEmptyKind;
  titleKey: MemoryBrowserEmptyTitleKey;
  hintKey?: MemoryBrowserEmptyHintKey;
  /** Offer "Clear filters" when query and/or kind chip is non-default. */
  showClearFilters: boolean;
  /**
   * Soft-link to Memory embedding settings when empty search + embed unset.
   * Honesty only — never claims App search uses vectors.
   */
  showEmbedLink: boolean;
};

export type MemoryBrowserEmptyInput = {
  experimentalMemory: boolean;
  loading: boolean;
  searching: boolean;
  /** Host list size (before filters). */
  entryCount: number;
  /** Display row count after merge + kind filter. */
  rowCount: number;
  query: string;
  kind: MemoryBrowserKindFilter;
  /**
   * Whether embedding.model is set (CLI hybrid possible).
   * null = unknown / not probed — treat as neutral keyword hint.
   */
  embedConfigured?: boolean | null;
};

/**
 * Resolve empty-state presentation for the memory browser list.
 * Returns `null` when there are display rows (no empty UI).
 *
 * Honest keyword-only App search — hints never claim cloud embeddings.
 */
export function resolveMemoryBrowserEmptyState(
  input: MemoryBrowserEmptyInput,
): MemoryBrowserEmptyPresentation | null {
  if (!input.experimentalMemory) {
    return {
      kind: "off",
      titleKey: "settings.memoryBrowser.off",
      showClearFilters: false,
      showEmbedLink: false,
    };
  }

  if (input.loading && input.entryCount === 0) {
    return {
      kind: "loading",
      titleKey: "settings.memoryBrowser.loading",
      showClearFilters: false,
      showEmbedLink: false,
    };
  }

  if (input.entryCount === 0) {
    return {
      kind: "empty_catalog",
      titleKey: "settings.memoryBrowser.empty",
      hintKey: "settings.memoryBrowser.emptyHint",
      showClearFilters: false,
      showEmbedLink: false,
    };
  }

  if (input.rowCount > 0) return null;

  const q = (input.query ?? "").trim();
  const kind = input.kind ?? "all";
  const filtersActive = hasActiveMemoryBrowserFilters({ query: q, kind });

  // Content search in flight with no interim name matches yet.
  if (q && input.searching && shouldRunMemoryContentSearch(q)) {
    return {
      kind: "searching",
      titleKey: "settings.memoryBrowser.searching",
      hintKey: "settings.memoryBrowser.searchingHint",
      showClearFilters: false,
      showEmbedLink: false,
    };
  }

  // Kind chip (alone or with query) → filtered empty.
  if (kind !== "all") {
    return {
      kind: "filtered",
      titleKey: "settings.memoryBrowser.filterEmpty",
      hintKey: q
        ? "settings.memoryBrowser.filterEmptyHint"
        : "settings.memoryBrowser.filterEmptyHintKind",
      showClearFilters: true,
      showEmbedLink: false,
    };
  }

  if (q) {
    // Keyword-only honesty:
    // - model unset → soft-link embed settings (CLI hybrid needs model)
    // - model set → hybrid unavailable for App browser (no host CLI path)
    // - unknown → generic keyword hint
    const embedUnset = input.embedConfigured === false;
    const embedOn = input.embedConfigured === true;
    return {
      kind: "no_matches",
      titleKey: "settings.memoryBrowser.searchEmpty",
      hintKey: embedUnset
        ? "settings.memoryBrowser.searchEmptyHintKeyword"
        : embedOn
          ? "settings.memoryBrowser.searchEmptyHintHybridUnavailable"
          : "settings.memoryBrowser.searchEmptyHint",
      showClearFilters: filtersActive,
      showEmbedLink: embedUnset || embedOn,
    };
  }

  // Defensive: entries exist, no query, kind all, zero rows (should not happen).
  return {
    kind: "empty_catalog",
    titleKey: "settings.memoryBrowser.empty",
    showClearFilters: false,
    showEmbedLink: false,
  };
}
