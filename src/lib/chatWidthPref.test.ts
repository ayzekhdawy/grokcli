import { describe, expect, it } from "vitest";
import {
  CHAT_WIDTHS,
  CHAT_WIDTH_ATTR,
  CHAT_WIDTH_MAX_PX,
  CHAT_WIDTH_STORAGE_KEY,
  DEFAULT_CHAT_WIDTH,
  applyChatWidth,
  isChatWidth,
  loadChatWidth,
  parseChatWidth,
  saveChatWidth,
  setChatWidth,
  type ChatWidthPrefStorage,
} from "./chatWidthPref";

function memoryStorage(
  initial: Record<string, string> = {},
): ChatWidthPrefStorage & { data: Record<string, string> } {
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

describe("chatWidthPref", () => {
  it("defaults to medium and rejects unknown values", () => {
    expect(DEFAULT_CHAT_WIDTH).toBe("medium");
    expect(parseChatWidth(null)).toBe("medium");
    expect(parseChatWidth("")).toBe("medium");
    expect(parseChatWidth("xl")).toBe("medium");
    expect(isChatWidth("narrow")).toBe(true);
    expect(isChatWidth("medium")).toBe(true);
    expect(isChatWidth("wide")).toBe(true);
    expect(isChatWidth("full")).toBe(true);
    expect(isChatWidth("xl")).toBe(false);
    expect(CHAT_WIDTHS).toEqual(["narrow", "medium", "wide", "full"]);
  });

  it("exposes max-width px map (full = none)", () => {
    expect(CHAT_WIDTH_MAX_PX.narrow).toBe(640);
    expect(CHAT_WIDTH_MAX_PX.medium).toBe(800);
    expect(CHAT_WIDTH_MAX_PX.wide).toBe(1000);
    expect(CHAT_WIDTH_MAX_PX.full).toBeNull();
  });

  it("persists and reloads after simulated relaunch", () => {
    const storage = memoryStorage();
    expect(loadChatWidth(storage)).toBe("medium");
    saveChatWidth("wide", storage);
    expect(storage.data[CHAT_WIDTH_STORAGE_KEY]).toBe("wide");
    expect(loadChatWidth(storage)).toBe("wide");
    saveChatWidth("narrow", storage);
    expect(loadChatWidth(storage)).toBe("narrow");
    saveChatWidth("full", storage);
    expect(loadChatWidth(storage)).toBe("full");
  });

  it("applyChatWidth sets data-chat-width", () => {
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    };
    applyChatWidth("narrow", el);
    expect(attrs.get(CHAT_WIDTH_ATTR)).toBe("narrow");
    applyChatWidth("medium", el);
    expect(attrs.get(CHAT_WIDTH_ATTR)).toBe("medium");
    applyChatWidth("wide", el);
    expect(attrs.get(CHAT_WIDTH_ATTR)).toBe("wide");
    applyChatWidth("full", el);
    expect(attrs.get(CHAT_WIDTH_ATTR)).toBe("full");
  });

  it("setChatWidth saves and applies", () => {
    const storage = memoryStorage();
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    };
    setChatWidth("wide", storage, el);
    expect(storage.data[CHAT_WIDTH_STORAGE_KEY]).toBe("wide");
    expect(attrs.get(CHAT_WIDTH_ATTR)).toBe("wide");
  });
});
