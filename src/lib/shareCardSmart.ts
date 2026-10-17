/**
 * Smart share-card summary (offline).
 *
 * Summary text is condensed from headings / lists / emphasis / closing lines
 * (topic-agnostic). Visual palette comes from curated skins
 * (`shareCardSkins.ts`); layout density still follows content structure.
 */

import type { ShareCardMessage } from "@/lib/sessionExportImage";
import {
  getShareCardSkin,
  type ShareCardSkinId,
} from "@/lib/shareCardSkins";

/** Structural layout modes — not topic labels. */
export type ShareCardLayoutMode = "editorial" | "stack" | "compact";

export type ShareCardTheme = {
  /** Stable seed 0..1 from content hash (for debugging). */
  seed: number;
  /** Reserved: skin accent reference (0 for curated skins). */
  hue: number;
  layout: ShareCardLayoutMode;
  /** Skin id applied to this card. */
  skinId: ShareCardSkinId;
  bg0: string;
  bg1: string;
  accent: string;
  accentSoft: string;
  text: string;
  muted: string;
  card: string;
  bullet: string;
  badge: string;
  /** @deprecated No glow orbs — kept empty/transparent for callers. */
  orbA: string;
  orbB: string;
  /** Short badge label from skin (e.g. "NOIR"). */
  badgeText: string;
  /** Full skin tokens for canvas rasterizers. */
  surfaceUser: string;
  surfaceTakeaway: string;
  border: string;
  borderStrong: string;
  faint: string;
  logo0: string;
  logo1: string;
  footerBg: string;
  radius: number;
  radiusSm: number;
  typeFace: "sans" | "mono";
  decor: "none" | "grain" | "corner";
  isLight: boolean;
};

export type SmartShareSummary = {
  theme: ShareCardTheme;
  headline: string;
  subtitle: string | null;
  bullets: string[];
  takeaway: string | null;
  sourceMessageCount: number;
};

const MAX_BULLETS = 8;
const MAX_BULLET_CHARS = 96;
const MAX_HEADLINE = 48;
const MAX_TAKEAWAY = 120;

export function stripMarkdownLite(s: string): string {
  return (s || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\|/g, " ")
    .replace(/[-]{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** FNV-1a 32-bit → [0, 1). Stable across runs. */
export function contentSeed(text: string): number {
  let h = 0x811c9dc5;
  const s = text || "";
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export type ContentStructure = {
  lines: number;
  listRatio: number;
  headingRatio: number;
  codeRatio: number;
  cjkRatio: number;
  questionRatio: number;
  avgLineLen: number;
  energy: number;
};

/** Topic-agnostic structural signals from raw markdown/text. */
export function analyzeContentStructure(text: string): ContentStructure {
  const sample = (text || "").slice(0, 16_000);
  const lines = sample.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  const n = Math.max(1, nonEmpty.length);

  let list = 0;
  let heading = 0;
  let codeLines = 0;
  let inFence = false;
  let q = 0;
  let lenSum = 0;
  let bang = 0;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    lenSum += t.length;
    if (t.startsWith("```")) {
      inFence = !inFence;
      codeLines += 1;
      continue;
    }
    if (inFence) {
      codeLines += 1;
      continue;
    }
    if (/^#{1,6}\s+\S/.test(t)) heading += 1;
    if (/^([-*+]|\d+\.)\s+\S/.test(t)) list += 1;
    if (/[?？]/.test(t)) q += 1;
    if (/[!！]/.test(t)) bang += 1;
  }

  let cjk = 0;
  let letters = 0;
  for (const ch of sample) {
    if (/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(ch)) cjk += 1;
    else if (/[A-Za-z0-9]/.test(ch)) letters += 1;
  }
  const alpha = Math.max(1, cjk + letters);

  const listRatio = list / n;
  const headingRatio = heading / n;
  const codeRatio = codeLines / Math.max(1, lines.length);
  const cjkRatio = cjk / alpha;
  const questionRatio = q / n;
  const avgLineLen = lenSum / n;
  // Energy: questions + bangs + short punchy lines
  const shortLines = nonEmpty.filter((l) => l.trim().length < 40).length / n;
  const energy = clamp01(questionRatio * 1.2 + bang / n + shortLines * 0.35);

  return {
    lines: n,
    listRatio: clamp01(listRatio),
    headingRatio: clamp01(headingRatio),
    codeRatio: clamp01(codeRatio),
    cjkRatio: clamp01(cjkRatio),
    questionRatio: clamp01(questionRatio),
    avgLineLen,
    energy,
  };
}

function pickLayout(st: ContentStructure, bulletCount: number): ShareCardLayoutMode {
  if (st.codeRatio > 0.18 || st.avgLineLen > 90) return "compact";
  if (st.listRatio > 0.28 || bulletCount >= 5) return "stack";
  if (st.headingRatio > 0.12 || st.lines > 40) return "editorial";
  return bulletCount >= 3 ? "stack" : "editorial";
}

/**
 * Build theme tokens: curated skin palette + structure-derived layout.
 */
export function buildThemeFromContent(
  title: string,
  corpus: string,
  bulletCount = 0,
  skinId?: string | null,
): ShareCardTheme {
  const seed = contentSeed(`${title}\n${corpus.slice(0, 2000)}`);
  const st = analyzeContentStructure(`${title}\n${corpus}`);
  const layout = pickLayout(st, bulletCount);
  const skin = getShareCardSkin(skinId);

  return {
    seed,
    hue: 0,
    layout,
    skinId: skin.id,
    bg0: skin.bg0,
    bg1: skin.bg1,
    accent: skin.accent,
    accentSoft: skin.accentSoft,
    text: skin.text,
    muted: skin.muted,
    card: skin.surface,
    bullet: skin.bullet,
    badge: skin.accent,
    orbA: "transparent",
    orbB: "transparent",
    badgeText: skin.badge,
    surfaceUser: skin.surfaceUser,
    surfaceTakeaway: skin.surfaceTakeaway,
    border: skin.border,
    borderStrong: skin.borderStrong,
    faint: skin.faint,
    logo0: skin.logo0,
    logo1: skin.logo1,
    footerBg: skin.footerBg,
    radius: skin.radius,
    radiusSm: skin.radiusSm,
    typeFace: skin.typeFace,
    decor: skin.decor,
    isLight: skin.isLight,
  };
}

/** @deprecated Use buildThemeFromContent — kept as thin alias for callers. */
export function pickShareCardTheme(text: string): ShareCardTheme {
  return buildThemeFromContent("", text, 0);
}

function extractHeadings(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^#{1,3}\s+(.+)$/);
    if (m?.[1]) out.push(stripMarkdownLite(m[1]));
  }
  return out.filter(Boolean);
}

function extractListItems(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)$/);
    if (m?.[1]) {
      const cleaned = stripMarkdownLite(m[1]);
      if (cleaned.length >= 4) out.push(cleaned);
    }
  }
  return out;
}

