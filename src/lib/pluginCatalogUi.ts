/**
 * Catalog/list helpers for the redesigned Settings → Plugins page
 * (ChatGPT-style: installed strip + 2-col featured cards).
 */

import type { AvailablePluginLike } from "./pluginMarketplace";
import {
  buildAvailableCard,
  buildInstalledCard,
  groupPluginCardsByLabel,
  normalizePluginCategory,
  type PluginCardKind,
  type PluginCardModel,
  type PluginManifestLike,
} from "./pluginCard";
import { isChatCutInstalled } from "./pluginRecommended";

export const PLUGIN_CATALOG_PAGE_SIZE = 24;

/**
 * Category collapse: groups with fewer than this show every item.
 * At/above threshold: preview first N, then a “more” tile as the 8th cell.
 */
export const PLUGIN_GROUP_COLLAPSE_AT = 8;
/** How many plugin cards to show before the expand tile (7 + expand = 8 slots). */
export const PLUGIN_GROUP_PREVIEW_COUNT = 7;
/** Max stacked logos on the expand tile (image logos only). */
export const PLUGIN_GROUP_STACK_ICON_COUNT = 4;

/**
 * Split a category group for collapse UI.
 * - length < 8 → all visible, no collapse
 * - length ≥ 8 and not expanded → first 7 + remaining for the “more” tile
 * - expanded → all visible
 */
export function splitGroupItemsForCollapse<T>(
  items: readonly T[],
  expanded: boolean,
  opts?: {
    collapseAt?: number;
    previewCount?: number;
  },
): {
  visible: T[];
  remaining: T[];
  collapsed: boolean;
  moreCount: number;
} {
  const collapseAt = opts?.collapseAt ?? PLUGIN_GROUP_COLLAPSE_AT;
  const previewCount = opts?.previewCount ?? PLUGIN_GROUP_PREVIEW_COUNT;
  const list = items ?? [];
  if (expanded || list.length < collapseAt) {
    return {
      visible: [...list],
      remaining: [],
      collapsed: false,
      moreCount: 0,
    };
  }
  const visible = list.slice(0, previewCount) as T[];
  const remaining = list.slice(previewCount) as T[];
  return {
    visible,
    remaining,
    collapsed: remaining.length > 0,
    moreCount: remaining.length,
  };
}

/**
 * Pick stacked logos for the expand tile:
 * - image logos only (no text/initial glyphs)
 * - prefer items that have iconUrl
 * - reverse visual order (last selected paints on the left / back)
 */
export function pickExpandStackLogos<
  T extends { name: string; displayName?: string; iconUrl?: string | null },
>(
  remaining: readonly T[],
  max = PLUGIN_GROUP_STACK_ICON_COUNT,
): Array<{ key: string; label: string; iconUrl: string }> {
  const withLogo: Array<{ key: string; label: string; iconUrl: string }> = [];
  for (const c of remaining) {
    const url = (c.iconUrl ?? "").trim();
    if (!url) continue;
    withLogo.push({
      key: c.name.trim().toLowerCase() || url,
      label: (c.displayName ?? c.name).trim() || c.name,
      iconUrl: url,
    });
    if (withLogo.length >= max) break;
  }
  // Reverse so the first preferred logo sits on top (rightmost in LTR stack).
  return withLogo.reverse();
}

/**
 * Group the full catalog first, then take a prefix of the flat stream.
 *
 * Important: never page then re-group — that inserts new items into earlier
 * category sections above the fold and makes infinite-scroll jump upward.
 */
export function sliceGroupedCatalogPage<
  T extends { categoryLabel: string; category?: PluginCardKind },
