/**
 * Curated share-card visual skins (export-as-image).
 *
 * Intentionally fixed palettes — not content-hash HSL rainbows or purple orbs.
 * Smart poster + full transcript share the same tokens so both modes feel like
 * one designed system. User picks a skin in the export dialog.
 */

export type ShareCardSkinId =
  | "noir"
  | "paper"
  | "terminal"
  | "stone"
  | "rose";

export const SHARE_CARD_SKIN_IDS: readonly ShareCardSkinId[] = [
  "noir",
  "paper",
  "terminal",
  "stone",
  "rose",
] as const;

export const DEFAULT_SHARE_CARD_SKIN: ShareCardSkinId = "noir";

export type ShareCardSkin = {
  id: ShareCardSkinId;
  /** Short badge label drawn on the card (uppercase, Latin). */
  badge: string;
  /** Subtle vertical gradient ends. */
  bg0: string;
  bg1: string;
  /** Thread / message surfaces. */
  surface: string;
  surfaceUser: string;
  surfaceTakeaway: string;
  border: string;
  borderStrong: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  accentSoft: string;
  bullet: string;
  logo0: string;
  logo1: string;
  footerBg: string;
  radius: number;
  radiusSm: number;
  /** Role / meta typography: "sans" | "mono". */
  typeFace: "sans" | "mono";
  /** Smart poster decorative treatment — never purple glow orbs. */
  decor: "none" | "grain" | "corner";
  isLight: boolean;
};

const SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const MONO =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

type FacePick = { typeFace: "sans" | "mono" };

export function skinBodyFont(_skin?: FacePick): string {
  // Body stays sans even for terminal so long CJK/paragraphs stay readable.
  return SANS;
}

export function skinMetaFont(skin: FacePick): string {
  return skin.typeFace === "mono" ? MONO : SANS;
}

const SKINS: Record<ShareCardSkinId, ShareCardSkin> = {
  /** Dark editorial — charcoal + restrained gold. No neon. */
  noir: {
    id: "noir",
    badge: "NOIR",
    bg0: "#12141a",
    bg1: "#0c0e12",
    surface: "#1a1d26",
    surfaceUser: "#222733",
    surfaceTakeaway: "rgba(196, 165, 116, 0.10)",
    border: "rgba(255,255,255,0.07)",
    borderStrong: "rgba(255,255,255,0.12)",
    text: "#f2f1ed",
    muted: "#9a9890",
    faint: "#6b6962",
    accent: "#c4a574",
    accentSoft: "rgba(196, 165, 116, 0.14)",
    bullet: "#c4a574",
    logo0: "#c4a574",
    logo1: "#8a7348",
    footerBg: "rgba(0,0,0,0.22)",
    radius: 14,
    radiusSm: 10,
    typeFace: "sans",
    decor: "corner",
    isLight: false,
  },
  /** Cold paper + ink blue — not warm beige/brass AI craft default. */
  paper: {
    id: "paper",
    badge: "PAPER",
    bg0: "#f3f4f6",
    bg1: "#e8eaef",
    surface: "#ffffff",
    surfaceUser: "#eef1f6",
    surfaceTakeaway: "rgba(30, 58, 95, 0.06)",
    border: "rgba(15, 23, 42, 0.08)",
    borderStrong: "rgba(15, 23, 42, 0.14)",
    text: "#14171c",
    muted: "#5c6470",
    faint: "#8b929c",
    accent: "#1e3a5f",
    accentSoft: "rgba(30, 58, 95, 0.10)",
    bullet: "#1e3a5f",
    logo0: "#1e3a5f",
    logo1: "#0f2440",
    footerBg: "rgba(15, 23, 42, 0.03)",
    radius: 12,
    radiusSm: 8,
    typeFace: "sans",
    decor: "none",
    isLight: true,
  },
  /** Terminal / dark-tech — single cyan accent, sharp edges. */
  terminal: {
    id: "terminal",
    badge: "TERM",
    bg0: "#0b0f14",
    bg1: "#070a0e",
    surface: "#121820",
    surfaceUser: "#16202b",
    surfaceTakeaway: "rgba(61, 214, 198, 0.08)",
    border: "rgba(61, 214, 198, 0.12)",
    borderStrong: "rgba(61, 214, 198, 0.22)",
    text: "#d7e0ea",
    muted: "#7d8b99",
    faint: "#556270",
    accent: "#3dd6c6",
    accentSoft: "rgba(61, 214, 198, 0.12)",
    bullet: "#3dd6c6",
    logo0: "#3dd6c6",
    logo1: "#1a8f84",
    footerBg: "rgba(0,0,0,0.28)",
    radius: 6,
    radiusSm: 4,
    typeFace: "mono",
    decor: "none",
    isLight: false,
  },
  /** Quiet monochrome zinc — gallery calm. */
  stone: {
    id: "stone",
    badge: "STONE",
    bg0: "#18181b",
    bg1: "#111113",
    surface: "#222226",
    surfaceUser: "#2a2a2f",
    surfaceTakeaway: "rgba(250, 250, 250, 0.05)",
    border: "rgba(255,255,255,0.08)",
    borderStrong: "rgba(255,255,255,0.14)",
    text: "#fafafa",
    muted: "#a1a1aa",
    faint: "#71717a",
    accent: "#e4e4e7",
    accentSoft: "rgba(228, 228, 231, 0.08)",
    bullet: "#d4d4d8",
    logo0: "#3f3f46",
    logo1: "#27272a",
    footerBg: "rgba(0,0,0,0.2)",
    radius: 10,
    radiusSm: 6,
    typeFace: "sans",
    decor: "none",
    isLight: false,
  },
  /** Muted rose on deep plum-black — not AI purple glow. */
  rose: {
    id: "rose",
    badge: "ROSE",
    bg0: "#151218",
    bg1: "#100e13",
    surface: "#1f1a22",
    surfaceUser: "#2a222c",
    surfaceTakeaway: "rgba(201, 137, 154, 0.10)",
    border: "rgba(201, 137, 154, 0.14)",
    borderStrong: "rgba(201, 137, 154, 0.24)",
    text: "#f6ecef",
    muted: "#b0a0a6",
    faint: "#7a6c72",
    accent: "#c9899a",
    accentSoft: "rgba(201, 137, 154, 0.14)",
    bullet: "#c9899a",
    logo0: "#c9899a",
    logo1: "#8f5a6a",
    footerBg: "rgba(0,0,0,0.25)",
    radius: 16,
    radiusSm: 12,
    typeFace: "sans",
    decor: "corner",
    isLight: false,
  },
};

export function isShareCardSkinId(v: unknown): v is ShareCardSkinId {
  return (
    typeof v === "string" &&
    (SHARE_CARD_SKIN_IDS as readonly string[]).includes(v)
  );
}

export function getShareCardSkin(
  id?: string | null,
): ShareCardSkin {
  if (isShareCardSkinId(id)) return SKINS[id];
  return SKINS[DEFAULT_SHARE_CARD_SKIN];
}

const PREF_KEY = "grok-app.exportImage.skin";

/** Last-used skin for the export dialog (best-effort localStorage). */
export function loadExportImageSkinPref(): ShareCardSkinId {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_SHARE_CARD_SKIN;
    const v = localStorage.getItem(PREF_KEY);
    return isShareCardSkinId(v) ? v : DEFAULT_SHARE_CARD_SKIN;
  } catch {
    return DEFAULT_SHARE_CARD_SKIN;
  }
}

export function saveExportImageSkinPref(id: ShareCardSkinId): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PREF_KEY, id);
  } catch {
    /* ignore */
  }
}
