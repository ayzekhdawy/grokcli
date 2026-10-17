import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLEAR_ALL_UNREAD_CONFIRM_THRESHOLD,
  SESSION_UNREAD_CHANGE_EVENT,
  SESSION_UNREAD_STORAGE_KEY,
  clearAllUnread,
  clearUnread,
  isTurnDoneReadyTransition,
  isUnread,
  listUnreadSessionIds,
  load,
  loadUnreadSessionIds,
  markUnread,
  parseUnreadSessionIds,
  save,
  saveUnreadSessionIds,
  isWorkbenchForeground,
  shouldConfirmClearAllUnread,
  shouldMarkUnreadOnTurnDone,
  toggleUnread,
  type SessionUnreadStorage,
} from "./sessionUnread";

function memoryStorage(
  initial: Record<string, string> = {},
): SessionUnreadStorage & { data: Record<string, string> } {
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

describe("parseUnreadSessionIds", () => {
  it("returns empty set for empty / invalid input", () => {
    expect(parseUnreadSessionIds(null).size).toBe(0);
    expect(parseUnreadSessionIds(undefined).size).toBe(0);
    expect(parseUnreadSessionIds("").size).toBe(0);
    expect(parseUnreadSessionIds("not-json").size).toBe(0);
    expect(parseUnreadSessionIds("{}").size).toBe(0);
    expect(parseUnreadSessionIds(42).size).toBe(0);
  });

  it("parses JSON array of non-empty strings", () => {
    const set = parseUnreadSessionIds(JSON.stringify(["a", "  b  ", "", "a"]));
    expect(set.has("a")).toBe(true);
    expect(set.has("b")).toBe(true);
    expect(set.has("")).toBe(false);
    expect(set.size).toBe(2);
  });

  it("accepts already-parsed arrays", () => {
    expect(parseUnreadSessionIds(["x", 1, null, "y"]).has("x")).toBe(true);
    expect(parseUnreadSessionIds(["x", 1, null, "y"]).has("y")).toBe(true);
    expect(parseUnreadSessionIds(["x", 1, null, "y"]).size).toBe(2);
  });
});

describe("load / save", () => {
  it("load returns empty set when missing", () => {
    const storage = memoryStorage();
    expect(loadUnreadSessionIds(storage).size).toBe(0);
    expect(load(storage).size).toBe(0);
  });

  it("round-trips ids and sorts on write", () => {
    const storage = memoryStorage();
    saveUnreadSessionIds(["z", "a", "z", "  m  "], storage);
    expect(JSON.parse(storage.data[SESSION_UNREAD_STORAGE_KEY]!)).toEqual([
      "a",
      "m",
      "z",
    ]);
    const loaded = loadUnreadSessionIds(storage);
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
      [SESSION_UNREAD_STORAGE_KEY]: "{broken",
    });
    expect(loadUnreadSessionIds(storage).size).toBe(0);
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
      saveUnreadSessionIds(["s1"], storage);
      expect(handler).toHaveBeenCalledTimes(1);
      const ev = handler.mock.calls[0]![0] as CustomEvent;
      expect(ev.type).toBe(SESSION_UNREAD_CHANGE_EVENT);
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

describe("isUnread / markUnread / clearUnread", () => {
  it("isUnread is false for empty / unknown ids", () => {
    const storage = memoryStorage();
    expect(isUnread(null, storage)).toBe(false);
    expect(isUnread(undefined, storage)).toBe(false);
    expect(isUnread("  ", storage)).toBe(false);
    expect(isUnread("missing", storage)).toBe(false);
  });

  it("markUnread adds and is idempotent", () => {
    const storage = memoryStorage();
    expect(markUnread("sess-1", storage)).toBe(true);
    expect(isUnread("sess-1", storage)).toBe(true);
    expect(markUnread("sess-1", storage)).toBe(true);
    expect(Array.from(loadUnreadSessionIds(storage))).toEqual(["sess-1"]);
  });

  it("markUnread ignores blank session ids", () => {
    const storage = memoryStorage();
    expect(markUnread("", storage)).toBe(false);
    expect(markUnread("   ", storage)).toBe(false);
    expect(loadUnreadSessionIds(storage).size).toBe(0);
  });

  it("clearUnread removes and is idempotent", () => {
    const storage = memoryStorage();
    markUnread("a", storage);
    expect(clearUnread("a", storage)).toBe(true);
    expect(isUnread("a", storage)).toBe(false);
    expect(clearUnread("a", storage)).toBe(true);
    expect(loadUnreadSessionIds(storage).size).toBe(0);
  });

  it("trims session ids on unread check", () => {
    const storage = memoryStorage();
    saveUnreadSessionIds(["sess-x"], storage);
    expect(isUnread("  sess-x  ", storage)).toBe(true);
  });
});

describe("listUnreadSessionIds / toggleUnread / clearAllUnread", () => {
  it("list returns sorted ids", () => {
    const storage = memoryStorage();
    markUnread("z", storage);
    markUnread("a", storage);
    markUnread("m", storage);
    expect(listUnreadSessionIds(storage)).toEqual(["a", "m", "z"]);
  });

  it("toggleUnread marks then clears", () => {
    const storage = memoryStorage();
    expect(toggleUnread("sess-1", storage)).toBe(true);
    expect(isUnread("sess-1", storage)).toBe(true);
    expect(toggleUnread("sess-1", storage)).toBe(false);
    expect(isUnread("sess-1", storage)).toBe(false);
  });

  it("toggleUnread ignores blank ids", () => {
    const storage = memoryStorage();
    expect(toggleUnread("", storage)).toBe(false);
    expect(toggleUnread("   ", storage)).toBe(false);
    expect(loadUnreadSessionIds(storage).size).toBe(0);
  });

  it("clearAllUnread empties the set and reports count", () => {
    const storage = memoryStorage();
    markUnread("a", storage);
    markUnread("b", storage);
    expect(clearAllUnread(storage)).toBe(2);
    expect(listUnreadSessionIds(storage)).toEqual([]);
    expect(clearAllUnread(storage)).toBe(0);
  });

  it("shouldConfirmClearAllUnread uses exclusive threshold", () => {
    expect(CLEAR_ALL_UNREAD_CONFIRM_THRESHOLD).toBe(3);
    expect(shouldConfirmClearAllUnread(0)).toBe(false);
    expect(shouldConfirmClearAllUnread(1)).toBe(false);
    expect(shouldConfirmClearAllUnread(3)).toBe(false);
    expect(shouldConfirmClearAllUnread(4)).toBe(true);
    expect(shouldConfirmClearAllUnread(2, 1)).toBe(true);
    expect(shouldConfirmClearAllUnread(1, 1)).toBe(false);
    expect(shouldConfirmClearAllUnread(-1)).toBe(false);
  });
});

describe("isWorkbenchForeground", () => {
  it("defaults to foreground when focus/visibility are omitted", () => {
    expect(isWorkbenchForeground()).toBe(true);
  });

  it("requires both focus and a visible document", () => {
    expect(isWorkbenchForeground({ hasFocus: true, visibilityState: "visible" })).toBe(
      true,
    );
    expect(isWorkbenchForeground({ hasFocus: false, visibilityState: "visible" })).toBe(
      false,
    );
    expect(isWorkbenchForeground({ hasFocus: true, visibilityState: "hidden" })).toBe(
      false,
    );
    expect(isWorkbenchForeground({ hasFocus: false, visibilityState: "hidden" })).toBe(
      false,
    );
  });
});

describe("shouldMarkUnreadOnTurnDone", () => {
  it("marks only when finished session is not the viewed one", () => {
    expect(
      shouldMarkUnreadOnTurnDone({
        sessionId: "bg",
        viewingSessionId: "fg",
      }),
    ).toBe(true);
    expect(
      shouldMarkUnreadOnTurnDone({
        sessionId: "fg",
        viewingSessionId: "fg",
      }),
    ).toBe(false);
    expect(
      shouldMarkUnreadOnTurnDone({
        sessionId: "bg",
        viewingSessionId: null,
      }),
    ).toBe(true);
    expect(
      shouldMarkUnreadOnTurnDone({
        sessionId: null,
        viewingSessionId: "fg",
      }),
    ).toBe(false);
  });

  it("marks the viewed session when the workbench is unfocused or hidden", () => {
    expect(
      shouldMarkUnreadOnTurnDone({
        sessionId: "fg",
        viewingSessionId: "fg",
        hasFocus: false,
        visibilityState: "visible",
      }),
    ).toBe(true);
    expect(
      shouldMarkUnreadOnTurnDone({
        sessionId: "fg",
        viewingSessionId: "fg",
        hasFocus: true,
        visibilityState: "hidden",
      }),
    ).toBe(true);
    expect(
      shouldMarkUnreadOnTurnDone({
        sessionId: "fg",
        viewingSessionId: "fg",
        hasFocus: true,
        visibilityState: "visible",
      }),
    ).toBe(false);
  });

  it("trims ids before compare", () => {
    expect(
      shouldMarkUnreadOnTurnDone({
        sessionId: "  same  ",
        viewingSessionId: "same",
      }),
    ).toBe(false);
  });
});

describe("isTurnDoneReadyTransition", () => {
  it("requires ready after streaming or awaiting_permission", () => {
    expect(isTurnDoneReadyTransition("streaming", "ready")).toBe(true);
    expect(isTurnDoneReadyTransition("awaiting_permission", "ready")).toBe(
      true,
    );
    expect(isTurnDoneReadyTransition("connecting", "ready")).toBe(false);
    expect(isTurnDoneReadyTransition("idle", "ready")).toBe(false);
    expect(isTurnDoneReadyTransition("ready", "ready")).toBe(false);
    expect(isTurnDoneReadyTransition("streaming", "idle")).toBe(false);
    expect(isTurnDoneReadyTransition(null, "ready")).toBe(false);
  });
});