>(
  cards: readonly T[],
  page: number,
  pageSize = PLUGIN_CATALOG_PAGE_SIZE,
): {
  groups: Array<{ key: string; label: string; items: T[] }>;
  visibleCount: number;
  hasMore: boolean;
  total: number;
} {
  const allGroups = groupPluginCardsByLabel(cards);
  const flat: Array<{ label: string; item: T }> = [];
  for (const g of allGroups) {
    for (const item of g.items) {
      flat.push({ label: g.label, item });
    }
  }
  const total = flat.length;
  const n = Math.max(1, pageSize);
  const p = Math.max(1, page);
  const end = Math.min(total, p * n);
  const slice = flat.slice(0, end);

  // Rebuild groups from the prefix only (append-only as page grows).
  const groups: Array<{ key: string; label: string; items: T[] }> = [];
  for (const row of slice) {
    const last = groups[groups.length - 1];
    if (last && last.label === row.label) {
      last.items.push(row.item);
    } else {
      groups.push({
        key: row.label.toLowerCase(),
        label: row.label,
        items: [row.item],
      });
    }
  }
  return {
    groups,
    visibleCount: slice.length,
    hasMore: end < total,
    total,
  };
}

export type InstalledPluginLikeForMatch = {
  name?: string | null;
  path?: string | null;
  source?: string | null;
  repoKey?: string | null;
  marketplace?: string | null;
};

/**
 * Alias keys for matching a catalog row against an installed plugin.
 * CLI often installs marketplace plugins as `name-<8hex>` while the catalog
 * still lists the bare manifest name (e.g. game-studio vs game-studio-8978c99b).
 */
export function installedPluginAliasKeys(
  plugin: InstalledPluginLikeForMatch | null | undefined,
): string[] {
  if (!plugin) return [];
  const keys = new Set<string>();
  const add = (raw?: string | null) => {
    const t = (raw ?? "").trim().toLowerCase();
    if (t) keys.add(t);
  };
  add(plugin.name);
  add(plugin.repoKey);

  const name = (plugin.name ?? "").trim();
  const hashSuffix = name.match(/^(.+)-([0-9a-f]{8,})$/i);
  if (hashSuffix?.[1]) add(hashSuffix[1]);

  const source = (plugin.source ?? "").trim();
  if (source) {
    const base = source.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";
    add(base);
    if (base.endsWith(".git")) add(base.slice(0, -4));
    // marketplace-cache/.../plugins/<slug>
    const m = source.match(/[/\\]plugins[/\\]([^/\\]+)[/\\]?$/i);
    if (m?.[1]) add(m[1]);
  }

  const path = (plugin.path ?? "").trim();
  if (path) {
    const m = path.match(/[/\\]plugins[/\\]([^/\\]+)/i);
    if (m?.[1]) add(m[1]);
    const base = path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";
    add(base);
    const pathHash = base.match(/^(.+)-([0-9a-f]{8,})$/i);
    if (pathHash?.[1]) add(pathHash[1]);
  }

  return [...keys];
}

/** Build a set of all alias keys for installed plugins (lower-case). */
export function buildInstalledPluginNameSet(
  plugins: readonly InstalledPluginLikeForMatch[] | null | undefined,
): Set<string> {
  const set = new Set<string>();
  for (const p of plugins ?? []) {
    for (const k of installedPluginAliasKeys(p)) set.add(k);
  }
  return set;
}

/** True when a catalog plugin name matches any installed alias. */
export function isCatalogPluginInstalled(
  catalogName: string | null | undefined,
  installedNames: Set<string> | null | undefined,
): boolean {
  const n = (catalogName ?? "").trim().toLowerCase();
  if (!n || !installedNames?.size) return false;
  if (installedNames.has(n)) return true;
  // installed may keep a longer hash-suffixed id
  for (const key of installedNames) {
    if (key.startsWith(`${n}-`) && /^[0-9a-f]{8,}$/i.test(key.slice(n.length + 1))) {
      return true;
    }
  }
  return false;
}

export { groupPluginCardsByLabel };

export function sliceCatalogPage<T>(
  items: readonly T[],
  page: number,
  pageSize = PLUGIN_CATALOG_PAGE_SIZE,
): { visible: T[]; hasMore: boolean; total: number } {
  const n = Math.max(1, pageSize);
  const p = Math.max(1, page);
  const end = p * n;
  return {
    visible: items.slice(0, end) as T[],
    hasMore: end < items.length,
    total: items.length,
  };
}

