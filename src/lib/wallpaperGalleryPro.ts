/**
 * WALLPAPER-GALLERY-PRO — pure helpers for wallpaper source gallery:
 * empty honesty, kind filter chips, client-side text filter, classified
 * load errors. Never invents CDN images — only real Host/search items.
 *
 * No DOM / Tauri side effects.
 */

import type { WallpaperGalleryItem } from "@/lib/wallpaperSource";

// ── Error classification ─────────────────────────────────────────────────────

/**
 * Stable gallery load / search failure kinds for soft-fail chips.
 * Broader than raw host codes — maps network · host · untrusted · empty · other.
 */
export type WallpaperGalleryErrorKind =
  | "network"
  | "host"
  | "untrusted"
  | "empty"
  | "other";

/** All error kinds (for label maps / tests). */
export const WALLPAPER_GALLERY_ERROR_KINDS: readonly WallpaperGalleryErrorKind[] =
  ["network", "host", "untrusted", "empty", "other"] as const;

// ── Kind filter chips ────────────────────────────────────────────────────────

/**
 * First-class kind chip buckets for the gallery.
 * `video` covers video/mp4-like kinds; everything else buckets as `image`.
 */
export type WallpaperGalleryKindFilter = "all" | "image" | "video";

/** Ordered chip list (All · Image · Video). */
export const WALLPAPER_GALLERY_KIND_FILTERS: readonly WallpaperGalleryKindFilter[] =
  ["all", "image", "video"] as const;

/** Per-chip counts; `all` is total length. */
export type WallpaperGalleryKindCounts = Record<
  WallpaperGalleryKindFilter,
  number
>;

/** Minimal item shape for filter / count helpers. */
export type WallpaperGalleryItemLike = Pick<
  WallpaperGalleryItem,
  "kind" | "source" | "username" | "textPreview" | "prompt" | "fullUrl" | "thumbUrl"
> & {
  id?: string;
  localPath?: string | null;
  postUrl?: string | null;
};

// ── Empty honesty ────────────────────────────────────────────────────────────

/** Contextual empty surfaces for the gallery body. */
export type WallpaperGalleryEmptyKind =
  | "loading"
  | "idle"
  | "empty"
  | "filter_empty"
  | "error";

export type WallpaperGalleryEmptyPresentation = {
  kind: WallpaperGalleryEmptyKind;
  /** Primary title i18n key under settings.wallpaperSource.*. */
  titleKey: string;
  /** Optional hint i18n key. */
  hintKey: string | null;
  /** Offer clear-filters CTA when client filters hide all items. */
  showClearFilters: boolean;
  /**
   * Soft-fail: capability / empty / filter gap — warn, do not invent results.
   * Hard error for network/other when a real failure occurred.
   */
  softFail: boolean;
  /** Classified error when kind === "error" or empty-from-error. */
  errorKind?: WallpaperGalleryErrorKind | null;
};

export type WallpaperGalleryEmptyInput = {
  /** Search / generate / download in flight. */
  loading: boolean;
  /**
   * Client-side gallery filter query (not the X search / Imagine prompt).
   * Non-empty with zero visible rows → filter_empty when items exist.
   */
  query: string;
  /** Visible item count after kind + text filters. */
  itemCount: number;
  /**
   * Classified load / search failure (string code, Error, or host payload).
   * When set with zero items, surfaces error (or empty) honesty.
   */
  error?: unknown | null;
  /**
   * Pre-filter total (optional). When known and > 0 while itemCount is 0 and
   * filters are active → filter_empty. When 0 after a completed search → empty.
   */
  totalCount?: number | null;
  /** Kind chip filter (`all` = no kind narrowing). */
  kindFilter?: WallpaperGalleryKindFilter | null;
  /**
   * True after at least one search/generate completed this open.
   * Distinguishes idle (never searched) from empty (searched, zero results).
   */
  hasSearched?: boolean;
};

// ── Error text helpers ───────────────────────────────────────────────────────

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
    const o = err as {
      code?: unknown;
      message?: unknown;
      reason?: unknown;
      error?: unknown;
      errorCode?: unknown;
    };
    const parts = [o.code, o.errorCode, o.message, o.reason, o.error]
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

