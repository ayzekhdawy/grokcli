/**
 * IM-facing session keys (cc-connect Feishu-aligned).
 * Project isolation is via separate Engines — project id is NOT in sessionKey.
 */

export type SessionKeyMode = "default" | "share_session_in_channel" | "thread_isolation";

export interface MakeSessionKeyInput {
  platform: string;
  chatId: string;
  userId: string;
  mode?: SessionKeyMode;
  /** Root message id for thread_isolation (group topics) */
  rootMsgId?: string;
}

/**
 * Build platform session key:
 * - default: platform:chat:user
 * - share_session_in_channel: platform:chat
 * - thread_isolation: platform:chat:root:rootMsgId
 */
export function makeSessionKey(input: MakeSessionKeyInput): string {
  const platform = (input.platform || "feishu").trim() || "feishu";
  const chatId = (input.chatId || "unknown").trim() || "unknown";
  const mode = input.mode || "default";

  if (mode === "share_session_in_channel") {
    return `${platform}:${chatId}`;
  }
  if (mode === "thread_isolation" && input.rootMsgId) {
    return `${platform}:${chatId}:root:${input.rootMsgId}`;
  }
  const userId = (input.userId || "unknown").trim() || "unknown";
  return `${platform}:${chatId}:${userId}`;
}

/** Internal map/log key: project isolation without embedding in IM sessionKey. */
export function makeRouteKey(projectId: string, sessionKey: string): string {
  return `${projectId}\0${sessionKey}`;
}

export function parseRouteKey(routeKey: string): { projectId: string; sessionKey: string } {
  const i = routeKey.indexOf("\0");
  if (i < 0) return { projectId: "", sessionKey: routeKey };
  return { projectId: routeKey.slice(0, i), sessionKey: routeKey.slice(i + 1) };
}
