/**
 * Persist installed plugins list so Settings → Extensions opens fast.
 * Memory + localStorage; mutations should invalidate or patch.
 */

import type { PluginDto } from "./api/extensions";

export const PLUGINS_LIST_TTL_MS = 30 * 60 * 1000; // 30 minutes
const STORAGE_KEY = "grok-app.pluginsList.v1";

export type PluginsListSnapshot = {
  fetchedAt: number;
  plugins: PluginDto[];
  error: string | null;
};

export type PluginsListLoadResult = PluginsListSnapshot & {
  fromCache: boolean;
};

export type PluginsListFetcher = () => Promise<{
  plugins?: PluginDto[] | null;
  error?: string | null;
}>;

let memory: PluginsListSnapshot | null = null;
let inflight: Promise<PluginsListLoadResult> | null = null;

function readStorage(): PluginsListSnapshot | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PluginsListSnapshot;
    if (!parsed || !Array.isArray(parsed.plugins)) return null;
    if (typeof parsed.fetchedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStorage(snap: PluginsListSnapshot): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch {
    /* quota / private mode */
  }
}

export function getPluginsListCache(): PluginsListSnapshot | null {
  if (memory) return memory;
  const stored = readStorage();
  if (stored) memory = stored;
  return memory;
}

export function isPluginsListFresh(
  now = Date.now(),
  ttlMs = PLUGINS_LIST_TTL_MS,
): boolean {
  const snap = getPluginsListCache();
  if (!snap) return false;
  return now - snap.fetchedAt < ttlMs;
}

export function invalidatePluginsListCache(): void {
  memory = null;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

export async function loadPluginsListCached(
  fetch: PluginsListFetcher,
  opts?: { force?: boolean; ttlMs?: number },
): Promise<PluginsListLoadResult> {
  const force = !!opts?.force;
  const ttlMs = opts?.ttlMs ?? PLUGINS_LIST_TTL_MS;
  const now = Date.now();
  const cached = getPluginsListCache();

  if (!force && cached && now - cached.fetchedAt < ttlMs) {
    return { ...cached, fromCache: true };
  }

  // Stale-while-revalidate: return stale cache immediately is not done here
  // (callers may prefer wait). We still share inflight.
  if (inflight && !force) return inflight;

  const run = (async (): Promise<PluginsListLoadResult> => {
    try {
      const res = await fetch();
      const snap: PluginsListSnapshot = {
        fetchedAt: Date.now(),
        plugins: Array.isArray(res.plugins) ? res.plugins : [],
        error: res.error?.trim() || null,
      };
      memory = snap;
      writeStorage(snap);
      return { ...snap, fromCache: false };
    } finally {
      inflight = null;
    }
  })();

  inflight = run;
  return run;
}

/** After enable/disable, patch cache without full CLI list when possible. */
export function patchPluginsListEnabled(name: string, enabled: boolean): void {
  const snap = getPluginsListCache();
  if (!snap) return;
  const n = name.trim().toLowerCase();
  const plugins = snap.plugins.map((p) =>
    p.name.trim().toLowerCase() === n ? { ...p, enabled } : p,
  );
  const next = { ...snap, plugins, fetchedAt: Date.now() };
  memory = next;
  writeStorage(next);
}

export function __resetPluginsListCacheForTests(): void {
  memory = null;
  inflight = null;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}
