/**
 * Supervisor: multi-engine lifecycle, process budget, FeishuConnectionHub registry.
 */

import path from "node:path";
import type { AppConfig, ProjectConfig } from "../config/types.js";
import { validateConfig } from "../config/validate.js";
import { Engine } from "../core/engine.js";
import {
  SessionManager,
  mediaStageDir,
  sessionFilePath,
} from "../core/session-manager.js";
import type { AgentDriver, PlatformAdapter } from "../core/interfaces.js";
import { ProcessBudget } from "../runtime/budget.js";
import {
  FeishuConnectionHub,
  getSharedHub,
  type HubEvent,
} from "../platform/feishu/hub.js";
import { FeishuPlatformAdapter } from "../platform/feishu/adapter.js";
import { MockPlatform } from "../platform/mock/index.js";
import { FakeGrokDriver } from "../agent/fake-grok.js";
import { GrokDriver } from "../agent/grok/driver.js";
import { DEFAULT_GROK_CONFIG } from "../config/types.js";
import { defaultDataDir } from "../util/paths.js";
import { log } from "../util/logger.js";

export interface SupervisorOptions {
  config: AppConfig;
  dataDir?: string;
  hub?: FeishuConnectionHub;
  budget?: ProcessBudget;
  language?: "zh" | "en";
  /** Use mock platforms + fake agents (acceptance / dry multi-project) */
  mockMode?: boolean;
  /** Per-project agent factory override */
  createAgent?: (project: ProjectConfig, budget: ProcessBudget) => AgentDriver;
  createPlatform?: (
    project: ProjectConfig,
    binding: PlatformBinding,
  ) => PlatformAdapter;
}

export interface PlatformBinding {
  type: string;
  app_id: string;
  app_secret: string;
  domain?: string;
  allow_from?: string;
  allow_chat?: string;
  require_mention?: boolean;
}

export interface SupervisorStatus {
  projects: ReturnType<Engine["status"]>[];
  hub: ReturnType<FeishuConnectionHub["audit"]>;
  budget: { used: number; max: number };
  running: boolean;
}

export class Supervisor {
  private config: AppConfig;
  private dataDir: string;
  private hub: FeishuConnectionHub;
  private budget: ProcessBudget;
  private engines = new Map<string, Engine>();
  private platforms = new Map<string, PlatformAdapter[]>();
  private language: "zh" | "en";
  private mockMode: boolean;
  private createAgent?: SupervisorOptions["createAgent"];
  private createPlatform?: SupervisorOptions["createPlatform"];
  private running = false;
  private signalHandlers: Array<() => void> = [];

  constructor(opts: SupervisorOptions) {
    this.config = opts.config;
    this.dataDir = opts.dataDir || defaultDataDir();
    this.hub = opts.hub || getSharedHub();
    this.budget =
      opts.budget ||
      new ProcessBudget(opts.config.runtime?.max_agent_processes ?? 8);
    this.language = opts.language || (opts.config.language === "en" ? "en" : "zh");
    this.mockMode = Boolean(opts.mockMode);
    this.createAgent = opts.createAgent;
    this.createPlatform = opts.createPlatform;
  }

  getEngine(projectId: string): Engine | undefined {
    return this.engines.get(projectId);
  }

  getPlatforms(projectId: string): PlatformAdapter[] {
    return this.platforms.get(projectId) || [];
  }

  getHub(): FeishuConnectionHub {
    return this.hub;
  }

  getBudget(): ProcessBudget {
    return this.budget;
  }

  status(): SupervisorStatus {
    return {
      projects: [...this.engines.values()].map((e) => e.status()),
      hub: this.hub.audit(),
      budget: { used: this.budget.used, max: this.budget.maxProcesses },
      running: this.running,
    };
  }

  /**
   * Start all projects. Partial failure: one engine fail → continue; all fail → throw.
   */
  async start(): Promise<{ started: string[]; failed: Array<{ name: string; error: string }> }> {
    const validation = validateConfig(this.config);
    for (const issue of validation.issues) {
      if (issue.level === "error") log.error(issue.message, { code: issue.code });
      else log.warn(issue.message, { code: issue.code });
    }
    if (!validation.ok) {
      const hard = validation.issues.filter((i) => i.level === "error");
      // Allow start without credentials only in mockMode
      const onlyCreds = hard.every((i) => i.code === "missing_feishu_credentials");
      if (!(this.mockMode && onlyCreds)) {
        throw new Error(
          `Config validation failed: ${hard.map((i) => i.message).join("; ")}`,
        );
      }
    }

    const started: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];

    for (const project of this.config.projects) {
      try {
        await this.startProject(project);
        started.push(project.name);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failed.push({ name: project.name, error: msg });
        log.error("engine start failed", { project: project.name, error: msg });
      }
    }

