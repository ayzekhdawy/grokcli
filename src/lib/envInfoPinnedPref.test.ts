import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ENV_INFO_PINNED,
  ENV_INFO_PINNED_CHANGE_EVENT,
  ENV_INFO_PINNED_STORAGE_KEY,
  loadEnvInfoPinnedPref,
  parseEnvInfoPinnedPref,
  saveEnvInfoPinnedPref,
  type EnvInfoPinnedStorage,
} from "./envInfoPinnedPref";

function memoryStorage(
  initial: Record<string, string> = {},
): EnvInfoPinnedStorage & { data: Record<string, string> } {
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

describe("envInfoPinned pref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to false (dropdown)", () => {
    expect(DEFAULT_ENV_INFO_PINNED).toBe(false);
    expect(parseEnvInfoPinnedPref(null)).toBe(false);
    expect(parseEnvInfoPinnedPref("")).toBe(false);
    expect(parseEnvInfoPinnedPref("maybe")).toBe(false);
    expect(loadEnvInfoPinnedPref(memoryStorage())).toBe(false);
  });

  it("parses true/false variants", () => {
    expect(parseEnvInfoPinnedPref("1")).toBe(true);
    expect(parseEnvInfoPinnedPref("true")).toBe(true);
    expect(parseEnvInfoPinnedPref(true)).toBe(true);
    expect(parseEnvInfoPinnedPref("0")).toBe(false);
    expect(parseEnvInfoPinnedPref("false")).toBe(false);
    expect(parseEnvInfoPinnedPref(false)).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveEnvInfoPinnedPref(true, s);
    expect(s.data[ENV_INFO_PINNED_STORAGE_KEY]).toBe("1");
    expect(loadEnvInfoPinnedPref(s)).toBe(true);
    saveEnvInfoPinnedPref(false, s);
    expect(s.data[ENV_INFO_PINNED_STORAGE_KEY]).toBe("0");
    expect(loadEnvInfoPinnedPref(s)).toBe(false);
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
    stubWindow.addEventListener(ENV_INFO_PINNED_CHANGE_EVENT, handler);
    saveEnvInfoPinnedPref(true, memoryStorage());
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0] as CustomEvent;
    expect(ev.detail).toBe(true);
  });
});
