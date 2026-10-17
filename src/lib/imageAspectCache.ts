/**
 * Persist chat image card aspect ratios so virtual-list remounts and next
 * session paint the correct width immediately (fixed 150px height + ratio
 * width). In-memory Map for the session; localStorage for cross-restart.
 */

import { isFusedQueryKeyPath } from "@/lib/pathNormalize";

export const IMAGE_ASPECT_CACHE_STORAGE_KEY = "grok.imageAspectCache.v1";
/** Cap disk entries (LRU by last-write). */
export const IMAGE_ASPECT_CACHE_MAX = 500;

export type ImageAspectStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type DiskEntry = { ar: number; ts: number };
type DiskBlob = { v: 1; e: Record<string, DiskEntry> };

const memory = new Map<string, DiskEntry>();
let hydrated = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function defaultStorage(): ImageAspectStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** True when token looks like a local absolute filesystem path. */
export function isLocalFsCacheKey(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (/^https?:\/\//i.test(t)) return false;
  if (t.startsWith("data:") || t.startsWith("blob:")) return false;
  if (t.startsWith("asset:") || t.includes("asset.localhost")) return false;
  if (t.startsWith("media:") || t.includes("media.localhost")) return false;
  if (isFusedQueryKeyPath(t)) return false;
  return t.startsWith("/") || /^[A-Za-z]:[\\/]/.test(t);
}

/**
 * Stable cache key: prefer absolute path; peel loopback media query `p=`;
 * strip volatile tokens from media URLs so remounts hit the same entry.
 */
export function imageAspectCacheKey(src: string, path?: string): string {
  const p = (path || "").trim();
  if (p && isLocalFsCacheKey(p)) return normalizeFsKey(p);

  const s = (src || "").trim();
  if (!s) return p || "";

  if (isLocalFsCacheKey(s)) return normalizeFsKey(s);

  // Loopback media HTTP: …/v1/media?t=TOKEN&p=encodeURIComponent(abs)
  // `URLSearchParams.get` already decodes once — do NOT decode again: paths
  // that legitimately contain `%` (agent-home `sessions/%2FUsers%2F…`) would
  // otherwise be corrupted into double-slash keys that never match.
  try {
    if (/^https?:\/\/127\.0\.0\.1(?::\d+)?\//i.test(s) || /\/v1\/media\?/i.test(s)) {
      const u = new URL(s);
      const file = u.searchParams.get("p");
      if (file && isLocalFsCacheKey(file)) {
        return normalizeFsKey(file);
      }
    }
  } catch {
    /* not a URL */
  }

  // media://localhost/<percent-encoded-path>
  if (s.startsWith("media:")) {
    try {
      const bare = s.replace(/^media:\/\/[^/]*/i, "");
      const decoded = decodeURIComponent(bare.replace(/^\//, ""));
      // Windows media may use media://localhost/C:/...
      const asPath = decoded.startsWith("/") || /^[A-Za-z]:[\\/]/.test(decoded)
        ? decoded
        : `/${decoded}`;
      if (isLocalFsCacheKey(asPath) || isLocalFsCacheKey(decoded)) {
        return normalizeFsKey(isLocalFsCacheKey(asPath) ? asPath : decoded);
      }
    } catch {
      /* fall through */
    }
  }

  // Remote https: strip hash only (query may be meaningful)
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      u.hash = "";
      return u.toString();
    }
  } catch {
    /* ignore */
  }

  return s;
}

function normalizeFsKey(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Basename alias so `` `puppy-soda-pixel.png` `` citations hit the same
 * occupancy box on the next session open, before IPC resolves the abs path.
 */
export function imageAspectBasenameKey(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop()?.trim() || "";
  if (!base || base.includes("..")) return "";
  if (!/\.[A-Za-z0-9]{2,8}$/.test(base)) return "";
  return `bn:${base}`;
}

function hydrate(storage: ImageAspectStorage = defaultStorage()): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = storage.getItem(IMAGE_ASPECT_CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as DiskBlob;
    if (!parsed || parsed.v !== 1 || !parsed.e || typeof parsed.e !== "object") {
      return;
    }
    for (const [k, ent] of Object.entries(parsed.e)) {
      if (!k || !ent || typeof ent.ar !== "number") continue;
      if (!(ent.ar > 0) || !Number.isFinite(ent.ar)) continue;
      memory.set(k, {
        ar: ent.ar,
        ts: typeof ent.ts === "number" ? ent.ts : 0,
      });
    }
  } catch {
    /* corrupt / private mode */
  }
}

function schedulePersist(storage: ImageAspectStorage = defaultStorage()): void {
  if (persistTimer != null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushImageAspectCache(storage);
  }, 400);
}

