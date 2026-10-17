/**
 * Pure helpers for Settings → Extensions → Marketplace.
 * Parses `grok plugin marketplace list --json` and related CLI shapes.
 */

export type MarketplaceSourceLike = {
  name: string;
  kind: string;
  /** Git remote URL when kind is git. */
  url?: string | null;
  /** Local directory when kind is local/path. */
  path?: string | null;
  branch?: string | null;
  /** Nested catalog plugins when CLI includes them (often empty today). */
  plugins?: MarketplaceCatalogPluginLike[];
};

export type MarketplaceCatalogPluginLike = {
  name: string;
  description?: string | null;
  marketplace?: string | null;
  source?: string | null;
  version?: string | null;
};

/** From `grok plugin list --json --available` (status "available"). */
export type AvailablePluginLike = {
  name: string;
  status: string;
  marketplace?: string | null;
  description?: string | null;
  version?: string | null;
  skillCount?: number | null;
  hasHooks?: boolean;
  hasAgents?: boolean;
  hasMcp?: boolean;
};

/** Canonical name for xAI's official marketplace source. */
export const XAI_OFFICIAL_MARKETPLACE = "xAI Official";

/** Match official catalog rows (CLI name may vary slightly). */
export function isXaiOfficialMarketplace(
  name: string | null | undefined,
): boolean {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return false;
  if (n === "xai official" || n === "xai-official" || n === "xai-official-marketplace") {
    return true;
  }
  return n.includes("xai") && n.includes("official");
}

/** Prefer official source when present in the configured list. */
export function pickDefaultMarketplaceFilter(
  sources: { name: string }[],
): string {
  const official = sources.find((s) => isXaiOfficialMarketplace(s.name));
  if (official) return official.name;
  return XAI_OFFICIAL_MARKETPLACE;
}

/**
 * Filter available plugins by marketplace chip.
 * - `"__all__"` → every source
 * - otherwise exact marketplace name (case-insensitive)
 */
export function filterAvailableByMarketplace<
  T extends { marketplace?: string | null },
>(plugins: T[], marketFilter: string): T[] {
  const f = (marketFilter ?? "").trim();
  if (!f || f === "__all__") return plugins;
  if (isXaiOfficialMarketplace(f)) {
    return plugins.filter((p) => isXaiOfficialMarketplace(p.marketplace));
  }
  const lower = f.toLowerCase();
  return plugins.filter(
    (p) => (p.marketplace ?? "").trim().toLowerCase() === lower,
  );
}

/** Enrich top-level counts from CLI `components` when flags are empty. */
export function enrichAvailableFromComponents(
  raw: Record<string, unknown>,
  base: {
    skillCount?: number | null;
    hasHooks?: boolean;
    hasAgents?: boolean;
    hasMcp?: boolean;
  },
): {
  skillCount: number | null;
  hasHooks: boolean;
  hasAgents: boolean;
  hasMcp: boolean;
} {
  let skillCount =
    typeof base.skillCount === "number" ? base.skillCount : null;
  let hasHooks = !!base.hasHooks;
  let hasAgents = !!base.hasAgents;
  let hasMcp = !!base.hasMcp;
  const comps = raw.components;
  if (!comps || typeof comps !== "object") {
    return { skillCount, hasHooks, hasAgents, hasMcp };
  }
  const c = comps as Record<string, unknown>;
  if ((skillCount ?? 0) === 0 && Array.isArray(c.skills)) {
    skillCount = c.skills.length;
  }
  if (!hasHooks && Array.isArray(c.hooks)) {
    hasHooks = c.hooks.length > 0;
  }
  if (!hasAgents && Array.isArray(c.agents)) {
    hasAgents = c.agents.length > 0;
  }
  if (
    !hasMcp &&
    (Array.isArray(c.mcpServers) || Array.isArray(c.mcp_servers))
  ) {
    const arr = (c.mcpServers ?? c.mcp_servers) as unknown[];
    hasMcp = arr.length > 0;
  }
  return { skillCount, hasHooks, hasAgents, hasMcp };
}

