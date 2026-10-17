import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  __resetPluginsListCacheForTests,
  invalidatePluginsListCache,
  loadPluginsListCached,
  patchPluginsListEnabled,
} from "./pluginsListCache";

describe("pluginsListCache", () => {
  beforeEach(() => {
    __resetPluginsListCacheForTests();
  });

  it("returns cache on second load without re-fetch", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({
        plugins: [{ name: "codex", status: "installed", enabled: true }],
        error: null,
      });
    const a = await loadPluginsListCached(fetch);
    expect(a.fromCache).toBe(false);
    expect(a.plugins).toHaveLength(1);
    const b = await loadPluginsListCached(fetch);
    expect(b.fromCache).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("force reloads and invalidate clears", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        plugins: [{ name: "a", status: "installed", enabled: true }],
      })
      .mockResolvedValueOnce({
        plugins: [
          { name: "a", status: "installed", enabled: true },
          { name: "b", status: "installed", enabled: false },
        ],
      });
    await loadPluginsListCached(fetch);
    invalidatePluginsListCache();
    const next = await loadPluginsListCached(fetch, { force: true });
    expect(next.plugins).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("patchPluginsListEnabled updates cache", async () => {
    const fetch = vi.fn().mockResolvedValue({
      plugins: [{ name: "codex", status: "installed", enabled: true }],
    });
    await loadPluginsListCached(fetch);
    patchPluginsListEnabled("codex", false);
    const cached = await loadPluginsListCached(fetch);
    expect(cached.fromCache).toBe(true);
    expect(cached.plugins[0]?.enabled).toBe(false);
  });
});
