import { beforeEach, describe, expect, it } from "vitest";
import {
  availablePluginDetailModel,
  availablePluginMetaLine,
  availablePluginRowKey,
  clearPluginRowError,
  enrichAvailableFromComponents,
  filterAvailableByMarketplace,
  filterAvailablePlugins,
  filterPluginsByQuery,
  formatComponentBadges,
  installedPluginDetailModel,
  isXaiOfficialMarketplace,
  marketplaceQualifiedInstallSource,
  marketplaceRemoveTarget,
  marketplaceSourceLabel,
  normalizeMarketplaceAddSource,
  normalizeMarketplaceInstallSource,
  normalizeMarketplaceUpdateName,
  parseMarketplaceListJson,
  parsePluginListAvailableJson,
  pickDefaultMarketplaceFilter,
  resolveMarketplaceRemoveArg,
  setPluginRowError,
  sortMarketplaceSourcesByName,
  takePluginsPage,
  XAI_OFFICIAL_MARKETPLACE,
} from "./pluginMarketplace";
import {
  __resetMarketplaceCatalogCacheForTests,
  invalidateMarketplaceCatalogCache,
  isMarketplaceCatalogFresh,
  loadMarketplaceCatalog,
  removeAvailablePluginFromCache,
} from "./marketplaceCatalogCache";

const SAMPLE_LIST = `[
  {
    "name": "xAI Official",
    "kind": "git",
    "source": {
      "url": "https://github.com/xai-org/plugin-marketplace.git",
      "branch": null
    }
  },
  {
    "name": "claude-plugins-official",
    "kind": "git",
    "source": {
      "url": "https://github.com/anthropics/claude-plugins-official.git",
      "branch": null
    }
  }
]`;

describe("parseMarketplaceListJson", () => {
  it("parses CLI array of sources without nested plugins", () => {
    const sources = parseMarketplaceListJson(SAMPLE_LIST);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      name: "xAI Official",
      kind: "git",
      url: "https://github.com/xai-org/plugin-marketplace.git",
    });
    expect(sources[1].name).toBe("claude-plugins-official");
    expect(marketplaceSourceLabel(sources[0])).toContain("xai-org/plugin-marketplace");
  });

  it("accepts wrapped { sources: [...] } and local path sources", () => {
    const raw = JSON.stringify({
      sources: [
        {
          name: "local-cat",
          kind: "local",
          source: { path: "/tmp/my-marketplace" },
        },
      ],
    });
    const sources = parseMarketplaceListJson(raw);
    expect(sources).toHaveLength(1);
    expect(sources[0].path).toBe("/tmp/my-marketplace");
    expect(marketplaceRemoveTarget(sources[0])).toBe("/tmp/my-marketplace");
  });

  it("keeps nested plugins when CLI includes them", () => {
    const raw = JSON.stringify([
      {
        name: "demo",
        kind: "git",
        source: { url: "https://example.com/m.git" },
        plugins: [
          { name: "alpha", description: "A" },
          { name: "  " },
        ],
      },
    ]);
    const sources = parseMarketplaceListJson(raw);
    expect(sources[0].plugins).toHaveLength(1);
    expect(sources[0].plugins?.[0].name).toBe("alpha");
  });

  it("returns empty for blank; throws on invalid JSON / shape", () => {
    expect(parseMarketplaceListJson("")).toEqual([]);
    expect(parseMarketplaceListJson("   ")).toEqual([]);
    expect(() => parseMarketplaceListJson("{")).toThrow(/parse marketplace list/i);
    expect(() => parseMarketplaceListJson('{"nope":1}')).toThrow(/not an array/i);
  });

  it("skips entries without a name", () => {
    const raw = JSON.stringify([
      { kind: "git", source: { url: "https://x.test/a.git" } },
      { name: "ok", kind: "git", source: { url: "https://x.test/b.git" } },
    ]);
    expect(parseMarketplaceListJson(raw).map((s) => s.name)).toEqual(["ok"]);
  });
});