function asTrimmedString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s || null;
}

function sourceUrlFromRaw(source: unknown): {
  url: string | null;
  path: string | null;
  branch: string | null;
} {
  if (!source || typeof source !== "object") {
    if (typeof source === "string") {
      const s = source.trim();
      if (!s) return { url: null, path: null, branch: null };
      if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("git@")) {
        return { url: s, path: null, branch: null };
      }
      return { url: null, path: s, branch: null };
    }
    return { url: null, path: null, branch: null };
  }
  const o = source as Record<string, unknown>;
  const url = asTrimmedString(o.url) ?? asTrimmedString(o.git) ?? asTrimmedString(o.remote);
  const path = asTrimmedString(o.path) ?? asTrimmedString(o.local);
  const branch = asTrimmedString(o.branch) ?? asTrimmedString(o.ref);
  return { url, path, branch };
}

function parseCatalogPlugin(raw: unknown): MarketplaceCatalogPluginLike | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = asTrimmedString(o.name);
  if (!name) return null;
  return {
    name,
    description: asTrimmedString(o.description),
    marketplace: asTrimmedString(o.marketplace),
    source: asTrimmedString(o.source) ?? sourceUrlFromRaw(o.source).url,
    version: asTrimmedString(o.version),
  };
}

function parseOneSource(raw: unknown): MarketplaceSourceLike | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = asTrimmedString(o.name);
  if (!name) return null;
  const kind =
    asTrimmedString(o.kind) ??
    asTrimmedString(o.type) ??
    (o.source && typeof o.source === "object" && "path" in (o.source as object)
      ? "local"
      : "git");
  const fromSource = sourceUrlFromRaw(o.source);
  const url =
    fromSource.url ??
    asTrimmedString(o.url) ??
    asTrimmedString(o.git) ??
    null;
  const path =
    fromSource.path ??
    asTrimmedString(o.path) ??
    null;
  const branch = fromSource.branch ?? asTrimmedString(o.branch);
  const pluginsRaw = o.plugins;
  const plugins = Array.isArray(pluginsRaw)
    ? pluginsRaw
        .map(parseCatalogPlugin)
        .filter((p): p is MarketplaceCatalogPluginLike => p != null)
    : undefined;
  return {
    name,
    kind: kind || "git",
    url,
    path,
    branch,
    plugins,
  };
}

/**
 * Parse `grok plugin marketplace list --json`.
 * Accepts a bare array or `{ sources: [...] }` / `{ marketplaces: [...] }`.
 */
