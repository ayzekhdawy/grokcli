/**
 * FeishuConnectionHub — exactly ONE long-connection per app_id|domain.
 * Multiple projects sharing the same app register as members and receive fan-out.
 *
 * Production: openConnection receives credentials and opens a real Feishu Channel.
 * Tests: inject openConnection to count sockets without network.
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { log } from "../../util/logger.js";

export type HubEvent = {
  type: string;
  messageId?: string;
  chatId?: string;
  chatType?: string;
  senderId?: string;
  text?: string;
  mentionBot?: boolean;
  raw?: unknown;
  recalledMessageId?: string;
  media?: Array<{
    kind: string;
    path?: string;
    fileKey?: string;
    imageKey?: string;
    fileName?: string;
  }>;
  resources?: Array<{
    type?: string;
    key?: string;
    fileKey?: string;
    imageKey?: string;
    fileName?: string;
    mimeType?: string;
  }>;
  mentions?: Array<{ isBot?: boolean; name?: string; id?: string }>;
};

export type HubMemberHandler = (event: HubEvent) => void | Promise<void>;

export interface HubMember {
  projectId: string;
  accountId: string;
  allowChat?: string;
  allowFrom?: string;
  requireMention?: boolean;
  onEvent: HubMemberHandler;
}

export interface HubConnection {
  key: string;
  appId: string;
  domain: string;
  connectionId: number;
  open: boolean;
}

export interface OpenConnectionResult {
  close: () => Promise<void>;
  /** Live channel handle for outbound (optional for mocks) */
  channel?: FeishuChannelHandle;
}

/** Minimal channel surface used by Feishu platform adapter */
export interface FeishuChannelHandle {
  send: (
    chatId: string,
    input: { markdown?: string; text?: string },
    opts?: { replyTo?: string },
  ) => Promise<unknown>;
  stream?: (
    chatId: string,
    input: {
      markdown: (s: { append: (chunk: string) => Promise<void> }) => Promise<void>;
    },
    opts?: { replyTo?: string },
  ) => Promise<unknown>;
  downloadResource?: (
    key: string,
    type: string,
  ) => Promise<Buffer | Uint8Array | ArrayBuffer>;
  botIdentity?: { name?: string };
}

export interface OpenConnectionParams {
  appId: string;
  appSecret: string;
  domain: string;
  platform?: "feishu" | "lark";
  /** Called for every inbound message on the single WS */
  onEvent: (event: HubEvent) => void | Promise<void>;
}

export interface FeishuConnectionHubOptions {
  /**
   * Open the long-connection for an app.
   * Default: real Feishu Channel via @larksuiteoapi/node-sdk.
   */
  openConnection?: (params: OpenConnectionParams) => Promise<OpenConnectionResult>;
}

let nextConnectionId = 1;

export class FeishuConnectionHub {
  private members = new Map<string, HubMember[]>();
  private connections = new Map<
    string,
    HubConnection & {
      close?: () => Promise<void>;
      channel?: FeishuChannelHandle;
      appSecret?: string;
    }
  >();
  private openConnection: NonNullable<FeishuConnectionHubOptions["openConnection"]>;

  constructor(opts: FeishuConnectionHubOptions = {}) {
    this.openConnection = opts.openConnection || defaultOpenFeishuConnection;
  }

  static hubKey(appId: string, domain = "open.feishu.cn"): string {
    return `${appId}|${domain}`;
  }

  connectionCount(): number {
    return [...this.connections.values()].filter((c) => c.open).length;
  }

  connectionCountFor(appId: string, domain = "open.feishu.cn"): number {
    const c = this.connections.get(FeishuConnectionHub.hubKey(appId, domain));
    return c?.open ? 1 : 0;
  }

  membersFor(appId: string, domain = "open.feishu.cn"): HubMember[] {
    return [...(this.members.get(FeishuConnectionHub.hubKey(appId, domain)) || [])];
  }

  getConnection(appId: string, domain = "open.feishu.cn"): HubConnection | undefined {
    return this.connections.get(FeishuConnectionHub.hubKey(appId, domain));
  }

  /** Shared channel for outbound (same app) */
  getChannel(appId: string, domain = "open.feishu.cn"): FeishuChannelHandle | undefined {
    return this.connections.get(FeishuConnectionHub.hubKey(appId, domain))?.channel;
  }

  async register(
    member: HubMember & {
      domain?: string;
      appSecret?: string;
      platform?: "feishu" | "lark";
    },
  ): Promise<{ role: "primary" | "secondary" }> {
    const domain = member.domain || "open.feishu.cn";
    const key = FeishuConnectionHub.hubKey(member.accountId, domain);
    const list = this.members.get(key) || [];
    const filtered = list.filter((m) => m.projectId !== member.projectId);
    filtered.push({
      projectId: member.projectId,
      accountId: member.accountId,
      allowChat: member.allowChat,
      allowFrom: member.allowFrom,
      requireMention: member.requireMention,
      onEvent: member.onEvent,
    });
    this.members.set(key, filtered);

    let conn = this.connections.get(key);
    if (!conn || !conn.open) {
      if (!member.appSecret) {
        // Allow credential-less register only when custom openConnection ignores secret (tests)
        // Production openConnection requires secret.
      }
      const handle = await this.openConnection({
        appId: member.accountId,
        appSecret: member.appSecret || "",
        domain,
        platform: member.platform,
        onEvent: (ev) => this.dispatch(member.accountId, ev, domain),
      });
      conn = {
        key,
        appId: member.accountId,
        domain,
        connectionId: nextConnectionId++,
        open: true,
        close: handle.close,
        channel: handle.channel,
        appSecret: member.appSecret,
      };
      this.connections.set(key, conn);
      return { role: "primary" };
    }
    return { role: "secondary" };
  }

