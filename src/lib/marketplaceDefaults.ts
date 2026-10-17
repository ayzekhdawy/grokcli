/**
 * Default marketplace sources for Grok App:
 * - xAI / Grok official
 * - openai/plugins
 * Claude / Anthropic sources are not default and can be removed on ensure.
 */

import {
  isOpenaiPluginsSource,
  OPENAI_PLUGINS_MARKETPLACE_URL,
  type MarketplaceSourceLikeForMatch,
} from "./pluginRecommended";
import { isXaiOfficialMarketplace } from "./pluginMarketplace";

/** Official Grok / xAI marketplace git URL. */
export const XAI_OFFICIAL_MARKETPLACE_URL =
  "https://github.com/xai-org/plugin-marketplace.git";

export type MarketplaceSourceRow = MarketplaceSourceLikeForMatch & {
  name: string;
  url?: string | null;
  path?: string | null;
};

export function isClaudeMarketplaceSource(
  source: MarketplaceSourceLikeForMatch | null | undefined,
): boolean {
  if (!source) return false;
  const blob = [source.name, source.url, source.path]
    .map((x) => (x ?? "").toLowerCase())
    .join(" ");
  if (!blob.trim()) return false;
  if (blob.includes("claude")) return true;
  if (blob.includes("anthropic")) return true;
  if (blob.includes("everything-claude-code")) return true;
  return false;
}

export function isGrokOfficialSource(
  source: MarketplaceSourceLikeForMatch | null | undefined,
): boolean {
  if (!source) return false;
  if (isXaiOfficialMarketplace(source.name)) return true;
  const blob = [source.url, source.path, source.name]
    .map((x) => (x ?? "").toLowerCase())
    .join(" ");
  return (
    blob.includes("xai-org/plugin-marketplace") ||
    blob.includes("xai official") ||
    blob.includes("xai-official")
  );
}

export function isDefaultAllowedMarketplaceSource(
  source: MarketplaceSourceLikeForMatch | null | undefined,
): boolean {
  if (!source) return false;
  if (isClaudeMarketplaceSource(source)) return false;
  return isGrokOfficialSource(source) || isOpenaiPluginsSource(source);
}

export type EnsureDefaultMarketplacesResult = {
  added: string[];
  removed: string[];
  errors: string[];
  sources: MarketplaceSourceRow[];
};

export type EnsureDefaultMarketplacesDeps = {
  list: () => Promise<MarketplaceSourceRow[]>;
  add: (url: string) => Promise<unknown>;
  remove: (nameOrUrl: string) => Promise<unknown>;
  /** When true, remove Claude / Anthropic sources. Default true. */
  removeClaude?: boolean;
};

/**
 * Ensure xAI official + openai/plugins exist; optionally remove Claude sources.
 * Soft-fail individual ops; never throws.
 */
export async function ensureDefaultMarketplaces(
  deps: EnsureDefaultMarketplacesDeps,
): Promise<EnsureDefaultMarketplacesResult> {
  const added: string[] = [];
  const removed: string[] = [];
  const errors: string[] = [];
  const removeClaude = deps.removeClaude !== false;

  let sources: MarketplaceSourceRow[] = [];
  try {
    sources = await deps.list();
  } catch (e) {
    errors.push(String(e));
    return { added, removed, errors, sources: [] };
  }

  if (removeClaude) {
    for (const s of sources) {
      if (!isClaudeMarketplaceSource(s)) continue;
      const target = (s.url || s.path || s.name || "").trim();
      if (!target) continue;
      try {
        await deps.remove(target);
        removed.push(s.name || target);
      } catch (e) {
        errors.push(String(e));
      }
    }
    try {
      sources = await deps.list();
    } catch (e) {
      errors.push(String(e));
    }
  }

  if (!sources.some((s) => isGrokOfficialSource(s))) {
    try {
      await deps.add(XAI_OFFICIAL_MARKETPLACE_URL);
      added.push(XAI_OFFICIAL_MARKETPLACE_URL);
    } catch (e) {
      errors.push(String(e));
    }
  }

  if (!sources.some((s) => isOpenaiPluginsSource(s))) {
    try {
      await deps.add(OPENAI_PLUGINS_MARKETPLACE_URL);
      added.push(OPENAI_PLUGINS_MARKETPLACE_URL);
    } catch (e) {
      errors.push(String(e));
    }
  }

  try {
    sources = await deps.list();
  } catch (e) {
    errors.push(String(e));
  }

  // Prefer unique default sources in UI filter order
  return { added, removed, errors, sources };
}

/** Filter catalog plugins to default-allowed marketplaces only. */
export function filterCatalogToDefaultSources<
  T extends { marketplace?: string | null },
>(
  plugins: readonly T[],
  sources: readonly MarketplaceSourceRow[],
): T[] {
  const allowedNames = new Set(
    sources
      .filter((s) => isDefaultAllowedMarketplaceSource(s))
      .map((s) => (s.name ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  // Also allow empty marketplace if only defaults exist
  return plugins.filter((p) => {
    const m = (p.marketplace ?? "").trim().toLowerCase();
    if (!m) return true;
    if (allowedNames.has(m)) return true;
    if (m.includes("xai") || m.includes("openai") || m === "plugins") {
      return true;
    }
    // Drop Claude-tagged marketplace rows
    if (m.includes("claude") || m.includes("anthropic")) return false;
    return false;
  });
}