export function parseMarketplaceListJson(raw: string): MarketplaceSourceLike[] {
  const text = (raw ?? "").trim();
  if (!text) return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `Failed to parse marketplace list JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  let arr: unknown[] | null = null;
  if (Array.isArray(value)) {
    arr = value;
  } else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const candidate = o.sources ?? o.marketplaces ?? o.items;
    if (Array.isArray(candidate)) arr = candidate;
  }
  if (!arr) {
    throw new Error("marketplace list JSON is not an array");
  }
  const out: MarketplaceSourceLike[] = [];
  for (const item of arr) {
    const src = parseOneSource(item);
    if (src) out.push(src);
  }
  return out;
}

/** Human-readable location for a marketplace source row. */
export function marketplaceSourceLabel(source: MarketplaceSourceLike): string {
  const url = (source.url ?? "").trim();
  if (url) return url;
  const path = (source.path ?? "").trim();
  if (path) return path;
  return "";
}

/** Argument the CLI remove command accepts (git URL or local path). */
export function marketplaceRemoveTarget(source: MarketplaceSourceLike): string | null {
  const url = (source.url ?? "").trim();
  if (url) return url;
  const path = (source.path ?? "").trim();
  if (path) return path;
  return null;
}

/** Reject empty add sources; trim whitespace. */
export function normalizeMarketplaceAddSource(source: string): string {
  const s = (source ?? "").trim();
  if (!s) {
    throw new Error("marketplace source required");
  }
  return s;
}

/**
 * Resolve remove arg for CLI: name → git URL / path from known sources.
 * Passes URLs and absolute paths through.
 */
export function resolveMarketplaceRemoveArg(
  nameOrUrl: string,
  sources: MarketplaceSourceLike[],
): string {
  const raw = (nameOrUrl ?? "").trim();
  if (!raw) {
    throw new Error("marketplace source name or URL required");
  }
  const looksLikeUrl =
    raw.includes("://") ||
    raw.startsWith("git@") ||
    raw.endsWith(".git");
  const looksLikePath =
    raw.startsWith("/") ||
    raw.startsWith("~") ||
    /^[A-Za-z]:[\\/]/.test(raw);
  if (looksLikeUrl || looksLikePath) {
    return raw;
  }
  const lower = raw.toLowerCase();
  const byName = sources.find((s) => s.name.trim().toLowerCase() === lower);
  if (byName) {
    const target = marketplaceRemoveTarget(byName);
    if (target) return target;
  }
  const byUrl = sources.find((s) => {
    const label = marketplaceSourceLabel(s).toLowerCase();
    return label === lower;
  });
  if (byUrl) {
    const target = marketplaceRemoveTarget(byUrl);
    if (target) return target;
  }
  // Fall through: CLI may accept the token as-is on some versions.
  return raw;
}

/** Optional update target: empty → update all (`null`). */
export function normalizeMarketplaceUpdateName(
  name?: string | null,
): string | null {
  const s = (name ?? "").trim();
  return s || null;
}

/**
 * Parse `grok plugin list --json --available` (or plain list).
 * Returns every row; callers filter by status.
 */
export function parsePluginListAvailableJson(raw: string): AvailablePluginLike[] {
  const text = (raw ?? "").trim();
  if (!text) return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `Failed to parse available plugins JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const arr = Array.isArray(value)
    ? value
    : value &&
        typeof value === "object" &&
        Array.isArray((value as Record<string, unknown>).plugins)
      ? ((value as Record<string, unknown>).plugins as unknown[])
      : null;
  if (!arr) {
    throw new Error("available plugins JSON is not an array");
  }
  const out: AvailablePluginLike[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = asTrimmedString(o.name);
    if (!name) continue;
    const status = asTrimmedString(o.status) ?? "available";
    const skillCountRaw =
      typeof o.skill_count === "number"
        ? o.skill_count
        : typeof o.skillCount === "number"
          ? o.skillCount
          : null;
    const enriched = enrichAvailableFromComponents(o, {
      skillCount: skillCountRaw,
      hasHooks: Boolean(o.has_hooks ?? o.hasHooks),
      hasAgents: Boolean(o.has_agents ?? o.hasAgents),
      hasMcp: Boolean(o.has_mcp ?? o.hasMcp),
    });
    out.push({
      name,
      status,
      marketplace: asTrimmedString(o.marketplace),
      description: asTrimmedString(o.description),
      version: asTrimmedString(o.version),
      skillCount: enriched.skillCount,
      hasHooks: enriched.hasHooks,
      hasAgents: enriched.hasAgents,
      hasMcp: enriched.hasMcp,
    });
  }
  return out;
}

/** Only rows the CLI marks as installable from marketplaces. */
export function filterAvailablePlugins(
  plugins: AvailablePluginLike[],
): AvailablePluginLike[] {
  return plugins.filter((p) => {
    const st = (p.status ?? "").trim().toLowerCase();
    return st === "available";
  });
}

/** Case-insensitive name/description/marketplace filter. */
export function filterPluginsByQuery<
  T extends { name: string; description?: string | null; marketplace?: string | null },