    if (!started.length && this.config.projects.length) {
      throw new Error(
        `All engines failed to start: ${failed.map((f) => f.name).join(", ")}`,
      );
    }
    this.running = true;
    return { started, failed };
  }

  private bindingsFor(project: ProjectConfig): PlatformBinding[] {
    if (project.platforms?.length) {
      return project.platforms.map((pl) => ({
        type: pl.type || "feishu",
        app_id: pl.app_id,
        app_secret: pl.app_secret,
        domain: pl.domain,
        allow_from: pl.allow_from ?? project.allow_from,
        allow_chat: pl.allow_chat ?? project.allow_chat,
        require_mention: pl.require_mention ?? project.require_mention,
      }));
    }
    return [
      {
        type: project.feishu?.platform || "feishu",
        app_id: project.feishu?.app_id || "",
        app_secret: project.feishu?.app_secret || "",
        domain: project.feishu?.domain,
        allow_from: project.allow_from,
        allow_chat: project.allow_chat,
        require_mention: project.require_mention,
      },
    ];
  }

  private async startProject(project: ProjectConfig): Promise<void> {
    const workDir =
      project.agent?.work_dir || project.grok?.work_dir || process.cwd();
    const agentType = project.agent?.type || "grok";
    const grokCfg = {
      ...DEFAULT_GROK_CONFIG(),
      ...project.grok,
      ...(project.agent || {}),
      work_dir: workDir,
    };

    const sessions = new SessionManager({
      projectId: project.name,
      filePath: sessionFilePath(this.dataDir, project.name, workDir),
      agentType,
    });

    const agent: AgentDriver = this.createAgent
      ? this.createAgent(project, this.budget)
      : this.mockMode
        ? new FakeGrokDriver({ projectId: project.name, budget: this.budget })
        : new GrokDriver({
            projectId: project.name,
            config: grokCfg,
            budget: this.budget,
          });

    const bindings = this.bindingsFor(project);
    const adapters: PlatformAdapter[] = [];
    const stageDir = mediaStageDir(this.dataDir, project.name);

    for (const b of bindings) {
      let adapter: PlatformAdapter;
      if (this.createPlatform) {
        adapter = this.createPlatform(project, b);
        adapters.push(adapter);
        // Custom platforms may be MockPlatform — register for hub fan-out when present
        if (adapter instanceof MockPlatform && b.app_id) {
          const mockAdapter = adapter;
          await this.hub.register({
            projectId: project.name,
            accountId: b.app_id,
            appSecret: b.app_secret,
            domain: b.domain || "open.feishu.cn",
            allowChat: b.allow_chat,
            allowFrom: b.allow_from,
            requireMention: b.require_mention,
            onEvent: (ev: HubEvent) => mockAdapter.onHubEvent(ev),
          });
        }
        // FeishuPlatformAdapter registers itself in start()
      } else if (this.mockMode || b.type === "mock") {
        adapter = new MockPlatform({
          projectId: project.name,
          accountId: b.app_id || `mock-${project.name}`,
          platform: b.type === "mock" ? "mock" : "feishu",
          allowFrom: b.allow_from,
          allowChat: b.allow_chat,
          requireMention: b.require_mention,
        });
        adapters.push(adapter);
        if (b.app_id) {
          await this.hub.register({
            projectId: project.name,
            accountId: b.app_id,
            appSecret: b.app_secret,
            domain: b.domain || "open.feishu.cn",
            allowChat: b.allow_chat,
            allowFrom: b.allow_from,
            requireMention: b.require_mention,
            onEvent: (ev: HubEvent) =>
              (adapter as MockPlatform).onHubEvent(ev),
          });
        }
      } else {
        // Production Feishu: real long-connection via Hub + FeishuPlatformAdapter
        adapter = new FeishuPlatformAdapter({
          projectId: project.name,
          appId: b.app_id,
          appSecret: b.app_secret,
          domain: b.domain || "open.feishu.cn",
          platform: b.type === "lark" ? "lark" : "feishu",
          allowFrom: b.allow_from,
          allowChat: b.allow_chat,
          requireMention: b.require_mention,
          hub: this.hub,
          mediaStageDir: stageDir,
        });
        adapters.push(adapter);
        // register happens in adapter.start() via hub with credentials
      }
    }

    const engine = new Engine({
      projectId: project.name,
      workDir,
      agent,
      sessions,
      platforms: adapters,
      language: this.language,
      streamCoalesceMs: grokCfg.stream_coalesce_ms ?? 100,
      mediaStageDir: stageDir,
    });

    await engine.start();
    this.engines.set(project.name, engine);
    this.platforms.set(project.name, adapters);
  }

  async stopProject(projectId: string): Promise<void> {
    const engine = this.engines.get(projectId);
    if (!engine) return;
    const project = this.config.projects.find((p) => p.name === projectId);
    if (project) {
      for (const b of this.bindingsFor(project)) {
        if (b.app_id) {
          await this.hub.unregister(
            projectId,
            b.app_id,
            b.domain || "open.feishu.cn",
          );
        }
      }
    }
    await engine.stop();
    this.engines.delete(projectId);
    this.platforms.delete(projectId);
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const id of [...this.engines.keys()]) {
      await this.stopProject(id);
    }
    await this.hub.shutdown();
    for (const off of this.signalHandlers) off();
    this.signalHandlers = [];
  }

  /** Install SIGTERM/SIGINT graceful shutdown */
  installSignalHandlers(onSignal?: (sig: string) => void): void {
    const handler = (sig: string) => {
      onSignal?.(sig);
      void this.stop();
    };
    const term = () => handler("SIGTERM");
    const int = () => handler("SIGINT");
    process.on("SIGTERM", term);
    process.on("SIGINT", int);
    this.signalHandlers.push(() => {
      process.off("SIGTERM", term);
      process.off("SIGINT", int);
    });
  }

  /** Dispatch mock/live hub event to app */
  async dispatchToApp(
    appId: string,
    event: HubEvent,
    domain = "open.feishu.cn",
  ): Promise<void> {
    await this.hub.dispatch(appId, event, domain);
  }
}

export function resolveDataDir(config?: AppConfig, override?: string): string {
  if (override) return path.resolve(override);
  return defaultDataDir();
}
