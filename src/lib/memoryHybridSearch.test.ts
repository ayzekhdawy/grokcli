import { describe, expect, it } from "vitest";
import {
  CLI_MEMORY_HYBRID_SEARCH_AVAILABLE,
  effectiveMemorySearchKind,
  memorySearchKindIsKeywordOnly,
  memorySearchKindStatusKey,
  memorySearchModeChipLabelKey,
  memorySearchModeChips,
  memoryHybridUnavailableHintKey,
  normalizeMemorySearchKind,
  resolveMemorySearchKind,
  shouldLinkMemoryEmbedFromSearchStatus,
} from "./memoryHybridSearch";

describe("CLI_MEMORY_HYBRID_SEARCH_AVAILABLE", () => {
  it("is false for CLI 0.2.117 (no grok memory search subcommand)", () => {
    expect(CLI_MEMORY_HYBRID_SEARCH_AVAILABLE).toBe(false);
  });
});

describe("resolveMemorySearchKind", () => {
  it("defaults to keyword", () => {
    expect(resolveMemorySearchKind()).toBe("keyword");
    expect(resolveMemorySearchKind({})).toBe("keyword");
    expect(resolveMemorySearchKind({ embeddingConfigured: null })).toBe(
      "keyword",
    );
    expect(resolveMemorySearchKind({ embeddingConfigured: false })).toBe(
      "keyword",
    );
  });

  it("returns hybrid_unavailable when embed set but no host CLI path", () => {
    expect(
      resolveMemorySearchKind({
        embeddingConfigured: true,
        cliHybridAvailable: false,
      }),
    ).toBe("hybrid_unavailable");
    // Default cliHybridAvailable follows CLI_MEMORY_HYBRID_SEARCH_AVAILABLE
    expect(
      resolveMemorySearchKind({ embeddingConfigured: true }),
    ).toBe("hybrid_unavailable");
  });

  it("returns hybrid only when both embed and CLI path exist", () => {
    expect(
      resolveMemorySearchKind({
        embeddingConfigured: true,
        cliHybridAvailable: true,
      }),
    ).toBe("hybrid");
    expect(
      resolveMemorySearchKind({
        embeddingConfigured: false,
        cliHybridAvailable: true,
      }),
    ).toBe("keyword");
  });

  it("never invents hybrid without CLI path", () => {
    expect(
      memorySearchKindIsKeywordOnly(
        resolveMemorySearchKind({ embeddingConfigured: true }),
      ),
    ).toBe(true);
    expect(
      memorySearchKindIsKeywordOnly(
        resolveMemorySearchKind({
          embeddingConfigured: true,
          cliHybridAvailable: true,
        }),
      ),
    ).toBe(false);
  });
});

describe("normalizeMemorySearchKind / effectiveMemorySearchKind", () => {
  it("normalizes host strings soft-fail", () => {
    expect(normalizeMemorySearchKind("keyword")).toBe("keyword");
    expect(normalizeMemorySearchKind("hybrid")).toBe("hybrid");
    expect(normalizeMemorySearchKind("hybrid_unavailable")).toBe(
      "hybrid_unavailable",
    );
    expect(normalizeMemorySearchKind("hybrid-unavailable")).toBe(
      "hybrid_unavailable",
    );
    expect(normalizeMemorySearchKind("HYBRID_UNAVAILABLE")).toBe(
      "hybrid_unavailable",
    );
    expect(normalizeMemorySearchKind("")).toBe("keyword");
    expect(normalizeMemorySearchKind("vector")).toBe("keyword");
    expect(normalizeMemorySearchKind(null)).toBe("keyword");
  });

  it("prefers host search kind when present", () => {
    expect(
      effectiveMemorySearchKind({
        hostSearchKind: "hybrid_unavailable",
        embeddingConfigured: false,
      }),
    ).toBe("hybrid_unavailable");
    expect(
      effectiveMemorySearchKind({
        hostSearchKind: "keyword",
        embeddingConfigured: true,
      }),
    ).toBe("keyword");
  });

  it("falls back to local resolve when host kind missing", () => {
    expect(
      effectiveMemorySearchKind({
        embeddingConfigured: true,
        cliHybridAvailable: false,
      }),
    ).toBe("hybrid_unavailable");
  });
});

describe("memorySearchModeChips", () => {
  it("always includes app keyword", () => {
    expect(memorySearchModeChips()).toEqual(["app_keyword"]);
    expect(memorySearchModeChips({ embeddingConfigured: null })).toEqual([
      "app_keyword",
    ]);
  });

  it("shows cli keyword when embed unset", () => {
    expect(memorySearchModeChips({ embeddingConfigured: false })).toEqual([
      "app_keyword",
      "cli_keyword",
    ]);
  });

  it("shows cli hybrid + hybrid_unavailable when embed on and no CLI path", () => {
    expect(
      memorySearchModeChips({
        embeddingConfigured: true,
        cliHybridAvailable: false,
      }),
    ).toEqual(["app_keyword", "cli_hybrid", "hybrid_unavailable"]);
  });

  it("omits hybrid_unavailable when CLI hybrid path exists", () => {
    expect(
      memorySearchModeChips({
        embeddingConfigured: true,
        cliHybridAvailable: true,
      }),
    ).toEqual(["app_keyword", "cli_hybrid"]);
  });
});

describe("label / status keys + link policy", () => {
  it("maps chip and kind keys", () => {
    expect(memorySearchModeChipLabelKey("app_keyword")).toBe(
      "settings.memoryBrowser.searchMode.appKeyword",
    );
    expect(memorySearchModeChipLabelKey("cli_hybrid")).toBe(
      "settings.memoryBrowser.searchMode.cliHybrid",
    );
    expect(memorySearchModeChipLabelKey("cli_keyword")).toBe(
      "settings.memoryBrowser.searchMode.cliKeyword",
    );
    expect(memorySearchModeChipLabelKey("hybrid_unavailable")).toBe(
      "settings.memoryBrowser.searchMode.hybridUnavailable",
    );
    expect(memorySearchKindStatusKey("keyword")).toBe(
      "settings.memoryBrowser.searchKind.keyword",
    );
    expect(memorySearchKindStatusKey("hybrid_unavailable")).toBe(
      "settings.memoryBrowser.searchKind.hybridUnavailable",
    );
    expect(memorySearchKindStatusKey("hybrid")).toBe(
      "settings.memoryBrowser.searchKind.hybrid",
    );
    expect(memoryHybridUnavailableHintKey()).toBe(
      "settings.memoryBrowser.hybridUnavailableHint",
    );
  });

  it("links embed settings only when model unset", () => {
    expect(shouldLinkMemoryEmbedFromSearchStatus(false)).toBe(true);
    expect(shouldLinkMemoryEmbedFromSearchStatus(true)).toBe(false);
    expect(shouldLinkMemoryEmbedFromSearchStatus(null)).toBe(false);
    expect(shouldLinkMemoryEmbedFromSearchStatus(undefined)).toBe(false);
  });
});
