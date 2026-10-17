/**
 * ChatCut Codex → Grok plugin layout adapter (pure + Node-free).
 *
 * Codex packages use `.codex-plugin/plugin.json` + `.mcp.json` + `skills/`.
 * Grok `plugin validate` / install discovers `.grok-plugin/plugin.json` (or
 * root `plugin.json`) and standard `skills/` + `.mcp.json`.
 *
 * This module:
 * - Parses Codex manifests without mutating upstream skill bodies.
 * - Builds a Grok-shaped manifest + MCP config (surface header preserved).
 * - Describes install/migration steps for re-pull → re-adapt (no skill fork).
 *
 * Filesystem materialization lives in `scripts/chatcut-plugin-start.mjs`
 * (and optional Node helpers) so unit tests stay pure.
 */

import {
  CHATCUT_MCP_SURFACE_CODEX,
  CHATCUT_MCP_URL,
} from "./chatcutHandoff";

export const CODEX_PLUGIN_MANIFEST_REL = ".codex-plugin/plugin.json";
export const GROK_PLUGIN_MANIFEST_REL = ".grok-plugin/plugin.json";
export const MCP_JSON_REL = ".mcp.json";
export const SKILLS_DIR_REL = "skills";

export type ChatcutCodexPluginJson = {
  name?: string;
  version?: string;
  description?: string;
  author?: unknown;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  mcpServers?: string;
  skills?: string;
  interface?: Record<string, unknown>;
  logo?: string;
  [key: string]: unknown;
};

export type ChatcutMcpServerConfig = {
  url?: string;
  type?: string;
  http_headers?: Record<string, string>;
  headers?: Record<string, string>;
  oauth_resource?: string;
  [key: string]: unknown;
};

export type ChatcutMcpJson = {
  mcpServers?: Record<string, ChatcutMcpServerConfig>;
  [key: string]: unknown;
};

export type AdaptedGrokPluginManifest = {
  name: string;
  version: string;
  description: string;
  author?: unknown;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  logo?: string;
  /** Marker for re-pull / re-adapt tooling (not required by CLI). */
  chatcut?: {
    sourceLayout: "codex";
    surface: string;
    mcpUrl: string;
    oauthResource: string;
  };
};

export type AdaptedChatcutPlugin = {
  /** Grok `.grok-plugin/plugin.json` body. */
  grokPluginJson: AdaptedGrokPluginManifest;
  /** `.mcp.json` body with Grok-friendly headers + Codex surface preserved. */
  mcpJson: ChatcutMcpJson;
  /** Skill directory names discovered under skills/. */
  skillNames: string[];
  /** MCP server entry name (usually `chatcut`). */
  mcpServerName: string;
  surfaceHeader: string;
  mcpUrl: string;
  oauthResource: string;
  /** Human migration notes. */
  migration: {
    rePull: string;
    reAdapt: string;
    noSkillFork: string;
  };
};

export type CodexPackageInventory = {
  hasCodexManifest: boolean;
  hasMcpJson: boolean;
  hasSkillsDir: boolean;
  skillNames: string[];
  pluginName: string | null;
  pluginVersion: string | null;
  mcpUrl: string | null;
  surfaceHeader: string | null;
  oauthResource: string | null;
  issues: string[];
};

