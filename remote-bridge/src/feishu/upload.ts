/**
 * Reliable Feishu image/file upload via open platform REST API.
 * Avoids Channel SDK path quirks (e.g. paths containing %2F).
 */

import fs from "node:fs";
import path from "node:path";
import { openApiBase, type PlatformBrand } from "../config/types.js";
import { log } from "../util/logger.js";
import { defaultDataDir, ensureDir } from "../util/paths.js";
import { classifyPath, type MediaKind } from "./media.js";

export interface FeishuUploadAuth {
  appId: string;
  appSecret: string;
  platform?: PlatformBrand | string;
}

async function tenantToken(auth: FeishuUploadAuth): Promise<string> {
  const base = openApiBase(auth.platform === "lark" ? "lark" : "feishu");
  const res = await fetch(`${base}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: auth.appId,
      app_secret: auth.appSecret,
    }),
  });
  const data = (await res.json()) as {
    code: number;
    msg?: string;
    tenant_access_token?: string;
  };
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`tenant_token failed: code=${data.code} msg=${data.msg}`);
  }
  return data.tenant_access_token;
}

/** Copy to a simple path under ~/.agent-connect/outbound/ (no % encodings). */
export function stageOutboundFile(src: string): string {
  if (!fs.existsSync(src)) throw new Error(`file not found: ${src}`);
  const dir = path.join(defaultDataDir(), "outbound");
  ensureDir(dir);
  const base = path.basename(src).replace(/[^\w.\-()+@]+/g, "_") || "file.bin";
  const dest = path.join(dir, `${Date.now()}-${base}`);
  fs.copyFileSync(src, dest);
  return dest;
}

export async function uploadImageKey(
  auth: FeishuUploadAuth,
  filePath: string,
): Promise<string> {
  const staged = stageOutboundFile(filePath);
  const token = await tenantToken(auth);
  const base = openApiBase(auth.platform === "lark" ? "lark" : "feishu");
  const buf = fs.readFileSync(staged);
  if (buf.length === 0) throw new Error("empty image");
  if (buf.length > 10 * 1024 * 1024) {
    // Over image limit — caller may fall back to file upload
    throw new Error(`image too large for im/v1/images (${buf.length} bytes, max 10MB)`);
  }

  const form = new FormData();
  form.append("image_type", "message");
  form.append(
    "image",
    new Blob([buf], { type: mimeFromPath(staged) }),
    path.basename(staged),
  );

  const res = await fetchWithRetry(`${base}/open-apis/im/v1/images`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = (await res.json()) as {
    code: number;
    msg?: string;
    data?: { image_key?: string };
  };
  if (data.code !== 0 || !data.data?.image_key) {
    throw new Error(`image upload API code=${data.code} msg=${data.msg}`);
  }
  log.info("feishu image_key uploaded", {
    image_key: data.data.image_key,
    bytes: buf.length,
    staged,
  });
  return data.data.image_key;
}

export async function uploadFileKey(
  auth: FeishuUploadAuth,
  filePath: string,
  fileType: "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream" = "stream",
): Promise<{ file_key: string; fileName: string }> {
  const staged = stageOutboundFile(filePath);
  const token = await tenantToken(auth);
  const base = openApiBase(auth.platform === "lark" ? "lark" : "feishu");
  const buf = fs.readFileSync(staged);
  if (buf.length === 0) throw new Error("empty file");
  if (buf.length > 30 * 1024 * 1024) {
    throw new Error(`file too large (${buf.length} bytes, max 30MB)`);
  }
  const fileName = path.basename(staged);

  const form = new FormData();
  form.append("file_type", fileType);
  form.append("file_name", fileName);
  form.append(
    "file",
    new Blob([buf], { type: "application/octet-stream" }),
    fileName,
  );

  const res = await fetchWithRetry(`${base}/open-apis/im/v1/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = (await res.json()) as {
    code: number;
    msg?: string;
    data?: { file_key?: string };
  };
  if (data.code !== 0 || !data.data?.file_key) {
    throw new Error(`file upload API code=${data.code} msg=${data.msg}`);
  }
  log.info("feishu file_key uploaded", {
    file_key: data.data.file_key,
    bytes: buf.length,
    staged,
  });
  return { file_key: data.data.file_key, fileName };
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 3,
): Promise<Response> {
  let lastErr: Error | null = null;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, init);
      return res;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      log.warn("feishu upload fetch retry", {
        attempt: i + 1,
        error: lastErr.message,
      });
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr || new Error("fetch failed");
}