describe("normalizeMarketplaceAddSource / update / install", () => {
  it("trims add source and rejects empty", () => {
    expect(normalizeMarketplaceAddSource("  owner/repo  ")).toBe("owner/repo");
    expect(() => normalizeMarketplaceAddSource("")).toThrow(/required/i);
    expect(() => normalizeMarketplaceAddSource("   ")).toThrow(/required/i);
  });

  it("update name: empty means all", () => {
    expect(normalizeMarketplaceUpdateName(undefined)).toBeNull();
    expect(normalizeMarketplaceUpdateName(null)).toBeNull();
    expect(normalizeMarketplaceUpdateName("  ")).toBeNull();
    expect(normalizeMarketplaceUpdateName("xAI Official")).toBe("xAI Official");
  });

  it("install source trim + qualify with marketplace", () => {
    expect(normalizeMarketplaceInstallSource(" vercel ")).toBe("vercel");
    expect(() => normalizeMarketplaceInstallSource("")).toThrow(/required/i);
    expect(marketplaceQualifiedInstallSource("vercel", "xAI Official")).toBe(
      "vercel@xAI Official",
    );
    expect(marketplaceQualifiedInstallSource("vercel@other", "xAI Official")).toBe(
      "vercel@other",
    );
    expect(marketplaceQualifiedInstallSource("vercel", null)).toBe("vercel");
  });
});

describe("resolveMarketplaceRemoveArg", () => {
  const sources = parseMarketplaceListJson(SAMPLE_LIST);

  it("maps source name to git URL (CLI remove wants URL)", () => {
    expect(resolveMarketplaceRemoveArg("xAI Official", sources)).toBe(
      "https://github.com/xai-org/plugin-marketplace.git",
    );
    expect(resolveMarketplaceRemoveArg("claude-plugins-official", sources)).toBe(
      "https://github.com/anthropics/claude-plugins-official.git",
    );
  });

  it("passes URLs and paths through", () => {
    expect(
      resolveMarketplaceRemoveArg(
        "https://github.com/xai-org/plugin-marketplace.git",
        sources,
      ),
    ).toBe("https://github.com/xai-org/plugin-marketplace.git");
    expect(resolveMarketplaceRemoveArg("/tmp/mkt", sources)).toBe("/tmp/mkt");
  });

  it("rejects empty", () => {
    expect(() => resolveMarketplaceRemoveArg("  ", sources)).toThrow(/required/i);
  });
});

describe("parsePluginListAvailableJson / filter", () => {
  const raw = `[
    {"status":"installed","name":"cloudflare","marketplace":"xAI Official"},
    {
      "status":"available",
      "name":"vercel",
      "description":"Vercel deploy",
      "marketplace":"xAI Official",
      "skill_count":2,
      "has_hooks":false,
      "has_agents":true,
      "has_mcp":false
    },
    {
      "status":"available",
      "name":"sentry",
      "marketplace":"xAI Official",
      "description":"errors"
    }
  ]`;

  it("parses available + installed rows", () => {
    const all = parsePluginListAvailableJson(raw);
    expect(all).toHaveLength(3);
    const avail = filterAvailablePlugins(all);
    expect(avail.map((p) => p.name)).toEqual(["vercel", "sentry"]);
    expect(avail[0].skillCount).toBe(2);
    expect(avail[0].hasAgents).toBe(true);
  });

  it("filters by query and meta line", () => {
    const avail = filterAvailablePlugins(parsePluginListAvailableJson(raw));
    expect(avail.map((p) => p.name)).toEqual(["vercel", "sentry"]);
    expect(filterPluginsByQuery(avail, "vercel").map((p) => p.name)).toEqual([
      "vercel",
    ]);
    expect(filterPluginsByQuery(avail, "deploy").map((p) => p.name)).toEqual([
      "vercel",
    ]);
    expect(filterPluginsByQuery(avail, "xai").length).toBe(2);
    expect(availablePluginMetaLine(avail[0])).toContain("xAI Official");
    expect(availablePluginMetaLine(avail[0])).toContain("2 skills");
    expect(availablePluginMetaLine(avail[0])).toContain("agents");
  });

  it("throws on bad shape; empty ok", () => {
    expect(parsePluginListAvailableJson("")).toEqual([]);
    expect(() => parsePluginListAvailableJson("null")).toThrow(/not an array/i);
  });
});

