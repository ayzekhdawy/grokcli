/**
 * Chat transcript font scale (Appearance).
 * localStorage-only — no Rust AppSettings (avoids prefs schema conflicts).
 * Applied via `data-chat-font` on `document.documentElement`.
 */

export type ChatFontScale = "sm" | "md" | "lg";

export const CHAT_FONT_SCALE_STORAGE_KEY = "grok.chatFontScale";
export const DEFAULT_CHAT_FONT_SCALE: ChatFontScale = "md";

export const CHAT_FONT_SCALES: readonly ChatFontScale[] = [
  "sm",
  "md",
  "lg",
] as const;

/** Pixel values for CSS vars --chat-fs / --chat-fs-sm / --chat-fs-xs. */
export type ChatFontScaleVars = {
  fs: number;
  fsSm: number;
  fsXs: number;
};

const SCALE_VARS: Record<ChatFontScale, ChatFontScaleVars> = {
  sm: { fs: 13, fsSm: 11.5, fsXs: 10.5 },
  md: { fs: 14, fsSm: 12.5, fsXs: 11.5 },
  lg: { fs: 16, fsSm: 14, fsXs: 12.5 },
};

export interface ChatFontScaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isChatFontScale(value: unknown): value is ChatFontScale {
  return value === "sm" || value === "md" || value === "lg";
}

export function parseChatFontScale(raw: unknown): ChatFontScale {
  if (typeof raw === "string" && isChatFontScale(raw)) return raw;
  return DEFAULT_CHAT_FONT_SCALE;
}

export function chatFontScaleVars(scale: ChatFontScale): ChatFontScaleVars {
  return SCALE_VARS[scale] ?? SCALE_VARS[DEFAULT_CHAT_FONT_SCALE];
}

export function loadChatFontScale(
  storage: ChatFontScaleStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): ChatFontScale {
  try {
    return parseChatFontScale(storage.getItem(CHAT_FONT_SCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_CHAT_FONT_SCALE;
  }
}

export function saveChatFontScale(
  scale: ChatFontScale,
  storage: ChatFontScaleStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): void {
  try {
    storage.setItem(CHAT_FONT_SCALE_STORAGE_KEY, scale);
  } catch {
    /* private mode / quota */
  }
}

/** Minimal DOM surface so unit tests need no jsdom. */
export interface ChatFontScaleRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute?(name: string): void;
}

/**
 * Apply scale to document via `data-chat-font` (html[data-chat-font] .lobe-chat).
 * Always sets the attribute so sm/md/lg are explicit and CSS overrides apply.
 */
export function applyChatFontScale(
  scale: ChatFontScale,
  root: ChatFontScaleRoot = typeof document !== "undefined"
    ? document.documentElement
    : { setAttribute: () => {} },
): void {
  root.setAttribute("data-chat-font", scale);
}

/** Persist + apply in one step (Settings onChange). */
export function setChatFontScale(
  scale: ChatFontScale,
  storage?: ChatFontScaleStorage,
  root?: ChatFontScaleRoot,
): void {
  saveChatFontScale(scale, storage);
  applyChatFontScale(scale, root);
}