function mimeFromPath(p: string): string {
  const e = path.extname(p).toLowerCase();
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  };
  return map[e] || "application/octet-stream";
}

function fileTypeForPath(p: string): "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream" {
  const e = path.extname(p).toLowerCase();
  if (e === ".pdf") return "pdf";
  if (e === ".mp4" || e === ".mov") return "mp4";
  if (e === ".opus" || e === ".ogg") return "opus";
  if (e === ".doc" || e === ".docx") return "doc";
  if (e === ".xls" || e === ".xlsx") return "xls";
  if (e === ".ppt" || e === ".pptx") return "ppt";
  return "stream";
}

/**
 * Upload + send as image or file message via raw im.message.create.
 */
export async function uploadAndSendMessage(
  auth: FeishuUploadAuth,
  chatId: string,
  filePath: string,
  opts?: { replyTo?: string; kind?: MediaKind },
): Promise<void> {
  const kind = opts?.kind || classifyPath(filePath);
  const base = openApiBase(auth.platform === "lark" ? "lark" : "feishu");
  const token = await tenantToken(auth);

  let msgType: string;
  let content: string;

  if (kind === "image") {
    try {
      const imageKey = await uploadImageKey(auth, filePath);
      msgType = "image";
      content = JSON.stringify({ image_key: imageKey });
    } catch (e) {
      // Oversize or format → send as file instead
      log.warn("image upload as image failed, try file", {
        error: e instanceof Error ? e.message : String(e),
      });
      const { file_key } = await uploadFileKey(
        auth,
        filePath,
        fileTypeForPath(filePath),
      );
      msgType = "file";
      content = JSON.stringify({ file_key });
    }
  } else {
    const { file_key } = await uploadFileKey(
      auth,
      filePath,
      fileTypeForPath(filePath),
    );
    // Prefer media-specific msg_type when possible
    if (kind === "audio") {
      msgType = "audio";
      content = JSON.stringify({ file_key, duration: 3000 });
    } else if (kind === "video") {
      msgType = "media";
      content = JSON.stringify({ file_key });
    } else {
      msgType = "file";
      content = JSON.stringify({ file_key });
    }
  }

  // Prefer reply API when replyTo present
  if (opts?.replyTo) {
    const res = await fetchWithRetry(
      `${base}/open-apis/im/v1/messages/${encodeURIComponent(opts.replyTo)}/reply`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content,
          msg_type: msgType,
        }),
      },
    );
    const data = (await res.json()) as { code: number; msg?: string };
    if (data.code !== 0) {
      // Fallback: plain create without reply
      log.warn("reply media failed, try create", { code: data.code, msg: data.msg });
    } else {
      log.info("feishu media message replied", { msgType, chatId });
      return;
    }
  }

  const res = await fetchWithRetry(`${base}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: msgType,
      content,
    }),
  });
  const data = (await res.json()) as { code: number; msg?: string };
  if (data.code !== 0) {
    // Last resort: if audio/media type failed, retry as file
    if (msgType === "audio" || msgType === "media") {
      const { file_key } = await uploadFileKey(
        auth,
        filePath,
        fileTypeForPath(filePath),
      );
      const res2 = await fetchWithRetry(
        `${base}/open-apis/im/v1/messages?receive_id_type=chat_id`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            receive_id: chatId,
            msg_type: "file",
            content: JSON.stringify({ file_key }),
          }),
        },
      );
      const data2 = (await res2.json()) as { code: number; msg?: string };
      if (data2.code !== 0) {
        throw new Error(`send message code=${data2.code} msg=${data2.msg}`);
      }
      log.info("feishu media sent as file fallback", { chatId });
      return;
    }
    throw new Error(`send message code=${data.code} msg=${data.msg}`);
  }
  log.info("feishu media message sent", { msgType, chatId });
}
