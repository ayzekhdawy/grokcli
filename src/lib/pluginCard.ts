/**
 * Pure helpers for Extensions → Plugins card UI:
 * display name, category groups, icon path candidates.
 */

import {
  isChatCutInstalled,
  pluginDisplayName,
  type PluginLikeForMatch,
} from "./pluginRecommended";

export type PluginCardKind =
  | "video"
  | "mcp"
  | "skills"
  | "agents"
  | "hooks"
  | "devtools"
  | "productivity"
  | "design"
  | "other";

export type PluginCardModel = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: PluginCardKind;
  categoryLabel: string;
  enabled: boolean;
  installed: boolean;
  marketplace?: string | null;
  path?: string | null;
  version?: string | null;
  /** Absolute path to a logo/icon file when known. */
  iconPath?: string | null;
  /** Optional data URL / asset URL for <img>. */
  iconUrl?: string | null;
  installSource?: string | null;
  providesLine?: string | null;
};

const CATEGORY_ORDER: PluginCardKind[] = [
  "video",
  "design",
  "mcp",
  "skills",
  "agents",
  "hooks",
  "devtools",
  "productivity",
  "other",
];

/** Stable order for section headers. */
export function pluginCategoryOrder(): readonly PluginCardKind[] {
  return CATEGORY_ORDER;
}

export function normalizePluginCategory(
  raw: string | null | undefined,
): PluginCardKind {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return "other";
  // Exact / known marketplace labels first (openai/plugins interface.category)
  if (
    s === "developer tools" ||
    s === "devtools" ||
    s === "developer tools & sdks"
  ) {
    return "devtools";
  }
  if (s === "productivity" || s === "business & operations") {
    return "productivity";
  }
  if (s === "creativity" || s === "design") return "design";
  if (s === "data & analytics" || s === "data") return "devtools";
  if (s === "finance" || s === "communication" || s === "travel") {
    return "productivity";
  }
  if (s === "education & research" || s === "security") return "other";
  if (
    s.includes("video") ||
    s.includes("media") ||
    s.includes("chatcut") ||
    s.includes("film")
  ) {
    return "video";
  }
  if (s.includes("design") || s.includes("ui") || s.includes("visual") || s.includes("creativ")) {
    return "design";
  }
  if (s.includes("mcp") || s.includes("protocol")) {
    return "mcp";
  }
  if (s.includes("skill")) return "skills";
  if (s.includes("agent") || s.includes("persona")) return "agents";
  if (s.includes("hook")) return "hooks";
  if (
    s.includes("dev") ||
    s.includes("git") ||
    s.includes("debug") ||
    s.includes("cli") ||
    s.includes("analytics") ||
    s.includes("security")
  ) {
    return "devtools";
  }
  if (
    s.includes("product") ||
    s.includes("office") ||
    s.includes("doc") ||
    s.includes("note") ||
    s.includes("finance") ||
    s.includes("business") ||
    s.includes("communication") ||
    s.includes("travel")
  ) {
    return "productivity";
  }
  return "other";
}

/**
 * Stable section order for Discover grouping.
 * Marketplace labels (English from plugin.json) come first; kind keys after.
 */
export const MARKETPLACE_CATEGORY_LABEL_ORDER: readonly string[] = [
  "Developer Tools",
  "Productivity",
  "Finance",
  "Business & Operations",
  "Data & Analytics",
  "Communication",
  "Education & Research",
  "Creativity",
  "Security",
  "Travel",
  "Design",
  "Video",
  "MCP",
  "Skills",
  "Agents",
  "Hooks",
  "Other",
];

/**
 * Map marketplace `interface.category` (or kind labels) to i18n message keys.
 * Unknown labels fall through to the raw string at the call site.
 */
export function marketplaceCategoryMessageKey(
  raw: string | null | undefined,
):
  | "ext.plugins.category.video"
  | "ext.plugins.category.design"
  | "ext.plugins.category.mcp"
  | "ext.plugins.category.skills"
  | "ext.plugins.category.agents"
  | "ext.plugins.category.hooks"
  | "ext.plugins.category.devtools"
  | "ext.plugins.category.productivity"
  | "ext.plugins.category.finance"
  | "ext.plugins.category.business"
  | "ext.plugins.category.data"
  | "ext.plugins.category.communication"
  | "ext.plugins.category.education"
  | "ext.plugins.category.creativity"
  | "ext.plugins.category.security"
  | "ext.plugins.category.travel"
  | "ext.plugins.category.other"
  | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "developer tools" || s === "devtools" || s === "developer tools & sdks") {
    return "ext.plugins.category.devtools";
  }
  if (s === "productivity") return "ext.plugins.category.productivity";
  if (s === "finance") return "ext.plugins.category.finance";
  if (s === "business & operations" || s === "business") {
    return "ext.plugins.category.business";
  }
  if (s === "data & analytics" || s === "data") {
    return "ext.plugins.category.data";
  }
  if (s === "communication") return "ext.plugins.category.communication";
  if (s === "education & research" || s === "education") {
    return "ext.plugins.category.education";
  }
  if (s === "creativity") return "ext.plugins.category.creativity";
  if (s === "security") return "ext.plugins.category.security";
  if (s === "travel") return "ext.plugins.category.travel";
  if (s === "design") return "ext.plugins.category.design";
  if (s === "video") return "ext.plugins.category.video";
  if (s === "mcp") return "ext.plugins.category.mcp";
  if (s === "skills") return "ext.plugins.category.skills";
  if (s === "agents") return "ext.plugins.category.agents";
  if (s === "hooks") return "ext.plugins.category.hooks";
  if (s === "other") return "ext.plugins.category.other";
  return null;
}

