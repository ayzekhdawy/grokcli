import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CODE_WRAP_PREF_EVENT,
  CODE_WRAP_PREF_KEY,
  loadCodeWrapPref,
  saveCodeWrapPref,
} from "./codeWrapPref";

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe("codeWrapPref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to false (scroll / no wrap)", () => {
    expect(loadCodeWrapPref(memoryStorage())).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveCodeWrapPref(true, s);
    expect(s.getItem(CODE_WRAP_PREF_KEY)).toBe("wrap");
    expect(loadCodeWrapPref(s)).toBe(true);
    saveCodeWrapPref(false, s);
    expect(s.getItem(CODE_WRAP_PREF_KEY)).toBe("scroll");
    expect(loadCodeWrapPref(s)).toBe(false);
  });

  it("accepts legacy true/false and 1/0 values", () => {
    expect(loadCodeWrapPref(memoryStorage({ [CODE_WRAP_PREF_KEY]: "true" }))).toBe(
      true,
    );
    expect(loadCodeWrapPref(memoryStorage({ [CODE_WRAP_PREF_KEY]: "1" }))).toBe(
      true,
    );
    expect(
      loadCodeWrapPref(memoryStorage({ [CODE_WRAP_PREF_KEY]: "false" })),
    ).toBe(false);
    expect(loadCodeWrapPref(memoryStorage({ [CODE_WRAP_PREF_KEY]: "0" }))).toBe(
      false,
    );
  });

  it("ignores unknown values", () => {
    expect(
      loadCodeWrapPref(memoryStorage({ [CODE_WRAP_PREF_KEY]: "maybe" })),
    ).toBe(false);
  });

  it("dispatches grok:codeWrapPref on save when window exists", () => {
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
    stubWindow.addEventListener(CODE_WRAP_PREF_EVENT, handler);
    saveCodeWrapPref(true, memoryStorage());
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0] as CustomEvent;
    expect(ev.detail).toBe(true);
  });
});

