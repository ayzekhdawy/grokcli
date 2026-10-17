/**
 * Pure helpers for Settings → Account → Custom providers save / live-apply.
 *
 * Host writes agent-home `config.toml`; warm ACP processes must be recycled so
 * the next send reloads base_url / api_key / auth.json without a full app restart.
 */

export type ProviderActiveRoute = {
  activeSource: string;
  activeProviderId: string | null | undefined;
};

/**
 * Whether a successful upsert should recycle warm agents so config applies live.
 *
 * - `setAsDefault` → route / default model changed
 * - Mutated id is the active custom route → key/url/backend edit must respawn
 */
export function providerMutationNeedsAgentReload(
  opts: {
    setAsDefault: boolean;
    providerId: string;
  } & ProviderActiveRoute,
): boolean {
  if (opts.setAsDefault) return true;
  const id = opts.providerId.trim();
  if (!id) return false;
  return (
    opts.activeSource === "custom" &&
    (opts.activeProviderId ?? "").trim() === id
  );
}

/**
 * Race a promise against a wall-clock timeout so UI never sticks on “Saving…”.
 * On timeout the underlying work may still complete (host already wrote disk).
 */
export function withProviderSaveTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutMessage = "Provider save timed out",
): Promise<T> {
  const timeoutMs = Number.isFinite(ms) && ms > 0 ? ms : 25_000;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    promise.then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Default wall-clock budget for `providers_upsert` IPC (ms). */
export const PROVIDER_SAVE_TIMEOUT_MS = 25_000;

/** Slug for new provider ids (mirrors host sanitize rules loosely). */
export function slugifyProviderId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