/**
 * Dedupe catalog rows by plugin name (case-insensitive).
 * Same plugin often appears under multiple marketplace sources (xAI + openai).
 * Prefer: longer description, then xAI Official, then first seen.
 */
export function dedupeAvailablePluginsByName<
  T extends {
    name: string;
    description?: string | null;
    marketplace?: string | null;
  },
>(plugins: readonly T[]): T[] {
  const best = new Map<string, T>();
  const score = (p: T): number => {
    let s = 0;
    const desc = (p.description ?? "").trim().length;
    s += Math.min(desc, 500);
    const m = (p.marketplace ?? "").toLowerCase();
    if (m.includes("xai") || m.includes("official")) s += 50;
    if (m.includes("openai") || m === "plugins") s += 20;
    return s;
  };
  for (const p of plugins) {
    const key = (p.name ?? "").trim().toLowerCase();
    if (!key) continue;
    const prev = best.get(key);
    if (!prev || score(p) > score(prev)) {
      best.set(key, p);
    }
  }
  return [...best.values()];
}

/** Dedupe cards by stable name key (for UI list). */
export function dedupePluginCardsByName(
  cards: readonly PluginCardModel[],
): PluginCardModel[] {
  const best = new Map<string, PluginCardModel>();
  for (const c of cards) {
    const key = (c.name ?? "").trim().toLowerCase();
    if (!key) continue;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, c);
      continue;
    }
    // Prefer row with logo + richer description
    const prevScore =
      (prev.iconUrl ? 100 : 0) + (prev.description?.length ?? 0);
    const nextScore = (c.iconUrl ? 100 : 0) + (c.description?.length ?? 0);
    if (nextScore > prevScore) best.set(key, c);
  }
  return [...best.values()];
}

