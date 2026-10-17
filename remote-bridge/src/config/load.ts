import fs from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  type AppConfig,
  type FeishuConfig,
  type GrokConfig,
  type GrokMode,
  type PlatformBindingConfig,
  type PlatformBrand,
  type ProjectConfig,
  DEFAULT_FEISHU_CONFIG,
  DEFAULT_GROK_CONFIG,
  emptyConfig,
} from "./types.js";
import { credentialQuality } from "./credentials.js";
import { defaultConfigPath, ensureDir, defaultDataDir } from "../util/paths.js";

function asString(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  return String(v);
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (["1", "true", "yes", "on"].includes(s)) return true;
    if (["0", "false", "no", "off"].includes(s)) return false;
  }
  return fallback;
}

function asNumber(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parsePlatform(v: unknown): PlatformBrand {
  const s = asString(v, "feishu").toLowerCase();
  return s === "lark" ? "lark" : "feishu";
}

function parseMode(v: unknown): GrokMode {
  const s = asString(v, "yolo");
  const allowed: GrokMode[] = [
    "yolo",
    "bypassPermissions",
    "default",
    "acceptEdits",
    "plan",
    "dontAsk",
  ];
  return (allowed.includes(s as GrokMode) ? s : "yolo") as GrokMode;
}

function parseFeishu(raw: Record<string, unknown> | undefined): FeishuConfig {
  const base = DEFAULT_FEISHU_CONFIG();
  if (!raw) return base;
  return {
    platform: parsePlatform(raw.platform),
    app_id: asString(raw.app_id),
    app_secret: asString(raw.app_secret),
    domain: asString(raw.domain) || undefined,
  };
}

function parseProfile(v: unknown): GrokConfig["profile"] {
  const s = asString(v, "auto").toLowerCase();
  if (s === "chat" || s === "fast") return "chat";
  if (s === "code" || s === "full" || s === "build") return "code";
  return "auto";
}

function parseBackend(v: unknown): GrokConfig["session_backend"] {
  const s = asString(v, "acp").toLowerCase();
  if (s === "spawn" || s === "cli" || s === "headless") return "spawn";
  return "acp";
}

function parseGrok(raw: Record<string, unknown> | undefined): GrokConfig {
  const base = DEFAULT_GROK_CONFIG();
  if (!raw) return base;
  return {
    work_dir: asString(raw.work_dir, base.work_dir),
    command: asString(raw.command, base.command),
    model: asString(raw.model) || undefined,
    mode: parseMode(raw.mode),
    profile: parseProfile(raw.profile),
    session_backend: parseBackend(raw.session_backend),
    max_turns: asNumber(raw.max_turns, base.max_turns),
    chat_max_turns: asNumber(raw.chat_max_turns, base.chat_max_turns),
    timeout_ms: asNumber(raw.timeout_ms, base.timeout_ms),
    rules: asString(raw.rules) || undefined,
    disallowed_tools: asString(raw.disallowed_tools) || undefined,
    no_memory: asBool(raw.no_memory, base.no_memory),
    stream_coalesce_ms: asNumber(raw.stream_coalesce_ms, base.stream_coalesce_ms),
    acp_max_processes: asNumber(raw.acp_max_processes, base.acp_max_processes),
    acp_idle_timeout_mins: asNumber(
      raw.acp_idle_timeout_mins,
      base.acp_idle_timeout_mins,
    ),
    args_json: asString(raw.args_json) || undefined,
    type: asString(raw.type, "grok") || "grok",
  };
}

function parsePlatformBinding(raw: Record<string, unknown>): PlatformBindingConfig {
  return {
    type: asString(raw.type, "feishu") || "feishu",
    app_id: asString(raw.app_id),
    app_secret: asString(raw.app_secret),
    domain: asString(raw.domain) || undefined,
    platform: raw.platform ? parsePlatform(raw.platform) : undefined,
    allow_from: asString(raw.allow_from) || undefined,
    allow_chat: asString(raw.allow_chat) || undefined,
    require_mention:
      raw.require_mention === undefined ? undefined : asBool(raw.require_mention, true),
    share_session_in_channel:
      raw.share_session_in_channel === undefined
        ? undefined
        : asBool(raw.share_session_in_channel, false),
    thread_isolation:
      raw.thread_isolation === undefined
        ? undefined
        : asBool(raw.thread_isolation, false),
  };
}

function isFeishuLikeBinding(pl: PlatformBindingConfig): boolean {
  const t = (pl.type || "feishu").toLowerCase();
  return t === "feishu" || t === "lark" || !pl.type;
}

function bindingToFeishu(pl: PlatformBindingConfig): FeishuConfig {
  return {
    platform: (pl.platform ||
      (pl.type === "lark" ? "lark" : "feishu")) as PlatformBrand,
    app_id: pl.app_id,
    app_secret: pl.app_secret,
    domain: pl.domain,
  };
}

/**
 * Resolve [projects.feishu] vs [[projects.platforms]]:
 * - Prefer real credentials over example placeholders (cli_*_xxxxxxxx).
 * - Prefer legacy feishu when both real and disagree (platforms still kept if multi).
 * - Drop placeholder-only platform rows when a real source exists.
 */
export function resolveProjectFeishu(
  legacy: FeishuConfig,
  platforms: PlatformBindingConfig[] | undefined,
): { feishu: FeishuConfig; platforms?: PlatformBindingConfig[] } {
  const feishuLike = (platforms || []).filter(isFeishuLikeBinding);
  type Cand = { feishu: FeishuConfig; quality: 0 | 1 | 2; source: "legacy" | "platform"; index: number };
  const candidates: Cand[] = [
    {
      feishu: legacy,
      quality: credentialQuality(legacy.app_id, legacy.app_secret),
      source: "legacy",
      index: -1,
    },
  ];
  feishuLike.forEach((pl, index) => {
    candidates.push({
      feishu: bindingToFeishu(pl),
      quality: credentialQuality(pl.app_id, pl.app_secret),
      source: "platform",
      index,
    });
  });

  // Highest quality wins; on tie prefer legacy so hand-edited [projects.feishu] is stable
  candidates.sort((a, b) => {
    if (b.quality !== a.quality) return b.quality - a.quality;
    if (a.source === "legacy" && b.source !== "legacy") return -1;
    if (b.source === "legacy" && a.source !== "legacy") return 1;
    return a.index - b.index;
  });
  const best = candidates[0]!;
  const feishu = best.feishu;

  if (!platforms?.length) {
    return { feishu, platforms: undefined };
  }

  // Drop pure placeholders when we have a real primary credential
  const cleaned = platforms.filter((pl) => {
    if (!isFeishuLikeBinding(pl)) return true;
    const q = credentialQuality(pl.app_id, pl.app_secret);
    if (q === 1 && best.quality === 2) return false;
    if (q === 0 && best.quality === 2) return false;
    return true;
  });

  // If only one feishu-like remains and matches primary, drop platforms array
  // so serialize/load stay on single [projects.feishu] (avoids dual-schema traps).
  const remainingFeishu = cleaned.filter(isFeishuLikeBinding);
  if (
    remainingFeishu.length <= 1 &&
    remainingFeishu.every(
      (pl) =>
        pl.app_id === feishu.app_id && pl.app_secret === feishu.app_secret,
    ) &&
    cleaned.every(isFeishuLikeBinding)
  ) {
    return { feishu, platforms: undefined };
  }

  // Multi-platform: ensure a binding exists for the resolved primary feishu
  if (remainingFeishu.length && best.quality === 2) {
    const hasPrimary = remainingFeishu.some(
      (pl) => pl.app_id === feishu.app_id && pl.app_secret === feishu.app_secret,
    );
    if (!hasPrimary) {
      cleaned.unshift({
        type: feishu.platform === "lark" ? "lark" : "feishu",
        platform: feishu.platform,
        app_id: feishu.app_id,
        app_secret: feishu.app_secret,
        domain: feishu.domain,
      });
    }
  }

  return {
    feishu,
    platforms: cleaned.length ? cleaned : undefined,
  };
}

function parseProject(raw: Record<string, unknown>, index: number): ProjectConfig {
  const name = asString(raw.name, `project-${index + 1}`);

  // platforms array (new schema)
  let platforms: PlatformBindingConfig[] | undefined;
  if (Array.isArray(raw.platforms)) {
    platforms = raw.platforms.map((p) =>
      parsePlatformBinding(p as Record<string, unknown>),
    );
  }

  // Legacy [projects.feishu] or inline app_id
  let feishuObj = (raw.feishu || raw.platform) as Record<string, unknown> | undefined;
  if (!feishuObj && (raw.app_id || raw.app_secret)) {
    feishuObj = {
      platform: raw.platform,
      app_id: raw.app_id,
      app_secret: raw.app_secret,
      domain: raw.domain,
    };
  }
  const legacyFeishu = parseFeishu(feishuObj);
  const resolved = resolveProjectFeishu(legacyFeishu, platforms);
  const feishu = resolved.feishu;
  platforms = resolved.platforms;

  const agentRaw = (raw.agent || raw.grok) as Record<string, unknown> | undefined;
  const grok = parseGrok(agentRaw);

  // ACL: project-level wins; else first remaining platform binding
  const allow_from = asString(
    raw.allow_from ?? platforms?.[0]?.allow_from,
    "*",
  );
  const allow_chat =
    asString(raw.allow_chat ?? platforms?.[0]?.allow_chat) || undefined;

  return {
    name,
    allow_from,
    require_mention: asBool(
      raw.require_mention ?? platforms?.[0]?.require_mention,
      true,
    ),
    allow_chat,
    share_session_in_channel: asBool(raw.share_session_in_channel, false),
    thread_isolation: asBool(raw.thread_isolation, false),
    feishu,
    grok,
    platforms,
    agent: agentRaw ? { ...grok, type: asString(agentRaw.type, "grok") } : undefined,
  };
}

/** Parse TOML text into AppConfig (pure, testable). */
export function parseConfigText(text: string): AppConfig {
  const data = parseToml(text) as Record<string, unknown>;
  const cfg = emptyConfig();
  cfg.language = asString(data.language);
  const log = data.log as Record<string, unknown> | undefined;
  if (log) cfg.log.level = asString(log.level, "info");

  const runtime = data.runtime as Record<string, unknown> | undefined;
  if (runtime) {
    cfg.runtime = {
      max_agent_processes: asNumber(runtime.max_agent_processes, 8),
    };
  }

  const projects = data.projects;
  if (Array.isArray(projects)) {
    cfg.projects = projects.map((p, i) => parseProject(p as Record<string, unknown>, i));
  } else if (projects && typeof projects === "object") {
    cfg.projects = [parseProject(projects as Record<string, unknown>, 0)];
  }
  return cfg;
}

export function loadConfig(configPath?: string): { path: string; config: AppConfig } {
  const resolved = configPath
    ? path.resolve(configPath)
    : defaultConfigPath();
  if (!fs.existsSync(resolved)) {
    return { path: resolved, config: emptyConfig() };
  }
  const text = fs.readFileSync(resolved, "utf8");
  return { path: resolved, config: parseConfigText(text) };
}

export function ensureConfigFile(configPath?: string): string {
  const resolved = configPath
    ? path.resolve(configPath)
    : defaultConfigPath();
  ensureDir(path.dirname(resolved));
  if (!fs.existsSync(resolved)) {
    // Never seed user config from config.example.toml (placeholders like
    // cli_work_xxxxxxxx caused bot/v3/info failures when copied blindly).
    const content = `# agent-connect config — created ${new Date().toISOString()}
# Do not commit secrets.
# Add a project: agent-connect feishu setup --project <name>
# Example template: config.example.toml in the package repo

[log]
level = "info"

[runtime]
max_agent_processes = 8
`;
    fs.writeFileSync(resolved, content, "utf8");
  }
  return resolved;
}

export function getProject(config: AppConfig, name?: string): ProjectConfig | undefined {
  if (!config.projects.length) return undefined;
  if (!name) {
    return config.projects.length === 1 ? config.projects[0] : undefined;
  }
  return config.projects.find((p) => p.name === name);
}

export function listProjectNames(config: AppConfig): string[] {
  return config.projects.map((p) => p.name);
}

export { defaultConfigPath, defaultDataDir };
