/**
 * Conversation → share-card PNG (Claude/ChatGPT-style export image).
 *
 * Pure builders for card model + offscreen DOM; rasterization uses canvas
 * (no runtime CDN). Footer always credits "Generated with Grok App".
 */

import { escapeHtml, type ExportableMessage } from "@/lib/sessionExport";
import {
  buildSmartShareSummary,
  type ShareCardTheme,
  type SmartShareSummary,
} from "@/lib/shareCardSmart";
import {
  DEFAULT_SHARE_CARD_SKIN,
  getShareCardSkin,
  skinBodyFont,
  skinMetaFont,
  type ShareCardSkin,
  type ShareCardSkinId,
} from "@/lib/shareCardSkins";
import {
  buildInlineMediaPathMap,
  extractMediaPathsFromContent,
  extractSessionRelativeMediaRefs,
  isImagePath,
  mediaTailFromPath,
  pathBasename,
  resolveInlineMediaToken,
  type Attachment,
} from "@/lib/attachments";

export const GROK_APP_SHARE_FOOTER = "Generated with Grok App";

/** One body block inside a full-transcript share message. */
export type ShareCardBodyPart =
  | { kind: "text"; text: string }
  | {
      kind: "image";
      /** Absolute path or original token. */
      path: string;
      /** Prefer data: URL; media:// / https also accepted by canvas Image. */
      src?: string | null;
    };

export type ShareCardMessage = {
  role: "user" | "assistant" | "tool" | string;
  content: string;
  thought?: string;
  createdAt?: string;
  /**
   * Structured body for canvas fallback (text + inline images).
   * DOM export prefers {@link imagePathMap} + {@link attachments} via chat renderers.
   */
  parts?: ShareCardBodyPart[];
  /**
   * Same map chat uses: short tokens / relatives → absolute paths.
   * Passed to MarkdownChat / ImageUi for path resolution.
   */
  imagePathMap?: Record<string, string>;
  /** Message attachments (absolute paths) — bottom cards + path map source. */
  attachments?: Attachment[];
};

export type ShareCardInput = {
  title: string;
  projectName?: string | null;
  /** Project cwd — same as chat `projectPath` for path resolution. */
  projectPath?: string | null;
  sessionId?: string | null;
  exportedAt?: string;
  messages: ShareCardMessage[];
  /** Custom logo data URL; null/omit → built-in mark text. */
  logoDataUrl?: string | null;
  /** Include assistant thinking blocks (default false for share cards). */
  includeThoughts?: boolean;
  /** Max messages to render (default 40; oldest dropped first). */
  maxMessages?: number;
  /** Max chars per message body (default 4000). */
  maxBodyChars?: number;
  /** Footer line (default {@link GROK_APP_SHARE_FOOTER}). */
  footerText?: string;
  /** Card width in CSS px (default 720). */
  widthPx?: number;
  /** UI locale for chat markdown components. */
  locale?: string | null;
};

export type ShareCardModel = {
  title: string;
  projectName: string | null;
  projectPath: string | null;
  sessionId: string | null;
  exportedAt: string;
  messages: ShareCardMessage[];
  logoDataUrl: string | null;
  includeThoughts: boolean;
  footerText: string;
  widthPx: number;
  truncatedCount: number;
  locale: string;
};

const DEFAULT_MAX_MESSAGES = 40;
const DEFAULT_MAX_BODY = 4000;
const DEFAULT_WIDTH = 720;

function roleLabel(role: string): string {
  if (role === "user") return "You";
  if (role === "assistant") return "Grok";
  if (role === "tool") return "Tool";
  return role;
}

