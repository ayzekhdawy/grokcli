import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig, ProjectConfig } from "../config/types.js";
import { runGrok } from "../grok/runner.js";
import { effectiveTuning } from "../grok/profile.js";
import {
  SessionStore,
  buildScopeKey,
  isSenderAllowed,
} from "../session/store.js";
import { helpText, parseSlashCommand, type BuiltinCommand } from "./commands.js";
import { log } from "../util/logger.js";
import { grokAuthExists, resolveGrokBinary } from "../util/paths.js";
import {
  MEDIA_OUTBOUND_RULE,
  buildInboundMediaPrompt,
  extractMediaRefs,
} from "../feishu/media.js";

export type TrustedProject = { id: string; name: string; path: string };

type PendingPick = {
  kind: "project" | "session";
  items: Array<{
    id: string;
    name: string;
    path?: string;
    sessionId?: string;
  }>;
};

/** Load trusted projects from Grok App projects.json */
export function loadGrokAppProjects(): TrustedProject[] {
  const roots = [
    process.env.GROK_APP_HOME,
    path.join(os.homedir(), ".grok-app"),
    process.env.APPDATA
      ? path.join(process.env.APPDATA, "grok-app")
      : "",
  ].filter(Boolean) as string[];
  for (const root of roots) {
    const file = path.join(root, "projects.json");
    try {
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Array<{
        id?: string;
        name?: string;
        path?: string;
        trusted?: boolean;
      }>;
      if (!Array.isArray(raw)) continue;
      return raw
        .filter((p) => p && p.trusted && p.path && p.id)
        .map((p) => ({
          id: String(p.id),
          name: String(p.name || p.id),
          path: String(p.path),
        }));
    } catch {
      /* try next */
    }
  }
  return [];
}

export interface IncomingMessage {
  messageId: string;
  chatId: string;
  chatType: "p2p" | "group" | string;
  senderId: string;
  content: string;
  mentionedBot?: boolean;
  /** Local paths of images the user sent (already downloaded) */
  imagePaths?: string[];
  /** Local paths of generic files the user sent */
  filePaths?: string[];
  audioPaths?: string[];
  videoPaths?: string[];
}

export interface BridgeSend {
  /** Send a markdown/text reply (text only; media via sendMedia) */
  reply: (markdown: string) => Promise<void>;
  /**
   * Stream progressive markdown updates.
   * If omitted, engine falls back to a single final reply.
   */
  stream?: (
    producer: (append: (chunk: string) => Promise<void>) => Promise<void>,
  ) => Promise<void>;
  /**
   * Send local image/file paths as native Feishu messages.
   * Called after text reply with paths extracted from agent output.
   */
  sendMedia?: (paths: string[]) => Promise<void>;
}

export interface BridgeEngineOptions {
  config: AppConfig;
  project: ProjectConfig;
  sessionStore?: SessionStore;
  /** Injectable Grok runner for tests */
  runGrokImpl?: typeof runGrok;
  language?: "zh" | "en";
}

/** Coalesce stream deltas so Feishu updates are not 1:1 with every token. */
export function createStreamCoalescer(
  append: (chunk: string) => Promise<void>,
  coalesceMs: number,
): {
  push: (delta: string) => Promise<void>;
  flush: () => Promise<void>;
  /** True if Feishu stream transport failed; text is still accumulated by caller */
  broken: () => boolean;
} {
  let buffer = "";
  let lastFlush = 0;
  let chain: Promise<void> = Promise.resolve();
  let broken = false;

  const doFlush = async () => {
    if (!buffer || broken) {
      buffer = "";
      return;
    }
    const chunk = buffer;
    buffer = "";
    lastFlush = Date.now();
    try {
      await append(chunk);
    } catch {
      broken = true;
      // Drop remaining buffer; caller will plain-reply full text
      buffer = "";
    }
  };

  return {
    push: async (delta: string) => {
      if (!delta || broken) return;
      buffer += delta;
      const now = Date.now();
      if (coalesceMs <= 0 || buffer.length >= 120 || now - lastFlush >= coalesceMs) {
        chain = chain.then(doFlush).catch(() => undefined);
        await chain;
      }
    },
    flush: async () => {
      chain = chain.then(doFlush).catch(() => undefined);
      await chain;
    },
    broken: () => broken,
  };
}

/**
 * Core message handler — pure-ish orchestration used by Feishu runtime and tests.
 */