/** Write memory → localStorage (LRU trim). Exported for tests. */
export function flushImageAspectCache(
  storage: ImageAspectStorage = defaultStorage(),
): void {
  try {
    const rows = [...memory.entries()].sort(
      (a, b) => (b[1].ts || 0) - (a[1].ts || 0),
    );
    const e: Record<string, DiskEntry> = {};
    for (const [k, ent] of rows.slice(0, IMAGE_ASPECT_CACHE_MAX)) {
      e[k] = { ar: ent.ar, ts: ent.ts };
    }
    // Drop excess from memory so process does not grow forever.
    if (rows.length > IMAGE_ASPECT_CACHE_MAX) {
      for (const [k] of rows.slice(IMAGE_ASPECT_CACHE_MAX)) {
        memory.delete(k);
      }
    }
    const blob: DiskBlob = { v: 1, e };
    storage.setItem(IMAGE_ASPECT_CACHE_STORAGE_KEY, JSON.stringify(blob));
  } catch {
    /* quota / private mode */
  }
}

/** Read cached aspect ratio (width/height), or null. */
export function getImageAspect(
  src: string,
  path?: string,
  storage: ImageAspectStorage = defaultStorage(),
): number | null {
  hydrate(storage);
  const primary = imageAspectCacheKey(src, path);
  if (primary) {
    const hit = memory.get(primary);
    if (hit && hit.ar > 0) return hit.ar;
  }
  // Fallback: raw path / src keys written by older sessions, then basename
  // so tick citations reserve the same card box before abs-path resolve.
  for (const k of [path, src]) {
    if (!k) continue;
    const hit =
      memory.get(k) ??
      memory.get(normalizeFsKey(k)) ??
      memory.get(imageAspectBasenameKey(k));
    if (hit && hit.ar > 0) return hit.ar;
  }
  return null;
}

/**
 * Store natural aspect ratio under a stable key (+ aliases so path/src both hit).
 */
export function setImageAspect(
  src: string,
  path: string | undefined,
  ar: number,
  extraKeys: string[] = [],
  storage: ImageAspectStorage = defaultStorage(),
): void {
  if (!(ar > 0) || !Number.isFinite(ar)) return;
  hydrate(storage);
  const ts = Date.now();
  const ent: DiskEntry = { ar, ts };
  const keys = new Set<string>();
  const primary = imageAspectCacheKey(src, path);
  if (primary) keys.add(primary);
  if (path && isLocalFsCacheKey(path)) keys.add(normalizeFsKey(path));
  if (src && isLocalFsCacheKey(src)) keys.add(normalizeFsKey(src));
  for (const k of extraKeys) {
    if (!k) continue;
    if (isLocalFsCacheKey(k)) keys.add(normalizeFsKey(k));
    else keys.add(imageAspectCacheKey(k));
    const bn = imageAspectBasenameKey(k);
    if (bn) keys.add(bn);
  }
  for (const raw of [path, src]) {
    const bn = raw ? imageAspectBasenameKey(raw) : "";
    if (bn) keys.add(bn);
  }
  if (keys.size === 0) return;
  for (const k of keys) {
    memory.set(k, ent);
  }
  schedulePersist(storage);
}

/** Test helper: clear memory + mark unhydrated. */
export function resetImageAspectCacheForTests(): void {
  memory.clear();
  hydrated = false;
  if (persistTimer != null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}