/** Parse JSON text; throws with context on failure. */
export function parseJsonObject(
  raw: string,
  label = "json",
): Record<string, unknown> {
  const t = (raw ?? "").trim();
  if (!t) throw new Error(`${label}: empty`);
  let v: unknown;
  try {
    v = JSON.parse(t);
  } catch (e) {
    throw new Error(
      `${label}: invalid JSON (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`${label}: expected object`);
  }
  return v as Record<string, unknown>;
}

export function inventoryCodexPackage(input: {
  pluginJsonRaw?: string | null;
  mcpJsonRaw?: string | null;
  skillNames?: string[] | null;
  hasSkillsDir?: boolean;
}): CodexPackageInventory {
  const issues: string[] = [];
  let pluginName: string | null = null;
  let pluginVersion: string | null = null;
  let hasCodexManifest = false;

  if (input.pluginJsonRaw && input.pluginJsonRaw.trim()) {
    try {
      const p = parseJsonObject(input.pluginJsonRaw, "plugin.json");
      hasCodexManifest = true;
      pluginName = typeof p.name === "string" ? p.name : null;
      pluginVersion = typeof p.version === "string" ? p.version : null;
      if (!pluginName) issues.push("plugin.json missing name");
    } catch (e) {
      issues.push(e instanceof Error ? e.message : String(e));
    }
  } else {
    issues.push("missing .codex-plugin/plugin.json");
  }

  let mcpUrl: string | null = null;
  let surfaceHeader: string | null = null;
  let oauthResource: string | null = null;
  let hasMcpJson = false;

  if (input.mcpJsonRaw && input.mcpJsonRaw.trim()) {
    try {
      const m = parseJsonObject(input.mcpJsonRaw, ".mcp.json") as ChatcutMcpJson;
      hasMcpJson = true;
      const servers = m.mcpServers ?? {};
      const chatcut =
        servers.chatcut ??
        Object.values(servers).find(
          (s) => s && typeof s === "object" && typeof s.url === "string",
        );
      if (chatcut && typeof chatcut === "object") {
        mcpUrl = typeof chatcut.url === "string" ? chatcut.url : null;
        oauthResource =
          typeof chatcut.oauth_resource === "string"
            ? chatcut.oauth_resource
            : null;
        const headers = {
          ...(chatcut.http_headers ?? {}),
          ...(chatcut.headers ?? {}),
        };
        const surface = headers["x-chatcut-mcp-surface"];
        surfaceHeader = typeof surface === "string" ? surface : null;
      } else {
        issues.push(".mcp.json has no chatcut (or url) server entry");
      }
    } catch (e) {
      issues.push(e instanceof Error ? e.message : String(e));
    }
  } else {
    issues.push("missing .mcp.json");
  }

  const skillNames = (input.skillNames ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const hasSkillsDir = input.hasSkillsDir === true || skillNames.length > 0;
  if (!hasSkillsDir || skillNames.length === 0) {
    issues.push("skills inventory empty");
  }

  return {
    hasCodexManifest,
    hasMcpJson,
    hasSkillsDir,
    skillNames,
    pluginName,
    pluginVersion,
    mcpUrl,
    surfaceHeader,
    oauthResource,
    issues,
  };
}

/**
 * Build Grok-consumable plugin + MCP JSON from Codex package files.
 * Does not copy skill bodies — skills/ is shared by path/symlink at materialize time.
 */
export function adaptCodexPackageToGrok(input: {
  pluginJsonRaw: string;
  mcpJsonRaw: string;
  skillNames?: string[] | null;
}): AdaptedChatcutPlugin {
  const plugin = parseJsonObject(
    input.pluginJsonRaw,
    CODEX_PLUGIN_MANIFEST_REL,
  ) as ChatcutCodexPluginJson;
  const mcpIn = parseJsonObject(input.mcpJsonRaw, MCP_JSON_REL) as ChatcutMcpJson;

  const name =
    typeof plugin.name === "string" && plugin.name.trim()
      ? plugin.name.trim()
      : "chatcut";
  const version =
    typeof plugin.version === "string" && plugin.version.trim()
      ? plugin.version.trim()
      : "0.0.0";
  const description =
    typeof plugin.description === "string" ? plugin.description : "ChatCut";

  const serversIn = { ...(mcpIn.mcpServers ?? {}) };
  let mcpServerName = "chatcut";
  if (!serversIn.chatcut) {
    const first = Object.keys(serversIn)[0];
    if (first) mcpServerName = first;
  }

  const entry: ChatcutMcpServerConfig = {
    ...(serversIn[mcpServerName] ?? {}),
  };

  const mcpUrl =
    (typeof entry.url === "string" && entry.url.trim()) || CHATCUT_MCP_URL;
  const oauthResource =
    (typeof entry.oauth_resource === "string" && entry.oauth_resource.trim()) ||
    mcpUrl;

  const httpHeaders: Record<string, string> = {
    ...(entry.http_headers ?? {}),
    ...(entry.headers ?? {}),
  };
  // Keep Codex surface until ChatCut documents a Grok surface (protocol parity).
  if (!httpHeaders["x-chatcut-mcp-surface"]) {
    httpHeaders["x-chatcut-mcp-surface"] = CHATCUT_MCP_SURFACE_CODEX;
  }
  const surfaceHeader = httpHeaders["x-chatcut-mcp-surface"];

  // Grok MCP config: keep url + headers; also mirror http_headers for Codex parity.
  const adaptedEntry: ChatcutMcpServerConfig = {
    ...entry,
    type: entry.type || "http",
    url: mcpUrl,
    oauth_resource: oauthResource,
    http_headers: { ...httpHeaders },
    // Grok / ACP path often reads `headers` (see McpServerDef).
    headers: { ...httpHeaders },
  };

  const mcpJson: ChatcutMcpJson = {
    mcpServers: {
      ...serversIn,
      [mcpServerName]: adaptedEntry,
    },
  };

  const skillNames = (input.skillNames ?? [])
    .map((s) => s.trim())
    .filter(Boolean);

  const logo =
    typeof plugin.logo === "string"
      ? plugin.logo
      : typeof plugin.interface?.logo === "string"
        ? (plugin.interface.logo as string)
        : undefined;

  const grokPluginJson: AdaptedGrokPluginManifest = {
    name,
    version,
    description,
    author: plugin.author,
    homepage: plugin.homepage,
    repository: plugin.repository,
    license: plugin.license,
    keywords: Array.isArray(plugin.keywords) ? plugin.keywords : undefined,
    logo,
    chatcut: {
      sourceLayout: "codex",
      surface: surfaceHeader,
      mcpUrl,
      oauthResource,
    },
  };

  return {
    grokPluginJson,
    mcpJson,
    skillNames,
    mcpServerName,
    surfaceHeader,
    mcpUrl,
    oauthResource,
    migration: {
      rePull:
        "Re-fetch ChatCut-Inc/agent-plugin codex/ (see vendor/chatcut-agent-plugin.pin); do not hand-edit skill bodies in App.",
      reAdapt:
        "Run scripts/chatcut-plugin-start.mjs (or adaptCodexPackageToGrok) to regenerate .grok-plugin/plugin.json + normalized .mcp.json; skills stay linked/copied from upstream codex/skills.",
      noSkillFork:
        "Skill markdown remains upstream-owned. Adapter only adds Grok manifest path; re-pull overwrites skills, then re-adapt.",
    },
  };
}

/**
 * TOML snippet for `~/.grok/config.toml` [mcp_servers.chatcut] when CLI
 * plugin MCP inject is unavailable. Headers must be added via `grok mcp add -H`.
 */
export function chatcutMcpCliAddArgs(adapted: AdaptedChatcutPlugin): {
  name: string;
  url: string;
  transport: "http";
  headers: Array<{ name: string; value: string }>;
  oauthResource: string;
} {
  const headers = Object.entries(
    adapted.mcpJson.mcpServers?.[adapted.mcpServerName]?.headers ??
      adapted.mcpJson.mcpServers?.[adapted.mcpServerName]?.http_headers ??
      {},
  ).map(([name, value]) => ({ name, value: String(value) }));
  return {
    name: adapted.mcpServerName,
    url: adapted.mcpUrl,
    transport: "http",
    headers,
    oauthResource: adapted.oauthResource,
  };
}

/** Gating checklist rows for parity docs / start script. */
export function chatcutParityChecklist(adapted: AdaptedChatcutPlugin): Array<{
  id: string;
  ok: boolean;
  detail: string;
}> {
  const surfaceOk =
    adapted.surfaceHeader === CHATCUT_MCP_SURFACE_CODEX ||
    adapted.surfaceHeader.length > 0;
  return [
    {
      id: "mcp_endpoint",
      ok: adapted.mcpUrl.includes("api.chatcut.io"),
      detail: adapted.mcpUrl,
    },
    {
      id: "oauth_resource",
      ok: adapted.oauthResource.includes("api.chatcut.io"),
      detail: adapted.oauthResource,
    },
    {
      id: "surface_header",
      ok: surfaceOk,
      detail: `x-chatcut-mcp-surface=${adapted.surfaceHeader}`,
    },
    {
      id: "skills_nonempty",
      ok: adapted.skillNames.length > 0,
      detail: `${adapted.skillNames.length} skill(s): ${adapted.skillNames.slice(0, 8).join(", ")}`,
    },
    {
      id: "grok_manifest_name",
      ok: !!adapted.grokPluginJson.name,
      detail: adapted.grokPluginJson.name,
    },
    {
      id: "handoff_host_mapping",
      ok: true,
      detail:
        "Codex control-in-app-browser / node_repl → Grok system default browser for ChatCut editor (EmbeddedBrowser WebView cannot play media; forceEditorInApp opt-in only)",
    },
  ];
}
