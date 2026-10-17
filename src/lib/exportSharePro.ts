/**
 * EXPORT-SHARE-PRO — pure helpers for share-card / export-image UX.
 *
 * Classifies pipeline + clipboard/save failures into stable kinds, derives
 * honest preview phases (never claim “ready” without a matching blob stamp),
 * and maps skins / layouts to i18n keys. No DOM / Tauri side effects.
 */

import {
  DEFAULT_SHARE_CARD_SKIN,
  isShareCardSkinId,
  type ShareCardSkinId,
} from "@/lib/shareCardSkins";
import type { ShareCardLayoutMode } from "@/lib/shareCardSmart";

/** Stable failure modes for preview + save/copy toasts. */
export type ExportImageErrorKind =
  | "empty"
  | "no_target"
  | "rasterize"
  | "blob_small"
  | "clipboard"
  | "save_failed"
  | "load_failed"
  | "cancelled"
  | "other";

/** Dialog preview lifecycle — UI must not invent “ready” without a blob. */
export type ExportImagePreviewPhase =
  | "closed"
  | "idle"
  | "rendering"
  | "ready"
  | "error";

/** Export mode shown in meta chips (smart poster vs full transcript). */
export type ExportImageMode = "smart" | "full";

/**
 * Stamp attached to a rendered PNG blob so Save/Copy never export a stale
 * skin / mode / session after the dialog options change.
 */
export type ExportImageBlobStamp = {
  sessionId: string;
  skinId: ShareCardSkinId;
  smart: boolean;
  mode: ExportImageMode;
  layout: string | null;
  byteLength: number;
  messageCount: number;
};

/** Options currently selected in the export dialog. */
export type ExportImageOptions = {
  sessionId: string;
  skinId: ShareCardSkinId | string | null | undefined;
  smart: boolean;
};

const LAYOUT_IDS: readonly ShareCardLayoutMode[] = [
  "editorial",
  "stack",
  "compact",
] as const;

