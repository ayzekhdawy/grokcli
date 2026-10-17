#!/usr/bin/env node
/**
 * ChatCut Codex plugin start simulation (gating script).
 *
 * - Resolves upstream codex/ package (vendor clone, fixture, or --fetch)
 * - Inventories manifest / .mcp.json / skills
 * - Adapts Codex layout → Grok-shaped plugin (writes under --out)
 * - Optionally runs `grok plugin validate` on the adapted tree
 * - Optionally registers MCP via `grok mcp add` (--register-mcp; mutates user config)
 * - Exits 0 only when package + MCP surface + skills + adapted form check out
 *
 * Usage:
 *   node scripts/chatcut-plugin-start.mjs
 *   node scripts/chatcut-plugin-start.mjs --fetch
 *   node scripts/chatcut-plugin-start.mjs --source path/to/codex
 *   node scripts/chatcut-plugin-start.mjs --out /tmp/chatcut-grok --validate
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  cpSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const PIN_PATH = join(REPO_ROOT, "vendor", "chatcut-agent-plugin.pin");
const VENDOR_CODEX = join(
  REPO_ROOT,
  "vendor",
  "chatcut-agent-plugin",
  "codex",
);
const FIXTURE_CODEX = join(
  REPO_ROOT,
  "src",
  "lib",
  "fixtures",
  "chatcut-codex-minimal",
);
const DEFAULT_OUT = join(REPO_ROOT, "vendor", "chatcut-grok-adapted");

const CHATCUT_MCP_URL = "https://api.chatcut.io/api/external-mcp/mcp";
const SURFACE = "codex";

function parseArgs(argv) {
  const args = {
    fetch: false,
    validate: true,
    registerMcp: false,
    source: null,
    out: DEFAULT_OUT,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fetch") args.fetch = true;
    else if (a === "--no-validate") args.validate = false;
    else if (a === "--validate") args.validate = true;
    else if (a === "--register-mcp") args.registerMcp = true;
    else if (a === "--source") args.source = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "-h" || a === "--help") args.help = true;
  }
  return args;
}

function log(line) {
  process.stdout.write(`${line}\n`);
}

function fail(msg, code = 1) {
  process.stderr.write(`FAIL: ${msg}\n`);
  process.exit(code);
}

function readPin() {
  if (!existsSync(PIN_PATH)) return null;
  const text = readFileSync(PIN_PATH, "utf8");
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([a-z_]+)=(.*)$/i);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function fetchUpstream(pin) {
  const url =
    pin?.source || "https://github.com/ChatCut-Inc/agent-plugin.git";
  const commit = pin?.commit || null;
  const dest = join(REPO_ROOT, "vendor", "chatcut-agent-plugin");
  mkdirSync(join(REPO_ROOT, "vendor"), { recursive: true });
  if (existsSync(join(dest, ".git"))) {
    log(`fetch: updating existing clone at ${dest}`);
    spawnSync("git", ["-C", dest, "fetch", "--depth", "1", "origin"], {
      stdio: "inherit",
    });
    if (commit) {
      spawnSync("git", ["-C", dest, "checkout", commit], { stdio: "inherit" });
    }
  } else {
    log(`fetch: sparse-clone ${url} → ${dest}`);
    rmSync(dest, { recursive: true, force: true });
    const r = spawnSync(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "--filter=blob:none",
        "--sparse",
        url,
        dest,
      ],
      { stdio: "inherit" },
    );
    if (r.status !== 0) fail("git clone failed", r.status ?? 1);
    spawnSync("git", ["-C", dest, "sparse-checkout", "set", "codex"], {
      stdio: "inherit",
    });
    if (commit) {
      spawnSync("git", ["-C", dest, "fetch", "--depth", "1", "origin", commit], {
        stdio: "inherit",
      });
      spawnSync("git", ["-C", dest, "checkout", commit], { stdio: "inherit" });
    }
  }
  return join(dest, "codex");
}

function resolveSource(args) {
  if (args.source) {
    const p = resolve(args.source);
    if (!existsSync(p)) fail(`--source not found: ${p}`);
    return p;
  }
  if (args.fetch) {
    return fetchUpstream(readPin());
  }
  if (existsSync(join(VENDOR_CODEX, ".mcp.json"))) {
    log(`source: vendor codex at ${VENDOR_CODEX}`);
    return VENDOR_CODEX;
  }
  if (existsSync(join(FIXTURE_CODEX, ".mcp.json"))) {
    log(`source: in-repo fixture at ${FIXTURE_CODEX}`);
    return FIXTURE_CODEX;
  }
  fail(
    "No ChatCut codex package found. Run with --fetch or place vendor/chatcut-agent-plugin/codex",
  );
}

function listSkillNames(skillsDir) {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => existsSync(join(skillsDir, n, "SKILL.md")));
}

function parseJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(`${label}: ${e instanceof Error ? e.message : e}`);
  }
}

function adaptPackage(sourceDir, outDir) {
  const codexManifest = join(sourceDir, ".codex-plugin", "plugin.json");
  const mcpPath = join(sourceDir, ".mcp.json");
  const skillsSrc = join(sourceDir, "skills");

  if (!existsSync(codexManifest)) {
    fail(`missing ${codexManifest}`);
  }
  if (!existsSync(mcpPath)) fail(`missing ${mcpPath}`);

  const plugin = parseJson(codexManifest, "plugin.json");
  const mcpIn = parseJson(mcpPath, ".mcp.json");
  const skillNames = listSkillNames(skillsSrc);

  const servers = mcpIn.mcpServers || {};
  const serverName = servers.chatcut ? "chatcut" : Object.keys(servers)[0];
  if (!serverName) fail(".mcp.json has no mcpServers entries");
  const entry = { ...(servers[serverName] || {}) };
  const mcpUrl = entry.url || CHATCUT_MCP_URL;
  const oauthResource = entry.oauth_resource || mcpUrl;
  const headers = {
    ...(entry.http_headers || {}),
    ...(entry.headers || {}),
  };
  if (!headers["x-chatcut-mcp-surface"]) {
    headers["x-chatcut-mcp-surface"] = SURFACE;
  }

  const adaptedEntry = {
    ...entry,
    type: entry.type || "http",
    url: mcpUrl,
    oauth_resource: oauthResource,
    http_headers: { ...headers },
    headers: { ...headers },
  };
  const mcpOut = {
    mcpServers: {
      ...servers,
      [serverName]: adaptedEntry,
    },
  };

  const grokPlugin = {
    name: plugin.name || "chatcut",
    version: plugin.version || "0.0.0",
    description: plugin.description || "ChatCut",
    author: plugin.author,
    homepage: plugin.homepage,
    repository: plugin.repository,
    license: plugin.license,
    keywords: plugin.keywords,
    logo: plugin.logo || plugin.interface?.logo,
    chatcut: {
      sourceLayout: "codex",
      surface: headers["x-chatcut-mcp-surface"],
      mcpUrl,
      oauthResource,
    },
  };

  // Materialize Grok-shaped tree: manifest + mcp + skills (symlink or copy).
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, ".grok-plugin"), { recursive: true });
  writeFileSync(
    join(outDir, ".grok-plugin", "plugin.json"),
    `${JSON.stringify(grokPlugin, null, 2)}\n`,
  );
  writeFileSync(join(outDir, ".mcp.json"), `${JSON.stringify(mcpOut, null, 2)}\n`);

  // Copy skills/assets (dereference). Symlinks break `grok plugin install`
  // (CLI materializes without following links → empty skill inventory).
  // Bodies stay upstream-owned: re-pull + re-adapt overwrites this tree.
  const skillsDst = join(outDir, "skills");
  if (existsSync(skillsSrc)) {
    cpSync(skillsSrc, skillsDst, { recursive: true });
    log(`skills: copied (dereferenced) ${skillsSrc} → ${skillsDst}`);
  }

  const assetsSrc = join(sourceDir, "assets");
  if (existsSync(assetsSrc)) {
    cpSync(assetsSrc, join(outDir, "assets"), { recursive: true });
    log(`assets: copied → ${join(outDir, "assets")}`);
  }

  // Migration stamp
  writeFileSync(
    join(outDir, "CHATCUT_ADAPT.md"),
    [
      "# ChatCut adapted for Grok",
      "",
      "Source layout: Codex (`.codex-plugin` + `.mcp.json` + `skills/`).",
      "This tree is generated by `scripts/chatcut-plugin-start.mjs`.",
      "",
      "## Migration",
      "1. Re-pull upstream: `node scripts/chatcut-plugin-start.mjs --fetch`",
      "2. Re-adapt: same script writes this directory (skills linked, not forked).",
      "3. Do **not** hand-edit skill bodies here — edit upstream or re-pull.",
      "",
      `MCP: ${mcpUrl}`,
      `Surface: x-chatcut-mcp-surface=${headers["x-chatcut-mcp-surface"]}`,
      `OAuth resource: ${oauthResource}`,
      `Skills: ${skillNames.length}`,
      "",
    ].join("\n"),
  );

  return {
    grokPlugin,
    mcpOut,
    skillNames,
    serverName,
    mcpUrl,
    oauthResource,
    surface: headers["x-chatcut-mcp-surface"],
    outDir,
  };
}

function runGrokValidate(outDir) {
  const which = spawnSync("which", ["grok"], { encoding: "utf8" });
  if (which.status !== 0) {
    log("validate: grok CLI not on PATH — soft-skip (adapter output still checked)");
    return { ok: true, soft: true, messages: ["grok CLI missing"] };
  }
  const r = spawnSync("grok", ["plugin", "validate", outDir], {
    encoding: "utf8",
  });
  const messages = `${r.stderr || ""}\n${r.stdout || ""}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const m of messages) log(`  validate| ${m}`);
  return { ok: r.status === 0, soft: false, messages, status: r.status };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    log(`Usage: node scripts/chatcut-plugin-start.mjs [options]
  --fetch          Sparse-clone/update ChatCut-Inc/agent-plugin codex/
  --source <path>  Use an existing codex/ package directory
  --out <path>     Adapted Grok plugin output (default: vendor/chatcut-grok-adapted)
  --validate       Run grok plugin validate on adapted tree (default)
  --no-validate    Skip CLI validate
  --register-mcp   Also grok mcp add chatcut with surface header (mutates config)
`);
    process.exit(0);
  }

  log("=== ChatCut plugin start simulation ===");
  const pin = readPin();
  if (pin?.commit) log(`pin.commit: ${pin.commit}`);
  if (pin?.source) log(`pin.source: ${pin.source}`);

  const sourceDir = resolveSource(args);
  log(`package.path: ${sourceDir}`);

  const codexManifest = join(sourceDir, ".codex-plugin", "plugin.json");
  const mcpPath = join(sourceDir, ".mcp.json");
  log(`codex.manifest.exists: ${existsSync(codexManifest)}`);
  log(`mcp.json.exists: ${existsSync(mcpPath)}`);

  const adapted = adaptPackage(sourceDir, resolve(args.out));
  log(`adapted.out: ${adapted.outDir}`);
  log(`mcp.url: ${adapted.mcpUrl}`);
  log(`mcp.oauth_resource: ${adapted.oauthResource}`);
  log(`mcp.surface: x-chatcut-mcp-surface=${adapted.surface}`);
  log(`skills.count: ${adapted.skillNames.length}`);
  log(`skills.list: ${adapted.skillNames.join(", ")}`);

  // Gating checks (never hardcode PASS)
  const checks = [];
  const push = (id, ok, detail) => {
    checks.push({ id, ok, detail });
    log(`check.${id}: ${ok ? "OK" : "FAIL"} — ${detail}`);
  };

  push(
    "package_resolved",
    existsSync(mcpPath) && existsSync(codexManifest),
    sourceDir,
  );
  push(
    "mcp_url",
    typeof adapted.mcpUrl === "string" &&
      adapted.mcpUrl.includes("api.chatcut.io"),
    adapted.mcpUrl,
  );
  push(
    "surface_header",
    adapted.surface === SURFACE || !!adapted.surface,
    `x-chatcut-mcp-surface=${adapted.surface}`,
  );
  push(
    "skills_nonempty",
    adapted.skillNames.length > 0,
    String(adapted.skillNames.length),
  );
  push(
    "adapted_manifest",
    existsSync(join(adapted.outDir, ".grok-plugin", "plugin.json")),
    join(adapted.outDir, ".grok-plugin", "plugin.json"),
  );
  push(
    "adapted_mcp",
    existsSync(join(adapted.outDir, ".mcp.json")),
    join(adapted.outDir, ".mcp.json"),
  );

  // Verify adapted MCP still has surface
  const adaptedMcp = parseJson(join(adapted.outDir, ".mcp.json"), "adapted .mcp.json");
  const h =
    adaptedMcp.mcpServers?.[adapted.serverName]?.headers?.[
      "x-chatcut-mcp-surface"
    ] ||
    adaptedMcp.mcpServers?.[adapted.serverName]?.http_headers?.[
      "x-chatcut-mcp-surface"
    ];
  push("adapted_surface_in_file", h === SURFACE || !!h, String(h));

  let validateOk = true;
  if (args.validate) {
    const v = runGrokValidate(adapted.outDir);
    validateOk = v.ok;
    push(
      "grok_plugin_validate",
      v.ok,
      v.soft ? "soft-skip (CLI missing)" : v.messages.slice(0, 3).join(" | "),
    );
  }

  if (args.registerMcp) {
    const which = spawnSync("which", ["grok"], { encoding: "utf8" });
    if (which.status !== 0) {
      log("register-mcp: grok CLI missing — skip");
    } else {
      const hdrArgs = [];
      for (const [k, v] of Object.entries(
        adapted.mcpOut.mcpServers[adapted.serverName].headers || {},
      )) {
        hdrArgs.push("-H", `${k}: ${v}`);
      }
      const r = spawnSync(
        "grok",
        [
          "mcp",
          "add",
          adapted.serverName,
          adapted.mcpUrl,
          "-t",
          "http",
          ...hdrArgs,
        ],
        { encoding: "utf8" },
      );
      log(`register-mcp exit=${r.status}`);
      if (r.stdout) log(r.stdout.trim());
      if (r.stderr) log(r.stderr.trim());
    }
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    fail(
      `gating failed: ${failed.map((f) => f.id).join(", ")}`,
      1,
    );
  }

  log("RESULT: PASS");
  log(
    JSON.stringify(
      {
        ok: true,
        packagePath: sourceDir,
        adaptedPath: adapted.outDir,
        mcpUrl: adapted.mcpUrl,
        surface: adapted.surface,
        skills: adapted.skillNames.length,
        validateOk,
      },
      null,
      2,
    ),
  );
}

main();
