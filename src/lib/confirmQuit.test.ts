import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALWAYS_QUIT_WITHOUT_ASKING_CHANGE_EVENT,
  ALWAYS_QUIT_WITHOUT_ASKING_STORAGE_KEY,
  DEFAULT_ALWAYS_QUIT_WITHOUT_ASKING,
  loadAlwaysQuitWithoutAskingPref,
  parseAlwaysQuitWithoutAskingPref,
  saveAlwaysQuitWithoutAskingPref,
  shouldConfirmQuit,
  type AlwaysQuitWithoutAskingStorage,
} from "./confirmQuit";

function memoryStorage(
  initial: Record<string, string> = {},
): AlwaysQuitWithoutAskingStorage & { data: Record<string, string> } {
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

describe("shouldConfirmQuit", () => {
  it("asks when there is at least one busy session and pref is off", () => {
    expect(shouldConfirmQuit(1, false)).toBe(true);
    expect(shouldConfirmQuit(3, false)).toBe(true);
  });

  it("does not ask when no sessions are busy", () => {
    expect(shouldConfirmQuit(0, false)).toBe(false);
    expect(shouldConfirmQuit(-1, false)).toBe(false);
    expect(shouldConfirmQuit(Number.NaN, false)).toBe(false);
  });

  it("does not ask when always-quit-without-asking is on", () => {
    expect(shouldConfirmQuit(0, true)).toBe(false);
    expect(shouldConfirmQuit(5, true)).toBe(false);
  });

  it("floors fractional busy counts", () => {
    expect(shouldConfirmQuit(0.9, false)).toBe(false);
    expect(shouldConfirmQuit(1.2, false)).toBe(true);
  });
});

describe("alwaysQuitWithoutAsking pref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to false (always confirm when busy)", () => {
    expect(DEFAULT_ALWAYS_QUIT_WITHOUT_ASKING).toBe(false);
    expect(parseAlwaysQuitWithoutAskingPref(null)).toBe(false);
    expect(parseAlwaysQuitWithoutAskingPref("")).toBe(false);
    expect(parseAlwaysQuitWithoutAskingPref("maybe")).toBe(false);
    expect(loadAlwaysQuitWithoutAskingPref(memoryStorage())).toBe(false);
  });

  it("parses true/false variants", () => {
    expect(parseAlwaysQuitWithoutAskingPref("1")).toBe(true);
    expect(parseAlwaysQuitWithoutAskingPref("true")).toBe(true);
    expect(parseAlwaysQuitWithoutAskingPref(true)).toBe(true);
    expect(parseAlwaysQuitWithoutAskingPref("0")).toBe(false);
    expect(parseAlwaysQuitWithoutAskingPref("false")).toBe(false);
    expect(parseAlwaysQuitWithoutAskingPref(false)).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveAlwaysQuitWithoutAskingPref(true, s);
    expect(s.data[ALWAYS_QUIT_WITHOUT_ASKING_STORAGE_KEY]).toBe("1");
    expect(loadAlwaysQuitWithoutAskingPref(s)).toBe(true);
    saveAlwaysQuitWithoutAskingPref(false, s);
    expect(s.data[ALWAYS_QUIT_WITHOUT_ASKING_STORAGE_KEY]).toBe("0");
    expect(loadAlwaysQuitWithoutAskingPref(s)).toBe(false);
  });

  it("dispatches change event on save when window exists", () => {
    const listeners = new Map<string, Set<EventListener>>();
    const stubWindow = {
      addEventListener(type: string, listener: EventListener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
      removeEventListener(type: string, listener: EventListener) {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent(ev: Event) {
        const set = listeners.get(ev.type);
        if (set) for (const fn of set) fn(ev);
        return true;
      },
    };
    vi.stubGlobal("window", stubWindow);
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent<T = unknown> extends Event {
        detail: T;
        constructor(type: string, init?: CustomEventInit<T>) {
          super(type);
          this.detail = init?.detail as T;
        }
      },
    );

    const handler = vi.fn();
    stubWindow.addEventListener(ALWAYS_QUIT_WITHOUT_ASKING_CHANGE_EVENT, handler);
    saveAlwaysQuitWithoutAskingPref(true, memoryStorage());
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0] as CustomEvent;
    expect(ev.detail).toBe(true);
  });
});