function errCode(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const o = err as { code?: unknown; errorCode?: unknown; reason?: unknown };
    for (const key of ["code", "errorCode", "reason"] as const) {
      const c = o[key];
      if (typeof c === "string" && c.trim()) {
        return c.trim().toLowerCase().replace(/-/g, "_");
      }
    }
  }
  if (typeof err === "string") {
    const t = err.trim().toLowerCase().replace(/-/g, "_");
    // bare codes
    if (/^[a-z_]+$/.test(t)) return t;
  }
  return "";
}

/**
 * Classify a thrown value / host / wallpaper source code into a stable gallery
 * error kind for soft-fail chips. Prefer explicit codes over free-form text.
 *
 * Mapping notes:
 * - network — search_failed, timeout, download, fetch/connect failures
 * - host — CLI missing, desktop-only, need Tauri
 * - untrusted — url_blocked, path not allowed, forbidden hosts
 * - empty — no images / empty search
 * - other — auth, imagine fail, generic
 *
 * Never invents success or CDN gallery rows.
 */
export function classifyWallpaperGalleryError(
  err: unknown,
): WallpaperGalleryErrorKind {
  if (err == null || err === "") return "other";

  const code = errCode(err);
  if (
    code === "network" ||
    code === "offline" ||
    code === "timeout" ||
    code === "timed_out" ||
    code === "search_failed" ||
    code === "download_failed" ||
    code === "fetch_failed" ||
    code === "read_failed"
  ) {
    return "network";
  }
  if (
    code === "host" ||
    code === "host_only" ||
    code === "host_error" ||
    code === "cli_missing" ||
    code === "need_tauri" ||
    code === "desktop_only"
  ) {
    return "host";
  }
  if (
    code === "untrusted" ||
    code === "url_blocked" ||
    code === "path_not_allowed" ||
    code === "path_denied" ||
    code === "forbidden"
  ) {
    return "untrusted";
  }
  if (code === "empty" || code === "no_results" || code === "no_images") {
    return "empty";
  }
  if (
    code === "auth_required" ||
    code === "imagine_failed" ||
    code === "generic" ||
    code === "other"
  ) {
    return "other";
  }

  const s = errText(err).toLowerCase();
  if (!s.trim()) return "other";

  // empty first (soft “no results”)
  if (
    /\bempty\b/.test(s) ||
    s.includes("no images") ||
    s.includes("no results") ||
    s.includes("no wallpapers") ||
    s.includes("nothing found")
  ) {
    return "empty";
  }

  // untrusted / blocked hosts (before generic network)
  if (
    s.includes("url_blocked") ||
    s.includes("url blocked") ||
    s.includes("not allowed") ||
    s.includes("path_not_allowed") ||
    s.includes("untrusted") ||
    s.includes("allowlist") ||
    s.includes("forbidden host") ||
    s.includes("blocked host")
  ) {
    return "untrusted";
  }

  // host / CLI / desktop
  if (
    s.includes("cli_missing") ||
    s.includes("cli not found") ||
    s.includes("cli missing") ||
    s.includes("need tauri") ||
    s.includes("need_tauri") ||
    s.includes("host only") ||
    s.includes("host_only") ||
    s.includes("desktop only") ||
    s.includes("desktop_only") ||
    s.includes("requires the desktop") ||
    s.includes("not available in browser")
  ) {
    return "host";
  }

  // network
  if (
    s.includes("search_failed") ||
    s.includes("download_failed") ||
    s.includes("read_failed") ||
    s.includes("timeout") ||
    s.includes("timed out") ||
    s.includes("network") ||
    s.includes("offline") ||
    s.includes("econnrefused") ||
    s.includes("enotfound") ||
    s.includes("fetch failed") ||
    s.includes("failed to fetch") ||
    /\b(502|503|504)\b/.test(s)
  ) {
    return "network";
  }

  return "other";
}