function truncateBody(text: string, max: number): string {
  const t = (text || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function isToolish(m: ShareCardMessage): boolean {
  if (m.role === "tool") return true;
  const c = (m.content || "").trim();
  return c.startsWith("tool_step|") || c.startsWith("tool_step");
}

const IMAGE_EXT =
  "png|jpe?g|gif|webp|bmp|svg|heic|avif";

/**
 * Resolve a path-like token to an absolute image path via pathMap / absolute form.
 */
export function resolveShareImagePath(
  token: string,
  pathMap?: Record<string, string> | null,
): string | null {
  const raw = (token || "").trim().replace(/^<|>$/g, "");
  if (!raw) return null;
  const abs = resolveInlineMediaToken(raw, pathMap);
  if (abs && isImagePath(abs)) return abs;
  if (isImagePath(raw) && (raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw))) {
    return raw;
  }
  return null;
}

/**
 * Split message content into text + image parts for full-transcript export.
 * Image hits: markdown `![]()`, backtick media paths, bare session-relative /
 * absolute image paths. Extra attachment images not already inlined are
 * appended at the end.
 */
export function buildShareContentParts(
  content: string,
  pathMap?: Record<string, string> | null,
  attachments?: Attachment[] | null,
): ShareCardBodyPart[] {
  const text = content || "";
  type Hit = { start: number; end: number; path: string };
  const hits: Hit[] = [];
  const seenRanges = new Set<string>();

  const pushHit = (start: number, end: number, token: string) => {
    if (start < 0 || end <= start) return;
    const path = resolveShareImagePath(token, pathMap);
    if (!path) return;
    const key = `${start}:${end}`;
    if (seenRanges.has(key)) return;
    // Skip overlaps
    for (const h of hits) {
      if (!(end <= h.start || start >= h.end)) return;
    }
    seenRanges.add(key);
    hits.push({ start, end, path });
  };

  // ![alt](path-or-url)
  {
    const re = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      pushHit(m.index, m.index + m[0].length, m[2] || "");
    }
  }
  // `path/to/image.ext` or **`path`**
  {
    const re = new RegExp(`\`([^\`\\n]+\\.(?:${IMAGE_EXT}))\``, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      pushHit(m.index, m.index + m[0].length, m[1] || "");
    }
  }
  // Absolute image paths in text
  for (const a of extractMediaPathsFromContent(text)) {
    if (!isImagePath(a.path)) continue;
    const idx = text.indexOf(a.path);
    if (idx >= 0) pushHit(idx, idx + a.path.length, a.path);
  }
  // Session-relative refs (images/1.jpg) — prefer whole-token spans
  for (const rel of extractSessionRelativeMediaRefs(text)) {
    if (!isImagePath(rel)) continue;
    let from = 0;
    while (from < text.length) {
      const idx = text.indexOf(rel, from);
      if (idx < 0) break;
      pushHit(idx, idx + rel.length, rel);
      from = idx + rel.length;
    }
  }

  hits.sort((a, b) => a.start - b.start);

  const parts: ShareCardBodyPart[] = [];
  let cursor = 0;
  const usedPaths = new Set<string>();
  for (const h of hits) {
    if (h.start > cursor) {
      const chunk = text.slice(cursor, h.start);
      // Keep whitespace-only chunks only when they contain a blank line (paragraph).
      if (chunk.trim() || /\n\s*\n/.test(chunk)) {
        parts.push({ kind: "text", text: chunk });
      }
    }
    parts.push({ kind: "image", path: h.path });
    usedPaths.add(h.path.replace(/\\/g, "/"));
    const tail = mediaTailFromPath(h.path);
    if (tail) usedPaths.add(tail.replace(/\\/g, "/"));
    usedPaths.add(pathBasename(h.path));
    cursor = h.end;
  }
  if (cursor < text.length) {
    const chunk = text.slice(cursor);
    if (chunk.trim()) parts.push({ kind: "text", text: chunk });
  }

  // Attachment images not already referenced in body
  for (const a of attachments ?? []) {
    if (a.isDir || !isImagePath(a.path)) continue;
    const norm = a.path.replace(/\\/g, "/");
    const tail = mediaTailFromPath(norm);
    const name = pathBasename(norm);
    if (
      usedPaths.has(norm) ||
      usedPaths.has(name) ||
      (tail && usedPaths.has(tail.replace(/\\/g, "/")))
    ) {
      continue;
    }
    parts.push({ kind: "image", path: a.path });
    usedPaths.add(norm);
  }

  if (!parts.length && text.trim()) {
    parts.push({ kind: "text", text });
  }
  return parts;
}

/** Attach resolved `src` (data:/media:) onto image parts via async loader. */
export async function hydrateShareImageParts(
  parts: ShareCardBodyPart[],
  loadSrc: (absPath: string) => Promise<string | null | undefined>,
): Promise<ShareCardBodyPart[]> {
  const out: ShareCardBodyPart[] = [];
  for (const p of parts) {
    if (p.kind !== "image") {
      out.push(p);
      continue;
    }
    if (p.src) {
      out.push(p);
      continue;
    }
    try {
      const src = await loadSrc(p.path);
      out.push({ ...p, src: src || null });
    } catch {
      out.push({ ...p, src: null });
    }
  }
  return out;
}

/**
 * Build pathMap + parts for a chat message (pure map; hydrate separately).
 */
export function sharePartsFromMessage(input: {
  content: string;
  attachments?: Attachment[] | null;
  pathMap?: Record<string, string> | null;
}): ShareCardBodyPart[] {
  const map = {
    ...buildInlineMediaPathMap(input.attachments),
    ...(input.pathMap || {}),
  };
  return buildShareContentParts(input.content, map, input.attachments);
}

function truncateParts(
  parts: ShareCardBodyPart[],
  maxChars: number,
): ShareCardBodyPart[] {
  let left = maxChars;
  const out: ShareCardBodyPart[] = [];
  for (const p of parts) {
    if (p.kind === "image") {
      out.push(p);
      continue;
    }
    if (left <= 0) break;
    if (p.text.length <= left) {
      out.push(p);
      left -= p.text.length;
    } else {
      out.push({ kind: "text", text: truncateBody(p.text, left) });
      left = 0;
      break;
    }
  }
  return out;
}

/**
 * Normalize exportable messages into a share-card model.
 * Drops empty shells and tool noise; caps length for readable cards.
 */
export function buildShareCardModel(input: ShareCardInput): ShareCardModel {
  const maxMessages = input.maxMessages ?? DEFAULT_MAX_MESSAGES;
  // Full cards with images need more room; still cap for safety.
  const maxBody = input.maxBodyChars ?? DEFAULT_MAX_BODY;
  const includeThoughts = input.includeThoughts === true;
  const widthPx = input.widthPx ?? DEFAULT_WIDTH;

  const cleaned: ShareCardMessage[] = [];
  for (const m of input.messages) {
    if (isToolish(m)) continue;
    // Prefer full content for DOM markdown export; parts only for canvas fallback.
    const body = truncateBody(m.content || "", maxBody);
    const rawParts =
      m.parts && m.parts.length > 0
        ? truncateParts(m.parts, maxBody)
        : ([{ kind: "text" as const, text: body }] as ShareCardBodyPart[]);
    const thought = includeThoughts
      ? truncateBody(m.thought || "", Math.min(1200, maxBody))
      : "";
    const hasImage =
      rawParts.some((p) => p.kind === "image") ||
      (m.attachments ?? []).some((a) => !a.isDir && isImagePath(a.path)) ||
      (m.imagePathMap && Object.keys(m.imagePathMap).length > 0);
    if (!body.trim() && !thought && !hasImage) continue;
    cleaned.push({
      role: m.role,
      content: body,
      thought: thought || undefined,
      createdAt: m.createdAt,
      parts: rawParts,
      imagePathMap: m.imagePathMap,
      attachments: m.attachments,
    });
  }

  let truncatedCount = 0;
  let messages = cleaned;
  if (messages.length > maxMessages) {
    truncatedCount = messages.length - maxMessages;
    messages = messages.slice(messages.length - maxMessages);
  }

  const title = (input.title || "Untitled").trim() || "Untitled";
  return {
    title,
    projectName: (input.projectName || "").trim() || null,
    projectPath: (input.projectPath || "").trim() || null,
    sessionId: input.sessionId ?? null,
    exportedAt: input.exportedAt || new Date().toISOString(),
    messages,
    locale: (input.locale || "en").trim() || "en",
    logoDataUrl: input.logoDataUrl?.trim() || null,
    includeThoughts,
    footerText: (input.footerText || GROK_APP_SHARE_FOOTER).trim(),
    widthPx,
    truncatedCount,
  };
}

