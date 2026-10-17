/**
 * Pure helpers for project codebase file/name + content search UI.
 *
 * Host scans under a trusted project root (`rg` or walk with caps).
 * Always keyword — never invents embeddings, vector search, or CLI
 * code-graph results. Soft-fail reasons stay honest and classified.
 */

export const CODEBASE_SEARCH_DEFAULT_LIMIT = 50;
export const CODEBASE_SEARCH_MAX_LIMIT = 100;
/** Debounce before calling host search (ms). */
export const CODEBASE_SEARCH_DEBOUNCE_MS = 300;

/** Search mode: path/name only, content only, or both. */
export type CodebaseSearchMode = "name" | "content" | "all";

export const CODEBASE_SEARCH_MODES: readonly CodebaseSearchMode[] = [
  "all",
  "name",
  "content",
] as const;

export type CodebaseSearchHitLike = {
  path: string;
  name: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
  snippet: string;
  contentMatch: boolean;
  line?: number | null;
};

export type CodebaseSearchResultLike = {
  hits?: CodebaseSearchHitLike[] | null;
  projectPath?: string | null;
  projectPathExists?: boolean;
  projectIsDir?: boolean;
  query?: string | null;
  mode?: string | null;
  limit?: number | null;
  truncated?: boolean;
  engine?: string | null;
  /** Always `"keyword"` from host — never invent embeddings. */
  searchKind?: string | null;
  softFail?: string | null;
};

/** Soft-fail reasons from host (or UI-side preflight). */
export type CodebaseSearchSoftFail =
  | "no_project"
  | "path_missing"
  | "not_a_dir"
  | "untrusted_project"
  | "empty_query"
  | "need_tauri"
  | "host_error"
  | "path_unreadable"
  | "unknown";

/** Clamp host/UI limit into the hard range. */
export function clampCodebaseSearchLimit(limit?: number | null): number {
  if (limit == null || !Number.isFinite(limit)) {
    return CODEBASE_SEARCH_DEFAULT_LIMIT;
  }
  const n = Math.floor(Number(limit));
  if (n < 1) return 1;
  if (n > CODEBASE_SEARCH_MAX_LIMIT) return CODEBASE_SEARCH_MAX_LIMIT;
  return n;
}

/** Normalize mode string → name | content | all. */
export function normalizeCodebaseSearchMode(
  mode?: string | null,
): CodebaseSearchMode {
  const m = (mode ?? "all").trim().toLowerCase();
  if (m === "name" || m === "path" || m === "filename") return "name";
  if (m === "content" || m === "body" || m === "text") return "content";
  return "all";
}

/** Whether free-text should trigger host search. */
export function shouldRunCodebaseSearch(
  query: string | undefined | null,
): boolean {
  return (query ?? "").trim().length > 0;
}

/**
 * Classify host soft_fail / preflight into a stable reason.
 * Never invents success from a soft-fail payload.
 */
export function classifyCodebaseSearchSoftFail(
  softFail: string | null | undefined,
  opts?: {
    projectPath?: string | null;
    isTauri?: boolean;
    hostError?: boolean;
  },
): CodebaseSearchSoftFail | null {
  if (opts?.isTauri === false) return "need_tauri";
  if (opts?.hostError) return "host_error";
  const path = (opts?.projectPath ?? "").trim();
  if (!path && !softFail) return "no_project";
  if (!softFail) return null;
  const s = softFail.trim().toLowerCase();
  if (s === "no_project") return "no_project";
  if (s === "path_missing") return "path_missing";
  if (s === "not_a_dir") return "not_a_dir";
  if (s === "untrusted_project") return "untrusted_project";
  if (s === "empty_query") return "empty_query";
  if (s.startsWith("path_unreadable")) return "path_unreadable";
  return "unknown";
}

/**
 * Honesty: App search is always keyword. Host may echo `search_kind`;
 * never upgrade to embedding/semantic when missing or wrong.
 */
export function resolveCodebaseSearchKind(
  searchKind?: string | null,
): "keyword" {
  void searchKind;
  return "keyword";
}

/** Engine label for UI badge — never invents "graph" / "embedding". */
export function normalizeCodebaseSearchEngine(
  engine?: string | null,
): "rg" | "walk" | "none" {
  const e = (engine ?? "none").trim().toLowerCase();
  if (e === "rg") return "rg";
  if (e === "walk") return "walk";
  return "none";
}

/** Match badge for a hit under an active query. */
export type CodebaseSearchMatchBadge = "content" | "name";

export function codebaseSearchMatchBadge(
  hit: Pick<CodebaseSearchHitLike, "contentMatch">,
  query: string,
): CodebaseSearchMatchBadge | null {
  if (!shouldRunCodebaseSearch(query)) return null;
  return hit.contentMatch ? "content" : "name";
}

export function countCodebaseContentHits(
  hits: Array<{ contentMatch?: boolean }> | null | undefined,
): number {
  let n = 0;
  for (const h of hits ?? []) {
    if (h.contentMatch) n += 1;
  }
  return n;
}