describe("sort / page helpers", () => {
  it("sorts sources by name", () => {
    const sorted = sortMarketplaceSourcesByName([
      { name: "z" },
      { name: "a" },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(["a", "z"]);
  });

  it("pages large lists", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    expect(takePluginsPage(items, 40)).toHaveLength(40);
    expect(takePluginsPage(items, 0)).toHaveLength(0);
    expect(takePluginsPage([1, 2], 40)).toEqual([1, 2]);
  });
});

describe("official filter + components enrich", () => {
  it("detects xAI Official marketplace names", () => {
    expect(isXaiOfficialMarketplace("xAI Official")).toBe(true);
    expect(isXaiOfficialMarketplace("xai-official")).toBe(true);
    expect(isXaiOfficialMarketplace("claude-plugins-official")).toBe(false);
    expect(pickDefaultMarketplaceFilter([{ name: "xAI Official" }])).toBe(
      "xAI Official",
    );
    expect(pickDefaultMarketplaceFilter([])).toBe(XAI_OFFICIAL_MARKETPLACE);
  });

  it("filters available by marketplace chip", () => {
    const rows = [
      { name: "a", marketplace: "xAI Official" },
      { name: "b", marketplace: "claude-plugins-official" },
    ];
    expect(filterAvailableByMarketplace(rows, "xAI Official").map((p) => p.name)).toEqual([
      "a",
    ]);
    expect(filterAvailableByMarketplace(rows, "__all__")).toHaveLength(2);
  });

  it("enriches skill/MCP counts from components when top-level is empty", () => {
    const enriched = enrichAvailableFromComponents(
      {
        skill_count: 0,
        has_mcp: false,
        components: {
          skills: [{ name: "s1" }, { name: "s2" }],
          mcpServers: [{ name: "m" }],
          hooks: [{ name: "h" }],
          agents: [],
        },
      },
      { skillCount: 0, hasHooks: false, hasAgents: false, hasMcp: false },
    );
    expect(enriched.skillCount).toBe(2);
    expect(enriched.hasMcp).toBe(true);
    expect(enriched.hasHooks).toBe(true);
    expect(enriched.hasAgents).toBe(false);
  });

  it("parses available JSON with components enrich", () => {
    const raw = JSON.stringify([
      {
        status: "available",
        name: "vercel",
        marketplace: "xAI Official",
        skill_count: 0,
        has_mcp: false,
        components: {
          skills: [{}, {}, {}],
          mcpServers: [{}],
        },
      },
    ]);
    const [p] = filterAvailablePlugins(parsePluginListAvailableJson(raw));
    expect(p.skillCount).toBe(3);
    expect(p.hasMcp).toBe(true);
  });
});

describe("marketplaceCatalogCache", () => {
  beforeEach(() => {
    __resetMarketplaceCatalogCacheForTests();
  });

  it("returns cached snapshot without re-fetching", async () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return {
        sources: [{ name: "xAI Official", kind: "git" }],
        available: [{ name: "vercel", status: "available" }],
      };
    };
    const first = await loadMarketplaceCatalog(fetch);
    expect(first.fromCache).toBe(false);
    expect(calls).toBe(1);
    const second = await loadMarketplaceCatalog(fetch);
    expect(second.fromCache).toBe(true);
    expect(calls).toBe(1);
    expect(isMarketplaceCatalogFresh()).toBe(true);

    await loadMarketplaceCatalog(fetch, { force: true });
    expect(calls).toBe(2);

    removeAvailablePluginFromCache("vercel", null);
    const after = await loadMarketplaceCatalog(fetch);
    expect(after.available).toHaveLength(0);
    expect(after.fromCache).toBe(true);

    invalidateMarketplaceCatalogCache();
    expect(isMarketplaceCatalogFresh()).toBe(false);
  });
});

