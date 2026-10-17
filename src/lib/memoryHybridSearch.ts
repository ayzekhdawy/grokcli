/**
 * Memory hybrid search path resolution for the Memory browser.
 *
 * ## Probe result (Grok Build CLI 0.2.117)
 * - `grok memory` only exposes `clear` (no `search` / `query` / `hybrid` subcommand).
 * - Hybrid (vector + full-text) lives in the **agent tool** `memory_search` when
 *   `--experimental-memory` is on and `[memory.embedding].model` is set.
 * - App browser never invents embedding vectors client-side.
 *
 * Therefore the App host path is always a path-scoped **keyword** file scan.
 * When an embedding model is configured we still soft-fail hybrid for the
 * browser and surface `hybrid_unavailable` honesty (agent CLI tool may still
 * hybrid mid-session).
 */

/** Host / UI search mode for App browser results. */
export type MemorySearchKind = "keyword" | "hybrid_unavailable" | "hybrid";

/**
 * Whether Grok Build exposes a host-invocable hybrid memory search CLI/API.
 * Documented false as of CLI 0.2.117 (`grok memory --help` → only `clear`).
 * Flip only when a real `grok memory search` (or equivalent) lands.
 */
export const CLI_MEMORY_HYBRID_SEARCH_AVAILABLE = false;

export type ResolveMemorySearchKindInput = {
  /**
   * Non-empty `[memory.embedding].model` from embed snapshot.
   * null / undefined = unknown (probe pending) → keyword.
   */
  embeddingConfigured?: boolean | null;
  /**
   * Whether a host-invocable hybrid CLI/API exists.
   * Defaults to {@link CLI_MEMORY_HYBRID_SEARCH_AVAILABLE}.
   */
  cliHybridAvailable?: boolean;
};

/**
 * Resolve App browser search kind (honest).
 *
 * - `hybrid` — only when CLI hybrid path exists AND embedding model is set
 * - `hybrid_unavailable` — embedding model set but no host hybrid CLI/API
 * - `keyword` — default / model unset / probe unknown
 */
export function resolveMemorySearchKind(
  input: ResolveMemorySearchKindInput = {},
): MemorySearchKind {
  const cli =
    input.cliHybridAvailable === true ||
    (input.cliHybridAvailable === undefined && CLI_MEMORY_HYBRID_SEARCH_AVAILABLE);
  const embedOn = input.embeddingConfigured === true;
  if (cli && embedOn) return "hybrid";
  if (embedOn && !cli) return "hybrid_unavailable";
  return "keyword";
}

/** True when App path is keyword-only (no vector retrieval in browser). */
export function memorySearchKindIsKeywordOnly(kind: MemorySearchKind): boolean {
  return kind === "keyword" || kind === "hybrid_unavailable";
}

/** Normalize host/API `searchKind` / `search_kind` string (soft-fail unknown). */
export function normalizeMemorySearchKind(
  raw: string | null | undefined,
): MemorySearchKind {
  const s = (raw ?? "").trim().toLowerCase().replace(/-/g, "_");
  if (s === "hybrid") return "hybrid";
  if (s === "hybrid_unavailable" || s === "hybridunavailable") {
    return "hybrid_unavailable";
  }
  return "keyword";
}

/**
 * Prefer host-reported search kind when present; else resolve from embed probe.
 * Soft-fail: invalid host values fall back to local resolution.
 */
export function effectiveMemorySearchKind(input: {
  hostSearchKind?: string | null;
  embeddingConfigured?: boolean | null;
  cliHybridAvailable?: boolean;
}): MemorySearchKind {
  const hostRaw = (input.hostSearchKind ?? "").trim();
  if (hostRaw) {
    const lower = hostRaw.toLowerCase().replace(/-/g, "_");
    if (
      lower === "hybrid" ||
      lower === "hybrid_unavailable" ||
      lower === "keyword"
    ) {
      return normalizeMemorySearchKind(hostRaw);
    }
  }
  return resolveMemorySearchKind({
    embeddingConfigured: input.embeddingConfigured,
    cliHybridAvailable: input.cliHybridAvailable,
  });
}

/** Mode chips shown above the Memory browser search field. */
export type MemorySearchModeChipId =
  | "app_keyword"
  | "cli_hybrid"
  | "cli_keyword"
  | "hybrid_unavailable";

/**
 * Build ordered honesty chips for the Memory browser status line.
 *
 * Always includes App keyword. When embed probe is known:
 * - configured → CLI agent hybrid + (if no host CLI) hybrid_unavailable
 * - unset → CLI agent keyword
 * - null/unknown → App keyword only
 */
export function memorySearchModeChips(
  input: ResolveMemorySearchKindInput = {},
): MemorySearchModeChipId[] {
  const chips: MemorySearchModeChipId[] = ["app_keyword"];
  if (input.embeddingConfigured === true) {
    chips.push("cli_hybrid");
    const kind = resolveMemorySearchKind(input);
    if (kind === "hybrid_unavailable") {
      chips.push("hybrid_unavailable");
    }
  } else if (input.embeddingConfigured === false) {
    chips.push("cli_keyword");
  }
  return chips;
}

/** i18n title key for a mode chip (MessageKey in messages.ts). */
export function memorySearchModeChipLabelKey(
  chip: MemorySearchModeChipId,
):
  | "settings.memoryBrowser.searchMode.appKeyword"
  | "settings.memoryBrowser.searchMode.cliHybrid"
  | "settings.memoryBrowser.searchMode.cliKeyword"
  | "settings.memoryBrowser.searchMode.hybridUnavailable" {
  switch (chip) {
    case "cli_hybrid":
      return "settings.memoryBrowser.searchMode.cliHybrid";
    case "cli_keyword":
      return "settings.memoryBrowser.searchMode.cliKeyword";
    case "hybrid_unavailable":
      return "settings.memoryBrowser.searchMode.hybridUnavailable";
    case "app_keyword":
    default:
      return "settings.memoryBrowser.searchMode.appKeyword";
  }
}

/** i18n key for post-search status line by resolved kind. */
export function memorySearchKindStatusKey(
  kind: MemorySearchKind,
):
  | "settings.memoryBrowser.searchKind.keyword"
  | "settings.memoryBrowser.searchKind.hybridUnavailable"
  | "settings.memoryBrowser.searchKind.hybrid" {
  switch (kind) {
    case "hybrid":
      return "settings.memoryBrowser.searchKind.hybrid";
    case "hybrid_unavailable":
      return "settings.memoryBrowser.searchKind.hybridUnavailable";
    case "keyword":
    default:
      return "settings.memoryBrowser.searchKind.keyword";
  }
}

/**
 * Whether to soft-link Memory embedding settings from the status row.
 * True when model is unset (user may want CLI hybrid) — not when already set.
 */
export function shouldLinkMemoryEmbedFromSearchStatus(
  embeddingConfigured: boolean | null | undefined,
): boolean {
  return embeddingConfigured === false;
}

/**
 * Hint under hybrid_unavailable chip (embedding on, no host hybrid CLI).
 */
export function memoryHybridUnavailableHintKey(): "settings.memoryBrowser.hybridUnavailableHint" {
  return "settings.memoryBrowser.hybridUnavailableHint";
}
