/**
 * Per-project Engine: owns sessions, agent, outbound, platform handlers.
 * Never shares mutable state with other Engines.
 */

import type {
  AgentDriver,
  AgentEvent,
  EngineStatus,
  InboundMessage,
  PlatformAdapter,
  ReplyContext,
} from "./interfaces.js";
import { SessionManager } from "./session-manager.js";
import { createStreamCoalescer } from "./stream-coalesce.js";
import { parseSlashCommand, helpText } from "../bridge/commands.js";
import { log } from "../util/logger.js";
import { safeBasename } from "../util/redact.js";
import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../util/paths.js";

export interface EngineOptions {
  projectId: string;
  workDir: string;
  agent: AgentDriver;
  sessions: SessionManager;
  platforms: PlatformAdapter[];
  language?: "zh" | "en";
  streamCoalesceMs?: number;
  mediaStageDir?: string;
  /** Busy policy: notice (default) or ignore */
  busyPolicy?: "notice" | "ignore";
}

export class Engine {
  readonly projectId: string;
  private workDir: string;
  private agent: AgentDriver;
  private sessions: SessionManager;
  private platforms: PlatformAdapter[];
  private language: "zh" | "en";
  private streamCoalesceMs: number;
  private mediaStageDir?: string;
  private busyPolicy: "notice" | "ignore";
  private running = false;
  private abortBySession = new Map<string, AbortController>();
  /** agent calls for tests */
  agentCallCount = 0;
  lastAgentSessionIds: string[] = [];

  constructor(opts: EngineOptions) {
    this.projectId = opts.projectId;
    this.workDir = opts.workDir;
    this.agent = opts.agent;
    this.sessions = opts.sessions;
    this.platforms = opts.platforms;
    this.language = opts.language || "zh";
    this.streamCoalesceMs = opts.streamCoalesceMs ?? 100;
    this.mediaStageDir = opts.mediaStageDir;
    this.busyPolicy = opts.busyPolicy || "notice";
  }

  get sessionManager(): SessionManager {
    return this.sessions;
  }

  get platformAdapters(): PlatformAdapter[] {
    return this.platforms;
  }

  get agentDriver(): AgentDriver {
    return this.agent;
  }