export class BridgeEngine {
  private project: ProjectConfig;
  private config: AppConfig;
  private store: SessionStore;
  private runGrokImpl: typeof runGrok;
  private language: "zh" | "en";
  private abortByScope = new Map<string, AbortController>();
  /** Number-menu state for /p and /r */
  private pendingPick = new Map<string, PendingPick>();

  constructor(opts: BridgeEngineOptions) {
    this.project = opts.project;
    this.config = opts.config;
    this.store = opts.sessionStore || new SessionStore();
    this.runGrokImpl = opts.runGrokImpl || runGrok;
    this.language = opts.language || (opts.config.language === "en" ? "en" : "zh");
  }

  getProject(): ProjectConfig {
    return this.project;
  }

  async handleMessage(msg: IncomingMessage, send: BridgeSend): Promise<void> {
    let content = (msg.content || "").trim();
    const hasMedia =
      Boolean(msg.imagePaths?.length) || Boolean(msg.filePaths?.length);
    if (!content && !hasMedia) return;
    if (!content && hasMedia) content = "请查看我发的附件。";

    // Group mention gate
    if (
      msg.chatType === "group" &&
      this.project.require_mention &&
      !msg.mentionedBot
    ) {
      log.debug("skip group message without @bot");
      return;
    }

    if (!isSenderAllowed(this.project.allow_from, msg.senderId)) {
      await send.reply(
        this.language === "en"
          ? "You are not on the allow_from list. Ask the admin to add your open_id."
          : "你不在 allow_from 白名单中。请管理员把你的 open_id 加入配置。",
      );
      return;
    }

    const scopeKey = buildScopeKey({
      project: this.project.name,
      chatType: msg.chatType,
      chatId: msg.chatId,
      senderId: msg.senderId,
    });

    // Number pick / cancel while in /p or /r menu
    const pending = this.pendingPick.get(scopeKey);
    if (pending) {
      if (content === "0" || /^cancel$/i.test(content)) {
        this.pendingPick.delete(scopeKey);
        await send.reply(this.language === "en" ? "Cancelled." : "已取消。");
        return;
      }
      if (/^\d+$/.test(content) || content.length > 0) {
        await this.handlePick(pending, content, scopeKey, send);
        return;
      }
    }

    const slash = parseSlashCommand(content);
    if (slash) {
      await this.handleSlash(slash, msg, scopeKey, send);
      return;
    }

    // Attach inbound media paths into the prompt for Grok
    const allPaths = [
      ...(msg.imagePaths || []),
      ...(msg.audioPaths || []),
      ...(msg.videoPaths || []),
      ...(msg.filePaths || []),
    ];
    const prompt = buildInboundMediaPrompt(content, allPaths, {
      images: msg.imagePaths,
      audio: msg.audioPaths,
      video: msg.videoPaths,
      files: msg.filePaths,
    });
    await this.runAgentTurn(prompt, scopeKey, send);
  }

  /** After agent text: extract paths and ship as Feishu attachments */
  private async deliverMediaFromText(
    text: string,
    send: BridgeSend,
  ): Promise<void> {
    if (!send.sendMedia || !text) return;
    const { refs } = extractMediaRefs(text, { mustExist: true });
    if (!refs.length) return;
    log.info("outbound media detected", {
      count: refs.length,
      paths: refs.map((r) => r.path),
    });
    await send.sendMedia(refs.map((r) => r.path));
  }