describe("availablePluginDetailModel / formatComponentBadges", () => {
  it("builds badges from skill/hooks/agents/mcp flags", () => {
    expect(
      formatComponentBadges({
        skillCount: 1,
        hasHooks: true,
        hasAgents: false,
        hasMcp: true,
      }),
    ).toEqual([
      { kind: "skills", label: "1 skill", count: 1 },
      { kind: "hooks", label: "hooks" },
      { kind: "mcp", label: "MCP" },
    ]);
    expect(
      formatComponentBadges({
        skillCount: 0,
        hasHooks: false,
        hasAgents: false,
        hasMcp: false,
      }),
    ).toEqual([]);
    expect(
      formatComponentBadges({
        skillCount: 2,
        hasHooks: false,
        hasAgents: true,
        hasMcp: false,
      }),
    ).toEqual([
      { kind: "skills", label: "2 skills", count: 2 },
      { kind: "agents", label: "agents" },
    ]);
  });

  it("builds a full detail model for available catalog rows", () => {
    const detail = availablePluginDetailModel({
      name: "vercel",
      status: "available",
      marketplace: "xAI Official",
      description: "Vercel deploy",
      version: "v1.2.0",
      skillCount: 2,
      hasHooks: false,
      hasAgents: true,
      hasMcp: false,
    });
    expect(detail.name).toBe("vercel");
    expect(detail.description).toBe("Vercel deploy");
    expect(detail.marketplace).toBe("xAI Official");
    expect(detail.versionLabel).toBe("1.2.0");
    expect(detail.isInstalled).toBe(false);
    expect(detail.installSource).toBe("vercel@xAI Official");
    expect(detail.badges.map((b) => b.kind)).toEqual(["skills", "agents"]);
    expect(detail.metaLine).toContain("xAI Official");
    expect(availablePluginRowKey(detail)).toBe("xAI Official:vercel");
  });

  it("marks non-available status as installed", () => {
    const detail = availablePluginDetailModel({
      name: "cloudflare",
      status: "installed",
      marketplace: "xAI Official",
    });
    expect(detail.isInstalled).toBe(true);
  });

  it("installedPluginDetailModel uses provides when present; null when empty", () => {
    expect(
      installedPluginDetailModel({
        name: "empty-only",
      }),
    ).toBeNull();

    const detail = installedPluginDetailModel({
      name: "cloudflare",
      marketplace: "xAI Official",
      version: "0.3.1",
      provides: { skills: 3, agents: 1, hooks: true, mcpServers: 0 },
    });
    expect(detail).not.toBeNull();
    expect(detail!.isInstalled).toBe(true);
    expect(detail!.badges.map((b) => b.kind)).toEqual([
      "skills",
      "hooks",
      "agents",
    ]);
    expect(detail!.versionLabel).toBe("0.3.1");
  });
});

describe("plugin row install errors", () => {
  it("sets and clears errors immutably", () => {
    const empty: Record<string, string> = {};
    const withErr = setPluginRowError(empty, "xAI Official:vercel", " boom ");
    expect(withErr).toEqual({ "xAI Official:vercel": "boom" });
    expect(empty).toEqual({});
    // Same message → same object
    expect(setPluginRowError(withErr, "xAI Official:vercel", "boom")).toBe(
      withErr,
    );
    const cleared = clearPluginRowError(withErr, "xAI Official:vercel");
    expect(cleared).toEqual({});
    expect(clearPluginRowError(cleared, "missing")).toBe(cleared);
    expect(setPluginRowError(empty, "", "x")).toBe(empty);
    expect(setPluginRowError(empty, "k", "  ")).toBe(empty);
  });
});