export function codebaseSearchMatchSummary(
  hits: CodebaseSearchHitLike[],
  query: string,
): { total: number; contentHits: number } | null {
  if (!shouldRunCodebaseSearch(query)) return null;
  if (hits.length === 0) return null;
  return {
    total: hits.length,
    contentHits: countCodebaseContentHits(hits),
  };
}

/**
 * Empty-state kinds for the codebase search panel.
 * `null` from the resolver means there are hits — no empty UI.
 */
export type CodebaseSearchEmptyKind =
  | "need_tauri"
  | "no_project"
  | "path_missing"
  | "not_a_dir"
  | "untrusted_project"
  | "idle"
  | "searching"
  | "no_matches"
  | "host_error"
  | "path_unreadable";

export type CodebaseSearchEmptyTitleKey =
  | "settings.codebaseSearch.needTauri"
  | "settings.codebaseSearch.noProject"
  | "settings.codebaseSearch.pathMissing"
  | "settings.codebaseSearch.notADir"
  | "settings.codebaseSearch.untrusted"
  | "settings.codebaseSearch.idle"
  | "settings.codebaseSearch.searching"
  | "settings.codebaseSearch.noMatches"
  | "settings.codebaseSearch.error"
  | "settings.codebaseSearch.pathUnreadable";

export type CodebaseSearchEmptyHintKey =
  | "settings.codebaseSearch.idleHint"
  | "settings.codebaseSearch.noMatchesHint"
  | "settings.codebaseSearch.noEmbeddings"
  | "settings.codebaseSearch.pathMissingHint"
  | "settings.codebaseSearch.untrustedHint";

export type CodebaseSearchEmptyPresentation = {
  kind: CodebaseSearchEmptyKind;
  titleKey: CodebaseSearchEmptyTitleKey;
  hintKey?: CodebaseSearchEmptyHintKey;
};

export type CodebaseSearchEmptyInput = {
  isTauri: boolean;
  projectPath?: string | null;
  query: string;
  searching: boolean;
  hitCount: number;
  softFail?: string | null;
  hostError?: boolean;
};

/**
 * Resolve empty-state presentation. Returns `null` when there are hits.
 * Soft-fails never claim semantic/embedding results.
 */
export function resolveCodebaseSearchEmptyState(
  input: CodebaseSearchEmptyInput,
): CodebaseSearchEmptyPresentation | null {
  if (!input.isTauri) {
    return {
      kind: "need_tauri",
      titleKey: "settings.codebaseSearch.needTauri",
    };
  }

  const reason = classifyCodebaseSearchSoftFail(input.softFail, {
    projectPath: input.projectPath,
    isTauri: input.isTauri,
    hostError: input.hostError,
  });

  if (reason === "no_project") {
    return {
      kind: "no_project",
      titleKey: "settings.codebaseSearch.noProject",
    };
  }
  if (reason === "path_missing") {
    return {
      kind: "path_missing",
      titleKey: "settings.codebaseSearch.pathMissing",
      hintKey: "settings.codebaseSearch.pathMissingHint",
    };
  }
  if (reason === "not_a_dir") {
    return {
      kind: "not_a_dir",
      titleKey: "settings.codebaseSearch.notADir",
    };
  }
  if (reason === "untrusted_project") {
    return {
      kind: "untrusted_project",
      titleKey: "settings.codebaseSearch.untrusted",
      hintKey: "settings.codebaseSearch.untrustedHint",
    };
  }
  if (reason === "path_unreadable") {
    return {
      kind: "path_unreadable",
      titleKey: "settings.codebaseSearch.pathUnreadable",
    };
  }
  if (reason === "host_error") {
    return {
      kind: "host_error",
      titleKey: "settings.codebaseSearch.error",
    };
  }

  if (input.hitCount > 0) return null;

  if (!shouldRunCodebaseSearch(input.query)) {
    return {
      kind: "idle",
      titleKey: "settings.codebaseSearch.idle",
      hintKey: "settings.codebaseSearch.idleHint",
    };
  }

  if (input.searching) {
    return {
      kind: "searching",
      titleKey: "settings.codebaseSearch.searching",
    };
  }

  // Active query, done, zero hits — honest keyword empty (never embeddings).
  return {
    kind: "no_matches",
    titleKey: "settings.codebaseSearch.noMatches",
    hintKey: "settings.codebaseSearch.noMatchesHint",
  };
}

/**
 * Normalize host result hits for display (stable relative path, no invent).
 */
export function normalizeCodebaseSearchHits(
  result: CodebaseSearchResultLike | null | undefined,
): CodebaseSearchHitLike[] {
  const hits = result?.hits ?? [];
  return hits
    .filter((h) => h && (h.path || h.relativePath))
    .map((h) => ({
      path: h.path || "",
      name: h.name || basenameFromPath(h.relativePath || h.path || ""),
      relativePath: (h.relativePath || h.name || "").replace(/\\/g, "/"),
      size: Number.isFinite(h.size) ? h.size : 0,
      mtimeMs: Number.isFinite(h.mtimeMs) ? h.mtimeMs : 0,
      snippet: h.snippet || "",
      contentMatch: !!h.contentMatch,
      line: h.line ?? null,
    }));
}

function basenameFromPath(p: string): string {
  const s = p.replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

/** Format file size for result rows. */
export function formatCodebaseSearchSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
