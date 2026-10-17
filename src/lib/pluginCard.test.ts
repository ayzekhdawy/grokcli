import { describe, expect, it } from "vitest";
import {
  buildAvailableCard,
  buildInstalledCard,
  groupPluginCards,
  normalizePluginCategory,
  pluginIconPathCandidates,
  pluginInitials,
  pluginManifestPathCandidates,
} from "./pluginCard";

describe("pluginCard", () => {
  it("normalizes categories", () => {
    expect(normalizePluginCategory("Design")).toBe("design");
    expect(normalizePluginCategory("video editing")).toBe("video");
    expect(normalizePluginCategory("MCP Server")).toBe("mcp");
  });

  it("maps codex installed plugin to ChatCut video card", () => {
    const card = buildInstalledCard(
      {
        name: "codex",
        path: "/plugins/agent-plugin",
        enabled: true,
        source: "https://github.com/ChatCut-Inc/agent-plugin",
      },
      {
        manifest: {
          interface: {
            displayName: "ChatCut",
            shortDescription: "Edit videos",
            category: "Design",
          },
        },
      },
    );
    expect(card.displayName).toBe("ChatCut");
    expect(card.category).toBe("design");
    expect(card.installed).toBe(true);
  });

  it("groups cards by category order", () => {
    const groups = groupPluginCards([
      { category: "other" as const, id: "a" },
      { category: "video" as const, id: "b" },
      { category: "mcp" as const, id: "c" },
    ]);
    expect(groups.map((g) => g.category)).toEqual(["video", "mcp", "other"]);
  });

  it("normalizes openai marketplace categories", () => {
    expect(normalizePluginCategory("Developer Tools")).toBe("devtools");
    expect(normalizePluginCategory("Finance")).toBe("productivity");
    expect(normalizePluginCategory("Creativity")).toBe("design");
    expect(normalizePluginCategory("Data & Analytics")).toBe("devtools");
  });

  it("prefers categoryHint on available cards", () => {
    const card = buildAvailableCard(
      {
        name: "taxdown",
        description: "tax helper",
        marketplace: "plugins",
      },
      { categoryHint: "Finance" },
    );
    expect(card.category).toBe("productivity");
  });


  it("builds icon/manifest candidates under root", () => {
    const icons = pluginIconPathCandidates("/root/plugin");
    expect(icons.some((p) => p.endsWith("assets/logo-light.png"))).toBe(true);
    const manifests = pluginManifestPathCandidates("/root/plugin");
    expect(manifests.some((p) => p.includes("plugin.json"))).toBe(true);
  });

  it("initials and available card", () => {
    expect(pluginInitials("ChatCut")).toBe("CH");
    expect(pluginInitials("视频剪辑")).toBe("视");
    const avail = buildAvailableCard(
      {
        name: "github",
        description: "Git tools",
        marketplace: "xAI Official",
        skillCount: 2,
      },
      { installSource: "github@xAI Official" },
    );
    expect(avail.displayName).toBe("github");
    expect(avail.installSource).toContain("github");
  });
});