/** Safe download basename for PNG export. */
export function sessionExportImageFilename(
  title: string,
  sessionId?: string | null,
): string {
  const base = (title || "session")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const id = (sessionId || "").slice(0, 8);
  const name = base || "session";
  return id ? `grok-${name}-${id}.png` : `grok-${name}.png`;
}

/**
 * Build a self-contained HTML fragment for the share card (no outer document).
 * Used for preview + rasterization. All text is escaped.
 */
export function shareCardToHtml(model: ShareCardModel): string {
  const logo = model.logoDataUrl
    ? `<img class="sc-logo" src="${escapeHtml(model.logoDataUrl)}" alt="" width="36" height="36" />`
    : `<div class="sc-logo sc-logo--mark" aria-hidden="true">G</div>`;

  const metaBits: string[] = [];
  if (model.projectName) metaBits.push(escapeHtml(model.projectName));
  metaBits.push(escapeHtml(model.exportedAt.slice(0, 19).replace("T", " ")));

  const msgHtml = model.messages
    .map((m) => {
      const role = roleLabel(m.role);
      const roleClass =
        m.role === "user"
          ? "user"
          : m.role === "assistant"
            ? "assistant"
            : "other";
      const thought =
        model.includeThoughts && m.thought
          ? `<div class="sc-thought"><span class="sc-thought__label">Thinking</span><pre>${escapeHtml(m.thought)}</pre></div>`
          : "";
      const body = m.content
        ? `<pre class="sc-body">${escapeHtml(m.content)}</pre>`
        : "";
      return `<section class="sc-msg sc-msg--${roleClass}">
  <div class="sc-msg__role">${escapeHtml(role)}</div>
  ${thought}${body}
</section>`;
    })
    .join("\n");

  const more =
    model.truncatedCount > 0
      ? `<p class="sc-more">+${model.truncatedCount} earlier messages omitted</p>`
      : "";

  return `<article class="sc-card" style="width:${model.widthPx}px">
  <header class="sc-header">
    ${logo}
    <div class="sc-header__text">
      <h1 class="sc-title">${escapeHtml(model.title)}</h1>
      <p class="sc-meta">${metaBits.join(" · ")}</p>
    </div>
  </header>
  <div class="sc-thread">
${more}
${msgHtml}
  </div>
  <footer class="sc-footer">
    <span class="sc-footer__mark">${escapeHtml(model.footerText)}</span>
  </footer>
</article>`;
}

/** Inline CSS for share card (light, print-friendly, social-share friendly). */
export const SHARE_CARD_STYLES = `
.sc-card{box-sizing:border-box;background:#0b0c0f;color:#f4f4f5;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;border-radius:16px;overflow:hidden;border:1px solid #27272a;box-shadow:0 12px 40px rgba(0,0,0,.35)}
.sc-header{display:flex;align-items:center;gap:12px;padding:18px 20px 14px;background:linear-gradient(180deg,#14151a 0%,#0b0c0f 100%);border-bottom:1px solid #27272a}
.sc-logo{width:36px;height:36px;border-radius:10px;object-fit:cover;flex-shrink:0;background:#18181b}
.sc-logo--mark{display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;color:#fff;background:linear-gradient(135deg,#3b82f6,#8b5cf6)}
.sc-header__text{min-width:0;flex:1}
.sc-title{margin:0;font-size:16px;font-weight:650;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sc-meta{margin:4px 0 0;font-size:12px;color:#a1a1aa}
.sc-thread{padding:8px 16px 4px;max-height:none}
.sc-more{margin:8px 4px;font-size:12px;color:#71717a}
.sc-msg{margin:10px 0;padding:10px 12px;border-radius:12px}
.sc-msg--user{background:#1e293b;margin-left:24px}
.sc-msg--assistant{background:#18181b;border:1px solid #27272a;margin-right:8px}
.sc-msg--other{background:#18181b;opacity:.9}
.sc-msg__role{font-size:11px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:#a1a1aa;margin-bottom:6px}
.sc-body,.sc-thought pre{margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:13.5px;line-height:1.55;color:#e4e4e7}
.sc-thought{margin-bottom:8px;padding:8px;border-radius:8px;background:#09090b;border:1px solid #27272a}
.sc-thought__label{display:block;font-size:10px;font-weight:600;color:#71717a;margin-bottom:4px;text-transform:uppercase}
.sc-footer{display:flex;align-items:center;justify-content:flex-end;padding:12px 18px 14px;border-top:1px solid #27272a;background:#0b0c0f}
.sc-footer__mark{font-size:11px;font-weight:600;letter-spacing:.04em;color:#71717a}
`.trim();

/**
 * Map session export messages into share-card messages.
 */
export function exportableToShareMessages(
  messages: ExportableMessage[],
): ShareCardMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
    thought: m.thought,
    createdAt: m.createdAt,
  }));
}

export type RasterizeShareCardOptions = {
  /** Device pixel ratio (default 2, Claude-style). */
  pixelRatio?: number;
  /** Background fill under the card (default: skin bg). */
  background?: string;
  /** Curated visual skin (default noir). */
  skinId?: ShareCardSkinId | string | null;
};

