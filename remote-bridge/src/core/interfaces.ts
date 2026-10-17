/**
 * Core ports for agent-connect.
 * Platforms normalize vendor events; engines own isolation; agents stream turns.
 */

export type ChatType = "p2p" | "group" | string;

export type AgentEventType =
  | "thinking"
  | "text"
  | "tool_use"
  | "tool_result"
  | "result"
  | "error";

export interface AgentEvent {
  type: AgentEventType;
  text?: string;
  name?: string;
  sessionId?: string;
  error?: string;
}

export interface LocalMediaRef {
  kind: "image" | "audio" | "video" | "file" | string;
  path: string;
  fileName?: string;
}

export interface ReplyContext {
  chatId: string;
  messageId?: string;
  chatType?: ChatType;
  senderId?: string;
  /** Opaque platform-specific payload for reconstruct */
  raw?: unknown;
}

export interface InboundMessage {
  projectId: string;
  platform: string;
  accountId: string;
  sessionKey: string;
  chatId: string;
  messageId: string;
  senderId: string;
  text: string;
  chatType: ChatType;
  mentionBot?: boolean;
  media: LocalMediaRef[];
  replyCtx: ReplyContext;
}

export type OutboundContent =
  | { kind: "text"; text: string }
  | { kind: "card"; markdown: string }
  | { kind: "media"; paths: string[] }
  | { kind: "stream_patch"; text: string; final?: boolean };

export interface InboundHandler {
  (msg: InboundMessage): void | Promise<void>;
}

export interface PlatformAdapter {
  readonly type: string;
  readonly accountId: string;
  readonly projectId: string;
  start(handler: InboundHandler): Promise<void>;
  stop(): Promise<void>;
  reply(ctx: ReplyContext, content: OutboundContent): Promise<void>;
  /**
   * Incremental stream patch (buffer or live card).
   * Prefer {@link withStream} when the platform supports a live CardKit session.
   */
  streamPatch?(ctx: ReplyContext, text: string, final?: boolean): Promise<void>;
  /**
   * Live stream session (e.g. Feishu CardKit). Opens a card immediately so the
   * user sees "generating" feedback, then appends coalesced chunks.
   */
  withStream?(
    ctx: ReplyContext,
    body: (append: (chunk: string) => Promise<void>) => Promise<void>,
  ): Promise<void>;
  sendMedia?(ctx: ReplyContext, paths: string[]): Promise<void>;
  startTyping?(ctx: ReplyContext): Promise<void>;
  stopTyping?(ctx: ReplyContext): Promise<void>;
  reconstructReplyCtx?(chatId: string): ReplyContext;
}

export interface SessionMeta {
  sessionKey: string;
  projectId: string;
  workDir: string;
  agentSessionId?: string;
  /** True if session already completed ≥1 agent turn */
  warmed?: boolean;
}

export interface AgentInput {
  text: string;
  mediaPaths?: string[];
  signal?: AbortSignal;
}

export interface AgentSessionHandle {
  readonly agentSessionId: string;
  runTurn(input: AgentInput): AsyncIterable<AgentEvent>;
  close(): Promise<void>;
}

export interface AgentDriver {
  readonly type: string;
  readonly projectId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  openSession(meta: SessionMeta): Promise<AgentSessionHandle>;
  /** Current process/slot count for budget/doctor */
  stats?(): { processes: number; keys: string[] };
}

export interface EngineStatus {
  projectId: string;
  running: boolean;
  sessions: number;
  busyKeys: string[];
  agent?: { type: string; processes: number };
  platforms: Array<{ type: string; accountId: string; hubRole?: string }>;
}
