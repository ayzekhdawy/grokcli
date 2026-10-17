/**
 * Inbound Feishu media: download image / file / audio / video for Grok.
 */

import path from "node:path";
import os from "node:os";
import { log } from "../util/logger.js";
import {
  saveInboundMedia,
  sniffKind,
  classifyPath,
  extForKind,
  type MediaKind,
} from "./media.js";

export interface InboundResource {
  type?: string;
  key?: string;
  fileKey?: string;
  imageKey?: string;
  fileName?: string;
  mimeType?: string;
  mime?: string;
}

export interface DownloadChannel {
  downloadResource?: (
    key: string,
    type: string,
  ) => Promise<Buffer | Uint8Array | ArrayBuffer>;
}

export interface InboundMediaResult {
  images: string[];
  files: string[];
  audio: string[];
  video: string[];
  /** All paths in stable order */
  all: string[];
}

function toBuffer(raw: Buffer | Uint8Array | ArrayBuffer): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  return Buffer.from(raw);
}

function normalizeType(type: string): MediaKind | "unknown" {
  const t = type.toLowerCase();
  if (t === "image" || t === "img" || t === "sticker") return "image";
  if (t === "audio" || t === "voice" || t === "media_audio") return "audio";
  if (t === "video" || t === "media_video") return "video";
  if (t === "file" || t === "media" || t === "document") return "file";
  return "unknown";
}

function mimeToExt(mime?: string): string {
  if (!mime) return "";
  const m = mime.toLowerCase();
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/opus": ".opus",
    "audio/mp4": ".m4a",
    "audio/amr": ".amr",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "application/json": ".json",
  };
  return map[m] || "";
}

function extFromName(name?: string): string {
  if (!name) return "";
  const e = path.extname(name);
  return e || "";
}

/**
 * Download message resources to ~/.agent-connect/inbound/ (or opts.dir).
 */
export async function downloadInboundResources(
  channel: DownloadChannel,
  resources: InboundResource[] | undefined,
  opts?: { dir?: string },
): Promise<InboundMediaResult> {
  const images: string[] = [];
  const files: string[] = [];
  const audio: string[] = [];
  const video: string[] = [];
  if (!resources?.length || !channel.downloadResource) {
    return { images, files, audio, video, all: [] };
  }

  const dir = opts?.dir || path.join(os.homedir(), ".agent-connect", "inbound");

  for (const r of resources) {
    const rawType = String(r.type || "file");
    let kind: MediaKind | "unknown" = normalizeType(rawType);
    const key = r.key || r.fileKey || r.imageKey || "";
    if (!key) continue;

    // Map download type for SDK
    const downloadType =
      kind === "image"
        ? "image"
        : kind === "audio"
          ? "file"
          : kind === "video"
            ? "file"
            : kind === "file"
              ? "file"
              : rawType || "file";

    try {
      const raw = await channel.downloadResource(key, downloadType);
      const buf = toBuffer(raw);
      if (!buf.length) continue;

      const sniffed = sniffKind(buf);
      if (kind === "unknown" && sniffed) kind = sniffed;
      if (kind === "unknown") {
        const byName = r.fileName ? classifyPath(r.fileName) : "file";
        kind = byName;
      }

      const mime = r.mimeType || r.mime;
      // After resolution above, kind is MediaKind; keep a safe fallback for exhaustiveness
      const resolvedKind: MediaKind =
        kind === "image" || kind === "audio" || kind === "video" || kind === "file"
          ? kind
          : "file";
      let ext =
        extFromName(r.fileName) ||
        mimeToExt(mime) ||
        extForKind(resolvedKind);

      const p = saveInboundMedia(buf, {
        dir,
        ext,
        fileName: r.fileName,
        prefix:
          kind === "image"
            ? "feishu-img"
            : kind === "audio"
              ? "feishu-audio"
              : kind === "video"
                ? "feishu-video"
                : "feishu-file",
      });

      if (kind === "image") images.push(p);
      else if (kind === "audio") audio.push(p);
      else if (kind === "video") video.push(p);
      else files.push(p);

      log.info("inbound media saved", {
        path: p,
        kind,
        bytes: buf.length,
        type: rawType,
      });
    } catch (e) {
      // Retry alternate download type
      try {
        const alt = downloadType === "image" ? "file" : "image";
        const raw = await channel.downloadResource!(key, alt);
        const buf = toBuffer(raw);
        const kind2 = sniffKind(buf) || "file";
        const p = saveInboundMedia(buf, {
          dir,
          ext: extFromName(r.fileName) || extForKind(kind2),
          fileName: r.fileName,
          prefix: "feishu-alt",
        });
        if (kind2 === "image") images.push(p);
        else if (kind2 === "audio") audio.push(p);
        else if (kind2 === "video") video.push(p);
        else files.push(p);
        log.info("inbound media saved (retry)", { path: p, kind: kind2 });
      } catch (e2) {
        log.error("inbound media download failed", {
          key,
          type: rawType,
          error: e instanceof Error ? e.message : String(e),
          retryError: e2 instanceof Error ? e2.message : String(e2),
        });
      }
    }
  }

  return {
    images,
    files,
    audio,
    video,
    all: [...images, ...audio, ...video, ...files],
  };
}