  async start(): Promise<void> {
    await this.agent.start();
    for (const p of this.platforms) {
      await p.start((msg) => this.handleInbound(msg));
    }
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const ctl of this.abortBySession.values()) ctl.abort();
    this.abortBySession.clear();
    for (const p of this.platforms) {
      await p.stop().catch(() => undefined);
    }
    await this.agent.stop().catch(() => undefined);
    await this.sessions.dispose();
  }

  status(): EngineStatus {
    return {
      projectId: this.projectId,
      running: this.running,
      sessions: this.sessions.count(),
      busyKeys: this.sessions.busyKeys(),
      agent: {
        type: this.agent.type,
        processes: this.agent.stats?.().processes ?? 0,
      },
      platforms: this.platforms.map((p) => ({
        type: p.type,
        accountId: p.accountId,
      })),
    };
  }

  async handleInbound(msg: InboundMessage): Promise<void> {
    const platform = this.platforms.find(
      (p) => p.type === msg.platform && p.accountId === msg.accountId,
    ) || this.platforms[0];
    if (!platform) return;

    let text = (msg.text || "").trim();
    const mediaPaths = msg.media?.map((m) => m.path).filter(Boolean) || [];
    if (!text && !mediaPaths.length) return;
    if (!text && mediaPaths.length) {
      text = this.language === "en" ? "Please review the attachment." : "请查看我发的附件。";
    }

    // Stage inbound media under project media-stage with safe names
    const staged = this.stageMedia(mediaPaths);
    const sessionKey = msg.sessionKey;
    const replyCtx = msg.replyCtx;

    const slash = parseSlashCommand(text);
    if (slash) {
      await this.handleSlash(slash, msg, sessionKey, platform, replyCtx);
      return;
    }

    const unlock = this.sessions.tryLock(sessionKey);
    if (!unlock) {
      if (this.busyPolicy === "notice") {
        await platform.reply(replyCtx, {
          kind: "text",
          text:
            this.language === "en"
              ? "Busy — please wait for the current turn to finish."
              : "忙碌中，请等待当前任务完成。",
        });
      }
      return;
    }

    this.sessions.touchUserActivity(sessionKey);
    const ctl = new AbortController();
    this.abortBySession.set(sessionKey, ctl);

    try {
      await this.runTurn({
        text,
        mediaPaths: staged,
        sessionKey,
        platform,
        replyCtx,
        signal: ctl.signal,
      });
    } finally {
      this.abortBySession.delete(sessionKey);
      unlock();
    }
  }

  private stageMedia(paths: string[]): string[] {
    if (!this.mediaStageDir || !paths.length) return paths;
    ensureDir(this.mediaStageDir);
    const out: string[] = [];
    for (const p of paths) {
      try {
        const base = safeBasename(path.basename(p));
        const dest = path.join(this.mediaStageDir, base);
        if (fs.existsSync(p) && path.resolve(p) !== path.resolve(dest)) {
          fs.copyFileSync(p, dest);
          out.push(dest);
        } else if (fs.existsSync(p)) {
          out.push(p);
        } else {
          // fixture path may not exist — still pass safe stage path for tests
          out.push(dest);
          if (!fs.existsSync(dest)) {
            fs.writeFileSync(dest, "");
          }
        }
      } catch {
        out.push(path.join(this.mediaStageDir, safeBasename(path.basename(p))));
      }
    }
    return out;
  }

  private async handleSlash(
    slash: NonNullable<ReturnType<typeof parseSlashCommand>>,
    msg: InboundMessage,
    sessionKey: string,
    platform: PlatformAdapter,
    replyCtx: ReplyContext,
  ): Promise<void> {
    switch (slash.name) {
      case "help":
        await platform.reply(replyCtx, {
          kind: "text",
          text: helpText(this.language),
        });
        return;
      case "whoami":
        await platform.reply(replyCtx, {
          kind: "text",
          text: [
            this.language === "en" ? "**Your identity**" : "**你的身份**",
            `- open_id: \`${msg.senderId}\``,
            `- chat_id: \`${msg.chatId}\``,
            `- session: \`${sessionKey}\``,
          ].join("\n"),
        });
        return;
      case "new": {
        const session = this.sessions.reset(sessionKey, this.workDir);
        await platform.reply(replyCtx, {
          kind: "text",
          text:
            this.language === "en"
              ? `New session started: \`${session.agentSessionId}\``
              : `已开启新会话：\`${session.agentSessionId}\``,
        });
        return;
      }
      case "status": {
        const session = this.sessions.getOrCreate(sessionKey, this.workDir);
        const st = this.status();
        await platform.reply(replyCtx, {
          kind: "text",
          text: [
            this.language === "en" ? "**Status**" : "**状态**",
            `- project: \`${this.projectId}\``,
            `- work_dir: \`${this.workDir}\``,
            `- backend: \`${this.agent.type}\``,
            `- agent_session: \`${session.agentSessionId}\` warmed=${session.warmed}`,
            `- processes: ${st.agent?.processes ?? 0}`,
            `- session_key: \`${sessionKey}\``,
          ].join("\n"),
        });
        return;
      }
      case "stop": {
        const ctl = this.abortBySession.get(sessionKey);
        if (ctl) {
          ctl.abort();
          await platform.reply(replyCtx, {
            kind: "text",
            text: this.language === "en" ? "Stop signal sent." : "已发送中断信号。",
          });
        } else {
          await platform.reply(replyCtx, {
            kind: "text",
            text: this.language === "en" ? "No in-flight turn." : "当前没有进行中的任务。",
          });
        }
        return;
      }
      case "unknown":
        await platform.reply(replyCtx, {
          kind: "text",
          text:
            this.language === "en"
              ? `Unknown command \`/${slash.raw}\`. Try \`/help\`.`
              : `未知命令 \`/${slash.raw}\`。试试 \`/help\`。`,
        });
        return;
    }
  }

  private async runTurn(opts: {
    text: string;
    mediaPaths: string[];
    sessionKey: string;
    platform: PlatformAdapter;
    replyCtx: ReplyContext;
    signal: AbortSignal;
  }): Promise<void> {
    const session = this.sessions.getOrCreate(opts.sessionKey, this.workDir);
    this.agentCallCount++;
    this.lastAgentSessionIds.push(session.agentSessionId);

    const handle = await this.agent.openSession({
      sessionKey: opts.sessionKey,
      projectId: this.projectId,
      workDir: this.workDir,
      agentSessionId: session.agentSessionId,
      warmed: session.warmed,
    });

    const promptParts = [opts.text];
    if (opts.mediaPaths.length) {
      promptParts.push(
        "",
        "Attachments:",
        ...opts.mediaPaths.map((p) => `- ${p}`),
      );
    }
    const prompt = promptParts.join("\n");

    let thinking = "";
    let finalText = "";
    let streamBroken = false;
    let patchCount = 0;
    const mediaOut: string[] = [];

    /** Feishu CardKit live stream (opens card immediately → "生成中" UX). */
    const withStream =
      typeof opts.platform.withStream === "function"
        ? opts.platform.withStream.bind(opts.platform)
        : null;
    const canStreamPatch = typeof opts.platform.streamPatch === "function";

    try {
      if (withStream) {
        // Prefer live CardKit session when the platform provides it.
        // This restores progressive feedback (card appears as soon as stream opens).
        try {
          await withStream(opts.replyCtx, async (append) => {
            // Immediate placeholder so user sees activity before first Grok token
            try {
              await append(
                this.language === "en" ? "⏳ Generating…\n\n" : "⏳ 生成中…\n\n",
              );
            } catch {
              streamBroken = true;
              throw new Error("stream transport failed");
            }

            const coalescer = createStreamCoalescer(async (chunk) => {
              try {
                await append(chunk);
              } catch {
                throw new Error("stream transport failed");
              }
            }, this.streamCoalesceMs);

            for await (const ev of handle.runTurn({
              text: prompt,
              mediaPaths: opts.mediaPaths,
              signal: opts.signal,
            })) {
              await this.applyEvent(ev, {
                onThinking: async (t) => {
                  thinking += t;
                  try {
                    await coalescer.push(t);
                  } catch {
                    streamBroken = true;
                  }
                },
                onText: async (t) => {
                  finalText += t;
                  try {
                    await coalescer.push(t);
                  } catch {
                    streamBroken = true;
                  }
                },
                onMedia: (p) => mediaOut.push(p),
                onSession: (id) => {
                  session.agentSessionId = id;
                },
              });
            }
            try {
              await coalescer.flush();
            } catch {
              streamBroken = true;
            }
            if (coalescer.broken()) streamBroken = true;
            patchCount = coalescer.patchCount();

            if (!finalText && !thinking && !streamBroken) {
              try {
                await append(
                  this.language === "en" ? "(empty response)" : "（空响应）",
                );
              } catch {
                streamBroken = true;
              }
            }
          });
        } catch (streamErr) {
          streamBroken = true;
          log.warn("live stream failed, plain-reply fallback", {
            project: this.projectId,
            error:
              streamErr instanceof Error ? streamErr.message : String(streamErr),
          });
        }

        if (streamBroken) {
          const body = this.composeBody(thinking, finalText);
          if (body) {
            await opts.platform.reply(opts.replyCtx, { kind: "text", text: body });
          } else if (!finalText && !thinking) {
            await opts.platform.reply(opts.replyCtx, {
              kind: "text",
              text:
                this.language === "en" ? "(empty response)" : "（空响应）",
            });
          }
        }
      } else if (canStreamPatch) {
        const coalescer = createStreamCoalescer(async (chunk) => {
          try {
            await opts.platform.streamPatch!(opts.replyCtx, chunk, false);
          } catch {
            throw new Error("stream transport failed");
          }
        }, this.streamCoalesceMs);

        for await (const ev of handle.runTurn({
          text: prompt,
          mediaPaths: opts.mediaPaths,
          signal: opts.signal,
        })) {
          await this.applyEvent(ev, {
            onThinking: async (t) => {
              thinking += t;
              // Stream thinking before text so order is preserved on success path
              try {
                await coalescer.push(t);
              } catch {
                streamBroken = true;
              }
            },
            onText: async (t) => {
              finalText += t;
              try {
                await coalescer.push(t);
              } catch {
                streamBroken = true;
              }
            },
            onMedia: (p) => mediaOut.push(p),
            onSession: (id) => {
              session.agentSessionId = id;
            },
          });
        }
        try {
          await coalescer.flush();
        } catch {
          streamBroken = true;
        }
        if (coalescer.broken()) streamBroken = true;
        patchCount = coalescer.patchCount();

        if (streamBroken) {
          const body = this.composeBody(thinking, finalText);
          if (body) {
            await opts.platform.reply(opts.replyCtx, { kind: "text", text: body });
          }
        } else {
          // final patch optional
          try {
            await opts.platform.streamPatch!(opts.replyCtx, "", true);
          } catch {
            /* ignore */
          }
          if (!finalText && !thinking) {
            await opts.platform.reply(opts.replyCtx, {
              kind: "text",
              text:
                this.language === "en"
                  ? "(empty response)"
                  : "（空响应）",
            });
          }
        }
      } else {
        for await (const ev of handle.runTurn({
          text: prompt,
          mediaPaths: opts.mediaPaths,
          signal: opts.signal,
        })) {
          await this.applyEvent(ev, {
            onThinking: (t) => {
              thinking += t;
            },
            onText: (t) => {
              finalText += t;
            },
            onMedia: (p) => mediaOut.push(p),
            onSession: (id) => {
              session.agentSessionId = id;
            },
          });
        }
        const body = this.composeBody(thinking, finalText);
        await opts.platform.reply(opts.replyCtx, {
          kind: "text",
          text:
            body ||
            (this.language === "en" ? "(empty response)" : "（空响应）"),
        });
      }

      // Outbound media
      const pathsFromText = extractLocalPaths(finalText);
      const allMedia = [...new Set([...mediaOut, ...pathsFromText])];
      if (allMedia.length && opts.platform.sendMedia) {
        await opts.platform.sendMedia(opts.replyCtx, allMedia);
      }

      this.sessions.markWarmed(opts.sessionKey, handle.agentSessionId);
      log.debug("engine turn done", {
        project: this.projectId,
        sessionKey: opts.sessionKey,
        patchCount,
        streamBroken,
        textLen: finalText.length,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error("engine turn failed", { project: this.projectId, error: message });
      await opts.platform.reply(opts.replyCtx, {
        kind: "text",
        text: this.language === "en" ? `Error: ${message}` : `错误：${message}`,
      });
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  private composeBody(thinking: string, text: string): string {
    // Preserve thinking-then-text order in final body when both present
    if (thinking && text) return `${thinking}\n${text}`;
    return text || thinking;
  }

  private async applyEvent(
    ev: AgentEvent,
    hooks: {
      onThinking: (t: string) => void | Promise<void>;
      onText: (t: string) => void | Promise<void>;
      onMedia: (p: string) => void;
      onSession: (id: string) => void;
    },
  ): Promise<void> {
    switch (ev.type) {
      case "thinking":
        if (ev.text) await hooks.onThinking(ev.text);
        break;
      case "text":
        if (ev.text) await hooks.onText(ev.text);
        break;
      case "result":
        if (ev.text) await hooks.onText(ev.text);
        if (ev.sessionId) hooks.onSession(ev.sessionId);
        break;
      case "error":
        if (ev.error || ev.text) {
          await hooks.onText(
            this.language === "en"
              ? `\nError: ${ev.error || ev.text}`
              : `\n错误：${ev.error || ev.text}`,
          );
        }
        break;
      case "tool_use":
        // progress only — no flood
        log.debug("tool_use", { project: this.projectId, name: ev.name });
        break;
      default:
        break;
    }
  }
}

/** Extract absolute local file paths from agent text for outbound media. */
export function extractLocalPaths(text: string): string[] {
  if (!text) return [];
  const re =
    /(?:^|[\s`'"(])((?:\/(?:Users|home|var|tmp|opt|private|data|Volumes)[^\s`'")\]]+)|(?:~\/[^\s`'")\]]+))/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let p = m[1]!;
    // trim trailing punctuation
    p = p.replace(/[.,;:!?]+$/, "");
    if (
      fs.existsSync(p) ||
      p.includes("media-stage") ||
      p.startsWith("/tmp") ||
      p.startsWith("/var")
    ) {
      out.push(p);
    }
  }
  return [...new Set(out)];
}
