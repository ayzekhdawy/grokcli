import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLEAR_ALL_MUTES_CONFIRM_THRESHOLD,
  SESSION_MUTE_CHANGE_EVENT,
  SESSION_MUTE_STORAGE_KEY,
  clearAllMutes,
  isMuted,
  listMutedSessionIds,
  load,
  loadMutedSessionIds,
  parseMutedSessionIds,
  save,
  saveMutedSessionIds,
  setMuted,
  shouldConfirmClearAllMutes,
  toggle,
  type SessionMuteStorage,
} from "./sessionMute";

function memoryStorage(
  initial: Record<string, string> = {},
): SessionMuteStorage & { data: Record<string, string> } {
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseMutedSessionIds", () => {
  it("returns empty set for empty / invalid input", () => {
    expect(parseMutedSessionIds(null).size).toBe(0);
    expect(parseMutedSessionIds(undefined).size).toBe(0);
    expect(parseMutedSessionIds("").size).toBe(0);
    expect(parseMutedSessionIds("not-json").size).toBe(0);
    expect(parseMutedSessionIds("{}").size).toBe(0);
    expect(parseMutedSessionIds(42).size).toBe(0);
  });

  it("parses JSON array of non-empty strings", () => {
    const set = parseMutedSessionIds(JSON.stringify(["a", "  b  ", "", "a"]));
    expect(set.has("a")).toBe(true);
    expect(set.has("b")).toBe(true);
    expect(set.has("")).toBe(false);
    expect(set.size).toBe(2);
  });

  it("accepts already-parsed arrays", () => {
    expect(parseMutedSessionIds(["x", 1, null, "y"]).has("x")).toBe(true);
    expect(parseMutedSessionIds(["x", 1, null, "y"]).has("y")).toBe(true);
    expect(parseMutedSessionIds(["x", 1, null, "y"]).size).toBe(2);
  });
});

describe("load / save", () => {
  it("load returns empty set when missing", () => {
    const storage = memoryStorage();
    expect(loadMutedSessionIds(storage).size).toBe(0);
    expect(load(storage).size).toBe(0);
  });

  it("round-trips ids and sorts on write", () => {
    const storage = memoryStorage();
    saveMutedSessionIds(["z", "a", "z", "  m  "], storage);
    expect(JSON.parse(storage.data[SESSION_MUTE_STORAGE_KEY]!)).toEqual([
      "a",
      "m",
      "z",
    ]);
    const loaded = loadMutedSessionIds(storage);
    expect(loaded.has("a")).toBe(true);
    expect(loaded.has("m")).toBe(true);
    expect(loaded.has("z")).toBe(true);
    expect(loaded.size).toBe(3);
    // alias
    save(["only"], storage);
    expect(Array.from(load(storage))).toEqual(["only"]);
  });

  it("load survives corrupt JSON", () => {
    const storage = memoryStorage({
      [SESSION_MUTE_STORAGE_KEY]: "{broken",
    });
    expect(loadMutedSessionIds(storage).size).toBe(0);
  });

  it("dispatches change event after save when window is available", () => {
    const storage = memoryStorage();
    const handler = vi.fn();
    const prevWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      value: {
        dispatchEvent: handler,
      },
      configurable: true,
      writable: true,
    });
    try {
      saveMutedSessionIds(["s1"], storage);
      expect(handler).toHaveBeenCalledTimes(1);
      const ev = handler.mock.calls[0]![0] as CustomEvent;
      expect(ev.type).toBe(SESSION_MUTE_CHANGE_EVENT);
      expect(ev.detail).toEqual(["s1"]);
    } finally {
      if (prevWindow === undefined) {
        // @ts-expect-error cleanup
        delete globalThis.window;
      } else {
        Object.defineProperty(globalThis, "window", {
          value: prevWindow,
          configurable: true,
          writable: true,
        });
      }
    }
  });
});

describe("isMuted / toggle / setMuted", () => {
  it("isMuted is false for empty / unknown ids", () => {
    const storage = memoryStorage();
    expect(isMuted(null, storage)).toBe(false);
    expect(isMuted(undefined, storage)).toBe(false);
    expect(isMuted("  ", storage)).toBe(false);
    expect(isMuted("missing", storage)).toBe(false);
  });

  it("toggle mutes then unmutes and returns new state", () => {
    const storage = memoryStorage();
    expect(toggle("sess-1", storage)).toBe(true);
    expect(isMuted("sess-1", storage)).toBe(true);
    expect(toggle("sess-1", storage)).toBe(false);
    expect(isMuted("sess-1", storage)).toBe(false);
  });

  it("toggle ignores blank session ids", () => {
    const storage = memoryStorage();
    expect(toggle("", storage)).toBe(false);
    expect(toggle("   ", storage)).toBe(false);
    expect(loadMutedSessionIds(storage).size).toBe(0);
  });

  it("setMuted adds and removes explicitly", () => {
    const storage = memoryStorage();
    expect(setMuted("a", true, storage)).toBe(true);
    expect(isMuted("a", storage)).toBe(true);
    expect(setMuted("a", false, storage)).toBe(false);
    expect(isMuted("a", storage)).toBe(false);
  });

  it("trims session ids on mute check", () => {
    const storage = memoryStorage();
    saveMutedSessionIds(["sess-x"], storage);
    expect(isMuted("  sess-x  ", storage)).toBe(true);
  });
});

describe("listMutedSessionIds / clearAllMutes", () => {
  it("list returns sorted muted ids", () => {
    const storage = memoryStorage();
    setMuted("z", true, storage);
    setMuted("a", true, storage);
    setMuted("m", true, storage);
    expect(listMutedSessionIds(storage)).toEqual(["a", "m", "z"]);
  });

  it("clearAllMutes empties the set and reports count", () => {
    const storage = memoryStorage();
    setMuted("a", true, storage);
    setMuted("b", true, storage);
    expect(clearAllMutes(storage)).toBe(2);
    expect(listMutedSessionIds(storage)).toEqual([]);
    expect(isMuted("a", storage)).toBe(false);
    expect(clearAllMutes(storage)).toBe(0);
  });

  it("shouldConfirmClearAllMutes uses exclusive threshold", () => {
    expect(CLEAR_ALL_MUTES_CONFIRM_THRESHOLD).toBe(3);
    expect(shouldConfirmClearAllMutes(0)).toBe(false);
    expect(shouldConfirmClearAllMutes(3)).toBe(false);
    expect(shouldConfirmClearAllMutes(4)).toBe(true);
    expect(shouldConfirmClearAllMutes(2, 1)).toBe(true);
  });

  it("mute does not imply unread is suppressed (honesty contract)", () => {
    // sessionMute only owns desktop-notify mute; unread is independent storage.
    // This test documents the product rule used by UI copy.
    const storage = memoryStorage();
    setMuted("sess-1", true, storage);
    expect(isMuted("sess-1", storage)).toBe(true);
    // No API here clears or blocks unread — mute set is orthogonal.
    expect(listMutedSessionIds(storage)).toEqual(["sess-1"]);
  });
});