/** Filter available rows by free-text query. */
export function filterPluginCardsByQuery(
  cards: readonly PluginCardModel[],
  query: string,
): PluginCardModel[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return [...cards];
  return cards.filter((c) => {
    const hay = [
      c.displayName,
      c.name,
      c.description,
      c.marketplace ?? "",
      c.categoryLabel,
      c.providesLine ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function availableToCards(
  plugins: readonly AvailablePluginLike[],
  opts?: {
    installedNames?: Set<string>;
    categoryLabel?: (k: PluginCardKind) => string;
    /** Prefer raw marketplace category string when present (interface.category). */
    metaByName?: Map<
      string,
      {
        displayName?: string | null;
        description?: string | null;
        longDescription?: string | null;
        version?: string | null;
        category?: string | null;
        logoUrl?: string | null;
      }
    >;
    enrich?: Map<string, { manifest?: PluginManifestLike | null; iconUrl?: string | null }>;
  },
): PluginCardModel[] {
  const installed = opts?.installedNames ?? new Set<string>();
  const unique = dedupeAvailablePluginsByName(plugins);
  return unique.map((p) => {
    const nameKey = p.name.trim().toLowerCase();
    const key = `${(p.marketplace ?? "").trim().toLowerCase()}:${nameKey}`;
    const extra = opts?.enrich?.get(key) ?? opts?.enrich?.get(nameKey);
    const meta = opts?.metaByName?.get(nameKey);
    const base = buildAvailableCard(p, {
      installed: isCatalogPluginInstalled(p.name, installed),
      installSource: p.marketplace
        ? `${p.name}@${p.marketplace}`
        : p.name,
      categoryLabel: opts?.categoryLabel,
      categoryHint: meta?.category ?? extra?.manifest?.interface?.category ?? null,
    });
    const iface = extra?.manifest?.interface;
    const displayName =
      meta?.displayName?.trim() ||
      iface?.displayName?.trim() ||
      extra?.manifest?.name?.trim() ||
      base.displayName;
    const description =
      meta?.description?.trim() ||
      iface?.shortDescription?.trim() ||
      extra?.manifest?.description?.trim() ||
      meta?.longDescription?.trim() ||
      base.description;
    const rawCat =
      meta?.category?.trim() ||
      iface?.category?.trim() ||
      "";
    let category = base.category;
    // Keep English labels for stable grouping; UI localizes at render time.
    let categoryLabel = KIND_GROUP_LABEL[base.category] ?? "Other";
    if (rawCat) {
      // Group Discover by marketplace meta category (original plugin.json label).
      category = normalizePluginCategory(rawCat);
      categoryLabel = rawCat;
    }
    return {
      ...base,
      // Stable id by name only so React keys never double-render same plugin
      id: nameKey,
      displayName,
      description,
      category,
      categoryLabel,
      version: meta?.version || base.version,
      iconUrl: meta?.logoUrl || extra?.iconUrl || base.iconUrl,
    };
  });
}

/** English group headers for inferred kinds (no marketplace meta). */
const KIND_GROUP_LABEL: Record<PluginCardKind, string> = {
  video: "Video",
  design: "Design",
  mcp: "MCP",
  skills: "Skills",
  agents: "Agents",
  hooks: "Hooks",
  devtools: "Developer Tools",
  productivity: "Productivity",
  other: "Other",
};

export function installedToCards(
  plugins: readonly {
    name: string;
    version?: string | null;
    path?: string | null;
    marketplace?: string | null;
    source?: string | null;
    enabled: boolean;
    provides?: {
      skills?: number | null;
      agents?: number | null;
      hooks?: boolean | null;
      mcpServers?: number | null;
    } | null;
  }[],
  opts?: {
    chatcutLabel?: string;
    categoryLabel?: (k: PluginCardKind) => string;
    enrich?: Map<
      string,
      { manifest?: PluginManifestLike | null; iconUrl?: string | null }
    >;
  },
): PluginCardModel[] {
  return plugins.map((p) => {
    const extra =
      opts?.enrich?.get(p.name.trim().toLowerCase()) ??
      opts?.enrich?.get((p.path ?? "").trim());
    const card = buildInstalledCard(p, {
      chatcutLabel: opts?.chatcutLabel,
      categoryLabel: opts?.categoryLabel,
      manifest: extra?.manifest,
      iconUrl: extra?.iconUrl,
    });
    if (isChatCutInstalled([p]) && opts?.chatcutLabel) {
      return { ...card, displayName: opts.chatcutLabel };
    }
    return card;
  });
}

/**
 * Resolve logo relative path against a plugin root directory.
 * Supports `assets/logo.svg`, `./assets/logo.png`, `../../assets/x.svg`.
 */
export function resolvePluginLogoPath(
  pluginRoot: string,
  logoField: string | null | undefined,
): string | null {
  const root = pluginRoot.replace(/[/\\]+$/, "");
  const logo = (logoField ?? "").trim();
  if (!root || !logo) return null;
  if (logo.startsWith("http://") || logo.startsWith("https://") || logo.startsWith("data:")) {
    return logo;
  }
  // Normalize ./ and ../ segments simply against root
  const parts = root.split(/[/\\]/);
  const segs = logo.replace(/^\.\//, "").split(/[/\\]/);
  for (const s of segs) {
    if (!s || s === ".") continue;
    if (s === "..") {
      parts.pop();
      continue;
    }
    parts.push(s);
  }
  return parts.join("/");
}

/** Candidate marketplace-cache roots for a plugin name. */
export function marketplacePluginRootCandidates(
  cacheRoot: string,
  pluginName: string,
): string[] {
  const cache = cacheRoot.replace(/[/\\]+$/, "");
  const name = pluginName.trim();
  if (!cache || !name) return [];
  return [
    `${cache}/plugins/${name}`,
    `${cache}/external_plugins/${name}`,
    // nested one-level scan pattern used by some marketplaces
    // callers may also pass resolved path
  ];
}
