import fs from "node:fs";
import path from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import type { AppConfig, FeishuConfig, GrokConfig, ProjectConfig } from "./types.js";
import { DEFAULT_GROK_CONFIG, emptyConfig } from "./types.js";
import { isPlaceholderCredential } from "./credentials.js";
import { ensureDir } from "../util/paths.js";
import { loadConfig, ensureConfigFile } from "./load.js";

export interface EnsureProjectOptions {
  configPath?: string;
  projectName: string;
  workDir?: string;
  platform?: "feishu" | "lark";
}

export interface EnsureProjectResult {
  path: string;
  config: AppConfig;
  created: boolean;
  project: ProjectConfig;
}

export function ensureProject(opts: EnsureProjectOptions): EnsureProjectResult {
  const configPath = ensureConfigFile(opts.configPath);
  const { config } = loadConfig(configPath);
  let created = false;
  let project = config.projects.find((p) => p.name === opts.projectName);
  if (!project) {
    created = true;
    project = {
      name: opts.projectName,
      allow_from: "*",
      require_mention: true,
      feishu: {
        platform: opts.platform || "feishu",
        app_id: "",
        app_secret: "",
      },
      grok: {
        ...DEFAULT_GROK_CONFIG(),
        work_dir: opts.workDir || process.cwd(),
      },
    };
    config.projects.push(project);
  }
  writeConfig(configPath, config);
  return { path: configPath, config, created, project };
}

export interface SaveFeishuCredentialsOptions {
  configPath?: string;
  projectName: string;
  appId: string;
  appSecret: string;
  platform?: "feishu" | "lark";
  ownerOpenId?: string;
  setAllowFromEmpty?: boolean;
  workDir?: string;
}

export interface SaveFeishuCredentialsResult {
  path: string;
  projectName: string;
  platform: string;
  allowFrom: string;
  created: boolean;
}

export function saveFeishuCredentials(
  opts: SaveFeishuCredentialsOptions,
): SaveFeishuCredentialsResult {
  const ensured = ensureProject({
    configPath: opts.configPath,
    projectName: opts.projectName,
    workDir: opts.workDir,
    platform: opts.platform,
  });
  const project = ensured.config.projects.find((p) => p.name === opts.projectName)!;
  project.feishu.app_id = opts.appId;
  project.feishu.app_secret = opts.appSecret;
  if (opts.platform) project.feishu.platform = opts.platform;
  if (opts.workDir) project.grok.work_dir = opts.workDir;

  // Keep dual-schema in sync: drop placeholder platform rows; either clear
  // platforms (single feishu) or update matching binding with real credentials.
  if (project.platforms?.length) {
    const brand = project.feishu.platform === "lark" ? "lark" : "feishu";
    const kept = project.platforms.filter((pl) => {
      const t = (pl.type || "feishu").toLowerCase();
      if (t !== "feishu" && t !== "lark") return true;
      // drop empty / placeholder feishu-like rows
      return Boolean(pl.app_id && pl.app_secret && !isPlaceholderCredential(pl.app_id));
    });
    const feishuLike = kept.filter((pl) => {
      const t = (pl.type || "feishu").toLowerCase();
      return t === "feishu" || t === "lark";
    });
    if (feishuLike.length === 0) {
      project.platforms = undefined;
    } else {
      // refresh first feishu-like binding to the saved credentials
      const idx = kept.findIndex((pl) => {
        const t = (pl.type || "feishu").toLowerCase();
        return t === "feishu" || t === "lark";
      });
      if (idx >= 0) {
        kept[idx] = {
          ...kept[idx]!,
          type: brand,
          platform: project.feishu.platform,
          app_id: opts.appId,
          app_secret: opts.appSecret,
        };
      }
      // Single real feishu binding → write only [projects.feishu]
      if (
        kept.length === 1 &&
        (kept[0]!.type === "feishu" || kept[0]!.type === "lark" || !kept[0]!.type)
      ) {
        project.platforms = undefined;
      } else {
        project.platforms = kept;
      }
    }
  }

  if (opts.setAllowFromEmpty && opts.ownerOpenId) {
    const current = (project.allow_from || "").trim();
    if (!current || current === "*") {
      project.allow_from = opts.ownerOpenId;
    } else if (!current.split(",").map((s) => s.trim()).includes(opts.ownerOpenId)) {
      project.allow_from = `${current},${opts.ownerOpenId}`;
    }
  }

  writeConfig(ensured.path, ensured.config);
  return {
    path: ensured.path,
    projectName: project.name,
    platform: project.feishu.platform,
    allowFrom: project.allow_from,
    created: ensured.created,
  };
}