/**
 * Canvas text wrap that never overflows `maxWidth`.
 * Strategy: prefer breaking on whitespace; any oversize segment is always
 * broken character-by-character (critical for CJK + long URLs / markdown).
 */
export function wrapTextLines(
  mctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: string,
): string[] {
  const safeMax = Math.max(8, maxWidth);
  mctx.font = font;

  const pushCharWrapped = (token: string, into: string[]): void => {
    if (!token) return;
    let chunk = "";
    for (const ch of token) {
      const trial = chunk + ch;
      if (!chunk || mctx.measureText(trial).width <= safeMax) {
        chunk = trial;
      } else {
        into.push(chunk);
        chunk = ch;
        // Single glyph wider than max: still emit so we advance.
        if (mctx.measureText(chunk).width > safeMax) {
          into.push(chunk);
          chunk = "";
        }
      }
    }
    if (chunk) into.push(chunk);
  };

  const paragraphs = (text || "").split("\n");
  const lines: string[] = [];
  for (const para of paragraphs) {
    if (!para) {
      lines.push("");
      continue;
    }

    // Split keeping whitespace tokens so we can reflow on spaces when possible.
    const parts = para.split(/(\s+)/);
    let line = "";
    const flush = () => {
      if (line) {
        lines.push(line);
        line = "";
      }
    };

    for (const part of parts) {
      if (!part) continue;
      // Whitespace-only: attach if something is on the line; never start a line with it.
      if (/^\s+$/.test(part)) {
        if (!line) continue;
        const trial = line + part;
        if (mctx.measureText(trial).width <= safeMax) {
          line = trial;
        } else {
          flush();
        }
        continue;
      }

      const trial = line + part;
      if (!line) {
        // Start of line — must fit or char-break the token.
        if (mctx.measureText(part).width <= safeMax) {
          line = part;
        } else {
          pushCharWrapped(part, lines);
          line = "";
        }
        continue;
      }

      if (mctx.measureText(trial).width <= safeMax) {
        line = trial;
        continue;
      }

      // Does not fit: commit current line, then place part on a new line.
      flush();
      if (mctx.measureText(part).width <= safeMax) {
        line = part;
      } else {
        pushCharWrapped(part, lines);
        line = "";
      }
    }
    flush();
  }
  return lines.length ? lines : [""];
}

