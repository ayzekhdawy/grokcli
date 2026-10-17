/** Connection status pill labels derived from session FSM state. */

import { queueSessionKey } from "./sendQueue";

export type ConnPhase =
  | "idle"
  | "connecting"
  | "ready"
  | "streaming"
  | "awaiting_permission"
  | "disconnected"
  | string;

export type ConnPill = {
  /** CSS modifier: ok | warn | err | muted */
  tone: "ok" | "warn" | "err" | "muted";
  /** i18n key under conn.* */
  labelKey: string;
};

export function connPillForState(state: ConnPhase, connecting?: boolean): ConnPill {
  if (connecting || state === "connecting") {
    return { tone: "warn", labelKey: "conn.connecting" };
  }
  switch (state) {
    case "ready":
      return { tone: "ok", labelKey: "conn.ready" };
    case "streaming":
      return { tone: "ok", labelKey: "conn.streaming" };
    case "awaiting_permission":
      return { tone: "warn", labelKey: "conn.permission" };
    case "disconnected":
      return { tone: "err", labelKey: "conn.disconnected" };
    case "idle":
    default:
      return { tone: "muted", labelKey: "conn.idle" };
  }
}

/**
 * Whether the *viewed* chat holds an in-flight Host connect claim.
 * Foreign `ensureConnected` work must not paint this chat as 连接中.
 */
export function isViewedSessionConnecting(
  viewedSessionId: string | null | undefined,
  connectingKeys: ReadonlySet<string>,
): boolean {
  return connectingKeys.has(queueSessionKey(viewedSessionId));
}

/** Handshake / drop states the user can click to cancel + retry. */
export function connPillRetryable(
  state: ConnPhase,
  viewedConnecting?: boolean,
): boolean {
  return viewedConnecting === true || state === "connecting" || state === "disconnected";
}

/**
 * Reconnect must stay clickable while a handshake is wedged — disabling it
 * left users with no in-app exit except restart.
 */
export function shouldDisableReconnectBecauseConnecting(
  _connecting: boolean,
): boolean {
  return false;
}