>(plugins: T[], query: string): T[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return plugins;
  return plugins.filter((p) => {
    const hay = [p.name, p.description ?? "", p.marketplace ?? ""]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

/**
 * Build install source for `grok plugin install`.
 * - bare name installs from marketplace catalogs
 * - `name@marketplace` pins a source when the name exists in multiple
 * - git URL / owner/repo / path pass through
 */
export function normalizeMarketplaceInstallSource(source: string): string {
  const s = (source ?? "").trim();
  if (!s) {
    throw new Error("plugin source required");
  }
  return s;
}

/** Prefer `name@marketplace` when marketplace is known (avoids multi-source ambiguity). */
export function marketplaceQualifiedInstallSource(
  name: string,
  marketplace?: string | null,
): string {
  const n = normalizeMarketplaceInstallSource(name);
  const m = (marketplace ?? "").trim();
  if (!m) return n;
  // Already qualified
  if (n.includes("@")) return n;
  return `${n}@${m}`;
}

export function sortMarketplaceSourcesByName<T extends { name: string }>(
  sources: T[],
): T[] {
  return [...sources].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export function sortAvailablePluginsByName<T extends { name: string }>(
  plugins: T[],
): T[] {
  return [...plugins].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** Compact meta under an available plugin name. */
export function availablePluginMetaLine(plugin: AvailablePluginLike): string {
  const parts: string[] = [];
  const market = (plugin.marketplace ?? "").trim();
  if (market) parts.push(market);
  const ver = (plugin.version ?? "").trim();
  if (ver) parts.push(`v${ver.replace(/^v/i, "")}`);
  const skills = Number(plugin.skillCount ?? 0);
  if (skills > 0) parts.push(`${skills} skill${skills === 1 ? "" : "s"}`);
  if (plugin.hasHooks) parts.push("hooks");
  if (plugin.hasAgents) parts.push("agents");
  if (plugin.hasMcp) parts.push("MCP");
  return parts.join(" · ");
}

/** Stable list / error-map key for an available (or catalog-matched) plugin. */
export function availablePluginRowKey(
  plugin: Pick<AvailablePluginLike, "name" | "marketplace">,
): string {
  return `${(plugin.marketplace ?? "").trim()}:${plugin.name}`;
}

/** Component chip kinds for marketplace detail UI. */
export type PluginComponentBadgeKind =
  | "skills"
  | "hooks"
  | "agents"
  | "mcp";

/**
 * Badge for skills / hooks / agents / MCP.
 * `label` is a short English technical token for tests / meta lines;
 * UI maps `kind` through i18n.
 */
export type PluginComponentBadge = {
  kind: PluginComponentBadgeKind;
  label: string;
  /** Present for skills (and optionally others) when a count is known. */
  count?: number | null;
};

export type AvailablePluginDetailModel = {
  name: string;
  description: string | null;
  marketplace: string | null;
  version: string | null;
  /** Normalized version label without a leading `v`, or null. */
  versionLabel: string | null;
  status: string;
  skillCount: number | null;
  hasHooks: boolean;
  hasAgents: boolean;
  hasMcp: boolean;
  badges: PluginComponentBadge[];
  metaLine: string;
  /** Qualified source for `plugin install` (`name@marketplace` when known). */
  installSource: string;
  /**
   * True when CLI status is not installable "available"
   * (e.g. already installed, or unknown non-available).
   */
  isInstalled: boolean;
};

function normalizeVersionLabel(version: string | null | undefined): string | null {
  const ver = (version ?? "").trim();
  if (!ver) return null;
  return ver.replace(/^v/i, "");
}

/**
 * Format skill/hooks/agents/MCP badges from counts/flags.
 * Omits zero / false components.
 */
export function formatComponentBadges(
  plugin: Pick<
    AvailablePluginLike,
    "skillCount" | "hasHooks" | "hasAgents" | "hasMcp"
  >,
): PluginComponentBadge[] {
  const badges: PluginComponentBadge[] = [];
  const skills = Number(plugin.skillCount ?? 0);
  if (skills > 0) {
    badges.push({
      kind: "skills",
      label: `${skills} skill${skills === 1 ? "" : "s"}`,
      count: skills,
    });
  }
  if (plugin.hasHooks) {
    badges.push({ kind: "hooks", label: "hooks" });
  }
  if (plugin.hasAgents) {
    badges.push({ kind: "agents", label: "agents" });
  }
  if (plugin.hasMcp) {
    badges.push({ kind: "mcp", label: "MCP" });
  }
  return badges;
}

/** Pure detail model for marketplace catalog / available rows. */
export function availablePluginDetailModel(
  plugin: AvailablePluginLike,
): AvailablePluginDetailModel {
  const status = (plugin.status ?? "").trim() || "available";
  const st = status.toLowerCase();
  const isInstalled = st !== "" && st !== "available";
  const marketplace = (plugin.marketplace ?? "").trim() || null;
  const version = (plugin.version ?? "").trim() || null;
  const description = (plugin.description ?? "").trim() || null;
  const badges = formatComponentBadges(plugin);
  return {
    name: plugin.name,
    description,
    marketplace,
    version,
    versionLabel: normalizeVersionLabel(version),
    status,
    skillCount:
      typeof plugin.skillCount === "number" ? plugin.skillCount : null,
    hasHooks: !!plugin.hasHooks,
    hasAgents: !!plugin.hasAgents,
    hasMcp: !!plugin.hasMcp,
    badges,
    metaLine: availablePluginMetaLine(plugin),
    installSource: marketplaceQualifiedInstallSource(
      plugin.name,
      marketplace,
    ),
    isInstalled,
  };
}

/**
 * Build a detail model from an installed plugin when catalog/provides data exists.
 * Returns null when there is nothing useful beyond the name.
 */
export function installedPluginDetailModel(plugin: {
  name: string;
  version?: string | null;
  marketplace?: string | null;
  status?: string | null;
  description?: string | null;
  provides?: {
    skills?: number | null;
    agents?: number | null;
    hooks?: boolean | null;
    mcpServers?: number | null;
  } | null;
}): AvailablePluginDetailModel | null {
  const name = (plugin.name ?? "").trim();
  if (!name) return null;
  const provides = plugin.provides;
  const skillCount =
    typeof provides?.skills === "number" ? provides.skills : null;
  const hasHooks = !!provides?.hooks;
  const hasAgents = (Number(provides?.agents ?? 0) || 0) > 0;
  const hasMcp = (Number(provides?.mcpServers ?? 0) || 0) > 0;
  const description = (plugin.description ?? "").trim() || null;
  const marketplace = (plugin.marketplace ?? "").trim() || null;
  const version = (plugin.version ?? "").trim() || null;
  const hasMeta =
    !!description ||
    !!marketplace ||
    !!version ||
    (skillCount ?? 0) > 0 ||
    hasHooks ||
    hasAgents ||
    hasMcp;
  if (!hasMeta) return null;
  return availablePluginDetailModel({
    name,
    status: (plugin.status ?? "").trim() || "installed",
    marketplace,
    description,
    version,
    skillCount,
    hasHooks,
    hasAgents,
    hasMcp,
  });
}

/** Set last install/update error for a plugin row key (immutable). */
export function setPluginRowError(
  errors: Record<string, string>,
  rowKey: string,
  message: string,
): Record<string, string> {
  const key = (rowKey ?? "").trim();
  const msg = (message ?? "").trim();
  if (!key || !msg) return errors;
  if (errors[key] === msg) return errors;
  return { ...errors, [key]: msg };
}

/** Clear last install/update error for a plugin row key (immutable). */
export function clearPluginRowError(
  errors: Record<string, string>,
  rowKey: string,
): Record<string, string> {
  const key = (rowKey ?? "").trim();
  if (!key || !(key in errors)) return errors;
  const next = { ...errors };
  delete next[key];
  return next;
}

/** Cap large catalogs for UI rendering; prefer filtered lists before calling. */
export function takePluginsPage<T>(plugins: T[], limit = 40): T[] {
  const n = Math.max(0, Math.floor(limit));
  if (plugins.length <= n) return plugins;
  return plugins.slice(0, n);
}