  private async handleSlash(
    slash: BuiltinCommand,
    msg: IncomingMessage,
    scopeKey: string,
    send: BridgeSend,
  ): Promise<void> {
    if (!slash) return;
    switch (slash.name) {
      case "help":
        await send.reply(helpText(this.language));
        return;
      case "whoami":
        await send.reply(
          [
            this.language === "en" ? "**Your identity**" : "**你的身份**",
            `- open_id: \`${msg.senderId}\``,
            `- chat_id: \`${msg.chatId}\``,
            `- chat_type: \`${msg.chatType}\``,
            "",
            this.language === "en"
              ? "Put open_id into `allow_from` to restrict access."
              : "把 open_id 写入 `allow_from` 可限制访问。",
          ].join("\n"),
        );
        return;
      case "new": {
        const cur = this.store.get(scopeKey);
        const workDir = cur?.workDir || this.project.grok.work_dir;
        const session = this.store.reset(scopeKey, workDir);
        await send.reply(
          this.language === "en"
            ? `New session started: \`${session.sessionId}\``
            : `已开启新会话：\`${session.sessionId}\``,
        );
        return;
      }
      case "project": {
        await this.handleProjectCommand(slash.query, scopeKey, send);
        return;
      }
      case "resume": {
        await this.handleResumeCommand(slash.query, scopeKey, send);
        return;
      }
      case "status": {
        const session = this.store.getOrCreate(
          scopeKey,
          this.project.grok.work_dir,
        );
        const binary = resolveGrokBinary(this.project.grok.command);
        const g = this.project.grok;
        await send.reply(
          [
            this.language === "en" ? "**Status**" : "**状态**",
            `- project: \`${this.project.name}\``,
            `- work_dir: \`${session.workDir || g.work_dir}\``,
            `- profile: \`${g.profile || "auto"}\` (chat_max=${g.chat_max_turns ?? 3}, max_turns=${g.max_turns})`,
            `- backend: \`${g.session_backend || "acp"}\` (acp_max=${g.acp_max_processes ?? 1}, idle=${g.acp_idle_timeout_mins ?? 15}m)`,
            `- mode: \`${g.mode}\``,
            `- grok: \`${binary}\``,
            `- auth: ${grokAuthExists() ? "ok" : "missing ~/.grok/auth.json"}`,
            `- session: \`${session.sessionId}\` warmed=${session.warmed}`,
            `- scope: \`${scopeKey}\``,
          ].join("\n"),
        );
        return;
      }
      case "stop": {
        const ctl = this.abortByScope.get(scopeKey);
        if (ctl) {
          ctl.abort();
          this.abortByScope.delete(scopeKey);
          await send.reply(this.language === "en" ? "Stop signal sent." : "已发送中断信号。");
        } else {
          await send.reply(
            this.language === "en" ? "No in-flight turn." : "当前没有进行中的任务。",
          );
        }
        return;
      }
      case "unknown":
        await send.reply(
          this.language === "en"
            ? `Unknown command \`/${slash.raw}\`. Try \`/help\`.`
            : `未知命令 \`/${slash.raw}\`。试试 \`/help\`。`,
        );
        return;
    }
  }

  private projectCatalog(): TrustedProject[] {
    const fromApp = loadGrokAppProjects();
    if (fromApp.length) return fromApp;
    // Fallback: config projects (work_dir as path)
    return (this.config.projects || []).map((p) => ({
      id: p.name,
      name: p.name,
      path: p.agent?.work_dir || p.grok?.work_dir || process.cwd(),
    }));
  }

  private async handleProjectCommand(
    query: string | undefined,
    scopeKey: string,
    send: BridgeSend,
  ): Promise<void> {
    const projects = this.projectCatalog();
    if (!projects.length) {
      await send.reply(
        this.language === "en"
          ? "No trusted projects. Trust a folder in Grok App first."
          : "没有已信任项目。请先在 Grok App 侧栏信任一个文件夹。",
      );
      return;
    }
    if (!query) {
      this.pendingPick.set(scopeKey, {
        kind: "project",
        items: projects.map((p) => ({
          id: p.id,
          name: p.name,
          path: p.path,
        })),
      });
      const lines = projects.map((p, i) => `${i + 1}. ${p.name}`);
      await send.reply(
        (this.language === "en"
          ? "Select a project (number or name):\n"
          : "选择项目（序号或名称）：\n") +
          lines.join("\n") +
          (this.language === "en" ? "\n0. Cancel" : "\n0. 取消"),
      );
      return;
    }
    await this.handlePick(
      {
        kind: "project",
        items: projects.map((p) => ({
          id: p.id,
          name: p.name,
          path: p.path,
        })),
      },
      query,
      scopeKey,
      send,
    );
  }

  private async handleResumeCommand(
    query: string | undefined,
    scopeKey: string,
    send: BridgeSend,
  ): Promise<void> {
    const cur = this.store.getOrCreate(scopeKey, this.project.grok.work_dir);
    const list = this.store.listByWorkDir(cur.workDir);
    if (!list.length) {
      await send.reply(
        this.language === "en"
          ? "No sessions in this project. Send a message to start one."
          : "当前项目没有历史会话。直接发消息会开启新会话。",
      );
      return;
    }
    if (!query) {
      this.pendingPick.set(scopeKey, {
        kind: "session",
        items: list.map((s, i) => ({
          id: String(i + 1),
          name: `${s.sessionId.slice(0, 8)}… (${s.warmed ? "warm" : "new"}) ${s.updatedAt?.slice(0, 16) || ""}`,
          path: s.workDir,
          sessionId: s.sessionId,
        })),
      });
      const lines = list.map(
        (s, i) =>
          `${i + 1}. \`${s.sessionId.slice(0, 8)}\` ${s.warmed ? "●" : "○"} ${s.updatedAt?.slice(0, 16) || ""}`,
      );
      await send.reply(
        (this.language === "en"
          ? "Resume a session (number):\n"
          : "恢复会话（序号）：\n") +
          lines.join("\n") +
          (this.language === "en" ? "\n0. Cancel" : "\n0. 取消"),
      );
      return;
    }
    await this.handlePick(
      {
        kind: "session",
        items: list.map((s, i) => ({
          id: String(i + 1),
          name: s.sessionId,
          path: s.workDir,
          sessionId: s.sessionId,
        })),
      },
      query,
      scopeKey,
      send,
    );
  }

