import * as lark from "@larksuiteoapi/node-sdk";
import type { AppConfig, ProjectConfig } from "../config/types.js";
import { BridgeEngine } from "./engine.js";
import { log } from "../util/logger.js";
import { isSenderAllowed } from "../session/store.js";
import { getAcpPool, shutdownAcpPool } from "../grok/acp/pool.js";
import { downloadInboundResources } from "../feishu/inbound.js";
import { sendNativePaths } from "../feishu/outbound.js";

export interface StartBridgeOptions {
  config: AppConfig;
  project: ProjectConfig;
  /** When true, do not connect WS — only validate and construct (boot check) */
  dryRun?: boolean;
  /** Injectable channel factory for tests */
  createChannel?: typeof lark.createLarkChannel;
}

export interface StartedBridge {
  stop: () => Promise<void>;
  botName?: string;
  engine: BridgeEngine;
}

/**
 * Start Feishu long-connection bridge for one project.
 */
export async function startBridge(opts: StartBridgeOptions): Promise<StartedBridge> {
  const { project, config } = opts;
  const feishu = project.feishu;

  if (!feishu.app_id || !feishu.app_secret) {
    throw new Error(
      `project ${JSON.stringify(project.name)} missing feishu.app_id/app_secret — run: lark-grok feishu setup`,
    );
  }

  const engine = new BridgeEngine({ config, project });
  const domain =
    feishu.domain ||
    (feishu.platform === "lark" ? lark.Domain.Lark : lark.Domain.Feishu);

  const dmAllowlist =
    project.allow_from && project.allow_from !== "*"
      ? project.allow_from.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

  // Warm ACP pool config early (does not start process until first message)
  if ((project.grok.session_backend || "acp") === "acp") {
    getAcpPool({
      maxAgentProcesses: project.grok.acp_max_processes ?? 1,
      idleTimeoutMins: project.grok.acp_idle_timeout_mins ?? 15,
      alwaysApprove:
        project.grok.mode === "yolo" || project.grok.mode === "bypassPermissions",
      model: project.grok.model,
    });
  }

  if (opts.dryRun) {
    log.info("dry-run: config OK, skipping WebSocket connect", {
      project: project.name,
      app_id: feishu.app_id,
      work_dir: project.grok.work_dir,
      platform: feishu.platform,
      session_backend: project.grok.session_backend || "acp",
    });
    return {
      engine,
      stop: async () => undefined,
      botName: "(dry-run)",
    };
  }

  const create = opts.createChannel || lark.createLarkChannel;
  const channel = create({
    appId: feishu.app_id,
    appSecret: feishu.app_secret,
    domain,
    loggerLevel: lark.LoggerLevel.info,
    policy: {
      requireMention: project.require_mention,
      dmMode: "open",
      ...(dmAllowlist
        ? {
            dmAllowlist,
          }
        : {}),
    },
  } as Parameters<typeof lark.createLarkChannel>[0]);

  const uploadAuth = {
    appId: feishu.app_id,
    appSecret: feishu.app_secret,
    platform: feishu.platform,
  };

  const sendNativeMedia = async (
    chatId: string,
    paths: string[],
    replyTo?: string,
  ) => {
    const result = await sendNativePaths(
      channel as unknown as {
        send: (
          c: string,
          input: Record<string, unknown>,
          o?: { replyTo?: string },
        ) => Promise<unknown>;
      },
      chatId,
      paths,
      replyTo,
      uploadAuth,
    );
    log.info("outbound media batch done", {
      ok: result.ok.length,
      failed: result.failed.length,
    });
  };

  channel.on("message", async (msg) => {
    try {
      log.info("inbound message", {
        chatId: msg.chatId,
        chatType: msg.chatType,
        senderId: msg.senderId,
        messageId: msg.messageId,
        mentionedBot: Boolean(msg.mentionedBot),
        preview: String(msg.content || "").slice(0, 120),
        resources: Array.isArray(msg.resources) ? msg.resources.length : 0,
      });
      if (!isSenderAllowed(project.allow_from, msg.senderId)) {
        log.warn("sender not in allow_from", { senderId: msg.senderId });
        await channel.send(
          msg.chatId,
          {
            markdown:
              config.language === "en"
                ? "You are not allowed to use this bot."
                : "你无权使用此机器人。",
          },
          { replyTo: msg.messageId },
        );
        return;
      }

      // Download inbound image / file / audio / video for Grok
      const inbound = await downloadInboundResources(
        channel as {
          downloadResource?: (
            key: string,
            type: string,
          ) => Promise<Buffer | Uint8Array | ArrayBuffer>;
        },
        msg.resources as
          | Array<{
              type?: string;
              key?: string;
              fileKey?: string;
              imageKey?: string;
              fileName?: string;
              mimeType?: string;
            }>
          | undefined,
      );

      const incoming = {
        messageId: msg.messageId,
        chatId: msg.chatId,
        chatType: msg.chatType,
        senderId: msg.senderId,
        content: stripBotMention(msg.content, msg.mentions),
        mentionedBot: Boolean(msg.mentionedBot),
        imagePaths: inbound.images,
        filePaths: [
          ...inbound.files,
          ...inbound.audio,
          ...inbound.video,
        ],
        audioPaths: inbound.audio,
        videoPaths: inbound.video,
      };

      if (!incoming.content && !inbound.all.length) {
        return;
      }
      if (!incoming.content && inbound.all.length) {
        incoming.content = "请查看我发的附件。";
      }

      await engine.handleMessage(incoming, {
        reply: async (markdown) => {
          // reply is text-only; media sent separately
          if (!markdown?.trim()) return;
          try {
            await channel.send(
              msg.chatId,
              { markdown },
              { replyTo: msg.messageId },
            );
          } catch {
            await channel.send(
              msg.chatId,
              { text: markdown },
              { replyTo: msg.messageId },
            );
          }
        },
        stream: async (producer) => {
          try {
            await channel.stream(
              msg.chatId,
              {
                markdown: async (s) => {
                  await producer(async (chunk) => {
                    await s.append(chunk);
                  });
                },
              },
              { replyTo: msg.messageId },
            );
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            log.warn("channel.stream error", { error: err.message });
            throw err;
          }
        },
        sendMedia: async (paths) => {
          await sendNativeMedia(msg.chatId, paths, msg.messageId);
        },
      });
    } catch (e) {
      log.error("message handler error", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  channel.on("error", (err) => {
    log.error("channel error", {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  channel.on("reject", (evt) => {
    log.debug("message rejected by policy", { reason: String(evt) });
  });

  await channel.connect();
  const botName = channel.botIdentity?.name || "bot";
  log.info("bridge connected", {
    project: project.name,
    bot: botName,
    platform: feishu.platform,
  });

  return {
    engine,
    botName,
    stop: async () => {
      await channel.disconnect();
      await shutdownAcpPool();
    },
  };
}

/** Remove leading @bot placeholders from normalized content */
function stripBotMention(
  content: string,
  mentions: Array<{ isBot?: boolean; name?: string; id?: string }> | undefined,
): string {
  let text = content || "";
  text = text.replace(/@_user_\d+/g, "");
  if (mentions) {
    for (const m of mentions) {
      if (m.isBot && m.name) {
        text = text.split(`@${m.name}`).join("");
      }
    }
  }
  return text.replace(/\s+/g, " ").trim();
}
