/**
 * Chat transcript reading width (Appearance).
 * localStorage-only — no Rust AppSettings (avoids prefs schema conflicts).
 * Applied via `data-chat-width` on `document.documentElement`.
 *
 * - `narrow`  (~640px)
 * - `medium`  (~800px, default)
 * - `wide`    (~1000px)
 * - `full`    (no max-width)
 */

export type ChatWidth = "narrow" | "medium" | "wide" | "full";

export const CHAT_WIDTH_STORAGE_KEY = "grok.chatWidth";
export const DEFAULT_CHAT_WIDTH: ChatWidth = "medium";
export const CHAT_WIDTH_ATTR = "data-chat-width";
/** Optional window event after save/apply (detail = preference). */
export const CHAT_WIDTH_CHANGE_EVENT = "grok-chat-width";

export const CHAT_WIDTHS: readonly ChatWidth[] = [
  "narrow",
  "medium",
  "wide",
  "full",
] as const;

/** Approximate max-width (px) for CSS; `full` is null (no cap). */
export const CHAT_WIDTH_MAX_PX: Record<ChatWidth, number | null> = {
  narrow: 640,
  medium: 800,
  wide: 1000,
  full: null,
};

export interface ChatWidthPrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isChatWidth(value: unknown): value is ChatWidth {
  return (
    value === "narrow" ||
    value === "medium" ||
    value === "wide" ||
    value === "full"
  );
}

export function parseChatWidth(raw: unknown): ChatWidth {
  if (typeof raw === "string" && isChatWidth(raw)) return raw;
  return DEFAULT_CHAT_WIDTH;
}

export function loadChatWidth(
  storage: ChatWidthPrefStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): ChatWidth {
  try {
    return parseChatWidth(storage.getItem(CHAT_WIDTH_STORAGE_KEY));
  } catch {
    return DEFAULT_CHAT_WIDTH;
  }
}

export function saveChatWidth(
  width: ChatWidth,
  storage: ChatWidthPrefStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): void {
  try {
    storage.setItem(CHAT_WIDTH_STORAGE_KEY, width);
  } catch {
    /* private mode / quota */
  }
}

/** Minimal DOM surface so unit tests need no jsdom. */
export interface ChatWidthPrefRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute?(name: string): void;
}

/**
 * Apply width to document via `data-chat-width`.
 * CSS: `html[data-chat-width="…"] { --chat-width-max }` drives `.lobe-chat__inner`,
 * floating `.composer` / `.composer-stack`, and `.perm-bar`.
 * Always sets the attribute so narrow/medium/wide/full are explicit.
 */
export function applyChatWidth(
  width: ChatWidth,
  root: ChatWidthPrefRoot = typeof document !== "undefined"
    ? document.documentElement
    : { setAttribute: () => {} },
): void {
  root.setAttribute(CHAT_WIDTH_ATTR, width);
}

/** Fire optional change event for listeners (no-op outside browser). */
export function dispatchChatWidthChange(width: ChatWidth): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(CHAT_WIDTH_CHANGE_EVENT, { detail: width }),
    );
  } catch {
    /* ignore */
  }
}

/** Persist + apply (+ optional event) in one step (Settings onChange). */
export function setChatWidth(
  width: ChatWidth,
  storage?: ChatWidthPrefStorage,
  root?: ChatWidthPrefRoot,
): void {
  saveChatWidth(width, storage);
  applyChatWidth(width, root);
  dispatchChatWidthChange(width);
}