/**
 * Group cards by display categoryLabel (meta-driven), with stable section order.
 */
export function groupPluginCardsByLabel<
  T extends { categoryLabel: string; category?: PluginCardKind },
>(cards: readonly T[]): Array<{ key: string; label: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const c of cards) {
    const label = (c.categoryLabel ?? "").trim() || "Other";
    const list = map.get(label) ?? [];
    list.push(c);
    map.set(label, list);
  }
  const orderIndex = new Map(
    MARKETPLACE_CATEGORY_LABEL_ORDER.map((l, i) => [l.toLowerCase(), i]),
  );
  const keys = [...map.keys()];
  keys.sort((a, b) => {
    const ia = orderIndex.get(a.toLowerCase());
    const ib = orderIndex.get(b.toLowerCase());
    if (ia != null && ib != null) return ia - ib;
    if (ia != null) return -1;
    if (ib != null) return 1;
    // Other always last among unknowns
    if (a.toLowerCase() === "other") return 1;
    if (b.toLowerCase() === "other") return -1;
    return a.localeCompare(b);
  });
  return keys.map((label) => ({
    key: label.toLowerCase(),
    label,
    items: map.get(label) ?? [],
  }));
}

export function categoryFromProvides(provides?: {
  skills?: number | null;
  agents?: number | null;
  hooks?: boolean | null;
  mcpServers?: number | null;
} | null): PluginCardKind {
  if (!provides) return "other";
  const mcp = Number(provides.mcpServers ?? 0);
  const skills = Number(provides.skills ?? 0);
  const agents = Number(provides.agents ?? 0);
  if (mcp > 0) return "mcp";
  if (skills > 0) return "skills";
  if (agents > 0) return "agents";
  if (provides.hooks) return "hooks";
  return "other";
}

export function groupPluginCards<T extends { category: PluginCardKind }>(
  cards: readonly T[],
): Array<{ category: PluginCardKind; items: T[] }> {
  const map = new Map<PluginCardKind, T[]>();
  for (const c of cards) {
    const list = map.get(c.category) ?? [];
    list.push(c);
    map.set(c.category, list);
  }
  const out: Array<{ category: PluginCardKind; items: T[] }> = [];
  for (const cat of CATEGORY_ORDER) {
    const items = map.get(cat);
    if (items?.length) out.push({ category: cat, items });
  }
  for (const [cat, items] of map) {
    if (!CATEGORY_ORDER.includes(cat) && items.length) {
      out.push({ category: cat, items });
    }
  }
  return out;
}

/** Candidate relative logo paths under an installed plugin root. */
export function pluginIconPathCandidates(pluginRoot: string): string[] {
  const root = pluginRoot.replace(/[/\\]+$/, "");
  if (!root) return [];
  const rels = [
    "assets/logo-light.png",
    "assets/logo.png",
    "assets/logo-dark.png",
    "assets/icon.png",
    "assets/icon.svg",
    "logo.png",
    "icon.png",
    "codex/assets/logo-light.png",
    "codex/assets/logo.png",
    "claude/assets/logo-light.png",
    ".grok-plugin/logo.png",
    ".codex-plugin/logo.png",
  ];
  return rels.map((r) => `${root}/${r}`);
}

/** Manifest path candidates under plugin install root. */
export function pluginManifestPathCandidates(pluginRoot: string): string[] {
  const root = pluginRoot.replace(/[/\\]+$/, "");
  if (!root) return [];
  return [
    `${root}/.grok-plugin/plugin.json`,
    `${root}/.codex-plugin/plugin.json`,
    `${root}/codex/.codex-plugin/plugin.json`,
    `${root}/.claude-plugin/plugin.json`,
    `${root}/claude/.claude-plugin/plugin.json`,
    `${root}/plugin.json`,
  ];
}

export type PluginManifestLike = {
  name?: string;
  description?: string;
  interface?: {
    displayName?: string;
    shortDescription?: string;
    category?: string;
  };
  keywords?: string[];
};