function drawLogoMark(
  ctx: CanvasRenderingContext2D,
  skin: ShareCardSkin | ShareCardTheme,
  x: number,
  y: number,
  size: number,
  logoImg: HTMLImageElement | null,
  radius: number,
) {
  if (logoImg) {
    ctx.save();
    roundRect(ctx, x, y, size, size, radius);
    ctx.clip();
    ctx.drawImage(logoImg, x, y, size, size);
    ctx.restore();
    return;
  }
  const g = ctx.createLinearGradient(x, y, x + size, y + size);
  g.addColorStop(0, skin.logo0);
  g.addColorStop(1, skin.logo1);
  ctx.fillStyle = g;
  roundRect(ctx, x, y, size, size, radius);
  ctx.fill();
  ctx.fillStyle = skin.isLight ? "#ffffff" : "#ffffff";
  ctx.font = `700 ${Math.round(size * 0.45)}px ${skinBodyFont(skin as ShareCardSkin)}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("G", x + size / 2, y + size / 2 + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawCardChrome(
  ctx: CanvasRenderingContext2D,
  skin: ShareCardSkin | ShareCardTheme,
  width: number,
  height: number,
) {
  const r = skin.radius;
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, skin.bg0);
  bg.addColorStop(1, skin.bg1);
  roundRect(ctx, 0, 0, width, height, r);
  ctx.fillStyle = bg;
  ctx.fill();

  if (skin.decor === "corner") {
    // Quiet corner hairlines — not glow orbs.
    ctx.strokeStyle = skin.borderStrong;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(width - 36, 14);
    ctx.lineTo(width - 14, 14);
    ctx.lineTo(width - 14, 36);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(14, height - 36);
    ctx.lineTo(14, height - 14);
    ctx.lineTo(36, height - 14);
    ctx.stroke();
  }

  ctx.strokeStyle = skin.borderStrong;
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, width - 1, height - 1, r);
  ctx.stroke();
}

/**
 * Draw a full-transcript share card with pure Canvas 2D.
 * Reliable in Tauri WebView; logo data URLs load as Image.
 */
export async function rasterizeShareCardPng(
  model: ShareCardModel,
  opts?: RasterizeShareCardOptions,
): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new Error("rasterizeShareCardPng requires a DOM");
  }

  const skin = getShareCardSkin(opts?.skinId);
  const pixelRatio = opts?.pixelRatio ?? 2;
  const width = model.widthPx;
  const padX = 22;
  const lineH = 20;
  const bubbleInset = 14;
  const userSideInset = 28;
  const bodyFont = `13.5px ${skinBodyFont(skin)}`;
  const titleFont = `650 15px ${skinBodyFont(skin)}`;
  const metaFont = `12px ${skinMetaFont(skin)}`;
  const roleFont = `600 10.5px ${skinMetaFont(skin)}`;
  const footerFont = `600 11px ${skinMetaFont(skin)}`;

  const measureCanvas = document.createElement("canvas");
  const mctx = measureCanvas.getContext("2d");
  if (!mctx) throw new Error("no 2d context");

  const wrap = (text: string, maxW: number, font: string) =>
    wrapTextLines(mctx, text, maxW, font);

  type DrawPart =
    | { kind: "text"; lines: string[] }
    | {
        kind: "image";
        img: HTMLImageElement | null;
        path: string;
        drawW: number;
        drawH: number;
      };

  type MsgBlock = {
    kind: "msg";
    role: string;
    roleClass: string;
    parts: DrawPart[];
    thoughtLines: string[];
    left: number;
    bubbleW: number;
    bubbleH: number;
  };
  type Block =
    | { kind: "header" }
    | { kind: "more"; text: string }
    | MsgBlock
    | { kind: "footer" };

  const maxImgH = 300;
  const imgGap = 8;

  // Preload all message images (best-effort).
  const imageCache = new Map<string, HTMLImageElement | null>();
  const preloadSrc = async (src: string | null | undefined, key: string) => {
    if (!src) {
      imageCache.set(key, null);
      return;
    }
    if (imageCache.has(key)) return;
    try {
      const img = await loadImage(src);
      imageCache.set(key, img);
    } catch {
      imageCache.set(key, null);
    }
  };
  for (const m of model.messages) {
    const parts =
      m.parts && m.parts.length
        ? m.parts
        : ([{ kind: "text", text: m.content || "" }] as ShareCardBodyPart[]);
    for (const p of parts) {
      if (p.kind === "image") {
        await preloadSrc(p.src || null, p.path);
      }
    }
  }

  const fitImage = (
    img: HTMLImageElement | null,
    maxW: number,
  ): { drawW: number; drawH: number } => {
    if (!img || !img.naturalWidth || !img.naturalHeight) {
      return { drawW: maxW, drawH: 48 };
    }
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    let drawW = maxW;
    let drawH = (nh / nw) * drawW;
    if (drawH > maxImgH) {
      drawH = maxImgH;
      drawW = (nw / nh) * drawH;
      if (drawW > maxW) {
        drawW = maxW;
        drawH = (nh / nw) * drawW;
      }
    }
    return {
      drawW: Math.max(1, Math.round(drawW)),
      drawH: Math.max(1, Math.round(drawH)),
    };
  };

  const blocks: Block[] = [{ kind: "header" }];
  if (model.truncatedCount > 0) {
    blocks.push({
      kind: "more",
      text: `+${model.truncatedCount} earlier messages omitted`,
    });
  }
  for (const m of model.messages) {
    const role =
      m.role === "user"
        ? "You"
        : m.role === "assistant"
          ? "Grok"
          : m.role === "tool"
            ? "Tool"
            : m.role;
    const roleClass =
      m.role === "user"
        ? "user"
        : m.role === "assistant"
          ? "assistant"
          : "other";
    const isUser = roleClass === "user";
    const left = isUser ? padX + userSideInset : padX;
    const bubbleW = Math.max(80, width - left - padX);
    // Safety margin so glyphs never touch the bubble stroke.
    const textMax = Math.max(40, bubbleW - bubbleInset * 2 - 4);
    const rawParts =
      m.parts && m.parts.length
        ? m.parts
        : ([{ kind: "text", text: m.content || "" }] as ShareCardBodyPart[]);
    const drawParts: DrawPart[] = [];
    for (const p of rawParts) {
      if (p.kind === "text") {
        const t = (p.text || "").replace(/^\n+|\n+$/g, "");
        if (!t.trim()) continue;
        drawParts.push({ kind: "text", lines: wrap(t, textMax, bodyFont) });
      } else {
        const img = imageCache.get(p.path) ?? null;
        const { drawW, drawH } = fitImage(img, textMax);
        drawParts.push({
          kind: "image",
          img,
          path: p.path,
          drawW,
          drawH: img ? drawH : 0,
        });
      }
    }
    if (!drawParts.length) {
      drawParts.push({ kind: "text", lines: [""] });
    }
    const thoughtLines =
      model.includeThoughts && m.thought
        ? wrap(m.thought, Math.max(40, textMax - 12), bodyFont)
        : [];
    const thoughtH =
      thoughtLines.length > 0
        ? 10 + 12 + thoughtLines.length * lineH + 10
        : 0;
    let bodyH = 0;
    for (const dp of drawParts) {
      if (dp.kind === "text") {
        bodyH += Math.max(1, dp.lines.length) * lineH + 4;
      } else if (dp.img && dp.drawH > 0) {
        bodyH += dp.drawH + imgGap;
      }
      // Failed image: omit height (path already removed from text when inlined)
    }
    bodyH = Math.max(bodyH, lineH);
    const bubbleH = 12 + 12 + 6 + thoughtH + bodyH + 12;
    blocks.push({
      kind: "msg",
      role,
      roleClass,
      parts: drawParts,
      thoughtLines,
      left,
      bubbleW,
      bubbleH,
    });
  }
  blocks.push({ kind: "footer" });

  let height = 0;
  const headerH = 70;
  const footerH = 44;
  height += headerH + 10;
  for (const b of blocks) {
    if (b.kind === "header" || b.kind === "footer") continue;
    if (b.kind === "more") {
      height += 26;
      continue;
    }
    height += b.bubbleH + 10;
  }
  height += footerH;
  height = Math.max(height, 160);

  let logoImg: HTMLImageElement | null = null;
  if (model.logoDataUrl) {
    try {
      logoImg = await loadImage(model.logoDataUrl);
    } catch {
      logoImg = null;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.scale(pixelRatio, pixelRatio);

  drawCardChrome(ctx, skin, width, height);

  // Header band
  ctx.fillStyle = skin.footerBg;
  ctx.fillRect(0, 0, width, headerH);
  ctx.strokeStyle = skin.border;
  ctx.beginPath();
  ctx.moveTo(0, headerH);
  ctx.lineTo(width, headerH);
  ctx.stroke();

  const logoSize = 34;
  const logoX = padX;
  const logoY = (headerH - logoSize) / 2;
  drawLogoMark(ctx, skin, logoX, logoY, logoSize, logoImg, skin.radiusSm);

  const textX = logoX + logoSize + 12;
  const titleMaxW = Math.max(40, width - textX - padX - 8);
  ctx.fillStyle = skin.text;
  ctx.font = titleFont;
  const titleLines = wrap(model.title, titleMaxW, titleFont).slice(0, 1);
  const title = titleLines[0] || model.title;
  ctx.fillText(title, textX, logoY + 14);
  ctx.fillStyle = skin.muted;
  ctx.font = metaFont;
  const metaBits: string[] = [];
  if (model.projectName) metaBits.push(model.projectName);
  metaBits.push(model.exportedAt.slice(0, 19).replace("T", " "));
  const meta = metaBits.join(" · ");
  const metaClipped = wrap(meta, titleMaxW, metaFont)[0] || meta;
  ctx.fillText(metaClipped, textX, logoY + 32);

  let y = headerH + 12;

  for (const b of blocks) {
    if (b.kind === "header" || b.kind === "footer") continue;
    if (b.kind === "more") {
      ctx.fillStyle = skin.faint;
      ctx.font = metaFont;
      const moreLine =
        wrap(b.text, width - padX * 2, metaFont)[0] || b.text;
      ctx.fillText(moreLine, padX, y + 14);
      y += 26;
      continue;
    }

    const { left, bubbleW, bubbleH, parts, thoughtLines } = b;

    ctx.fillStyle =
      b.roleClass === "user" ? skin.surfaceUser : skin.surface;
    roundRect(ctx, left, y, bubbleW, bubbleH, skin.radiusSm);
    ctx.fill();
    ctx.strokeStyle = skin.border;
    ctx.lineWidth = 1;
    roundRect(
      ctx,
      left + 0.5,
      y + 0.5,
      bubbleW - 1,
      bubbleH - 1,
      skin.radiusSm,
    );
    ctx.stroke();

    // Clip so metrics edge-cases never paint outside the bubble.
    ctx.save();
    roundRect(ctx, left + 1, y + 1, bubbleW - 2, bubbleH - 2, skin.radiusSm);
    ctx.clip();

    let ty = y + 16;
    ctx.fillStyle = skin.faint;
    ctx.font = roleFont;
    const roleLabel =
      skin.typeFace === "mono" ? b.role : b.role.toUpperCase();
    ctx.fillText(roleLabel, left + bubbleInset, ty);
    ty += 14;

    if (thoughtLines.length > 0) {
      const th = 8 + 12 + thoughtLines.length * lineH + 8;
      ctx.fillStyle = skin.footerBg;
      roundRect(
        ctx,
        left + 10,
        ty,
        bubbleW - 20,
        th,
        Math.max(4, skin.radiusSm - 2),
      );
      ctx.fill();
      ctx.fillStyle = skin.faint;
      ctx.font = roleFont;
      ctx.fillText("Thinking", left + 18, ty + 14);
      ctx.fillStyle = skin.muted;
      ctx.font = bodyFont;
      let ly = ty + 28;
      for (const line of thoughtLines) {
        ctx.fillText(line, left + 18, ly);
        ly += lineH;
      }
      ty += th + 6;
    }

    let ly = ty + 2;
    for (const dp of parts) {
      if (dp.kind === "text") {
        ctx.fillStyle = skin.text;
        ctx.font = bodyFont;
        for (const line of dp.lines) {
          ctx.fillText(line, left + bubbleInset, ly);
          ly += lineH;
        }
        ly += 4;
      } else if (dp.img && dp.drawH > 0) {
        const ix = left + bubbleInset;
        const iy = ly;
        // Soft frame behind image
        ctx.fillStyle = skin.footerBg;
        roundRect(ctx, ix - 2, iy - 2, dp.drawW + 4, dp.drawH + 4, 6);
        ctx.fill();
        try {
          ctx.save();
          roundRect(ctx, ix, iy, dp.drawW, dp.drawH, 6);
          ctx.clip();
          ctx.drawImage(dp.img, ix, iy, dp.drawW, dp.drawH);
          ctx.restore();
        } catch {
          /* draw failed — skip */
        }
        ly += dp.drawH + imgGap;
      }
    }
    ctx.restore();

    y += bubbleH + 10;
  }

  const footerY = height - footerH;
  ctx.fillStyle = skin.footerBg;
  ctx.fillRect(0, footerY, width, footerH);
  ctx.strokeStyle = skin.border;
  ctx.beginPath();
  ctx.moveTo(0, footerY);
  ctx.lineTo(width, footerY);
  ctx.stroke();
  ctx.fillStyle = skin.faint;
  ctx.font = footerFont;
  ctx.textAlign = "right";
  ctx.fillText(model.footerText, width - padX, footerY + 26);
  ctx.textAlign = "left";

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
  if (!blob) throw new Error("toBlob failed");
  return blob;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

/** Download a PNG blob via temporary anchor (browser fallback only). */
export function downloadPngBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    // Required in some WebViews so the synthetic click is not ignored.
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Delay revoke so the download can start.
    setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }
}

/** Blob → base64 (no data: prefix) for Host `export_bytes_save`. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Copy PNG blob to clipboard when supported. */
export async function copyPngBlob(blob: Blob): Promise<boolean> {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof ClipboardItem === "undefined"
  ) {
    return false;
  }
  try {
    const isSafari = /^((?!chrome|android).)*safari/i.test(
      typeof navigator !== "undefined" ? navigator.userAgent : "",
    );
    if (isSafari) {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": Promise.resolve(blob) }),
      ]);
    } else {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
    }
    return true;
  } catch {
    return false;
  }
}


/**
 * Rasterize a smart summary poster (curated skin + bullets + takeaway).
 * Canvas-only; no foreignObject. Footer always credits Grok App.
 */
export async function rasterizeSmartShareCardPng(
  summary: SmartShareSummary,
  opts?: {
    pixelRatio?: number;
    logoDataUrl?: string | null;
    footerText?: string;
    widthPx?: number;
    exportedAt?: string;
  },
): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new Error("rasterizeSmartShareCardPng requires a DOM");
  }
  const pixelRatio = opts?.pixelRatio ?? 2;
  const width = opts?.widthPx ?? 720;
  const theme = summary.theme;
  const footerText = (opts?.footerText || GROK_APP_SHARE_FOOTER).trim();
  const exportedAt = (opts?.exportedAt || new Date().toISOString())
    .slice(0, 19)
    .replace("T", " ");

  const layout = theme.layout;
  const dense = layout === "compact";
  const stacky = layout === "stack";
  const padX = dense ? 24 : 28;
  const contentW = width - padX * 2;
  const lineH = dense ? 20 : 22;
  const titleSize = dense ? 22 : layout === "editorial" ? 26 : 24;
  const bodySize = dense ? 13.5 : 14.5;
  const face = { typeFace: theme.typeFace };
  const fontTitle = `700 ${titleSize}px ${skinBodyFont(face)}`;
  const fontSub = `13px ${skinMetaFont(face)}`;
  const fontBody = `${bodySize}px ${skinBodyFont(face)}`;
  const fontBadge = `600 10.5px ${skinMetaFont(face)}`;
  const fontFooter = `600 11px ${skinMetaFont(face)}`;
  const fontTakeLabel = `700 10px ${skinMetaFont(face)}`;

  const measureCanvas = document.createElement("canvas");
  const mctx = measureCanvas.getContext("2d");
  if (!mctx) throw new Error("no 2d context");

  const wrap = (text: string, maxW: number, font: string) =>
    wrapTextLines(mctx, text, maxW, font);

  const bulletTextMax = contentW - (stacky ? 40 : 36);
  const titleLines = wrap(summary.headline, contentW - 8, fontTitle);
  const subLines = summary.subtitle
    ? wrap(summary.subtitle, contentW - 8, fontSub)
    : [];
  const bulletBlocks = summary.bullets.map((b) =>
    wrap(b, bulletTextMax, fontBody),
  );
  const takeLines = summary.takeaway
    ? wrap(summary.takeaway, contentW - 32, fontBody)
    : [];

  let height = 0;
  const headerH = 88;
  const footerH = 44;
  const titleLineH = titleSize + 8;
  height += headerH;
  height += dense ? 12 : 18;
  height += titleLines.length * titleLineH + 6;
  if (subLines.length) height += subLines.length * 18 + 8;
  height += 14;
  const bulletPadY = dense ? 8 : 10;
  for (const bl of bulletBlocks) {
    height += Math.max(1, bl.length) * lineH + bulletPadY + (dense ? 6 : 8);
  }
  if (takeLines.length) {
    height += 12 + 14 + takeLines.length * lineH + 18;
  }
  height += footerH + 8;
  height = Math.max(height, 280);

  let logoImg: HTMLImageElement | null = null;
  if (opts?.logoDataUrl) {
    try {
      logoImg = await loadImage(opts.logoDataUrl);
    } catch {
      logoImg = null;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.scale(pixelRatio, pixelRatio);

  drawCardChrome(ctx, theme, width, height);

  // Header band
  ctx.fillStyle = theme.footerBg;
  ctx.fillRect(0, 0, width, headerH);
  ctx.strokeStyle = theme.border;
  ctx.beginPath();
  ctx.moveTo(0, headerH);
  ctx.lineTo(width, headerH);
  ctx.stroke();

  const logoSize = 36;
  const logoX = padX;
  const logoY = 26;
  drawLogoMark(ctx, theme, logoX, logoY, logoSize, logoImg, theme.radiusSm);

  // Skin badge (not layout·hue)
  const badgeText = (theme.badgeText || "NOIR").toUpperCase();
  ctx.font = fontBadge;
  const badgeW = Math.ceil(ctx.measureText(badgeText).width) + 14;
  const badgeH = 22;
  const badgeX = width - padX - badgeW;
  const badgeY = logoY + 7;
  ctx.fillStyle = theme.accentSoft;
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 999);
  ctx.fill();
  ctx.fillStyle = theme.accent;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2 + 0.5);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = theme.muted;
  ctx.font = fontSub;
  const dateMax = Math.max(40, badgeX - (logoX + logoSize + 20));
  const dateLine = wrap(exportedAt, dateMax, fontSub)[0] || exportedAt;
  ctx.fillText(dateLine, logoX + logoSize + 14, logoY + 24);

  let y = headerH + (dense ? 14 : 20);

  ctx.fillStyle = theme.text;
  ctx.font = fontTitle;
  for (const line of titleLines) {
    ctx.fillText(line, padX, y + titleSize - 4);
    y += titleLineH;
  }
  y += 2;

  if (subLines.length) {
    ctx.fillStyle = theme.muted;
    ctx.font = fontSub;
    for (const line of subLines) {
      ctx.fillText(line, padX, y + 12);
      y += 18;
    }
    y += 6;
  } else {
    y += 4;
  }

  // Accent rule
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padX, y);
  ctx.lineTo(padX + 40, y);
  ctx.stroke();
  y += dense ? 14 : 18;

  for (const bl of bulletBlocks) {
    const blockH = Math.max(1, bl.length) * lineH + bulletPadY;
    ctx.fillStyle = theme.card;
    roundRect(ctx, padX, y, contentW, blockH, theme.radiusSm);
    ctx.fill();
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    roundRect(
      ctx,
      padX + 0.5,
      y + 0.5,
      contentW - 1,
      blockH - 1,
      theme.radiusSm,
    );
    ctx.stroke();

    ctx.fillStyle = theme.bullet;
    ctx.beginPath();
    ctx.arc(padX + 16, y + blockH / 2, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = theme.text;
    ctx.font = fontBody;
    let ly = y + (dense ? 16 : 18);
    for (const line of bl) {
      ctx.fillText(line, padX + 30, ly);
      ly += lineH;
    }
    y += blockH + (dense ? 6 : 8);
  }

  if (takeLines.length) {
    y += 4;
    const th = 12 + 12 + takeLines.length * lineH + 12;
    ctx.fillStyle = theme.surfaceTakeaway || theme.accentSoft;
    roundRect(ctx, padX, y, contentW, th, theme.radiusSm);
    ctx.fill();
    ctx.strokeStyle = theme.accent;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    roundRect(ctx, padX + 0.5, y + 0.5, contentW - 1, th - 1, theme.radiusSm);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = theme.accent;
    ctx.font = fontTakeLabel;
    ctx.fillText("TAKEAWAY", padX + 16, y + 16);

    ctx.fillStyle = theme.text;
    ctx.font = fontBody;
    let ly = y + 34;
    for (const line of takeLines) {
      ctx.fillText(line, padX + 16, ly);
      ly += lineH;
    }
    y += th + 6;
  }

  const footerY = height - footerH;
  ctx.fillStyle = theme.footerBg;
  ctx.fillRect(0, footerY, width, footerH);
  ctx.strokeStyle = theme.border;
  ctx.beginPath();
  ctx.moveTo(0, footerY);
  ctx.lineTo(width, footerY);
  ctx.stroke();
  ctx.fillStyle = theme.faint;
  ctx.font = fontFooter;
  ctx.textAlign = "right";
  ctx.fillText(footerText, width - padX, footerY + 26);
  ctx.textAlign = "left";

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
  if (!blob) throw new Error("toBlob failed");
  return blob;
}


/** Options for the pure share-card export pipeline (no React / Tauri). */
export type ExportImagePipelineInput = {
  title: string;
  projectName?: string | null;
  projectPath?: string | null;
  sessionId?: string | null;
  messages: ShareCardMessage[];
  /** Smart summary poster vs full transcript card. Default true. */
  smart?: boolean;
  /** Curated visual skin (default noir). */
  skinId?: ShareCardSkinId | string | null;
  logoDataUrl?: string | null;
  pixelRatio?: number;
  locale?: string | null;
};

export type ExportImagePipelineResult = {
  blob: Blob;
  mode: "smart" | "full";
  /** Skin id used for this render. */
  skinId: ShareCardSkinId;
  /** Present when mode === "smart" — structural layout density. */
  styleLabel?: string | null;
  layout?: string | null;
  bulletCount?: number;
  messageCount: number;
  byteLength: number;
};

/**
 * Real export pipeline used by the UI (and e2e tests):
 * messages → model/summary → canvas rasterize → PNG Blob.
 */
export async function buildExportImagePipeline(
  input: ExportImagePipelineInput,
): Promise<ExportImagePipelineResult> {
  const smart = input.smart !== false;
  const logoDataUrl = input.logoDataUrl ?? null;
  const pixelRatio = input.pixelRatio ?? 2;
  const msgs = input.messages ?? [];
  const skin = getShareCardSkin(input.skinId ?? DEFAULT_SHARE_CARD_SKIN);
  const skinId = skin.id;

  if (smart) {
    const summary = buildSmartShareSummary({
      title: input.title,
      messages: msgs,
      includeThoughts: false,
      skinId,
    });
    if (!summary.bullets.length && !summary.headline) {
      const err = new Error("empty");
      (err as Error & { code?: string }).code = "empty";
      throw err;
    }
    // Domain theme buckets must not exist on the universal theme.
    const themeAny = summary.theme as { id?: string; themeId?: string };
    if (themeAny.id === "fitness" || themeAny.themeId === "fitness") {
      throw new Error("domain theme buckets must not be used");
    }
    const blob = await rasterizeSmartShareCardPng(summary, {
      pixelRatio,
      logoDataUrl,
    });
    if (!blob || blob.size < 256) {
      throw new Error("smart rasterize produced empty/small blob");
    }
    return {
      blob,
      mode: "smart",
      skinId,
      styleLabel: summary.theme.skinId,
      layout: summary.theme.layout,
      bulletCount: summary.bullets.length,
      messageCount: summary.sourceMessageCount,
      byteLength: blob.size,
    };
  }

  const model = buildShareCardModel({
    title: input.title,
    projectName: input.projectName,
    projectPath: input.projectPath,
    sessionId: input.sessionId,
    logoDataUrl,
    includeThoughts: false,
    // Longer body so multi-image conversations still fit on one card.
    maxBodyChars: 12_000,
    messages: msgs,
    locale: input.locale,
  });
  if (model.messages.length === 0) {
    const err = new Error("empty");
    (err as Error & { code?: string }).code = "empty";
    throw err;
  }

  // Prefer offscreen DOM + screenshot so GFM markdown (tables, bold, lists,
  // code, images) matches chat rendering. Fall back to canvas text if capture
  // fails (tests / headless / WebView quirks).
  let blob: Blob | null = null;
  if (typeof document !== "undefined") {
    try {
      const { rasterizeShareCardDomPng } = await import(
        "@/lib/shareCardDomExport"
      );
      blob = await rasterizeShareCardDomPng(model, { pixelRatio, skinId });
    } catch {
      blob = null;
    }
  }
  if (!blob || blob.size < 256) {
    blob = await rasterizeShareCardPng(model, { pixelRatio, skinId });
  }
  if (!blob || blob.size < 256) {
    throw new Error("full rasterize produced empty/small blob");
  }
  return {
    blob,
    mode: "full",
    skinId,
    styleLabel: skinId,
    layout: null,
    messageCount: model.messages.length,
    byteLength: blob.size,
  };
}
