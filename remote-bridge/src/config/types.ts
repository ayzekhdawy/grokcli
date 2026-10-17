/** Feishu / Lark brand for API domains */
export type PlatformBrand = "feishu" | "lark";

/** Grok permission modes (mapped to CLI flags) */
export type GrokMode =
  | "yolo"
  | "bypassPermissions"
  | "default"
  | "acceptEdits"
  | "plan"
  | "dontAsk";

export interface FeishuConfig {
  platform: PlatformBrand;
  app_id: string;
  app_secret: string;
  /** Optional API domain override */
  domain?: string;
}

export type GrokProfileName = "auto" | "chat" | "code";

/** How to talk to Grok Build */
export type SessionBackend = "acp" | "spawn";

export interface GrokConfig {
  work_dir: string;
  command: string;
  model?: string;
  mode: GrokMode;
  /**
   * auto = short chat → fast chat profile; coding intent → full agent.
   * chat = always low-latency; code = always full Build agent.
   */
  profile: GrokProfileName;
  /**
   * acp  = long-lived `grok agent stdio` (recommended for Feishu)
   * spawn = one-shot `grok -p` per message (legacy / scripts)
   */
  session_backend: SessionBackend;
  max_turns: number;
  /** Max turns when chat profile is active (default 3) */
  chat_max_turns: number;
  timeout_ms: number;
  /** Extra --rules text appended for every turn */
  rules?: string;
  /** Comma-separated tool denylist for --disallowed-tools */
  disallowed_tools?: string;
  /** Prefer --no-memory (faster cold start for chat) */
  no_memory: boolean;
  /** Merge stream deltas before Feishu update (ms). 0 = every delta. */
  stream_coalesce_ms: number;
  /**
   * Max concurrent `grok agent` OS processes (default 1).
   * Each process is keyed by work_dir and can host many ACP sessions.
   */
  acp_max_processes: number;
  /**
   * Stop idle ACP agent process after N minutes (default 15; 0 = never).
   * Session transcripts stay on disk and reload via session/load.
   */
  acp_idle_timeout_mins: number;
  /** Optional full argv template JSON array (spawn backend only) */
  args_json?: string;
  /** Agent type label (default grok) */
  type?: string;
}

/** Platform binding (architecture multi-platform form) */
export interface PlatformBindingConfig {
  type: string;
  app_id: string;
  app_secret: string;
  domain?: string;
  platform?: PlatformBrand;
  allow_from?: string;
  allow_chat?: string;
  require_mention?: boolean;
  share_session_in_channel?: boolean;
  thread_isolation?: boolean;
}

export interface ProjectConfig {
  name: string;
  allow_from: string;
  require_mention: boolean;
  /** Group chat allowlist (Shared Hub / M2) */
  allow_chat?: string;
  share_session_in_channel?: boolean;
  thread_isolation?: boolean;
  /** Legacy single Feishu block */
  feishu: FeishuConfig;
  /** Legacy single Grok block */
  grok: GrokConfig;
  /** Multi-platform bindings (preferred) */
  platforms?: PlatformBindingConfig[];
  /** Agent block alias for grok (preferred schema) */
  agent?: Partial<GrokConfig> & { type?: string };
}

export interface RuntimeConfig {
  max_agent_processes: number;
}

export interface AppConfig {
  language?: string;
  log: { level: string };
  runtime?: RuntimeConfig;
  projects: ProjectConfig[];
}

export const DEFAULT_GROK_CONFIG = (): GrokConfig => ({
  work_dir: process.cwd(),
  command: "grok",
  mode: "yolo",
  profile: "auto",
  session_backend: "acp",
  max_turns: 12,
  chat_max_turns: 3,
  timeout_ms: 540_000,
  no_memory: false,
  // Fewer Feishu CardKit updates → fewer ECONNRESET on flaky links
  stream_coalesce_ms: 200,
  acp_max_processes: 1,
  acp_idle_timeout_mins: 15,
  type: "grok",
});

export const DEFAULT_FEISHU_CONFIG = (): FeishuConfig => ({
  platform: "feishu",
  app_id: "",
  app_secret: "",
});

export function emptyConfig(): AppConfig {
  return {
    language: "",
    log: { level: "info" },
    runtime: { max_agent_processes: 8 },
    projects: [],
  };
}

export function openApiBase(platform: PlatformBrand | string): string {
  return platform === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn";
}

export function accountsBase(platform: PlatformBrand | string): string {
  return platform === "lark"
    ? "https://accounts.larksuite.com"
    : "https://accounts.feishu.cn";
}
