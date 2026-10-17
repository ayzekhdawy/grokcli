/**
 * Message-node deep links: open a session and scroll to a message bubble.
 *
 * Preferred hash: `#/session/<sessionId>/m/<messageId>`
 * Query form:     `#/session/<sessionId>?m=<messageId>`
 *                 (aliases: `message`, `messageId`)
 *
 * Pure only — no DOM / navigation side effects.
 * Reuses multi-window session id sanitization so `#/session/<id>` stays compatible.
 */

import { sanitizeSessionIdForLabel } from "./multiWindow";
import type { SessionMessageNode } from "./sessionMessageNodes";
import type { ChatMessage } from "./session";

/** Path prefix shared with multi-window session deep links. */
export const MESSAGE_DEEP_LINK_SESSION_PREFIX = "session/";

/** Path segment between session id and message id (`…/m/<messageId>`). */
export const MESSAGE_DEEP_LINK_MSG_SEGMENT = "m";

export type MessageDeepLink = {
  sessionId: string;
  messageId: string;
};

/** Soft max length for message ids (UUID + host-generated slugs). */
const MESSAGE_ID_MAX = 256;

/**
 * Soft validation for a message id suitable for a deep-link path segment.
 * Accepts UUID / host ids / local `a-…` / `u-…` style; rejects path junk.
 */
export function isValidMessageId(id: string | null | undefined): boolean {
  if (id == null) return false;
  const raw = String(id).trim();
  if (!raw) return false;
  if (raw.length > MESSAGE_ID_MAX) return false;
  // No path / query / hash / whitespace — keep path segments unambiguous.
  if (/[/?#\s]/.test(raw)) return false;
  // Soft: printable ASCII-ish identifiers (UUID, slug, host mid).
  if (!/^[A-Za-z0-9_.:@+-]+$/.test(raw)) return false;
  return true;
}

/**
 * Path portion of a location hash without leading `#` / `#/` and without query.
 * `"#/session/abc/m/mid?x=1"` → `"session/abc/m/mid"`.
 */
export function messageDeepLinkPathOnly(
  raw: string | null | undefined,
): string {
  let s = (raw ?? "").trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (s.startsWith("/")) s = s.slice(1);
  const qi = s.indexOf("?");
  if (qi >= 0) s = s.slice(0, qi);
  return s.replace(/\/+$/, "");
}

/**
 * Parse `?a=1&b=2` from a hash or path. Values are decodeURIComponent'd.
 * Malformed pairs are skipped (never throws).
 */
export function parseMessageDeepLinkQuery(
  raw: string | null | undefined,
): Record<string, string> {
  const s = (raw ?? "").replace(/^#/, "");
  const qi = s.indexOf("?");
  if (qi < 0) return {};
  let query = s.slice(qi + 1);
  const hashFrag = query.indexOf("#");
  if (hashFrag >= 0) query = query.slice(0, hashFrag);
  const out: Record<string, string> = {};
  if (!query) return out;
  for (const part of query.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    let k = eq >= 0 ? part.slice(0, eq) : part;
    let v = eq >= 0 ? part.slice(eq + 1) : "";
    try {
      k = decodeURIComponent(k.replace(/\+/g, " ")).trim();
      v = decodeURIComponent(v.replace(/\+/g, " ")).trim();
    } catch {
      continue;
    }
    if (k) out[k] = v;
  }
  return out;
}

function sanitizeMessageIdSegment(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep raw */
  }
  s = s.trim();
  return isValidMessageId(s) ? s : null;
}

/**
 * Build app-relative hash for a message node.
 * Prefers `#/session/<sessionId>/m/<messageId>`.
 * Returns empty string when either id is invalid.
 */
export function formatMessageDeepLink(
  sessionId: string | null | undefined,
  messageId: string | null | undefined,
): string {
  const sid = sanitizeSessionIdForLabel(sessionId);
  const mid = sanitizeMessageIdSegment(messageId);
  if (!sid || !mid) return "";
  // encodeURIComponent is a no-op for UUID / simple slugs; safe for edge ids.
  return `#/${MESSAGE_DEEP_LINK_SESSION_PREFIX}${sid}/${MESSAGE_DEEP_LINK_MSG_SEGMENT}/${encodeURIComponent(mid)}`;
}

/**
 * Parse `#/session/<id>/m/<mid>` or `#/session/<id>?m=<mid>` (and aliases).
 * Accepts with or without leading `#` / `/`. Returns null when incomplete.
 */
export function parseMessageDeepLink(
  hashOrPath: string | null | undefined,
): MessageDeepLink | null {
  if (hashOrPath == null) return null;
  const path = messageDeepLinkPathOnly(hashOrPath);
  if (!path.startsWith(MESSAGE_DEEP_LINK_SESSION_PREFIX)) return null;

  const rest = path.slice(MESSAGE_DEEP_LINK_SESSION_PREFIX.length);
  const segments = rest.split("/").filter(Boolean);
  // Need at least the session id segment.
  if (segments.length < 1) return null;

  const sessionId = sanitizeSessionIdForLabel(segments[0] ?? "");
  if (!sessionId) return null;

  // Path form: session/<id>/m/<messageId>
  if (
    segments.length >= 3 &&
    (segments[1] ?? "").toLowerCase() === MESSAGE_DEEP_LINK_MSG_SEGMENT
  ) {
    const messageId = sanitizeMessageIdSegment(segments[2]);
    if (!messageId) return null;
    // Reject extra path noise after message id (keep link shape strict).
    if (segments.length > 3) return null;
    return { sessionId, messageId };
  }

  // Query form: session/<id>?m=… (or message / messageId)
  // Only when path is exactly session/<id> (no extra path segments).
  if (segments.length !== 1) return null;
  const q = parseMessageDeepLinkQuery(hashOrPath);
  const rawMid = q.m ?? q.message ?? q.messageId ?? "";
  const messageId = sanitizeMessageIdSegment(rawMid);
  if (!messageId) return null;
  return { sessionId, messageId };
}

export type PlanScrollToMessageResult =
  | {
      ok: true;
      messageIndex: number;
      /** Node id when the row is a message-node candidate; else null. */
      nodeId: string | null;
    }
  | {
      ok: false;
      reason: "missing" | "empty_id";
    };

/**
 * Plan a virtualizer / rail scroll to `messageId`.
 * Prefers session message nodes; falls back to any messages[] row by id.
 * Soft-missing when the id is absent after the journal is available.
 */
export function planScrollToMessage(opts: {
  messageId: string | null | undefined;
  nodes: readonly SessionMessageNode[];
  messages: readonly ChatMessage[];
}): PlanScrollToMessageResult {
  const mid = (opts.messageId ?? "").trim();
  if (!mid || !isValidMessageId(mid)) {
    return { ok: false, reason: "empty_id" };
  }

  const fromNode = opts.nodes.find((n) => n.id === mid);
  if (fromNode) {
    return {
      ok: true,
      messageIndex: fromNode.messageIndex,
      nodeId: fromNode.id,
    };
  }

  const msgIdx = opts.messages.findIndex((m) => m.id === mid);
  if (msgIdx >= 0) {
    return {
      ok: true,
      messageIndex: msgIdx,
      nodeId: null,
    };
  }

  return { ok: false, reason: "missing" };
}