  private async handlePick(
    pending: PendingPick,
    query: string,
    scopeKey: string,
    send: BridgeSend,
  ): Promise<void> {
    const q = query.trim();
    let item = pending.items.find((x) => x.id === q);
    if (!item) {
      const n = Number(q);
      if (Number.isInteger(n) && n >= 1 && n <= pending.items.length) {
        item = pending.items[n - 1];
      }
    }
    if (!item) {
      item = pending.items.find(
        (x) => x.name.toLowerCase() === q.toLowerCase(),
      );
    }
    if (!item) {
      item = pending.items.find((x) =>
        x.name.toLowerCase().includes(q.toLowerCase()),
      );
    }
    if (!item) {
      await send.reply(
        this.language === "en"
          ? `Not found: ${q}. Send /p or /r again.`
          : `未找到：${q}。请重新发送 /p 或 /r。`,
      );
      return;
    }

    this.pendingPick.delete(scopeKey);

    if (pending.kind === "project" && item.path) {
      const session = this.store.bindProject(scopeKey, item.path);
      await send.reply(
        this.language === "en"
          ? `Project bound: **${item.name}**\n\`${item.path}\`\nNext message starts a **new** Grok session.`
          : `已绑定项目：**${item.name}**\n\`${item.path}\`\n下一条消息将开启 **新会话**。`,
      );
      log.info("project bound via /p", {
        scopeKey,
        project: item.name,
        workDir: session.workDir,
      });
      return;
    }

    if (pending.kind === "session" && item.sessionId) {
      const workDir =
        item.path ||
        this.store.get(scopeKey)?.workDir ||
        this.project.grok.work_dir;
      const session = this.store.resumeSession(
        scopeKey,
        item.sessionId,
        workDir,
      );
      await send.reply(
        this.language === "en"
          ? `Resuming session \`${session.sessionId.slice(0, 8)}\`…\nNext message continues this session.`
          : `正在恢复会话 \`${session.sessionId.slice(0, 8)}\`…\n下一条消息将继续该会话。`,
      );
      return;
    }
  }

