import { describe, expect, it } from "vitest";
import {
  RECENT_PROMPT_HISTORY_MAX,
  RECENT_PROMPT_TEXT_MAX,
  clearRecentPromptHistory,
  filterRecentPromptHistory,
  loadRecentPromptHistory,
  parseRecentPromptEntry,
  parseRecentPromptHistory,
  pushRecentPrompt,
  recordRecentPrompt,
  removeRecentPrompt,
  removeRecentPromptAt,
  saveRecentPromptHistory,
  type RecentPromptEntry,
  type RecentPromptStorage,
} from "./recentPromptHistory";

function memStorage(seed?: Record<string, string>): RecentPromptStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

const sample = (
  n: number,
  overrides?: Partial<RecentPromptEntry>,
): RecentPromptEntry => ({
  text: `prompt ${n}`,
  sessionId: `sess-${n}`,
  at: new Date(1_700_000_000_000 + n * 1000).toISOString(),
  ...overrides,
});

describe("parseRecentPromptEntry", () => {
  it("accepts valid entries and trims sessionId", () => {
    expect(
      parseRecentPromptEntry({
        text: "hello world",
        sessionId: "  abc  ",
        at: "2026-01-01T00:00:00.000Z",
        secret: "should-drop",
      }),
    ).toEqual({
      text: "hello world",
      sessionId: "abc",
      at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("rejects empty / whitespace-only text", () => {
    expect(parseRecentPromptEntry({ text: "  ", sessionId: "s" })).toBeNull();
    expect(parseRecentPromptEntry({ text: "", sessionId: "s" })).toBeNull();
    expect(parseRecentPromptEntry(null)).toBeNull();
    expect(parseRecentPromptEntry("nope")).toBeNull();
  });

  it("truncates long text", () => {
    const long = "x".repeat(RECENT_PROMPT_TEXT_MAX + 100);
    const e = parseRecentPromptEntry({
      text: long,
      sessionId: "s",
      at: "2026-01-01T00:00:00.000Z",
    });
    expect(e?.text.length).toBe(RECENT_PROMPT_TEXT_MAX);
  });

  it("defaults missing at and allows empty sessionId", () => {
    const e = parseRecentPromptEntry({ text: "hi" });
    expect(e?.text).toBe("hi");
    expect(e?.sessionId).toBe("");
    expect(e?.at).toBeTruthy();
  });
});

describe("parseRecentPromptHistory", () => {
  it("parses JSON string and array, newest-first order preserved", () => {
    const a = sample(1);
    const b = sample(2);
    expect(parseRecentPromptHistory(JSON.stringify([a, b]))).toEqual([a, b]);
    expect(parseRecentPromptHistory([a, b])).toEqual([a, b]);
  });

  it("returns empty on corrupt input", () => {
    expect(parseRecentPromptHistory("{not json")).toEqual([]);
    expect(parseRecentPromptHistory(42)).toEqual([]);
    expect(parseRecentPromptHistory(undefined)).toEqual([]);
  });

  it("caps at max", () => {
    const many = Array.from({ length: 60 }, (_, i) => sample(i));
    expect(parseRecentPromptHistory(many, 5)).toHaveLength(5);
    expect(parseRecentPromptHistory(many).length).toBeLessThanOrEqual(
      RECENT_PROMPT_HISTORY_MAX,
    );
  });
});

describe("pushRecentPrompt (ring + consecutive dedupe)", () => {
  it("prepends newest and trims to max", () => {
    const existing = Array.from({ length: 3 }, (_, i) => sample(i));
    const next = pushRecentPrompt(existing, sample(99), 3);
    expect(next).toHaveLength(3);
    expect(next[0]!.sessionId).toBe("sess-99");
    expect(next.map((e) => e.sessionId)).toEqual([
      "sess-99",
      "sess-0",
      "sess-1",
    ]);
  });

  it("dedupes consecutive identical text (keeps one, updates meta)", () => {
    const a = sample(1, { text: "same" });
    const b = sample(2, { text: "other" });
    const again = sample(3, { text: "same", sessionId: "new-sess" });
    const next = pushRecentPrompt([a, b], again, 50);
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({
      text: "same",
      sessionId: "new-sess",
    });
    expect(next[1]!.text).toBe("other");
  });

  it("allows non-consecutive identical text", () => {
    const a = sample(1, { text: "same" });
    const b = sample(2, { text: "other" });
    const again = sample(3, { text: "same" });
    // newest is "other", so "same" is not consecutive → prepend
    const next = pushRecentPrompt([b, a], again, 50);
    expect(next).toHaveLength(3);
    expect(next.map((e) => e.text)).toEqual(["same", "other", "same"]);
  });

  it("ignores invalid entry", () => {
    const existing = [sample(1)];
    expect(
      pushRecentPrompt(existing, {
        text: "  ",
        sessionId: "",
        at: "",
      }),
    ).toEqual(existing);
  });

  it("enforces default max of 50", () => {
    let list: RecentPromptEntry[] = [];
    for (let i = 0; i < 55; i++) {
      list = pushRecentPrompt(list, sample(i));
    }
    expect(list).toHaveLength(RECENT_PROMPT_HISTORY_MAX);
    expect(list[0]!.sessionId).toBe("sess-54");
    expect(list[list.length - 1]!.sessionId).toBe("sess-5");
  });
});

describe("load / save / recordRecentPrompt", () => {
  it("round-trips through storage", () => {
    const storage = memStorage();
    const a = sample(1);
    saveRecentPromptHistory([a], storage);
    expect(loadRecentPromptHistory(storage)).toEqual([a]);
  });

  it("recordRecentPrompt appends and skips empty", () => {
    const storage = memStorage();
    const first = recordRecentPrompt(
      { text: "one", sessionId: "s1", at: "2026-01-01T00:00:00.000Z" },
      storage,
    );
    expect(first).toHaveLength(1);
    expect(first[0]!.text).toBe("one");

    const second = recordRecentPrompt(
      { text: "two", sessionId: "s2", at: "2026-01-02T00:00:00.000Z" },
      storage,
    );
    expect(second.map((e) => e.text)).toEqual(["two", "one"]);

    const empty = recordRecentPrompt({ text: "  ", sessionId: "s3" }, storage);
    expect(empty.map((e) => e.text)).toEqual(["two", "one"]);
  });

  it("recordRecentPrompt consecutive dedupe", () => {
    const storage = memStorage();
    recordRecentPrompt(
      { text: "same", sessionId: "s1", at: "2026-01-01T00:00:00.000Z" },
      storage,
    );
    const next = recordRecentPrompt(
      { text: "same", sessionId: "s2", at: "2026-01-02T00:00:00.000Z" },
      storage,
    );
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ text: "same", sessionId: "s2" });
  });
});

describe("filterRecentPromptHistory", () => {
  const history = [
    sample(1, { text: "Fix auth bug" }),
    sample(2, { text: "Add dark mode" }),
    sample(3, { text: "Fix login form" }),
  ];

  it("returns all when query empty", () => {
    expect(filterRecentPromptHistory(history, "")).toHaveLength(3);
    expect(filterRecentPromptHistory(history, "")[0]!.historyIndex).toBe(0);
  });

  it("filters case-insensitively and keeps historyIndex", () => {
    const hits = filterRecentPromptHistory(history, "FIX");
    expect(hits.map((h) => h.text)).toEqual(["Fix auth bug", "Fix login form"]);
    expect(hits.map((h) => h.historyIndex)).toEqual([0, 2]);
  });

  it("returns empty when nothing matches", () => {
    expect(filterRecentPromptHistory(history, "xyz")).toEqual([]);
  });
});

describe("removeRecentPromptAt / removeRecentPrompt", () => {
  it("removes by index and ignores OOB", () => {
    const history = [sample(1), sample(2), sample(3)];
    expect(removeRecentPromptAt(history, 1).map((e) => e.sessionId)).toEqual([
      "sess-1",
      "sess-3",
    ]);
    expect(removeRecentPromptAt(history, -1)).toEqual(history);
    expect(removeRecentPromptAt(history, 99)).toEqual(history);
  });

  it("persists removal via storage", () => {
    const storage = memStorage();
    saveRecentPromptHistory([sample(1), sample(2), sample(3)], storage);
    const next = removeRecentPrompt(0, storage);
    expect(next.map((e) => e.sessionId)).toEqual(["sess-2", "sess-3"]);
    expect(loadRecentPromptHistory(storage).map((e) => e.sessionId)).toEqual([
      "sess-2",
      "sess-3",
    ]);
  });
});

describe("clearRecentPromptHistory", () => {
  it("wipes storage to empty list", () => {
    const storage = memStorage();
    saveRecentPromptHistory([sample(1), sample(2)], storage);
    expect(clearRecentPromptHistory(storage)).toEqual([]);
    expect(loadRecentPromptHistory(storage)).toEqual([]);
  });
});