/** i18n title key for a classified gallery error kind. */
export function wallpaperGalleryErrorTitleKey(
  kind: WallpaperGalleryErrorKind,
): string {
  switch (kind) {
    case "network":
      return "settings.wallpaperSource.errKind.network";
    case "host":
      return "settings.wallpaperSource.errKind.host";
    case "untrusted":
      return "settings.wallpaperSource.errKind.untrusted";
    case "empty":
      return "settings.wallpaperSource.errKind.empty";
    case "other":
    default:
      return "settings.wallpaperSource.errKind.other";
  }
}

/** i18n hint key for a classified gallery error kind. */
export function wallpaperGalleryErrorHintKey(
  kind: WallpaperGalleryErrorKind,
): string {
  switch (kind) {
    case "network":
      return "settings.wallpaperSource.errKind.hint.network";
    case "host":
      return "settings.wallpaperSource.errKind.hint.host";
    case "untrusted":
      return "settings.wallpaperSource.errKind.hint.untrusted";
    case "empty":
      return "settings.wallpaperSource.errKind.hint.empty";
    case "other":
    default:
      return "settings.wallpaperSource.errKind.hint.other";
  }
}

/**
 * Soft-fail when the failure is a capability/empty gap rather than a hard
 * crash: host gaps, empty results, and untrusted URL blocks stay warn-level.
 * Network / other stay as actionable errors (still non-fatal to the app).
 */
export function isWallpaperGallerySoftFail(
  kind: WallpaperGalleryErrorKind,
): boolean {
  return kind === "host" || kind === "empty" || kind === "untrusted";
}

// ── Kind helpers ─────────────────────────────────────────────────────────────

/** Normalize media kind into a chip bucket (`image` | `video`). */
export function galleryKindBucket(
  kind: string | null | undefined,
): Exclude<WallpaperGalleryKindFilter, "all"> {
  const k = String(kind ?? "")
    .toLowerCase()
    .trim();
  if (
    k === "video" ||
    k.startsWith("video/") ||
    k.includes("mp4") ||
    k.includes("webm") ||
    k.includes("mov")
  ) {
    return "video";
  }
  return "image";
}

/** Whether an item matches the kind chip (`all` always matches). */
export function itemMatchesKindFilter(
  item: Pick<WallpaperGalleryItemLike, "kind"> | null | undefined,
  filter: WallpaperGalleryKindFilter | null | undefined,
): boolean {
  if (!item) return false;
  const f = filter ?? "all";
  if (f === "all") return true;
  return galleryKindBucket(item.kind) === f;
}

/** Count items per kind chip bucket. Never invents rows. */
export function countGalleryByKind(
  items: readonly Pick<WallpaperGalleryItemLike, "kind">[],
): WallpaperGalleryKindCounts {
  const counts: WallpaperGalleryKindCounts = {
    all: items.length,
    image: 0,
    video: 0,
  };
  for (const it of items) {
    counts[galleryKindBucket(it.kind)] += 1;
  }
  return counts;
}

/** i18n label key for a kind chip. */
export function wallpaperGalleryKindFilterLabelKey(
  filter: WallpaperGalleryKindFilter,
): string {
  switch (filter) {
    case "image":
      return "settings.wallpaperSource.kind.image";
    case "video":
      return "settings.wallpaperSource.kind.video";
    case "all":
    default:
      return "settings.wallpaperSource.kind.all";
  }
}

// ── Filter ───────────────────────────────────────────────────────────────────

export type WallpaperGalleryListFilter = {
  query?: string | null;
  kind?: WallpaperGalleryKindFilter | null;
};

/**
 * True when kind chip or free-text narrows the list
 * (used for filter-empty honesty and clear-filters CTA).
 */
export function wallpaperGalleryHasActiveFilters(
  filter: WallpaperGalleryListFilter | null | undefined,
): boolean {
  if (!filter) return false;
  const kind = filter.kind ?? "all";
  const q = (filter.query ?? "").trim();
  return kind !== "all" || q.length > 0;
}

/**
 * Filter gallery items by free-text query and optional kind chip (AND).
 *
 * Text matches username, textPreview, prompt, urls, source, kind, id.
 * Does **not** invent CDN rows — only filters the provided list.
 *
 * Overload: `filterGalleryItems(items, queryString)` for query-only.
 */