export function parsePluginManifestJson(raw: string): PluginManifestLike | null {
  try {
    const v = JSON.parse(raw) as PluginManifestLike;
    if (!v || typeof v !== "object") return null;
    return v;
  } catch {
    return null;
  }
}

export function buildInstalledCard(
  plugin: {
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
  },
  opts?: {
    chatcutLabel?: string;
    manifest?: PluginManifestLike | null;
    iconPath?: string | null;
    iconUrl?: string | null;
    categoryLabel?: (k: PluginCardKind) => string;
  },
): PluginCardModel {
  const chatcutLabel = opts?.chatcutLabel ?? "ChatCut";
  const m = opts?.manifest;
  const iface = m?.interface;
  const displayName =
    iface?.displayName?.trim() ||
    pluginDisplayName(plugin as PluginLikeForMatch, chatcutLabel);
  const description =
    iface?.shortDescription?.trim() ||
    m?.description?.trim() ||
    plugin.marketplace ||
    plugin.source ||
    "";
  let category = normalizePluginCategory(iface?.category);
  if (category === "other" && isChatCutInstalled([plugin])) {
    category = "video";
  }
  if (category === "other") {
    category = categoryFromProvides(plugin.provides);
  }
  if (category === "other" && Array.isArray(m?.keywords)) {
    category = normalizePluginCategory(m!.keywords!.join(" "));
  }
  const provides = plugin.provides;
  const bits: string[] = [];
  if (provides) {
    if (Number(provides.skills ?? 0) > 0) bits.push(`${provides.skills} skills`);
    if (Number(provides.agents ?? 0) > 0) bits.push(`${provides.agents} agents`);
    if (provides.hooks) bits.push("hooks");
    if (Number(provides.mcpServers ?? 0) > 0) bits.push("MCP");
  }
  return {
    id: `${plugin.marketplace ?? ""}:${plugin.name}`,
    name: plugin.name,
    displayName,
    description,
    category,
    categoryLabel: opts?.categoryLabel?.(category) ?? category,
    enabled: !!plugin.enabled,
    installed: true,
    marketplace: plugin.marketplace,
    path: plugin.path,
    version: plugin.version,
    iconPath: opts?.iconPath ?? null,
    iconUrl: opts?.iconUrl ?? null,
    providesLine: bits.length ? bits.join(" · ") : null,
  };
}

export function buildAvailableCard(
  plugin: {
    name: string;
    description?: string | null;
    marketplace?: string | null;
    version?: string | null;
    skillCount?: number | null;
    hasHooks?: boolean;
    hasAgents?: boolean;
    hasMcp?: boolean;
  },
  opts?: {
    installed?: boolean;
    installSource?: string | null;
    categoryLabel?: (k: PluginCardKind) => string;
    /** Prefer plugin.json / meta `interface.category` when known. */
    categoryHint?: string | null;
  },
): PluginCardModel {
  const description = (plugin.description ?? "").trim();
  let category = normalizePluginCategory(opts?.categoryHint);
  if (category === "other") {
    category = normalizePluginCategory(
      [plugin.marketplace, description, plugin.name].filter(Boolean).join(" "),
    );
  }
  if (category === "other") {
    category = categoryFromProvides({
      skills: plugin.skillCount,
      agents: plugin.hasAgents ? 1 : 0,
      hooks: plugin.hasHooks,
      mcpServers: plugin.hasMcp ? 1 : 0,
    });
  }
  const bits: string[] = [];
  if (Number(plugin.skillCount ?? 0) > 0) {
    bits.push(`${plugin.skillCount} skills`);
  }
  if (plugin.hasAgents) bits.push("agents");
  if (plugin.hasHooks) bits.push("hooks");
  if (plugin.hasMcp) bits.push("MCP");
  return {
    id: `${plugin.marketplace ?? ""}:${plugin.name}`,
    name: plugin.name,
    displayName: plugin.name,
    description,
    category,
    categoryLabel: opts?.categoryLabel?.(category) ?? category,
    enabled: true,
    installed: !!opts?.installed,
    marketplace: plugin.marketplace,
    version: plugin.version,
    installSource: opts?.installSource ?? null,
    providesLine: bits.length ? bits.join(" · ") : null,
  };
}

/** Initials for icon fallback (1–2 chars). */
export function pluginInitials(displayName: string): string {
  const s = displayName.trim();
  if (!s) return "P";
  // Prefer Latin initials
  const words = s.split(/[\s\-_./]+/).filter(Boolean);
  if (words.length >= 2 && /^[A-Za-z]/.test(words[0]!) && /^[A-Za-z]/.test(words[1]!)) {
    return (words[0]![0]! + words[1]![0]!).toUpperCase();
  }
  if (/^[\u4e00-\u9fff]/.test(s)) return s.slice(0, 1);
  return s.slice(0, 2).toUpperCase();
}
