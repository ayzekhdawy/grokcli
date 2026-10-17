/**
 * Outbound Feishu delivery: text + native image / audio / video / file messages.
 * Prefers direct REST upload (reliable) over Channel SDK path upload.
 */

import fs from "node:fs";
import { log } from "../util/logger.js";
import {
  extractMediaRefs,
  classifyPath,
  type MediaKind,
  type MediaRef,
} from "./media.js";
import {
  uploadAndSendMessage,
  type FeishuUploadAuth,
} from "./upload.js";

export interface OutboundChannel {
  send: (
    chatId: string,
    input: Record<string, unknown>,
    options?: { replyTo?: string },
  ) => Promise<unknown>;
}

export interface DeliverReplyOptions {
  channel: OutboundChannel;
  chatId: string;
  replyTo?: string;
  text: string;
  textAlreadySent?: boolean;
  /** Required for reliable REST upload path */
  auth?: FeishuUploadAuth;
}

/**
 * Send one local path as Feishu native message.
 * Uses open platform upload APIs first (stages file to clean path).
 */
export async function sendNativePath(
  channel: OutboundChannel,
  chatId: string,
  filePath: string,
  replyTo?: string,
  kindHint?: MediaKind,
  auth?: FeishuUploadAuth,
): Promise<void> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`path not found: ${filePath}`);
  }
  const kind = kindHint || classifyPath(filePath);

  // Preferred: REST upload + message create (handles %2F paths, retries)
  if (auth?.appId && auth?.appSecret) {
    await uploadAndSendMessage(auth, chatId, filePath, {
      replyTo,
      kind,
    });
    return;
  }

  // Fallback: Channel SDK (may fail on odd paths / flaky upload)
  const fileName = filePath.split(/[/\\]/).pop() || "file";
  const opts = replyTo ? { replyTo } : undefined;
  try {
    if (kind === "image") {
      await channel.send(chatId, { image: { source: filePath } }, opts);
    } else {
      await channel.send(
        chatId,
        { file: { source: filePath, fileName } },
        opts,
      );
    }
    log.info("feishu media sent via channel sdk", { path: filePath, kind });
  } catch (e) {
    log.error("feishu media send failed", {
      path: filePath,
      kind,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

export async function sendNativePaths(
  channel: OutboundChannel,
  chatId: string,
  paths: string[],
  replyTo?: string,
  auth?: FeishuUploadAuth,
): Promise<{ ok: string[]; failed: Array<{ path: string; error: string }> }> {
  const ok: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];
  for (const p of paths) {
    try {
      await sendNativePath(channel, chatId, p, replyTo, undefined, auth);
      ok.push(p);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      failed.push({ path: p, error });
      log.error("feishu media send failed", { path: p, error });
      try {
        await channel.send(
          chatId,
          {
            text: `附件发送失败（${p.split(/[/\\]/).pop()}）：${error}\n路径：${p}`,
          },
          replyTo ? { replyTo } : undefined,
        );
      } catch {
        /* ignore */
      }
    }
  }
  return { ok, failed };
}

/**
 * Send markdown text (optional) then Feishu-native media for each local path found.
 */
export async function deliverTextAndMedia(
  opts: DeliverReplyOptions,
): Promise<{ text: string; media: MediaRef[] }> {
  const { refs, cleanedText } = extractMediaRefs(opts.text);
  const text = cleanedText || (refs.length ? "" : opts.text);

  if (!opts.textAlreadySent && text.trim()) {
    try {
      await opts.channel.send(
        opts.chatId,
        { markdown: text },
        opts.replyTo ? { replyTo: opts.replyTo } : undefined,
      );
    } catch (e) {
      log.warn("markdown send failed, try text", {
        error: e instanceof Error ? e.message : String(e),
      });
      await opts.channel.send(
        opts.chatId,
        { text },
        opts.replyTo ? { replyTo: opts.replyTo } : undefined,
      );
    }
  } else if (!opts.textAlreadySent && !text.trim() && refs.length) {
    await opts.channel.send(
      opts.chatId,
      { text: `📎 ${refs.length} 个附件` },
      opts.replyTo ? { replyTo: opts.replyTo } : undefined,
    );
  }

  for (const ref of refs) {
    try {
      await sendNativePath(
        opts.channel,
        opts.chatId,
        ref.path,
        opts.replyTo,
        ref.kind,
        opts.auth,
      );
    } catch (e) {
      try {
        await opts.channel.send(
          opts.chatId,
          {
            text: `附件发送失败（${ref.fileName}）：${e instanceof Error ? e.message : String(e)}\n路径：${ref.path}`,
          },
          opts.replyTo ? { replyTo: opts.replyTo } : undefined,
        );
      } catch {
        /* ignore */
      }
    }
  }

  return { text, media: refs };
}