  async unregister(projectId: string, appId: string, domain = "open.feishu.cn"): Promise<void> {
    const key = FeishuConnectionHub.hubKey(appId, domain);
    const list = (this.members.get(key) || []).filter((m) => m.projectId !== projectId);
    if (list.length) {
      this.members.set(key, list);
      return;
    }
    this.members.delete(key);
    const conn = this.connections.get(key);
    if (conn) {
      conn.open = false;
      await conn.close?.().catch(() => undefined);
      this.connections.delete(key);
    }
  }

  /**
   * Fan-out an event to all members.
   * One member throw must not kill others.
   */
  async dispatch(appId: string, event: HubEvent, domain = "open.feishu.cn"): Promise<void> {
    const key = FeishuConnectionHub.hubKey(appId, domain);
    const snapshot = [...(this.members.get(key) || [])];
    await Promise.all(
      snapshot.map(async (m) => {
        try {
          await m.onEvent(event);
        } catch (e) {
          log.error("hub fan-out error", {
            project: m.projectId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }),
    );
  }

  async shutdown(): Promise<void> {
    const keys = [...this.connections.keys()];
    for (const key of keys) {
      const conn = this.connections.get(key);
      if (conn) {
        conn.open = false;
        await conn.close?.().catch(() => undefined);
      }
    }
    this.connections.clear();
    this.members.clear();
  }

  audit(): Array<{
    appId: string;
    domain: string;
    projects: string[];
    connectionOpen: boolean;
  }> {
    const out: Array<{
      appId: string;
      domain: string;
      projects: string[];
      connectionOpen: boolean;
    }> = [];
    for (const [key, members] of this.members) {
      const [appId, domain] = key.split("|");
      const conn = this.connections.get(key);
      out.push({
        appId: appId || "",
        domain: domain || "",
        projects: members.map((m) => m.projectId),
        connectionOpen: Boolean(conn?.open),
      });
    }
    return out;
  }
}

/** Default: open real Feishu/Lark long-connection via official SDK. */
export async function defaultOpenFeishuConnection(
  params: OpenConnectionParams,
): Promise<OpenConnectionResult> {
  if (!params.appId || !params.appSecret) {
    throw new Error(
      `FeishuConnectionHub: missing app credentials for ${params.appId || "(empty app_id)"}`,
    );
  }

  const isLark =
    params.platform === "lark" ||
    params.domain.includes("larksuite");
  const domain = isLark ? lark.Domain.Lark : lark.Domain.Feishu;

  const channel = lark.createLarkChannel({
    appId: params.appId,
    appSecret: params.appSecret,
    domain,
    loggerLevel: lark.LoggerLevel.info,
    policy: {
      requireMention: false, // ACL applied per binding after fan-out
      dmMode: "open",
    },
  } as Parameters<typeof lark.createLarkChannel>[0]);

  channel.on("message", async (msg: {
    messageId?: string;
    chatId?: string;
    chatType?: string;
    senderId?: string;
    content?: string;
    mentionedBot?: boolean;
    resources?: HubEvent["resources"];
    mentions?: HubEvent["mentions"];
  }) => {
    const event: HubEvent = {
      type: "im.message.receive_v1",
      messageId: msg.messageId,
      chatId: msg.chatId,
      chatType: msg.chatType,
      senderId: msg.senderId,
      text: stripBotMention(String(msg.content || ""), msg.mentions),
      mentionBot: Boolean(msg.mentionedBot),
      resources: msg.resources,
      mentions: msg.mentions,
      raw: msg,
    };
    await params.onEvent(event);
  });

  channel.on("error", (err: unknown) => {
    log.error("feishu hub channel error", {
      app_id: params.appId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  await channel.connect();
  log.info("feishu hub connected", {
    app_id: params.appId,
    domain: params.domain,
    bot: channel.botIdentity?.name,
  });

  const handle: FeishuChannelHandle = {
    send: (chatId, input, opts) =>
      channel.send(chatId, input as never, opts as never),
    stream: channel.stream
      ? (chatId, input, opts) =>
          channel.stream!(chatId, input as never, opts as never)
      : undefined,
    downloadResource: channel.downloadResource
      ? (key, type) =>
          channel.downloadResource!(key, type as Parameters<
            NonNullable<typeof channel.downloadResource>
          >[1])
      : undefined,
    botIdentity: channel.botIdentity,
  };

  return {
    channel: handle,
    close: async () => {
      await channel.disconnect();
    },
  };
}

function stripBotMention(
  content: string,
  mentions: Array<{ isBot?: boolean; name?: string }> | undefined,
): string {
  let text = content || "";
  text = text.replace(/@_user_\d+/g, "");
  if (mentions) {
    for (const m of mentions) {
      if (m.isBot && m.name) text = text.split(`@${m.name}`).join("");
    }
  }
  return text.replace(/\s+/g, " ").trim();
}

let sharedHub: FeishuConnectionHub | null = null;

export function getSharedHub(opts?: FeishuConnectionHubOptions): FeishuConnectionHub {
  if (!sharedHub) sharedHub = new FeishuConnectionHub(opts);
  return sharedHub;
}

export function resetSharedHubForTests(): void {
  sharedHub = null;
  nextConnectionId = 1;
}