function extractBoldPhrases(text: string): string[] {
  const out: string[] = [];
  const re = /\*\*([^*]{2,80})\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const t = stripMarkdownLite(m[1]);
    if (t.length >= 4) out.push(t);
  }
  return out;
}

function extractTakeaway(text: string): string | null {
  const lines = text.split("\n");
  // Prefer lines that look like closers (structure), not fixed domain words only.
  const closerRe =
    /^(#{1,3}\s*)?(一句话|总结|要点|结论|小结|takeaway|tl;?dr|summary|bottom\s*line|key\s*point)\b/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (closerRe.test(line.trim())) {
      const after = line.split(/[：:]/).slice(1).join(":").trim();
      if (after) return truncate(stripMarkdownLite(after), MAX_TAKEAWAY);
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const cand = stripMarkdownLite(lines[j] ?? "");
        if (cand.length >= 8) return truncate(cand, MAX_TAKEAWAY);
      }
    }
  }
  // Last short paragraph as soft closer
  const paras = text
    .split(/\n{2,}/)
    .map((p) => stripMarkdownLite(p))
    .filter((p) => p.length >= 12 && p.length <= 160);
  return paras.length ? truncate(paras[paras.length - 1]!, MAX_TAKEAWAY) : null;
}

function dedupePreserve(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const key = raw.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    let near = false;
    for (const s of seen) {
      if (s.startsWith(key.slice(0, 24)) || key.startsWith(s.slice(0, 24))) {
        near = true;
        break;
      }
    }
    if (near) continue;
    seen.add(key);
    out.push(truncate(raw, MAX_BULLET_CHARS));
    if (out.length >= max) break;
  }
  return out;
}

export function buildSmartShareSummary(input: {
  title: string;
  messages: ShareCardMessage[];
  includeThoughts?: boolean;
  /** Curated visual skin (default noir). */
  skinId?: string | null;
}): SmartShareSummary {
  const parts: string[] = [];
  let sourceMessageCount = 0;
  for (const m of input.messages) {
    if (m.role === "tool") continue;
    const body = (m.content || "").trim();
    const thought =
      input.includeThoughts && m.thought ? String(m.thought).trim() : "";
    if (!body && !thought) continue;
    sourceMessageCount += 1;
    if (m.role === "user") parts.push(body.slice(0, 400));
    else {
      parts.push(body);
      if (thought) parts.push(thought.slice(0, 600));
    }
  }
  const corpus = parts.join("\n\n");
  const headings = extractHeadings(corpus);
  const lists = extractListItems(corpus);
  const bolds = extractBoldPhrases(corpus);

  const headline = truncate(
    stripMarkdownLite(input.title) ||
      headings[0] ||
      stripMarkdownLite(parts[0] || "").slice(0, MAX_HEADLINE) ||
      "Grok share",
    MAX_HEADLINE,
  );

  const bullets = dedupePreserve(
    [
      ...headings.filter((h) => h !== headline),
      ...lists,
      ...bolds,
      ...corpus
        .split(/[。！？\n.!?]/)
        .map((s) => stripMarkdownLite(s))
        .filter((s) => s.length >= 10 && s.length <= 90),
    ],
    MAX_BULLETS,
  );

  const safeBullets =
    bullets.length > 0
      ? bullets
      : [truncate(stripMarkdownLite(corpus) || headline, MAX_BULLET_CHARS)];

  const theme = buildThemeFromContent(
    input.title,
    corpus,
    safeBullets.length,
    input.skinId,
  );

  const subtitle =
    headings.find((h) => h !== headline)?.slice(0, 64) ||
    (sourceMessageCount > 1 ? `${sourceMessageCount} turns` : null);

  return {
    theme,
    headline,
    subtitle,
    bullets: safeBullets,
    takeaway: extractTakeaway(corpus),
    sourceMessageCount,
  };
}
