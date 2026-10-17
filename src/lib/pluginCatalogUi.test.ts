import { describe, expect, it } from "vitest";
import {
  availableToCards,
  buildInstalledPluginNameSet,
  dedupeAvailablePluginsByName,
  filterPluginCardsByQuery,
  groupPluginCardsByLabel,
  installedPluginAliasKeys,
  isCatalogPluginInstalled,
  resolvePluginLogoPath,
  pickExpandStackLogos,
  sliceCatalogPage,
  sliceGroupedCatalogPage,
  splitGroupItemsForCollapse,
} from "./pluginCatalogUi";

describe("pluginCatalogUi", () => {
  it("maps hash-suffixed install names back to catalog slugs", () => {
    const keys = installedPluginAliasKeys({
      name: "game-studio-8978c99b",
      source:
        "/Users/x/.grok/marketplace-cache/abc/plugins/game-studio",
      marketplace: "plugins",
    });
    expect(keys).toContain("game-studio-8978c99b");
    expect(keys).toContain("game-studio");
    const set = buildInstalledPluginNameSet([
      {
        name: "game-studio-8978c99b",
        source: "/cache/plugins/game-studio",
      },
      { name: "codex" },
    ]);
    expect(isCatalogPluginInstalled("game-studio", set)).toBe(true);
    expect(isCatalogPluginInstalled("codex", set)).toBe(true);
    expect(isCatalogPluginInstalled("vercel", set)).toBe(false);
  });

  it("marks available cards installed when aliases match", () => {
    const set = buildInstalledPluginNameSet([
      {
        name: "game-studio-8978c99b",
        source: "/cache/plugins/game-studio",
      },
    ]);
    const cards = availableToCards(
      [
        {
          name: "game-studio",
          status: "available",
          description: "Game studio",
          marketplace: "plugins",
        },
        {
          name: "vercel",
          status: "available",
          description: "Deploy",
          marketplace: "plugins",
        },
      ],
      { installedNames: set },
    );
    expect(cards.find((c) => c.name === "game-studio")?.installed).toBe(true);
    expect(cards.find((c) => c.name === "vercel")?.installed).toBe(false);
  });

  it("groups cards by marketplace category labels from meta", () => {
    const meta = new Map([
      ["vercel", { category: "Developer Tools", description: "deploy" }],
      ["taxdown", { category: "Finance", description: "tax" }],
      ["granola", { category: "Communication", description: "notes" }],
    ]);
    const cards = availableToCards(
      [
        {
          name: "taxdown",
          status: "available",
          description: "tax",
          marketplace: "plugins",
        },
        {
          name: "vercel",
          status: "available",
          description: "deploy",
          marketplace: "plugins",
        },
        {
          name: "granola",
          status: "available",
          description: "notes",
          marketplace: "plugins",
        },
      ],
      { metaByName: meta },
    );
    const groups = groupPluginCardsByLabel(cards);
    expect(groups.map((g) => g.label)).toEqual([
      "Developer Tools",
      "Finance",
      "Communication",
    ]);
    expect(groups[0]?.items.map((i) => i.name)).toEqual(["vercel"]);
  });

  it("collapses category groups at 8+ items to 7 + more tile", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const collapsed = splitGroupItemsForCollapse(items, false);
    expect(collapsed.visible).toHaveLength(7);
    expect(collapsed.remaining).toHaveLength(3);
    expect(collapsed.moreCount).toBe(3);
    expect(collapsed.collapsed).toBe(true);

    const seven = splitGroupItemsForCollapse(
      Array.from({ length: 7 }, (_, i) => ({ id: i })),
      false,
    );
    expect(seven.collapsed).toBe(false);
    expect(seven.visible).toHaveLength(7);

    const expanded = splitGroupItemsForCollapse(items, true);
    expect(expanded.collapsed).toBe(false);
    expect(expanded.visible).toHaveLength(10);
  });

  it("picks expand stack logos: image-only, reverse paint order", () => {
    const stack = pickExpandStackLogos(
      [
        { name: "a", displayName: "A", iconUrl: null },
        { name: "b", displayName: "B", iconUrl: "https://x/b.png" },
        { name: "c", displayName: "C", iconUrl: "" },
        { name: "d", displayName: "D", iconUrl: "https://x/d.png" },
        { name: "e", displayName: "E", iconUrl: "https://x/e.png" },
      ],
      4,
    );
    // Only image logos; reversed so first preferred is on top (right)
    expect(stack.map((s) => s.key)).toEqual(["e", "d", "b"]);
    expect(stack.every((s) => s.iconUrl.startsWith("https://"))).toBe(true);
  });


  it("paginates grouped catalog without reshuffling earlier sections", () => {
    // 30 Developer Tools + 10 Finance — page size 24 should only show Dev Tools
    // first, then append Finance on page 2 (not inject Finance mid-list then
    // re-sort on next page).
    const plugins = [
      ...Array.from({ length: 30 }, (_, i) => ({
        name: `dev-${i}`,
        status: "available" as const,
        description: "tool",
        marketplace: "plugins",
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        name: `fin-${i}`,
        status: "available" as const,
        description: "money",
        marketplace: "plugins",
      })),
    ];
    const meta = new Map<string, { category: string }>();
    for (let i = 0; i < 30; i++) meta.set(`dev-${i}`, { category: "Developer Tools" });
    for (let i = 0; i < 10; i++) meta.set(`fin-${i}`, { category: "Finance" });
    const cards = availableToCards(plugins, { metaByName: meta });

    const p1 = sliceGroupedCatalogPage(cards, 1, 24);
    expect(p1.visibleCount).toBe(24);
    expect(p1.hasMore).toBe(true);
    expect(p1.groups.map((g) => g.label)).toEqual(["Developer Tools"]);
    expect(p1.groups[0]?.items).toHaveLength(24);
    const p1Names = p1.groups[0]!.items.map((c) => c.name);

    const p2 = sliceGroupedCatalogPage(cards, 2, 24);
    expect(p2.visibleCount).toBe(40);
    expect(p2.hasMore).toBe(false);
    // First 24 of Developer Tools must be identical prefix (no reshuffle)
    expect(p2.groups[0]?.items.slice(0, 24).map((c) => c.name)).toEqual(p1Names);
    expect(p2.groups.map((g) => g.label)).toEqual([
      "Developer Tools",
      "Finance",
    ]);
    expect(p2.groups[0]?.items).toHaveLength(30);
    expect(p2.groups[1]?.items).toHaveLength(10);
  });

  it("dedupes same name from multiple marketplaces", () => {
    const out = dedupeAvailablePluginsByName([
      {
        name: "vercel",
        description: "short",
        marketplace: "plugins",
      },
      {
        name: "vercel",
        description: "Vercel deployment platform integration. Longer.",
        marketplace: "xAI Official",
      },
      {
        name: "Sentry",
        description: "errors",
        marketplace: "xAI Official",
      },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((p) => p.name === "vercel")?.marketplace).toBe(
      "xAI Official",
    );
  });

  it("availableToCards does not emit duplicate names", () => {
    const cards = availableToCards([
      {
        name: "vercel",
        status: "available",
        description: "a",
        marketplace: "xAI Official",
      },
      {
        name: "vercel",
        status: "available",
        description: "b",
        marketplace: "plugins",
      },
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.id).toBe("vercel");
  });

  it("pages catalog with hasMore", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const p1 = sliceCatalogPage(items, 1, 24);
    expect(p1.visible).toHaveLength(24);
    expect(p1.hasMore).toBe(true);
    const p3 = sliceCatalogPage(items, 3, 24);
    expect(p3.visible).toHaveLength(50);
    expect(p3.hasMore).toBe(false);
  });

  it("maps available plugins with descriptions", () => {
    const cards = availableToCards([
      {
        name: "vercel",
        status: "available",
        description: "Vercel deployment platform",
        marketplace: "xAI Official",
        skillCount: 3,
      },
    ]);
    expect(cards[0]?.description).toContain("Vercel");
    expect(cards[0]?.displayName).toBe("vercel");
  });

  it("filters cards by query", () => {
    const cards = availableToCards([
      {
        name: "vercel",
        status: "available",
        description: "deploy",
        marketplace: "xAI Official",
      },
      {
        name: "sentry",
        status: "available",
        description: "errors",
        marketplace: "xAI Official",
      },
    ]);
    expect(filterPluginCardsByQuery(cards, "sentry")).toHaveLength(1);
  });

  it("resolves logo relative paths", () => {
    expect(
      resolvePluginLogoPath("/cache/plugins/neon", "assets/logo.svg"),
    ).toBe("/cache/plugins/neon/assets/logo.svg");
    expect(
      resolvePluginLogoPath("/cache/plugins/neon/.grok-plugin", "../assets/logo.svg"),
    ).toBe("/cache/plugins/neon/assets/logo.svg");
  });
});
