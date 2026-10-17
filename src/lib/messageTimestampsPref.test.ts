import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHOW_MESSAGE_TIMESTAMPS,
  MESSAGE_TIMESTAMPS_STORAGE_KEY,
  loadMessageTimestampsPref,
  parseMessageTimestampsPref,
  saveMessageTimestampsPref,
  type MessageTimestampsStorage,
} from "./messageTimestampsPref";

function memoryStorage(
  initial: Record<string, string> = {},
): MessageTimestampsStorage & { data: Record<string, string> } {
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

describe("messageTimestampsPref", () => {
  it("defaults to true", () => {
    expect(DEFAULT_SHOW_MESSAGE_TIMESTAMPS).toBe(true);
    expect(parseMessageTimestampsPref(null)).toBe(true);
    expect(parseMessageTimestampsPref("")).toBe(true);
    expect(parseMessageTimestampsPref("maybe")).toBe(true);
    expect(loadMessageTimestampsPref(memoryStorage())).toBe(true);
  });

  it("parses true/false variants", () => {
    expect(parseMessageTimestampsPref("1")).toBe(true);
    expect(parseMessageTimestampsPref("true")).toBe(true);
    expect(parseMessageTimestampsPref(true)).toBe(true);
    expect(parseMessageTimestampsPref("0")).toBe(false);
    expect(parseMessageTimestampsPref("false")).toBe(false);
    expect(parseMessageTimestampsPref(false)).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveMessageTimestampsPref(false, s);
    expect(s.data[MESSAGE_TIMESTAMPS_STORAGE_KEY]).toBe("0");
    expect(loadMessageTimestampsPref(s)).toBe(false);
    saveMessageTimestampsPref(true, s);
    expect(s.data[MESSAGE_TIMESTAMPS_STORAGE_KEY]).toBe("1");
    expect(loadMessageTimestampsPref(s)).toBe(true);
  });
});
