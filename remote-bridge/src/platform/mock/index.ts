/**
 * Mock IM platform for full acceptance without network.
 * Records outbound replies, stream patches, media, typing.
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
import type { HubEvent } from "../feishu/hub.js";

export interface MockOutboundRecord {
  kind: string;
  text?: string;
  paths?: string[];
  chatId: string;
  messageId?: string;
  final?: boolean;
  at: number;
}

export interface MockPlatformOptions {
  projectId: string;
  accountId: string;
  platform?: string;
  allowFrom?: string;
  allowChat?: string;
  requireMention?: boolean;
  sessionKeyMode?: SessionKeyMode;
  /** When streamPatch throws once (then works) — for D03 */
  failStreamOnce?: boolean;
  /** Always fail stream */
  failStreamAlways?: boolean;
}

export class MockPlatform implements PlatformAdapter {
  readonly type: string;
  readonly accountId: string;
  readonly projectId: string;
  private handler: InboundHandler | null = null;
  private allowFrom?: string;
  private allowChat?: string;
  private requireMention: boolean;
  private sessionKeyMode: SessionKeyMode;
  private failStreamOnce: boolean;
  private failStreamAlways: boolean;
  private streamFailBudget: number;

  /** Seen message ids for dedup */
  private seenIds = new Set<string>();
  private recalled = new Set<string>();

  /** Outbound recorder */
  replies: MockOutboundRecord[] = [];
  streamPatches: MockOutboundRecord[] = [];
  mediaOut: MockOutboundRecord[] = [];
  typing: Array<{ op: "start" | "stop"; chatId: string }> = [];
  rawApiCalls: Array<{ method: string; appId: string; chatId?: string }> = [];
  agentInvoked = false;
  deniedMessages: string[] = [];
  droppedReasons: string[] = [];

  constructor(opts: MockPlatformOptions) {
    this.projectId = opts.projectId;
    this.accountId = opts.accountId;
    this.type = opts.platform || "feishu";
    this.allowFrom = opts.allowFrom;
    this.allowChat = opts.allowChat;
    this.requireMention = opts.requireMention !== false;
    this.sessionKeyMode = opts.sessionKeyMode || "default";
    this.failStreamOnce = Boolean(opts.failStreamOnce);
    this.failStreamAlways = Boolean(opts.failStreamAlways);
    this.streamFailBudget = this.failStreamOnce ? 1 : this.failStreamAlways ? 999 : 0;
  }

  async start(handler: InboundHandler): Promise<void> {
    this.handler = handler;
  }

  async stop(): Promise<void> {
    this.handler = null;
  }

  async reply(ctx: ReplyContext, content: OutboundContent): Promise<void> {
    this.rawApiCalls.push({
      method: "reply",
      appId: this.accountId,
      chatId: ctx.chatId,
    });
    const text =
      content.kind === "text"
        ? content.text
        : content.kind === "card"
          ? content.markdown
          : content.kind === "stream_patch"
            ? content.text
            : undefined;
    this.replies.push({
      kind: content.kind,
      text,
      paths: content.kind === "media" ? content.paths : undefined,
      chatId: ctx.chatId,
      messageId: ctx.messageId,
      at: Date.now(),
    });
  }

  async streamPatch(ctx: ReplyContext, text: string, final?: boolean): Promise<void> {
    if (this.streamFailBudget > 0) {
      this.streamFailBudget--;
      throw new Error("ECONNRESET mock stream failure");
    }
    this.rawApiCalls.push({
      method: "streamPatch",
      appId: this.accountId,
      chatId: ctx.chatId,
    });
    this.streamPatches.push({
      kind: "stream_patch",
      text,
      final,
      chatId: ctx.chatId,
      messageId: ctx.messageId,
      at: Date.now(),
    });
  }

  async sendMedia(ctx: ReplyContext, paths: string[]): Promise<void> {
    this.rawApiCalls.push({
      method: "sendMedia",
      appId: this.accountId,
      chatId: ctx.chatId,
    });
    this.mediaOut.push({
      kind: "media",
      paths: [...paths],
      chatId: ctx.chatId,
      messageId: ctx.messageId,
      at: Date.now(),
    });
  }

  async startTyping(ctx: ReplyContext): Promise<void> {
    this.typing.push({ op: "start", chatId: ctx.chatId });
  }

