import { describe, expect, it, vi } from "vitest";
import {
  ensureDefaultMarketplaces,
  filterCatalogToDefaultSources,
  isClaudeMarketplaceSource,
  isDefaultAllowedMarketplaceSource,
  XAI_OFFICIAL_MARKETPLACE_URL,
} from "./marketplaceDefaults";
import { OPENAI_PLUGINS_MARKETPLACE_URL } from "./pluginRecommended";

describe("marketplaceDefaults", () => {
  it("detects Claude sources", () => {
    expect(
      isClaudeMarketplaceSource({
        name: "claude-plugins-official",
        url: "https://github.com/anthropics/claude-plugins-official.git",
      }),
    ).toBe(true);
    expect(
      isClaudeMarketplaceSource({
        name: "everything-claude-code",
        url: "https://github.com/affaan-m/everything-claude-code.git",
      }),
    ).toBe(true);
    expect(
      isClaudeMarketplaceSource({
        name: "xAI Official",
        url: XAI_OFFICIAL_MARKETPLACE_URL,
      }),
    ).toBe(false);
  });

  it("allows only grok official + openai by default", () => {
    expect(
      isDefaultAllowedMarketplaceSource({
        name: "xAI Official",
        url: XAI_OFFICIAL_MARKETPLACE_URL,
      }),
    ).toBe(true);
    expect(
      isDefaultAllowedMarketplaceSource({
        name: "plugins",
        url: OPENAI_PLUGINS_MARKETPLACE_URL,
      }),
    ).toBe(true);
    expect(
      isDefaultAllowedMarketplaceSource({
        name: "claude-plugins-official",
        url: "https://github.com/anthropics/claude-plugins-official.git",
      }),
    ).toBe(false);
  });

  it("ensureDefaultMarketplaces removes Claude and adds missing defaults", async () => {
    let sources = [
      {
        name: "claude-plugins-official",
        url: "https://github.com/anthropics/claude-plugins-official.git",
      },
    ];
    const list = vi.fn(async () => sources);
    const add = vi.fn(async (url: string) => {
      if (url.includes("xai")) {
        sources = [
          ...sources.filter((s) => !s.name.includes("claude")),
          { name: "xAI Official", url },
        ];
      } else if (url.includes("openai")) {
        sources = [...sources, { name: "plugins", url }];
      }
    });
    const remove = vi.fn(async (target: string) => {
      sources = sources.filter(
        (s) => s.name !== target && s.url !== target && !(s.url ?? "").includes("claude"),
      );
      sources = sources.filter((s) => !isClaudeMarketplaceSource(s));
    });
    const res = await ensureDefaultMarketplaces({ list, add, remove });
    expect(remove).toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(XAI_OFFICIAL_MARKETPLACE_URL);
    expect(add).toHaveBeenCalledWith(OPENAI_PLUGINS_MARKETPLACE_URL);
    expect(res.sources.every((s) => !isClaudeMarketplaceSource(s))).toBe(true);
  });

  it("filters catalog rows from Claude marketplaces", () => {
    const filtered = filterCatalogToDefaultSources(
      [
        { name: "a", marketplace: "xAI Official" },
        { name: "b", marketplace: "claude-plugins-official" },
        { name: "c", marketplace: "plugins" },
      ],
      [
        { name: "xAI Official", url: XAI_OFFICIAL_MARKETPLACE_URL },
        { name: "plugins", url: OPENAI_PLUGINS_MARKETPLACE_URL },
      ],
    );
    expect(filtered.map((p) => p.name)).toEqual(["a", "c"]);
  });
});