  private async runAgentTurn(
    prompt: string,
    scopeKey: string,
    send: BridgeSend,
  ): Promise<void> {
    const session = this.store.getOrCreate(scopeKey, this.project.grok.work_dir);
    const exists = this.store.isWarmed(scopeKey);
    const ctl = new AbortController();
    this.abortByScope.set(scopeKey, ctl);

    const g = this.project.grok;
    const workDir = session.workDir || g.work_dir;
    const tuning = effectiveTuning({
      profile: g.profile,
      prompt,
      maxTurns: g.max_turns,
      chatMaxTurns: g.chat_max_turns,
      rules: [g.rules, MEDIA_OUTBOUND_RULE].filter(Boolean).join(" "),
      disallowedTools: g.disallowed_tools,
      noMemory: g.no_memory,
      streamCoalesceMs: g.stream_coalesce_ms,
    });

    // Apply per-turn tuning onto a shallow config clone for the runner
    const turnConfig = {
      ...g,
      work_dir: workDir,
      max_turns: tuning.maxTurns,
      chat_max_turns: tuning.maxTurns,
      rules: tuning.rules,
      disallowed_tools: tuning.disallowedTools || undefined,
      no_memory: tuning.noMemory,
      // force profile so buildGrokArgsFromConfig does not re-detect
      profile: tuning.profile as "chat" | "code",
    };

    const markDone = (sessionId?: string) => {
      this.store.markWarmed(scopeKey, sessionId || session.sessionId);
    };

    const t0 = Date.now();
    log.info("grok turn start", {
      scopeKey,
      sessionId: session.sessionId,
      resume: exists,
      backend: g.session_backend || "acp",
      profile: tuning.profile,
      maxTurns: tuning.maxTurns,
      noMemory: tuning.noMemory,
      work_dir: g.work_dir,
      mode: g.mode,
      promptPreview: prompt.slice(0, 160),
    });

    try {
      if (send.stream) {
        let finalText = "";
        let err = "";
        let streamTransportBroken = false;
        try {
          await send.stream(async (append) => {
            const coalescer = createStreamCoalescer(
              append,
              tuning.streamCoalesceMs,
            );
            const result = await this.runGrokImpl({
              config: turnConfig,
              prompt,
              sessionId: session.sessionId,
              sessionExists: exists,
              signal: ctl.signal,
              onText: async (delta) => {
                finalText += delta;
                await coalescer.push(delta);
              },
            });
            await coalescer.flush();
            if (coalescer.broken()) streamTransportBroken = true;
            markDone(result.sessionId || session.sessionId);
            if (result.sessionId) session.sessionId = result.sessionId;
            log.info("grok turn done", {
              sessionId: result.sessionId || session.sessionId,
              exitCode: result.exitCode,
              textLen: (finalText || result.text || "").length,
              ms: Date.now() - t0,
              profile: tuning.profile,
              error: result.error || undefined,
              stream: true,
              streamBroken: streamTransportBroken,
            });
            if (result.error) err = result.error;
            if (!finalText && result.text) {
              finalText = result.text;
              if (!streamTransportBroken) {
                try {
                  await append(result.text);
                } catch {
                  streamTransportBroken = true;
                }
              }
            }
            if (!finalText && err && !streamTransportBroken) {
              try {
                await append(
                  this.language === "en" ? `\n\nError: ${err}` : `\n\n错误：${err}`,
                );
              } catch {
                streamTransportBroken = true;
              }
            }
            if (!finalText && !err && !streamTransportBroken) {
              try {
                await append(
                  this.language === "en"
                    ? "(empty response from Grok)"
                    : "（Grok 未返回内容）",
                );
              } catch {
                streamTransportBroken = true;
              }
            }
          });
        } catch (streamErr) {
          streamTransportBroken = true;
          log.warn("feishu stream failed, will plain-reply", {
            error:
              streamErr instanceof Error ? streamErr.message : String(streamErr),
            textLen: finalText.length,
          });
        }

        // CardKit stream often dies with ECONNRESET after text is ready — still deliver reply
        const full =
          finalText ||
          (err
            ? this.language === "en"
              ? `Error: ${err}`
              : `错误：${err}`
            : "");
        if (streamTransportBroken) {
          if (full) {
            try {
              // Prefer media-aware delivery when possible
              if (send.sendMedia) {
                const { cleanedText } = extractMediaRefs(full);
                await send.reply(cleanedText || full);
                await this.deliverMediaFromText(full, send);
              } else {
                await send.reply(full);
              }
              log.info("plain reply sent after stream failure", {
                textLen: full.length,
              });
            } catch (replyErr) {
              log.error("plain reply also failed", {
                error:
                  replyErr instanceof Error ? replyErr.message : String(replyErr),
              });
            }
          }
        } else if (full) {
          // Stream OK — still send any local files/images as native attachments
          await this.deliverMediaFromText(full, send);
        }
      } else {
        const result = await this.runGrokImpl({
          config: turnConfig,
          prompt,
          sessionId: session.sessionId,
          sessionExists: exists,
          signal: ctl.signal,
        });
        markDone(result.sessionId || session.sessionId);
        log.info("grok turn done", {
          sessionId: result.sessionId || session.sessionId,
          exitCode: result.exitCode,
          textLen: (result.text || "").length,
          ms: Date.now() - t0,
          profile: tuning.profile,
          error: result.error || undefined,
        });
        const body =
          result.text ||
          (result.error
            ? this.language === "en"
              ? `Error: ${result.error}`
              : `错误：${result.error}`
            : this.language === "en"
              ? "(empty response from Grok)"
              : "（Grok 未返回内容）");
        if (send.sendMedia) {
          const { cleanedText } = extractMediaRefs(body);
          await send.reply(cleanedText || body);
          await this.deliverMediaFromText(body, send);
        } else {
          await send.reply(body);
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error("agent turn failed", { error: message, ms: Date.now() - t0 });
      await send.reply(
        this.language === "en" ? `Error: ${message}` : `错误：${message}`,
      );
    } finally {
      this.abortByScope.delete(scopeKey);
    }
  }
}
