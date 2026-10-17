import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TRAY_BUSY_BADGE,
  TRAY_BUSY_BADGE_CHANGE_EVENT,
  TRAY_BUSY_BADGE_STORAGE_KEY,
  loadTrayBusyBadgePref,
  parseTrayBusyBadgePref,
  saveTrayBusyBadgePref,
  type TrayBusyBadgeStorage,
} from "./trayBusyBadgePref";

function memoryStorage(
  initial: Record<string, string> = {},
): TrayBusyBadgeStorage & { data: Record<string, string> } {
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

describe("trayBusyBadge pref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to true (on)", () => {
    expect(DEFAULT_TRAY_BUSY_BADGE).toBe(true);
    expect(parseTrayBusyBadgePref(null)).toBe(true);
    expect(parseTrayBusyBadgePref("")).toBe(true);
    expect(parseTrayBusyBadgePref("maybe")).toBe(true);
    expect(loadTrayBusyBadgePref(memoryStorage())).toBe(true);
  });

  it("parses true/false variants", () => {
    expect(parseTrayBusyBadgePref("1")).toBe(true);
    expect(parseTrayBusyBadgePref("true")).toBe(true);
    expect(parseTrayBusyBadgePref(true)).toBe(true);
    expect(parseTrayBusyBadgePref("0")).toBe(false);
    expect(parseTrayBusyBadgePref("false")).toBe(false);
    expect(parseTrayBusyBadgePref(false)).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveTrayBusyBadgePref(false, s);
    expect(s.data[TRAY_BUSY_BADGE_STORAGE_KEY]).toBe("0");
    expect(loadTrayBusyBadgePref(s)).toBe(false);
    saveTrayBusyBadgePref(true, s);
    expect(s.data[TRAY_BUSY_BADGE_STORAGE_KEY]).toBe("1");
    expect(loadTrayBusyBadgePref(s)).toBe(true);
  });

  it("load returns default when storage throws", () => {
    const broken: TrayBusyBadgeStorage = {
      getItem() {
        throw new Error("private");
      },
      setItem() {
        throw new Error("private");
      },
    };
    expect(loadTrayBusyBadgePref(broken)).toBe(true);
    expect(() => saveTrayBusyBadgePref(false, broken)).not.toThrow();
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
    stubWindow.addEventListener(TRAY_BUSY_BADGE_CHANGE_EVENT, handler);
    saveTrayBusyBadgePref(false, memoryStorage());
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0] as CustomEvent;
    expect(ev.detail).toBe(false);
  });
});
