/**
 * Remote IM types — Settings GUI + Bridge + Grok Build ACP only.
 * Spec: docs/llm-wiki/remote-im.md
 */

/** All channel ids listed in remote-im.md §6 / §2.2 */
export type RemoteChannelId =
  | "feishu"
  | "lark"
  | "dingtalk"
  | "wecom"
  | "weixin"
  | "wps-xiezuo"
  | "weibo"
  | "qq"
  | "qqbot"
  | "telegram"
  | "slack"
  | "discord"
  | "matrix"
  | "line"
  | "imessage"
  | "wps-agentspace";

export type ChannelGroup = "domestic" | "overseas" | "other";

/** Sidebar status light */
export type ChannelStatusTone = "connected" | "configured" | "unconfigured" | "error";

export type ProjectScope = "all_trusted" | { allow: string[] };

export type PresenterMode = "auto" | "text_only";

export type ProgressStyle = "legacy" | "compact" | "card";

export type BridgeLifecycle = "attached" | "detached";

/** Host bridge phase. `listening` = connectors up; `degraded` = enabled but not listening. */
export type BridgeRunState =
  | "stopped"
  | "running"
  | "listening"
  | "degraded"
  | "error"
  | "starting"
  | "stopping";

export type AclConfig = {
  allowFrom: string;
  allowChat?: string;
  /** true = require @mention in groups (inverse of group_reply_all) */
  requireMention: boolean;
  groupOnly: boolean;
  adminFrom?: string;
  shareSessionInChannel: boolean;
};

export type ChannelInstance = {
  id: string;
  channel: RemoteChannelId;
  name: string;
  enabled: boolean;
  /** Opaque ref into secrets store — never the secret itself */
  credentialsRef: string | null;
  /** Non-secret option values from §6 */
  options: Record<string, unknown>;
  acl: AclConfig;
  projectScope: ProjectScope;
  presenter: PresenterMode;
  /** Whether credentials are present (masked); never includes plaintext */
  hasCredentials: boolean;
  lastError?: string | null;
  status: ChannelStatusTone;
};

export type BridgeGlobalConfig = {
  enabled: boolean;
  lifecycle: BridgeLifecycle;
  allowRemoteYolo: boolean;
};

/** Crash-recovery / rate-limit posture from Host (RIM-RESILIENCE). */
export type BridgeRecoveryPhase =
  | "idle"
  | "listening"
  | "starting"
  | "restarting"
  | "backing_off"
  | "degraded"
  | "rate_limited"
  | "error"
  | "stopped";

export type BridgeErrorKind =
  | "rate_limit"
  | "auth"
  | "network"
  | "crash"
  | "config"
  | "unknown";

export type BridgeStatus = {
  state: BridgeRunState;
  enabled: boolean;
  lifecycle: BridgeLifecycle;
  allowRemoteYolo: boolean;
  connectedChannels: Array<{
    channel: RemoteChannelId;
    instanceId: string;
    name: string;
  }>;
  lastError: string | null;
  mock?: boolean;
  /** Always `rust://in-process` for the Rust runtime. */
  remoteBridgePath?: string | null;
  /** `rust` when Host runs connectors in-process. */
  backend?: string | null;
  /** Restart attempts since last successful listen (crash recovery). */
  restartAttempt?: number;
  /** Seconds until next automatic restart (backoff). */
  nextRetrySecs?: number | null;
  /** Host recovery phase for UI honesty. */
  recoveryPhase?: BridgeRecoveryPhase | string | null;
  /** Classified last error kind. */
  errorKind?: BridgeErrorKind | string | null;
  /** True when last error is a rate/quota limit (honest banner). */
  rateLimited?: boolean;
};

export type FieldControl =
  | "text"
  | "password"
  | "toggle"
  | "checkbox"
  | "select"
  | "number"
  | "radio";

export type ChannelFieldSchema = {
  key: string;
  /** i18n key for label */
  labelKey: string;
  control: FieldControl;
  section: "bind" | "options" | "advanced";
  required?: boolean;
  secret?: boolean;
  defaultValue?: unknown;
  /** Select / radio options */
  choices?: Array<{ value: string; labelKey: string }>;
  /** Show when another option equals value */
  when?: { key: string; equals: unknown };
  placeholderKey?: string;
  helpKey?: string;
};

export type ChannelSchema = {
  id: RemoteChannelId;
  group: ChannelGroup;
  /** GUI bind + save available (not comingSoon) */
  implemented: boolean;
  /**
   * Soft-retired / unsupported channel.
   * Hidden from default sidebar + new-bind picker; existing instances
   * keep a soft-retired banner (no crash, no setup guide pack).
   */
  retired?: boolean;
  /** Alias of product language; prefer `retired` in code. */
  unsupported?: boolean;
  scanSupport: boolean;
  pasteSupport: boolean;
  /** Needs public webhook URL callout */
  needsPublicUrl?: boolean;
  connectionKey: string;
  nameKey: string;
  fields: ChannelFieldSchema[];
};

export type RemoteImSelection =
  | { kind: "bridge" }
  | { kind: "channel"; channelId: RemoteChannelId; instanceId?: string };

/** Secrets API shape (Phase 0 stub; host implements later) */
export type RemoteImSecretPut = {
  credentialsRef: string;
  channel: RemoteChannelId;
  instanceId: string;
  /** Map of secret field keys → values; never logged */
  secrets: Record<string, string>;
};

export type RemoteImSecretGetMasked = {
  credentialsRef: string;
  /** field key → last 4 chars or boolean hasValue */
  masked: Record<string, string | boolean>;
};

/** Agent turn mode after control-plane decisions */
export type RemoteAgentMode = "new" | "resume" | "reject";

export type RemoteBinding = {
  chatKey: string;
  channel: RemoteChannelId;
  projectId: string | null;
  agentSessionId: string | null;
  /** When set, next user message uses this mode then clears one-shot intent */
  pendingMode: RemoteAgentMode | null;
};

export type TrustedProject = {
  id: string;
  name: string;
  path: string;
};

export type SessionIndexEntry = {
  id: string;
  title: string;
  projectId: string | null;
  agentSessionId?: string | null;
  updatedAt: string;
  source?: string;
};
