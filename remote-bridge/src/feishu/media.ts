/**
 * Local media/file detection for Feishu native image / audio / video / file messages.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const IMAGE_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  ".ico",
  ".svg",
]);

const AUDIO_EXT = new Set([
  ".mp3",
  ".wav",
  ".ogg",
  ".opus",
  ".m4a",
  ".aac",
  ".flac",
  ".amr",
  ".wma",
]);

const VIDEO_EXT = new Set([
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".m4v",
  ".3gp",
  ".mpeg",
  ".mpg",
]);

/** Any other extension (or no whitelist miss) is treated as generic file. */
export type MediaKind = "image" | "audio" | "video" | "file";

export interface MediaRef {
  kind: MediaKind;
  path: string;
  fileName: string;
  size?: number;
}

/** Absolute / home paths that may point at local files. */
const PATH_RE =
  /(?:^|[\s`'"(（【\[])((?:\/(?:Users|home|var|tmp|opt|private|data)[^\s`'")）】\]]+)|(?:~\/[^\s`'")）】\]]+))/g;

const MD_IMAGE_RE = /!\[[^\]]*\]\((file:\/\/)?([^)\s]+)\)/g;
/** Markdown file link: [name](/abs/path) */
const MD_LINK_RE = /(?<!!)\[[^\]]*\]\((file:\/\/)?(\/[^)\s]+|~\/[^)\s]+)\)/g;

export const DEFAULT_MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024; // 50 MiB
export const DEFAULT_MAX_FILES = 16;

export function expandHome(p: string): string {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  if (p.startsWith("file://")) {
    try {
      let u = p.replace(/^file:\/\//, "");
      // file:///Users/... → /Users/...
      if (u.startsWith("/") || u.match(/^[A-Za-z]:/)) {
        return decodeURIComponent(u);
      }
      return decodeURIComponent("/" + u.replace(/^\/+/, ""));
    } catch {
      return p.replace(/^file:\/\/\/?/, "/");
    }
  }
  return p;
}

export function classifyPath(filePath: string): MediaKind {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXT.has(ext)) return "image";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (VIDEO_EXT.has(ext)) return "video";
  return "file";
}

/** Sniff kind from magic bytes when extension is missing/wrong. */
export function sniffKind(buf: Buffer): MediaKind | null {
  if (buf.length < 4) return null;
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image";
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return "image";
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image";
  // WEBP
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  )
    return "image";
  // PDF
  if (buf.toString("ascii", 0, 4) === "%PDF") return "file";
  // MP3 ID3 or frame sync
  if (buf.toString("ascii", 0, 3) === "ID3") return "audio";
  if (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0) return "audio";
  // MP4 / MOV (ftyp)
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") return "video";
  // ZIP (also docx/xlsx)
  if (buf[0] === 0x50 && buf[1] === 0x4b) return "file";
  return null;
}

export function extForKind(kind: MediaKind, preferred?: string): string {
  if (preferred && path.extname(preferred)) return path.extname(preferred);
  switch (kind) {
    case "image":
      return ".jpg";
    case "audio":
      return ".mp3";
    case "video":
      return ".mp4";
    default:
      return ".bin";
  }
}

/**
 * Extract unique existing local media/file paths from agent text.
 * Any regular file on disk counts as "file" if not image/audio/video.
 */
