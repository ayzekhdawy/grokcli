/**
 * While a reply is running, the send key can insert the draft into that
 * turn instead of queueing it. Default off: Enter still queues, and
 * Ctrl+Enter still steers. Shift+Enter stays a newline either way.
 * The queue button is unchanged.
 */

export const COMPOSER_ENTER_INSERTS_LIVE_KEY = "grok.composerEnterInsertsLive";

/** Fired on `window` after a same-tab preference save (storage events are cross-tab only). */
export const COMPOSER_ENTER_INSERTS_LIVE_CHANGED_EVENT =
  "grok:composerEnterInsertsLive";

export function loadComposerEnterInsertsLive(
  storage: Storage = localStorage,
): boolean {
  try {
    const v = storage.getItem(COMPOSER_ENTER_INSERTS_LIVE_KEY);
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
  } catch {
    /* private mode */
  }
  return false;
}

export function saveComposerEnterInsertsLive(
  enabled: boolean,
  storage: Storage = localStorage,
): void {
  try {
    storage.setItem(
      COMPOSER_ENTER_INSERTS_LIVE_KEY,
      enabled ? "true" : "false",
    );
  } catch {
    /* ignore */
  }
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(COMPOSER_ENTER_INSERTS_LIVE_CHANGED_EVENT, {
          detail: enabled,
        }),
      );
    }
  } catch {
    /* ignore */
  }
}
