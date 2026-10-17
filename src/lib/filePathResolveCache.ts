/**
 * In-memory cache of chat FilePathCard resolve results.
 * Prevents plain-code → card layout flash when the virtual list remounts
 * a row on scroll (each remount used to re-run host resolve async).
 *
 * - string = verified absolute path
 * - null = known missing / unopenable
 * - absent = never resolved this session
 */

const cache = new Map<string, string | null>();

function cacheKey(path: string, projectPath?: string | null): string {
  return `${projectPath || ""}\0${path.trim()}`;
}

export function getCachedFileResolve(
  path: string,
  projectPath?: string | null,
): string | null | undefined {
  const k = cacheKey(path, projectPath);
  if (!cache.has(k)) return undefined;
  return cache.get(k);
}

export function setCachedFileResolve(
  path: string,
  projectPath: string | null | undefined,
  absolutePath: string | null,
): void {
  const p = path.trim();
  if (!p) return;
  cache.set(cacheKey(p, projectPath), absolutePath);
  if (absolutePath) {
    // Alias: abs key also hits so absolute-only remounts are instant.
    cache.set(cacheKey(absolutePath, projectPath), absolutePath);
    cache.set(cacheKey(absolutePath, null), absolutePath);
  }
}

/** Test helper. */
export function resetFilePathResolveCacheForTests(): void {
  cache.clear();
}