export function extractMediaRefs(
  text: string,
  opts?: {
    mustExist?: boolean;
    maxFiles?: number;
    maxBytes?: number;
  },
): { refs: MediaRef[]; cleanedText: string } {
  const mustExist = opts?.mustExist !== false;
  const maxFiles = opts?.maxFiles ?? DEFAULT_MAX_FILES;
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;
  const found = new Map<string, MediaRef>();

  const consider = (raw: string) => {
    if (found.size >= maxFiles) return;
    let p = expandHome(String(raw || "").trim());
    p = p.replace(/[.,;:!?。，；：！？]+$/, "");
    p = p.replace(/[)\]}>》」』]+$/, "");
    if (!p) return;
    // absolute or home
    if (!(p.startsWith("/") || p.startsWith(os.homedir()) || /^[A-Za-z]:[\\/]/.test(p))) {
      return;
    }
    if (p.endsWith("/") || p.length < 3) return;

    let kind = classifyPath(p);
    let size: number | undefined;

    if (mustExist) {
      if (!fs.existsSync(p)) return;
      try {
        const st = fs.statSync(p);
        if (!st.isFile() || st.size <= 0) return;
        if (st.size > maxBytes) return;
        size = st.size;
        // refine kind via magic when extension is odd
        if (!path.extname(p) || path.extname(p).length > 6) {
          const head = Buffer.alloc(Math.min(16, st.size));
          const fd = fs.openSync(p, "r");
          fs.readSync(fd, head, 0, head.length, 0);
          fs.closeSync(fd);
          const sniffed = sniffKind(head);
          if (sniffed) kind = sniffed;
        }
      } catch {
        return;
      }
    }

    // No extension + not mustExist → still allow as file
    if (!path.extname(p) && !mustExist) kind = "file";

    const resolved = path.resolve(p);
    if (!found.has(resolved)) {
      found.set(resolved, {
        kind,
        path: resolved,
        fileName: path.basename(resolved),
        size,
      });
    }
  };

  let cleaned = text || "";

  cleaned = cleaned.replace(MD_IMAGE_RE, (_full, _f, url: string) => {
    consider(String(url));
    return "";
  });

  cleaned = cleaned.replace(MD_LINK_RE, (_full, _f, url: string) => {
    consider(String(url));
    // keep a short mention in text
    return path.basename(String(url));
  });

  let m: RegExpExecArray | null;
  const re = new RegExp(PATH_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    consider(m[1] || "");
  }

  // Whole-line paths (any extension or none)
  for (const line of text.split("\n")) {
    const t = line.trim().replace(/^['"`]+|['"`]+$/g, "");
    if (
      /^\/\S+$/.test(t) ||
      /^~\/\S+$/.test(t) ||
      /^[A-Za-z]:[\\/]\S+$/.test(t) ||
      /^file:\/\/\/\S+$/i.test(t)
    ) {
      consider(t);
    }
    // "附件：/path/to/x"
    const labeled = t.match(
      /(?:路径|文件|附件|图片|视频|音频|path|file|image|video|audio)\s*[:：]\s*(\S+)/i,
    );
    if (labeled?.[1]) consider(labeled[1]);
  }

  cleaned = cleaned
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  return { refs: [...found.values()], cleanedText: cleaned };
}

export function saveInboundMedia(
  data: Buffer,
  opts: { ext?: string; prefix?: string; dir?: string; fileName?: string },
): string {
  const dir = opts.dir || path.join(os.homedir(), ".agent-connect", "inbound");
  fs.mkdirSync(dir, { recursive: true });
  const ext = opts.ext || ".bin";
  const base =
    opts.fileName && path.basename(opts.fileName).replace(/[^\w.\-()+@]+/g, "_");
  const name =
    base && base.length > 1
      ? `${Date.now()}-${base}`
      : `${opts.prefix || "bin"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const full = path.join(dir, name);
  fs.writeFileSync(full, data);
  return full;
}

export function buildInboundMediaPrompt(
  text: string,
  paths: string[],
  labels?: { images?: string[]; files?: string[]; audio?: string[]; video?: string[] },
): string {
  if (!paths.length) return text;
  const lines: string[] = [
    `用户发送了 ${paths.length} 个媒体/文件附件，已下载到本机：`,
  ];
  if (labels?.images?.length) {
    lines.push("图片：");
    labels.images.forEach((p, i) => lines.push(`  ${i + 1}. ${p}`));
  }
  if (labels?.audio?.length) {
    lines.push("音频：");
    labels.audio.forEach((p, i) => lines.push(`  ${i + 1}. ${p}`));
  }
  if (labels?.video?.length) {
    lines.push("视频：");
    labels.video.forEach((p, i) => lines.push(`  ${i + 1}. ${p}`));
  }
  if (labels?.files?.length) {
    lines.push("文件：");
    labels.files.forEach((p, i) => lines.push(`  ${i + 1}. ${p}`));
  }
  if (!labels) {
    paths.forEach((p, i) => lines.push(`  ${i + 1}. ${p}`));
  }
  lines.push(
    "你可用 Read 等工具分析这些路径。",
    "若你生成了新图片/视频/音频/普通文件要回传给用户，请在回复中单独写一行绝对路径；飞书桥会上传为原生消息。",
  );
  const hint = lines.join("\n");
  return text ? `${hint}\n\n用户说：${text}` : hint;
}

export const MEDIA_OUTBOUND_RULE =
  "When you create or save any image, audio, video, or ordinary file for the user, put each absolute filesystem path on its own line " +
  "(e.g. /Users/me/Downloads/out.png or /tmp/report.pdf). " +
  "The Feishu bridge uploads them as native Feishu image/audio/video/file messages. " +
  "Do not claim you already sent a Feishu attachment — only the path is required. " +
  "Prefer real local files over remote URLs when the user asks for an attachment.";