function errText(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const code =
      typeof (err as Error & { code?: unknown }).code === "string"
        ? String((err as Error & { code?: string }).code)
        : "";
    return `${code} ${err.message} ${err.name}`.trim();
  }
  if (typeof err === "object") {
    const o = err as { code?: unknown; message?: unknown; reason?: unknown };
    const parts = [o.code, o.message, o.reason]
      .filter((x) => x != null && String(x).trim())
      .map(String);
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * Classify a thrown value / host error into a stable kind.
 * Prefer explicit `code` / known pipeline messages over free-form text.
 */
export function classifyExportImageError(err: unknown): ExportImageErrorKind {
  if (err == null || err === "") return "other";

  const codeRaw =
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string"
      ? String((err as { code: string }).code).trim().toLowerCase()
      : "";

  if (codeRaw === "empty") return "empty";
  if (codeRaw === "cancelled" || codeRaw === "cancel") return "cancelled";
  if (codeRaw === "clipboard") return "clipboard";
  if (codeRaw === "no_target" || codeRaw === "no-target") return "no_target";
  if (codeRaw === "rasterize" || codeRaw === "blob_small") return codeRaw as ExportImageErrorKind;
  if (codeRaw === "save_failed" || codeRaw === "save-failed") return "save_failed";
  if (codeRaw === "load_failed" || codeRaw === "load-failed") return "load_failed";

  const s = errText(err).toLowerCase();
  if (!s.trim()) return "other";

  // User dismissed native save dialog — silent.
  if (
    /\bcancel(led)?\b/.test(s) ||
    s.includes("user cancelled") ||
    s.includes("user canceled")
  ) {
    return "cancelled";
  }

  // Pipeline: `throw new Error("empty")` / code empty / nothing to export.
  if (
    s.trim() === "empty" ||
    s.trim() === "error: empty" ||
    s.includes("nothing to export") ||
    /(^|\s)empty(\s|$)/.test(s) ||
    /\bcode\b.*\bempty\b|\bempty\b.*\bcode\b/.test(s)
  ) {
    return "empty";
  }

  if (s.includes("no target") || s.includes("no_target")) return "no_target";

  if (
    s.includes("clipboard") ||
    s.includes("write image") ||
    s.includes("copy image")
  ) {
    return "clipboard";
  }

  if (
    s.includes("empty/small blob") ||
    s.includes("blob too small") ||
    s.includes("produced empty") ||
    s.includes("small blob")
  ) {
    return "blob_small";
  }

  if (
    s.includes("toblob") ||
    s.includes("rasterize") ||
    s.includes("html-to-image") ||
    s.includes("canvas") && s.includes("fail")
  ) {
    return "rasterize";
  }

  if (
    s.includes("save failed") ||
    s.includes("save_failed") ||
    s.includes("could not save") ||
    s.includes("write failed")
  ) {
    return "save_failed";
  }

  if (
    s.includes("sessionmessages") ||
    s.includes("load messages") ||
    s.includes("failed to load") ||
    s.includes("session not found")
  ) {
    return "load_failed";
  }

  return "other";
}

/** i18n message key for a classified export error (never invent success). */
export function exportImageErrorMessageKey(
  kind: ExportImageErrorKind,
): string {
  switch (kind) {
    case "empty":
      return "session.exportImageEmpty";
    case "clipboard":
      return "session.exportImageClipboardFail";
    case "rasterize":
    case "blob_small":
      return "session.exportImageRasterFail";
    case "save_failed":
      return "session.exportImageSaveFail";
    case "load_failed":
      return "session.exportImageLoadFail";
    case "no_target":
      return "session.exportImageNoTarget";
    case "cancelled":
      return "session.exportImageCancelled";
    case "other":
    default:
      return "session.exportImageFail";
  }
}

/** Cancelled save dialog should not toast as a failure. */
export function exportImageErrorSilent(kind: ExportImageErrorKind): boolean {
  return kind === "cancelled";
}

/**
 * Resolve user-facing error copy from a thrown value.
 * Returns message key + whether to stay silent (cancelled).
 */
export function resolveExportImageError(err: unknown): {
  kind: ExportImageErrorKind;
  messageKey: string;
  silent: boolean;
  /** Short technical detail for debug suffix (empty when not useful). */
  detail: string;
} {
  const kind = classifyExportImageError(err);
  const messageKey = exportImageErrorMessageKey(kind);
  const silent = exportImageErrorSilent(kind);
  const raw = errText(err).trim();
  // Avoid dumping full "Error: empty" when we already have a specific key.
  let detail = "";
  if (
    kind === "other" &&
    raw &&
    !/^error:\s*$/i.test(raw) &&
    raw.length < 200
  ) {
    detail = raw.replace(/^Error:\s*/i, "").trim();
  }
  return { kind, messageKey, silent, detail };
}

/**
 * Honest preview phase from dialog state.
 * `ready` only when a preview URL exists (blob was successfully built).
 * Error wins over rendering when no URL is shown.
 */
export function deriveExportImagePreviewPhase(input: {
  open: boolean;
  busy: boolean;
  hasPreviewUrl: boolean;
  hasError: boolean;
}): ExportImagePreviewPhase {
  if (!input.open) return "closed";
  if (input.hasPreviewUrl) return "ready";
  if (input.hasError) return "error";
  if (input.busy) return "rendering";
  return "idle";
}

/** Normalize skin id for stamps (unknown → default). */
export function normalizeExportImageSkinId(
  id: string | null | undefined,
): ShareCardSkinId {
  return isShareCardSkinId(id) ? id : DEFAULT_SHARE_CARD_SKIN;
}

/**
 * True when the cached blob was built for the exact dialog options.
 * Prevents Save/Copy of a previous skin/mode after a switch.
 */
export function exportImageBlobMatchesOptions(
  stamp: ExportImageBlobStamp | null | undefined,
  options: ExportImageOptions,
): boolean {
  if (!stamp) return false;
  if (!stamp.sessionId || stamp.sessionId !== options.sessionId) return false;
  if (stamp.smart !== !!options.smart) return false;
  const want = normalizeExportImageSkinId(options.skinId);
  if (stamp.skinId !== want) return false;
  if (!Number.isFinite(stamp.byteLength) || stamp.byteLength < 256) return false;
  return true;
}

/**
 * Whether Save PNG / Copy may run.
 * Requires a matching blob stamp; busy alone does not invent readiness.
 */
export function canExportImageActions(input: {
  open: boolean;
  hasMatchingBlob: boolean;
  /** When true and no matching blob, actions stay disabled. */
  hasError?: boolean;
  busy?: boolean;
}): boolean {
  if (!input.open) return false;
  if (!input.hasMatchingBlob) return false;
  return true;
}

/** i18n key for a curated skin label. */
export function shareCardSkinMessageKey(
  id: ShareCardSkinId | string | null | undefined,
): string {
  const skin = normalizeExportImageSkinId(id);
  return `session.exportImageSkin.${skin}`;
}

/** i18n key for structural layout density, or null when unknown / full mode. */
export function shareCardLayoutMessageKey(
  layout: string | null | undefined,
): string | null {
  const l = (layout || "").trim().toLowerCase();
  if ((LAYOUT_IDS as readonly string[]).includes(l)) {
    return `session.exportImageLayout.${l}`;
  }
  return null;
}

/** i18n key for smart vs full mode chip. */
export function exportImageModeMessageKey(mode: ExportImageMode | boolean): string {
  const m: ExportImageMode =
    mode === true || mode === "smart"
      ? "smart"
      : mode === false || mode === "full"
        ? "full"
        : "smart";
  return m === "smart"
    ? "session.exportImageMode.smart"
    : "session.exportImageMode.full";
}

export type ExportImageMetaParts = {
  modeKey: string;
  skinKey: string;
  layoutKey: string | null;
  mode: ExportImageMode;
  skinId: ShareCardSkinId;
  layout: string | null;
  byteLength: number | null;
  messageCount: number | null;
};

/**
 * Build meta chip model for the preview footer.
 * Prefer stamp (what was actually rendered); fall back to dialog options.
 */
export function buildExportImageMetaParts(input: {
  stamp?: ExportImageBlobStamp | null;
  skinId?: string | null;
  smart?: boolean;
}): ExportImageMetaParts {
  const stamp = input.stamp ?? null;
  const skinId = stamp
    ? stamp.skinId
    : normalizeExportImageSkinId(input.skinId);
  const smart = stamp ? stamp.smart : input.smart !== false;
  const mode: ExportImageMode = stamp?.mode ?? (smart ? "smart" : "full");
  const layout = stamp?.layout ?? null;
  return {
    modeKey: exportImageModeMessageKey(mode),
    skinKey: shareCardSkinMessageKey(skinId),
    layoutKey: mode === "smart" ? shareCardLayoutMessageKey(layout) : null,
    mode,
    skinId,
    layout: mode === "smart" ? layout : null,
    byteLength: stamp?.byteLength ?? null,
    messageCount: stamp?.messageCount ?? null,
  };
}

/**
 * Build a stamp from a successful pipeline result + dialog options.
 * Pure — callers attach it next to the blob ref.
 */
export function stampFromPipelineResult(
  options: ExportImageOptions,
  result: {
    skinId?: string | null;
    mode?: string | null;
    layout?: string | null;
    byteLength?: number | null;
    messageCount?: number | null;
  },
): ExportImageBlobStamp {
  const smart = !!options.smart;
  const mode: ExportImageMode =
    result.mode === "full" || result.mode === "smart"
      ? result.mode
      : smart
        ? "smart"
        : "full";
  return {
    sessionId: options.sessionId,
    skinId: normalizeExportImageSkinId(result.skinId ?? options.skinId),
    smart,
    mode,
    layout:
      mode === "smart" && result.layout
        ? String(result.layout)
        : null,
    byteLength: Math.max(0, Math.floor(Number(result.byteLength) || 0)),
    messageCount: Math.max(0, Math.floor(Number(result.messageCount) || 0)),
  };
}

/** Human-readable byte size for meta (honest approximate). */
export function formatExportImageBytes(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  if (n < 1024) return `${Math.floor(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10_240 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