/** Serialize AppConfig to TOML text (pure). */
export function serializeConfig(config: AppConfig): string {
  const doc: Record<string, unknown> = {};
  if (config.language) doc.language = config.language;
  doc.log = { level: config.log?.level || "info" };
  if (config.runtime) {
    doc.runtime = { max_agent_processes: config.runtime.max_agent_processes ?? 8 };
  }
  doc.projects = config.projects.map((p) => projectToTomlObject(p));
  const header = `# grok-remote-bridge config — managed by Grok App / CLI\n# Do not commit secrets.\n\n`;
  return header + stringifyToml(doc);
}

function projectToTomlObject(p: ProjectConfig): Record<string, unknown> {
  const feishu: FeishuConfig = p.feishu;
  const grok: GrokConfig = p.grok;
  const obj: Record<string, unknown> = {
    name: p.name,
    allow_from: p.allow_from,
    require_mention: p.require_mention,
    feishu: {
      platform: feishu.platform,
      app_id: feishu.app_id,
      app_secret: feishu.app_secret,
    },
    grok: {
      work_dir: grok.work_dir,
      command: grok.command,
      mode: grok.mode,
      profile: grok.profile || "auto",
      session_backend: grok.session_backend || "acp",
      max_turns: grok.max_turns,
      chat_max_turns: grok.chat_max_turns ?? 3,
      timeout_ms: grok.timeout_ms,
      no_memory: Boolean(grok.no_memory),
      stream_coalesce_ms: grok.stream_coalesce_ms ?? 100,
      acp_max_processes: grok.acp_max_processes ?? 1,
      acp_idle_timeout_mins: grok.acp_idle_timeout_mins ?? 15,
    },
  };
  if (p.allow_chat) obj.allow_chat = p.allow_chat;
  if (feishu.domain) (obj.feishu as Record<string, unknown>).domain = feishu.domain;
  if (grok.model) (obj.grok as Record<string, unknown>).model = grok.model;
  if (grok.rules) (obj.grok as Record<string, unknown>).rules = grok.rules;
  if (grok.disallowed_tools)
    (obj.grok as Record<string, unknown>).disallowed_tools = grok.disallowed_tools;
  if (grok.args_json) (obj.grok as Record<string, unknown>).args_json = grok.args_json;
  if (p.platforms?.length) {
    const plats = p.platforms.filter(
      (pl) =>
        pl.app_id &&
        pl.app_secret &&
        !isPlaceholderCredential(pl.app_id) &&
        !isPlaceholderCredential(pl.app_secret),
    );
    // Skip platforms array when it only restates single [projects.feishu]
    const onlyDupFeishu =
      plats.length === 1 &&
      plats[0]!.app_id === feishu.app_id &&
      plats[0]!.app_secret === feishu.app_secret;
    if (plats.length && !onlyDupFeishu) {
      obj.platforms = plats.map((pl) => ({
        type: pl.type,
        app_id: pl.app_id,
        app_secret: pl.app_secret,
        ...(pl.domain ? { domain: pl.domain } : {}),
        ...(pl.allow_from ? { allow_from: pl.allow_from } : {}),
        ...(pl.allow_chat ? { allow_chat: pl.allow_chat } : {}),
      }));
    }
  }
  return obj;
}

export function writeConfig(configPath: string, config: AppConfig): void {
  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, serializeConfig(config), "utf8");
}

export function createEmptyConfigFile(configPath: string): void {
  writeConfig(configPath, emptyConfig());
}
