/**
 * Platform ACL: allow_from, allow_chat, require_mention.
 */

export function isSenderAllowed(allowFrom: string | undefined, senderId: string): boolean {
  const raw = (allowFrom ?? "*").trim();
  if (!raw || raw === "*") return true;
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.includes("*")) return true;
  return allowed.includes(senderId);
}

export function isChatAllowed(allowChat: string | undefined, chatId: string, chatType: string): boolean {
  // p2p always allowed unless allow_chat explicitly set to empty deny-all list with only groups
  const raw = (allowChat ?? "").trim();
  if (!raw || raw === "*") return true;
  // If allow_chat is set, only listed chats pass (groups typically)
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.includes("*")) return true;
  if (chatType === "p2p" && !allowed.length) return true;
  return allowed.includes(chatId);
}

export function mentionRequired(
  requireMention: boolean | undefined,
  chatType: string,
  mentionBot: boolean | undefined,
): boolean {
  if (chatType !== "group") return true; // not required to drop
  if (!requireMention) return true;
  return Boolean(mentionBot);
}

/** Whether message should be accepted by this binding */
export function acceptInbound(opts: {
  allowFrom?: string;
  allowChat?: string;
  requireMention?: boolean;
  senderId: string;
  chatId: string;
  chatType: string;
  mentionBot?: boolean;
}): { ok: true } | { ok: false; reason: "allow_from" | "allow_chat" | "require_mention" } {
  if (!isSenderAllowed(opts.allowFrom, opts.senderId)) {
    return { ok: false, reason: "allow_from" };
  }
  if (!isChatAllowed(opts.allowChat, opts.chatId, opts.chatType)) {
    return { ok: false, reason: "allow_chat" };
  }
  if (!mentionRequired(opts.requireMention, opts.chatType, opts.mentionBot)) {
    return { ok: false, reason: "require_mention" };
  }
  return { ok: true };
}
