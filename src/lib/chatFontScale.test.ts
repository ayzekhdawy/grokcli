import { describe, expect, it } from "vitest";
import {
  CHAT_FONT_SCALE_STORAGE_KEY,
  CHAT_FONT_SCALES,
  DEFAULT_CHAT_FONT_SCALE,
  applyChatFontScale,
  chatFontScaleVars,
  isChatFontScale,
  loadChatFontScale,
  parseChatFontScale,
  saveChatFontScale,
  setChatFontScale,
  type ChatFontScaleStorage,
} from "./chatFontScale";

function memoryStorage(
  initial: Record<string, string> = {},
): ChatFontScaleStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

describe("chatFontScale", () => {
  it("defaults to md and rejects unknown values", () => {
    expect(DEFAULT_CHAT_FONT_SCALE).toBe("md");
    expect(parseChatFontScale(null)).toBe("md");
    expect(parseChatFontScale("")).toBe("md");
    expect(parseChatFontScale("xl")).toBe("md");
    expect(isChatFontScale("sm")).toBe(true);
    expect(isChatFontScale("md")).toBe(true);
    expect(isChatFontScale("lg")).toBe(true);
    expect(isChatFontScale("xl")).toBe(false);
    expect(CHAT_FONT_SCALES).toEqual(["sm", "md", "lg"]);
  });

  it("exposes pixel vars for sm / md / lg", () => {
    expect(chatFontScaleVars("sm")).toEqual({
      fs: 13,
      fsSm: 11.5,
      fsXs: 10.5,
    });
    expect(chatFontScaleVars("md")).toEqual({
      fs: 14,
      fsSm: 12.5,
      fsXs: 11.5,
    });
    expect(chatFontScaleVars("lg")).toEqual({
      fs: 16,
      fsSm: 14,
      fsXs: 12.5,
    });
  });

  it("persists and reloads after simulated relaunch", () => {
    const storage = memoryStorage();
    expect(loadChatFontScale(storage)).toBe("md");
    saveChatFontScale("lg", storage);
    expect(storage.data[CHAT_FONT_SCALE_STORAGE_KEY]).toBe("lg");
    expect(loadChatFontScale(storage)).toBe("lg");
    saveChatFontScale("sm", storage);
    expect(loadChatFontScale(storage)).toBe("sm");
  });

  it("applyChatFontScale sets data-chat-font", () => {
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    };
    applyChatFontScale("sm", el);
    expect(attrs.get("data-chat-font")).toBe("sm");
    applyChatFontScale("md", el);
    expect(attrs.get("data-chat-font")).toBe("md");
    applyChatFontScale("lg", el);
    expect(attrs.get("data-chat-font")).toBe("lg");
  });

  it("setChatFontScale saves and applies", () => {
    const storage = memoryStorage();
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    };
    setChatFontScale("lg", storage, el);
    expect(storage.data[CHAT_FONT_SCALE_STORAGE_KEY]).toBe("lg");
    expect(attrs.get("data-chat-font")).toBe("lg");
  });
});
