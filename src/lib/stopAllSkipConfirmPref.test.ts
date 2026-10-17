import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_STOP_ALL_SKIP_CONFIRM,
  STOP_ALL_SKIP_CONFIRM_CHANGE_EVENT,
  STOP_ALL_SKIP_CONFIRM_STORAGE_KEY,
  loadStopAllSkipConfirmPref,
  parseStopAllSkipConfirmPref,
  saveStopAllSkipConfirmPref,
  type StopAllSkipConfirmStorage,
} from "./stopAllSkipConfirmPref";

function memoryStorage(
  initial: Record<string, string> = {},
): StopAllSkipConfirmStorage & { data: Record<string, string> } {
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

describe("stopAllSkipConfirm pref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to false (always confirm)", () => {
    expect(DEFAULT_STOP_ALL_SKIP_CONFIRM).toBe(false);
    expect(parseStopAllSkipConfirmPref(null)).toBe(false);
    expect(parseStopAllSkipConfirmPref("")).toBe(false);
    expect(parseStopAllSkipConfirmPref("maybe")).toBe(false);
    expect(loadStopAllSkipConfirmPref(memoryStorage())).toBe(false);
  });

  it("parses true/false variants", () => {
    expect(parseStopAllSkipConfirmPref("1")).toBe(true);
    expect(parseStopAllSkipConfirmPref("true")).toBe(true);
    expect(parseStopAllSkipConfirmPref(true)).toBe(true);
    expect(parseStopAllSkipConfirmPref("0")).toBe(false);
    expect(parseStopAllSkipConfirmPref("false")).toBe(false);
    expect(parseStopAllSkipConfirmPref(false)).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveStopAllSkipConfirmPref(true, s);
    expect(s.data[STOP_ALL_SKIP_CONFIRM_STORAGE_KEY]).toBe("1");
    expect(loadStopAllSkipConfirmPref(s)).toBe(true);
    saveStopAllSkipConfirmPref(false, s);
    expect(s.data[STOP_ALL_SKIP_CONFIRM_STORAGE_KEY]).toBe("0");
    expect(loadStopAllSkipConfirmPref(s)).toBe(false);
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
    stubWindow.addEventListener(STOP_ALL_SKIP_CONFIRM_CHANGE_EVENT, handler);
    saveStopAllSkipConfirmPref(true, memoryStorage());
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0] as CustomEvent;
    expect(ev.detail).toBe(true);
  });
});
