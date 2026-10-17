/**
 * Production Feishu PlatformAdapter — hub-backed inbound + channel outbound.
 */

import type {
  InboundHandler,
  InboundMessage,
  LocalMediaRef,
  OutboundContent,
  PlatformAdapter,
  ReplyContext,
} from "../../core/interfaces.js";
import { makeSessionKey, type SessionKeyMode } from "../../core/session-key.js";
import { acceptInbound } from "../../core/acl.js";
import type { FeishuConnectionHub, HubEvent } from "./hub.js";
import { downloadInboundResources } from "../../feishu/inbound.js";
import { sendNativePaths } from "../../feishu/outbound.js";
import { log } from "../../util/logger.js";
import type { PlatformBrand } from "../../config/types.js";

export interface FeishuPlatformOptions {
  projectId: string;
  appId: string;
  appSecret: string;
  domain?: string;
  platform?: PlatformBrand;
  allowFrom?: string;
  allowChat?: string;
  requireMention?: boolean;
  sessionKeyMode?: SessionKeyMode;
  hub: FeishuConnectionHub;
  mediaStageDir?: string;
}

export class FeishuPlatformAdapter implements PlatformAdapter {
  readonly type = "feishu";
  readonly accountId: string;
  readonly projectId: string;
  private appSecret: string;
  private domain: string;
  private platformBrand: PlatformBrand;
  private allowFrom?: string;
  private allowChat?: string;
  private requireMention: boolean;
  private sessionKeyMode: SessionKeyMode;
  private hub: FeishuConnectionHub;
  private mediaStageDir?: string;
  private handler: InboundHandler | null = null;
  private seenIds = new Set<string>();
  private recalled = new Set<string>();
  private hubRole: "primary" | "secondary" | "" = "";

  constructor(opts: FeishuPlatformOptions) {
    this.projectId = opts.projectId;
    this.accountId = opts.appId;
    this.appSecret = opts.appSecret;
    this.domain = opts.domain || "open.feishu.cn";
    this.platformBrand = opts.platform || "feishu";
    this.allowFrom = opts.allowFrom;
    this.allowChat = opts.allowChat;
    this.requireMention = opts.requireMention !== false;
    this.sessionKeyMode = opts.sessionKeyMode || "default";
    this.hub = opts.hub;
    this.mediaStageDir = opts.mediaStageDir;
  }

  getHubRole(): string {
    return this.hubRole;
  }

  async start(handler: InboundHandler): Promise<void> {
    this.handler = handler;
    const role = await this.hub.register({
      projectId: this.projectId,
      accountId: this.accountId,
      appSecret: this.appSecret,
      domain: this.domain,
      platform: this.platformBrand,
      allowChat: this.allowChat,
      allowFrom: this.allowFrom,
      requireMention: this.requireMention,
      onEvent: (ev) => this.onHubEvent(ev),
    });
    this.hubRole = role.role;
  }

  async stop(): Promise<void> {
    this.handler = null;
    await this.hub.unregister(this.projectId, this.accountId, this.domain);
  }

  private channel() {
    return this.hub.getChannel(this.accountId, this.domain);
  }

  async reply(ctx: ReplyContext, content: OutboundContent): Promise<void> {
    const ch = this.channel();
    if (!ch) {
      log.warn("feishu reply skipped: no channel", {
        project: this.projectId,
        app_id: this.accountId,
      });
      return;
    }
    const text =
      content.kind === "text"
        ? content.text
        : content.kind === "card"
          ? content.markdown
          : content.kind === "stream_patch"
            ? content.text
            : "";
    if (!text?.trim()) return;
    try {
      await ch.send(
        ctx.chatId,
        { markdown: text },
        { replyTo: ctx.messageId },
      );
    } catch {
      await ch.send(ctx.chatId, { text }, { replyTo: ctx.messageId });
    }
  }

  async streamPatch(ctx: ReplyContext, text: string, final?: boolean): Promise<void> {
    // Engine path: streamPatch(delta)… then streamPatch('', true) on success.
    // Without an active CardKit session, buffer deltas and flush on final.
    const ch = this.channel();
    if (!ch) throw new Error("no feishu channel");

    if (this.activeStreamAppend) {
      if (text) await this.activeStreamAppend(text);
      // CardKit session owns delivery; final empty patch is a no-op
      return;
    }

    if (text) {
      this.streamBuffer = (this.streamBuffer || "") + text;
    }

    // Always flush on final — including Engine's empty final marker after success
    if (final) {
      const body = this.streamBuffer;
      this.streamBuffer = "";
      if (body) {
        await this.reply(ctx, { kind: "text", text: body });
      }
    }
  }