export function filterGalleryItems<T extends WallpaperGalleryItemLike>(
  items: readonly T[],
  queryOrFilter: string | WallpaperGalleryListFilter | null | undefined = {},
): T[] {
  const opts: WallpaperGalleryListFilter =
    typeof queryOrFilter === "string"
      ? { query: queryOrFilter }
      : queryOrFilter ?? {};

  const kind = opts.kind ?? "all";
  let out: T[] = items as T[];

  if (kind !== "all") {
    out = out.filter((it) => itemMatchesKindFilter(it, kind));
  }

  const q = (opts.query ?? "").trim().toLowerCase();
  if (!q) return out;

  return out.filter((it) => {
    const hay = [
      it.id ?? "",
      it.kind ?? "",
      it.source ?? "",
      it.username ?? "",
      it.textPreview ?? "",
      it.prompt ?? "",
      it.fullUrl ?? "",
      it.thumbUrl ?? "",
      it.localPath ?? "",
      it.postUrl ?? "",
      galleryKindBucket(it.kind),
    ]
      .join("\n")
      .toLowerCase();
    return hay.includes(q);
  });
}

// ── Empty state resolve ──────────────────────────────────────────────────────

/**
 * Resolve which empty surface to show for the wallpaper gallery body.
 * Returns `null` when filtered item rows should render.
 *
 * Priority:
 * 1. itemCount > 0 → null (render gallery — never invent extras)
 * 2. loading → loading
 * 3. error → empty (soft) or error (classified)
 * 4. filters active + (total unknown or total > 0) → filter_empty
 * 5. hasSearched or totalCount === 0 → empty
 * 6. idle (never searched)
 */
export function resolveWallpaperGalleryEmptyState(
  input: WallpaperGalleryEmptyInput,
): WallpaperGalleryEmptyPresentation | null {
  const itemCount = Math.max(0, Math.floor(Number(input.itemCount) || 0));
  if (itemCount > 0) return null;

  if (input.loading) {
    return {
      kind: "loading",
      titleKey: "settings.wallpaperSource.empty.loading",
      hintKey: "settings.wallpaperSource.empty.loadingHint",
      showClearFilters: false,
      softFail: true,
    };
  }

  if (input.error != null && String(errText(input.error)).trim()) {
    const errorKind = classifyWallpaperGalleryError(input.error);
    if (errorKind === "empty") {
      return {
        kind: "empty",
        titleKey: "settings.wallpaperSource.empty.noResults",
        hintKey: "settings.wallpaperSource.empty.noResultsHint",
        showClearFilters: false,
        softFail: true,
        errorKind,
      };
    }
    return {
      kind: "error",
      titleKey: wallpaperGalleryErrorTitleKey(errorKind),
      hintKey: wallpaperGalleryErrorHintKey(errorKind),
      showClearFilters: false,
      softFail: isWallpaperGallerySoftFail(errorKind),
      errorKind,
    };
  }

  const q = (input.query ?? "").trim();
  const kind = input.kindFilter ?? "all";
  const hasFilters = kind !== "all" || q.length > 0;
  const totalRaw = input.totalCount;
  const totalKnown = totalRaw != null && Number.isFinite(Number(totalRaw));
  const total = totalKnown ? Math.max(0, Math.floor(Number(totalRaw) || 0)) : null;

  if (hasFilters && (total == null || total > 0)) {
    return {
      kind: "filter_empty",
      titleKey: "settings.wallpaperSource.empty.filterEmpty",
      hintKey: "settings.wallpaperSource.empty.filterEmptyHint",
      showClearFilters: true,
      softFail: true,
    };
  }

  if (input.hasSearched || total === 0) {
    return {
      kind: "empty",
      titleKey: "settings.wallpaperSource.empty.noResults",
      hintKey: "settings.wallpaperSource.empty.noResultsHint",
      showClearFilters: false,
      softFail: true,
    };
  }

  return {
    kind: "idle",
    titleKey: "settings.wallpaperSource.emptyGallery",
    hintKey: "settings.wallpaperSource.empty.idleHint",
    showClearFilters: false,
    softFail: true,
  };
}
