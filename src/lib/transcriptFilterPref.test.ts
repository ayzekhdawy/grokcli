import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TRANSCRIPT_FILTER,
  TRANSCRIPT_FILTER_CHANGE_EVENT,
  TRANSCRIPT_FILTER_STORAGE_KEY,
  filterMessagesForTranscript,
  loadTranscriptFilterPref,
  parseTranscriptFilterPref,
  saveTranscriptFilterPref,
  shouldShowTranscriptToolChrome,
  type TranscriptFilterStorage,
} from "./transcriptFilterPref";
import { weaveToolsIntoAssistantSegments, type ChatMessage } from "./session";

function memoryStorage(
  initial: Record<string, string> = {},
): TranscriptFilterStorage & { data: Record<string, string> } {
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

describe("transcriptFilterPref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to conversation (fewer tool rows while streaming)", () => {
    expect(DEFAULT_TRANSCRIPT_FILTER).toBe("conversation");
    expect(parseTranscriptFilterPref(null)).toBe("conversation");
    expect(parseTranscriptFilterPref("")).toBe("conversation");
    expect(parseTranscriptFilterPref("maybe")).toBe("conversation");
    expect(loadTranscriptFilterPref(memoryStorage())).toBe("conversation");
  });

  it("parses known modes", () => {
    expect(parseTranscriptFilterPref("all")).toBe("all");
    expect(parseTranscriptFilterPref("full")).toBe("all");
    expect(parseTranscriptFilterPref("conversation")).toBe("conversation");
    expect(parseTranscriptFilterPref("conversation_only")).toBe("conversation");
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveTranscriptFilterPref("conversation", s);
    expect(s.data[TRANSCRIPT_FILTER_STORAGE_KEY]).toBe("conversation");
    expect(loadTranscriptFilterPref(s)).toBe("conversation");
    saveTranscriptFilterPref("all", s);
    expect(s.data[TRANSCRIPT_FILTER_STORAGE_KEY]).toBe("all");
    expect(loadTranscriptFilterPref(s)).toBe("all");
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
    stubWindow.addEventListener(TRANSCRIPT_FILTER_CHANGE_EVENT, handler);
    saveTranscriptFilterPref("conversation", memoryStorage());
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0] as CustomEvent;
    expect(ev.detail).toBe("conversation");
  });

  it("shouldShowTranscriptToolChrome is false only for conversation", () => {
    expect(shouldShowTranscriptToolChrome("all")).toBe(true);
    expect(shouldShowTranscriptToolChrome("conversation")).toBe(false);
  });
});

describe("filterMessagesForTranscript", () => {
  const user: ChatMessage = { id: "u1", role: "user", content: "hi" };
  const asst: ChatMessage = {
    id: "a1",
    role: "assistant",
    content: "done",
    thought: "think",
  };
  const tool1: ChatMessage = {
    id: "tool-call-1",
    role: "tool",
    content: "tool_step|completed||run",
    marker: "tool_step",
    toolCallId: "call-1",
  };
  const tool2: ChatMessage = {
    id: "tool-call-2",
    role: "tool",
    content: "tool_step|completed||run2",
    marker: "tool_step",
    toolCallId: "call-2",
  };
  const err: ChatMessage = {
    id: "e1",
    role: "assistant",
    content: "boom",
    isError: true,
  };
  const compact: ChatMessage = {
    id: "c1",
    role: "tool",
    content: "context_compact|auto",
    marker: "context_compact",
  };

  it("mode all: drops only inlined tool_step rows (woven tools)", () => {
    const woven = weaveToolsIntoAssistantSegments([user, asst, tool1, tool2]);
    const out = filterMessagesForTranscript(woven, "all");
    expect(out.map((m) => m.id)).toEqual(["u1", "a1"]);
  });

  it("mode all: keeps standalone tool_step not on any assistant", () => {
    const rows = [user, tool1];
    expect(filterMessagesForTranscript(rows, "all").map((m) => m.id)).toEqual([
      "u1",
      "tool-call-1",
    ]);
  });

  it("mode conversation: hides all tool_step rows", () => {
    const rows = [user, tool1, asst, tool2, err, compact];
    const out = filterMessagesForTranscript(rows, "conversation");
    expect(out.map((m) => m.id)).toEqual(["u1", "a1", "e1", "c1"]);
  });

  it("mode conversation: keeps user, assistant, errors; drops woven tools too", () => {
    const woven = weaveToolsIntoAssistantSegments([
      user,
      asst,
      tool1,
      tool2,
      err,
    ]);
    const out = filterMessagesForTranscript(woven, "conversation");
    expect(out.map((m) => m.id)).toEqual(["u1", "a1", "e1"]);
    expect(out.every((m) => m.marker !== "tool_step")).toBe(true);
  });

  it("defaults to conversation when mode omitted", () => {
    const rows = [user, tool1];
    expect(filterMessagesForTranscript(rows).map((m) => m.id)).toEqual([
      "u1",
    ]);
  });
});
