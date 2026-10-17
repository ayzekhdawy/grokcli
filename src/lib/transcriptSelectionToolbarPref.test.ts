import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TRANSCRIPT_SELECTION_TOOLBAR,
  TRANSCRIPT_SELECTION_TOOLBAR_CHANGE_EVENT,
  TRANSCRIPT_SELECTION_TOOLBAR_STORAGE_KEY,
  loadTranscriptSelectionToolbarPref,
  parseTranscriptSelectionToolbarPref,
  saveTranscriptSelectionToolbarPref,
  type TranscriptSelectionToolbarStorage,
} from "./transcriptSelectionToolbarPref";

function memoryStorage(
  initial: Record<string, string> = {},
): TranscriptSelectionToolbarStorage & { data: Record<string, string> } {
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

describe("transcriptSelectionToolbarPref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to on", () => {
    expect(DEFAULT_TRANSCRIPT_SELECTION_TOOLBAR).toBe(true);
    expect(parseTranscriptSelectionToolbarPref(null)).toBe(true);
    expect(parseTranscriptSelectionToolbarPref("")).toBe(true);
    expect(parseTranscriptSelectionToolbarPref("maybe")).toBe(true);
    expect(loadTranscriptSelectionToolbarPref(memoryStorage())).toBe(true);
  });

  it("parses true/false variants", () => {
    expect(parseTranscriptSelectionToolbarPref("1")).toBe(true);
    expect(parseTranscriptSelectionToolbarPref("true")).toBe(true);
    expect(parseTranscriptSelectionToolbarPref(true)).toBe(true);
    expect(parseTranscriptSelectionToolbarPref("0")).toBe(false);
    expect(parseTranscriptSelectionToolbarPref("false")).toBe(false);
    expect(parseTranscriptSelectionToolbarPref(false)).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveTranscriptSelectionToolbarPref(false, s);
    expect(s.data[TRANSCRIPT_SELECTION_TOOLBAR_STORAGE_KEY]).toBe("0");
    expect(loadTranscriptSelectionToolbarPref(s)).toBe(false);
    saveTranscriptSelectionToolbarPref(true, s);
    expect(s.data[TRANSCRIPT_SELECTION_TOOLBAR_STORAGE_KEY]).toBe("1");
    expect(loadTranscriptSelectionToolbarPref(s)).toBe(true);
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
    stubWindow.addEventListener(
      TRANSCRIPT_SELECTION_TOOLBAR_CHANGE_EVENT,
      handler,
    );
    saveTranscriptSelectionToolbarPref(false, memoryStorage());
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0] as CustomEvent;
    expect(ev.detail).toBe(false);
  });
});
