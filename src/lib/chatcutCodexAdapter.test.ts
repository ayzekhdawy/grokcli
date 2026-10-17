import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adaptCodexPackageToGrok,
  chatcutMcpCliAddArgs,
  chatcutParityChecklist,
  inventoryCodexPackage,
} from "./chatcutCodexAdapter";
import {
  CHATCUT_MCP_SURFACE_CODEX,
  CHATCUT_MCP_URL,
} from "./chatcutHandoff";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "chatcut-codex-minimal");

function loadFixture() {
  const pluginJsonRaw = readFileSync(
    join(FIXTURE, ".codex-plugin", "plugin.json"),
    "utf8",
  );
  const mcpJsonRaw = readFileSync(join(FIXTURE, ".mcp.json"), "utf8");
  const skillsDir = join(FIXTURE, "skills");
  const skillNames = existsSync(skillsDir)
    ? readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];
  return { pluginJsonRaw, mcpJsonRaw, skillNames };
}

describe("inventoryCodexPackage (real fixture files)", () => {
  it("reads codex layout from fixtures/chatcut-codex-minimal", () => {
    expect(existsSync(join(FIXTURE, ".codex-plugin", "plugin.json"))).toBe(
      true,
    );
    const { pluginJsonRaw, mcpJsonRaw, skillNames } = loadFixture();
    const inv = inventoryCodexPackage({
      pluginJsonRaw,
      mcpJsonRaw,
      skillNames,
      hasSkillsDir: true,
    });
    expect(inv.hasCodexManifest).toBe(true);
    expect(inv.hasMcpJson).toBe(true);
    expect(inv.pluginName).toBe("chatcut");
    expect(inv.mcpUrl).toBe(CHATCUT_MCP_URL);
    expect(inv.surfaceHeader).toBe(CHATCUT_MCP_SURFACE_CODEX);
    expect(inv.oauthResource).toContain("api.chatcut.io");
    expect(inv.skillNames.length).toBeGreaterThan(0);
    expect(inv.issues.filter((i) => i.includes("missing"))).toEqual([]);
  });
});

describe("adaptCodexPackageToGrok", () => {
  it("emits Grok manifest + MCP headers without inventing surface", () => {
    const { pluginJsonRaw, mcpJsonRaw, skillNames } = loadFixture();
    const adapted = adaptCodexPackageToGrok({
      pluginJsonRaw,
      mcpJsonRaw,
      skillNames,
    });
    expect(adapted.grokPluginJson.name).toBe("chatcut");
    expect(adapted.grokPluginJson.version).toMatch(/^\d+\.\d+/);
    expect(adapted.surfaceHeader).toBe("codex");
    expect(adapted.mcpUrl).toBe(CHATCUT_MCP_URL);
    expect(adapted.oauthResource).toBe(CHATCUT_MCP_URL);

    const entry = adapted.mcpJson.mcpServers?.chatcut;
    expect(entry?.url).toBe(CHATCUT_MCP_URL);
    expect(entry?.http_headers?.["x-chatcut-mcp-surface"]).toBe("codex");
    expect(entry?.headers?.["x-chatcut-mcp-surface"]).toBe("codex");
    expect(entry?.oauth_resource).toBe(CHATCUT_MCP_URL);
    expect(adapted.skillNames).toContain("chatcut-plugin-basics");
    expect(adapted.migration.noSkillFork.toLowerCase()).toContain("upstream");

    const cli = chatcutMcpCliAddArgs(adapted);
    expect(cli.transport).toBe("http");
    expect(cli.headers.some((h) => h.name === "x-chatcut-mcp-surface")).toBe(
      true,
    );

    const parity = chatcutParityChecklist(adapted);
    expect(parity.every((r) => r.ok)).toBe(true);
  });

  it("defaults surface to codex when upstream omits header", () => {
    const adapted = adaptCodexPackageToGrok({
      pluginJsonRaw: JSON.stringify({
        name: "chatcut",
        version: "1.0.0",
        description: "t",
      }),
      mcpJsonRaw: JSON.stringify({
        mcpServers: {
          chatcut: { url: CHATCUT_MCP_URL },
        },
      }),
      skillNames: ["a"],
    });
    expect(adapted.surfaceHeader).toBe("codex");
  });
});