  private streamBuffer = "";
  private activeStreamAppend: ((chunk: string) => Promise<void>) | null = null;

  /**
   * Live CardKit stream session for one turn.
   * Engine prefers this over streamPatch so Feishu shows a card immediately
   * (progressive "生成中" UX) instead of buffering until the full answer.
   */
  async withStream(
    ctx: ReplyContext,
    body: (append: (chunk: string) => Promise<void>) => Promise<void>,
  ): Promise<void> {
    const ch = this.channel();
    if (!ch?.stream) {
      // No CardKit — fall back to buffer + single plain reply (same as streamPatch final)
      this.streamBuffer = "";
      await body(async (chunk) => {
        if (chunk) this.streamBuffer = (this.streamBuffer || "") + chunk;
      });
      const bodyText = this.streamBuffer;
      this.streamBuffer = "";
      if (bodyText) {
        await this.reply(ctx, { kind: "text", text: bodyText });
      }
      return;
    }
    try {
      await ch.stream(
        ctx.chatId,
        {
          markdown: async (s) => {
            this.activeStreamAppend = (chunk) => s.append(chunk);
            try {
              await body((chunk) => s.append(chunk));
            } finally {
              this.activeStreamAppend = null;
            }
          },
        },
        { replyTo: ctx.messageId },
      );
    } catch (e) {
      this.activeStreamAppend = null;
      throw e;
    }
  }

  async sendMedia(ctx: ReplyContext, paths: string[]): Promise<void> {
    const ch = this.channel();
    if (!ch) return;
    await sendNativePaths(
      ch as unknown as {
        send: (
          c: string,
          input: Record<string, unknown>,
          o?: { replyTo?: string },
        ) => Promise<unknown>;
      },
      ctx.chatId,
      paths,
      ctx.messageId,
      {
        appId: this.accountId,
        appSecret: this.appSecret,
        platform: this.platformBrand,
      },
    );
  }

  reconstructReplyCtx(chatId: string): ReplyContext {
    return { chatId };
  }

  async onHubEvent(event: HubEvent): Promise<void> {
    if (event.type === "im.message.recalled_v1" || event.recalledMessageId) {
      const id = event.recalledMessageId || event.messageId;
      if (id) this.recalled.add(id);
      return;
    }

    const messageId = event.messageId || "";
    if (messageId && this.seenIds.has(messageId)) return;
    if (messageId && this.recalled.has(messageId)) return;
    if (messageId) this.seenIds.add(messageId);

    const chatId = event.chatId || "";
    const chatType = event.chatType || "p2p";
    const senderId = event.senderId || "";

    const acl = acceptInbound({
      allowFrom: this.allowFrom,
      allowChat: this.allowChat,
      requireMention: this.requireMention,
      senderId,
      chatId,
      chatType,
      mentionBot: event.mentionBot,
    });
    if (!acl.ok) {
      if (acl.reason === "allow_from" && this.handler) {
        await this.reply(
          { chatId, messageId, chatType, senderId },
          { kind: "text", text: "You are not on the allow_from list." },
        );
      }
      return;
    }

    if (!this.handler) return;

    // Download media if resources present
    let media: LocalMediaRef[] = [];
    if (event.resources?.length) {
      const ch = this.channel();
      if (ch?.downloadResource) {
        const inbound = await downloadInboundResources(
          ch,
          event.resources,
          { dir: this.mediaStageDir },
        );
        media = inbound.all.map((p) => ({
          kind: "file",
          path: p,
          fileName: p.split("/").pop(),
        }));
        for (const p of inbound.images) {
          media.push({ kind: "image", path: p });
        }
      }
    } else if (event.media?.length) {
      media = event.media.map((m) => ({
        kind: m.kind,
        path: m.path || "",
        fileName: m.fileName,
      }));
    }

    const sessionKey = makeSessionKey({
      platform: "feishu",
      chatId,
      userId: senderId,
      mode: this.sessionKeyMode,
    });

    const msg: InboundMessage = {
      projectId: this.projectId,
      platform: "feishu",
      accountId: this.accountId,
      sessionKey,
      chatId,
      messageId,
      senderId,
      text: event.text || "",
      chatType,
      mentionBot: event.mentionBot,
      media,
      replyCtx: { chatId, messageId, chatType, senderId },
    };
    await this.handler(msg);
  }
}