  async stopTyping(ctx: ReplyContext): Promise<void> {
    this.typing.push({ op: "stop", chatId: ctx.chatId });
  }

  reconstructReplyCtx(chatId: string): ReplyContext {
    return { chatId };
  }

  /** Hub member handler — apply ACL + dedup + normalize */
  async onHubEvent(event: HubEvent): Promise<void> {
    if (event.type === "im.message.recalled_v1" || event.recalledMessageId) {
      const id = event.recalledMessageId || event.messageId;
      if (id) this.recalled.add(id);
      return;
    }

    const messageId = event.messageId || "";
    if (messageId && this.seenIds.has(messageId)) {
      this.droppedReasons.push("dedup");
      return;
    }
    if (messageId && this.recalled.has(messageId)) {
      this.droppedReasons.push("recalled");
      return;
    }
    if (messageId) this.seenIds.add(messageId);

    const chatId = event.chatId || "";
    const chatType = event.chatType || "p2p";
    const senderId = event.senderId || "";
    const mentionBot = event.mentionBot;

    const acl = acceptInbound({
      allowFrom: this.allowFrom,
      allowChat: this.allowChat,
      requireMention: this.requireMention,
      senderId,
      chatId,
      chatType,
      mentionBot,
    });
    if (!acl.ok) {
      this.droppedReasons.push(acl.reason);
      if (acl.reason === "allow_from" && this.handler) {
        // Engine path still needed for safe deny message — inject synthetic
        const msg = this.toInbound(event, true);
        // Direct deny reply without agent
        await this.reply(msg.replyCtx, {
          kind: "text",
          text: "You are not on the allow_from list.",
        });
        this.deniedMessages.push(messageId);
      }
      return;
    }

    if (!this.handler) return;
    const msg = this.toInbound(event, false);
    await this.handler(msg);
  }

  /** Direct inject (bypasses hub) for simple engine tests */
  async inject(partial: {
    messageId: string;
    chatId: string;
    chatType?: string;
    senderId: string;
    text: string;
    mentionBot?: boolean;
    media?: LocalMediaRef[];
  }): Promise<void> {
    await this.onHubEvent({
      type: "im.message.receive_v1",
      messageId: partial.messageId,
      chatId: partial.chatId,
      chatType: partial.chatType || "p2p",
      senderId: partial.senderId,
      text: partial.text,
      mentionBot: partial.mentionBot,
      media: partial.media?.map((m) => ({
        kind: m.kind,
        path: m.path,
        fileName: m.fileName,
      })),
    });
  }

  private toInbound(event: HubEvent, _denied: boolean): InboundMessage {
    const chatId = event.chatId || "";
    const senderId = event.senderId || "";
    const chatType = event.chatType || "p2p";
    const sessionKey = makeSessionKey({
      platform: this.type,
      chatId,
      userId: senderId,
      mode: this.sessionKeyMode,
    });
    const media: LocalMediaRef[] = (event.media || []).map((m) => ({
      kind: m.kind,
      path: m.path || `/mock/media/${m.fileName || m.fileKey || m.imageKey || "file"}`,
      fileName: m.fileName,
    }));
    return {
      projectId: this.projectId,
      platform: this.type,
      accountId: this.accountId,
      sessionKey,
      chatId,
      messageId: event.messageId || "",
      senderId,
      text: event.text || "",
      chatType,
      mentionBot: event.mentionBot,
      media,
      replyCtx: {
        chatId,
        messageId: event.messageId,
        chatType,
        senderId,
      },
    };
  }

  /** Outbound texts only (replies + non-empty stream patches for asserts) */
  allReplyTexts(): string[] {
    return this.replies.map((r) => r.text || "").filter(Boolean);
  }

  /** Combined user-visible text from replies and stream patches */
  allOutputText(): string {
    const parts = [
      ...this.replies.map((r) => r.text || ""),
      ...this.streamPatches.map((s) => s.text || ""),
    ];
    return parts.join("");
  }

  clear(): void {
    this.replies = [];
    this.streamPatches = [];
    this.mediaOut = [];
    this.typing = [];
    this.rawApiCalls = [];
    this.droppedReasons = [];
    this.deniedMessages = [];
  }
}
