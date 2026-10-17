import { describe, expect, it } from "vitest";
import {
  clampPromptHistoryActive,
  collectUserPromptHistory,
  filterPromptHistory,
  nextPromptHistoryIndex,
  promptHistoryEmptyMessageKey,
  promptHistoryListNavFromKey,
  promptHistoryListPreview,
  resolvePromptHistoryEmptyState,
  shouldHandlePromptHistoryKey,
  stepPromptHistory,
  stepPromptHistoryListIndex,
} from "./composerPromptHistory";

describe("collectUserPromptHistory", () => {
  it("returns user contents newest first", () => {
    const history = collectUserPromptHistory([
      { role: "user", content: "first" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "second" },
      { role: "assistant", content: "ok2" },
      { role: "user", content: "third" },
    ]);
    expect(history).toEqual(["third", "second", "first"]);
  });

  it("skips empty / whitespace-only user messages", () => {
    const history = collectUserPromptHistory([
      { role: "user", content: "  " },
      { role: "user", content: "" },
      { role: "user", content: null },
      { role: "user", content: "keep" },
      { role: "tool", content: "tool noise" },
    ]);
    expect(history).toEqual(["keep"]);
  });

  it("preserves stored skill tokens", () => {
    const history = collectUserPromptHistory([
      { role: "user", content: "[[skill:foo]] hello" },
    ]);
    expect(history).toEqual(["[[skill:foo]] hello"]);
  });

  it("returns empty for no messages", () => {
    expect(collectUserPromptHistory([])).toEqual([]);
  });
});

describe("nextPromptHistoryIndex", () => {
  it("starts at newest on first up", () => {
    expect(nextPromptHistoryIndex(null, 3, "up")).toBe(0);
  });

  it("walks older on repeated up and clamps", () => {
    expect(nextPromptHistoryIndex(0, 3, "up")).toBe(1);
    expect(nextPromptHistoryIndex(1, 3, "up")).toBe(2);
    expect(nextPromptHistoryIndex(2, 3, "up")).toBe(2);
  });

  it("walks newer on down and clears past newest", () => {
    expect(nextPromptHistoryIndex(2, 3, "down")).toBe(1);
    expect(nextPromptHistoryIndex(1, 3, "down")).toBe(0);
    expect(nextPromptHistoryIndex(0, 3, "down")).toBe(null);
    expect(nextPromptHistoryIndex(null, 3, "down")).toBe(null);
  });

  it("returns null when history is empty", () => {
    expect(nextPromptHistoryIndex(null, 0, "up")).toBe(null);
    expect(nextPromptHistoryIndex(0, 0, "down")).toBe(null);
  });
});

describe("stepPromptHistory", () => {
  const history = ["newest", "mid", "oldest"];

  it("fills draft with newest on first up", () => {
    expect(stepPromptHistory(history, null, "up")).toEqual({
      index: 0,
      text: "newest",
    });
  });

  it("cycles older then clears past newest on down", () => {
    expect(stepPromptHistory(history, 0, "up")).toEqual({
      index: 1,
      text: "mid",
    });
    expect(stepPromptHistory(history, 1, "down")).toEqual({
      index: 0,
      text: "newest",
    });
    expect(stepPromptHistory(history, 0, "down")).toEqual({
      index: null,
      text: "",
    });
  });

  it("handles empty history", () => {
    expect(stepPromptHistory([], null, "up")).toEqual({
      index: null,
      text: "",
    });
  });
});

describe("filterPromptHistory", () => {
  const history = ["fix auth bug", "Add dark mode", "fix login form"];

  it("returns all entries newest-first when query empty", () => {
    expect(filterPromptHistory(history, "")).toEqual([
      { historyIndex: 0, text: "fix auth bug" },
      { historyIndex: 1, text: "Add dark mode" },
      { historyIndex: 2, text: "fix login form" },
    ]);
    expect(filterPromptHistory(history, "  ")).toEqual(
      filterPromptHistory(history, ""),
    );
  });

  it("filters by case-insensitive substring and keeps historyIndex", () => {
    expect(filterPromptHistory(history, "FIX")).toEqual([
      { historyIndex: 0, text: "fix auth bug" },
      { historyIndex: 2, text: "fix login form" },
    ]);
  });

  it("returns empty when nothing matches", () => {
    expect(filterPromptHistory(history, "xyz")).toEqual([]);
  });
});

describe("promptHistoryListPreview", () => {
  it("collapses whitespace and truncates", () => {
    expect(promptHistoryListPreview("a\n\nb   c")).toBe("a b c");
    expect(promptHistoryListPreview("abcdefghij", 6)).toBe("abcde…");
  });
});

describe("shouldHandlePromptHistoryKey", () => {
  it("claims ArrowUp only when empty or browsing", () => {
    expect(
      shouldHandlePromptHistoryKey({
        key: "ArrowUp",
        draftEmpty: true,
        browsing: false,
        historyLength: 2,
      }),
    ).toBe(true);
    expect(
      shouldHandlePromptHistoryKey({
        key: "ArrowUp",
        draftEmpty: false,
        browsing: true,
        historyLength: 2,
      }),
    ).toBe(true);
    expect(
      shouldHandlePromptHistoryKey({
        key: "ArrowUp",
        draftEmpty: false,
        browsing: false,
        historyLength: 2,
      }),
    ).toBe(false);
  });

  it("claims ArrowDown only while browsing", () => {
    expect(
      shouldHandlePromptHistoryKey({
        key: "ArrowDown",
        draftEmpty: true,
        browsing: false,
        historyLength: 2,
      }),
    ).toBe(false);
    expect(
      shouldHandlePromptHistoryKey({
        key: "ArrowDown",
        draftEmpty: false,
        browsing: true,
        historyLength: 2,
      }),
    ).toBe(true);
  });

  it("ignores other keys and empty history", () => {
    expect(
      shouldHandlePromptHistoryKey({
        key: "Enter",
        draftEmpty: true,
        browsing: false,
        historyLength: 2,
      }),
    ).toBe(false);
    expect(
      shouldHandlePromptHistoryKey({
        key: "ArrowUp",
        draftEmpty: true,
        browsing: false,
        historyLength: 0,
      }),
    ).toBe(false);
  });
});

describe("clampPromptHistoryActive", () => {
  it("clamps into range and handles empty", () => {
    expect(clampPromptHistoryActive(0, 0)).toBe(0);
    expect(clampPromptHistoryActive(5, 3)).toBe(2);
    expect(clampPromptHistoryActive(-1, 3)).toBe(0);
    expect(clampPromptHistoryActive(1.9, 3)).toBe(1);
    expect(clampPromptHistoryActive(Number.NaN, 3)).toBe(0);
  });
});

describe("stepPromptHistoryListIndex", () => {
  it("walks up/down without wrapping", () => {
    expect(stepPromptHistoryListIndex(0, 4, "up")).toBe(1);
    expect(stepPromptHistoryListIndex(3, 4, "up")).toBe(3);
    expect(stepPromptHistoryListIndex(2, 4, "down")).toBe(1);
    expect(stepPromptHistoryListIndex(0, 4, "down")).toBe(0);
  });

  it("home/end and page jumps", () => {
    expect(stepPromptHistoryListIndex(2, 10, "home")).toBe(0);
    expect(stepPromptHistoryListIndex(2, 10, "end")).toBe(9);
    expect(stepPromptHistoryListIndex(1, 10, "pageUp", 5)).toBe(6);
    expect(stepPromptHistoryListIndex(8, 10, "pageDown", 5)).toBe(3);
    // Invalid page size falls back to default (5) → 2+5=7
    expect(stepPromptHistoryListIndex(2, 10, "pageUp", 0)).toBe(7);
  });

  it("returns 0 for empty list", () => {
    expect(stepPromptHistoryListIndex(3, 0, "end")).toBe(0);
  });
});

describe("promptHistoryListNavFromKey", () => {
  it("maps known keys", () => {
    expect(promptHistoryListNavFromKey("ArrowUp")).toBe("up");
    expect(promptHistoryListNavFromKey("ArrowDown")).toBe("down");
    expect(promptHistoryListNavFromKey("Home")).toBe("home");
    expect(promptHistoryListNavFromKey("End")).toBe("end");
    expect(promptHistoryListNavFromKey("PageUp")).toBe("pageUp");
    expect(promptHistoryListNavFromKey("PageDown")).toBe("pageDown");
    expect(promptHistoryListNavFromKey("Enter")).toBeNull();
  });
});

describe("resolvePromptHistoryEmptyState", () => {
  it("returns null when rows exist", () => {
    expect(
      resolvePromptHistoryEmptyState({
        scope: "session",
        query: "",
        filteredCount: 2,
        unfilteredCount: 2,
      }),
    ).toBeNull();
  });

  it("session empty vs filter", () => {
    expect(
      resolvePromptHistoryEmptyState({
        scope: "session",
        query: "",
        filteredCount: 0,
        unfilteredCount: 0,
      }),
    ).toEqual({ kind: "session", showClearFilter: false });
    expect(
      resolvePromptHistoryEmptyState({
        scope: "session",
        query: "xyz",
        filteredCount: 0,
        unfilteredCount: 4,
      }),
    ).toEqual({ kind: "sessionFilter", showClearFilter: true });
  });

  it("recent empty vs filter", () => {
    expect(
      resolvePromptHistoryEmptyState({
        scope: "recent",
        query: "  ",
        filteredCount: 0,
        unfilteredCount: 0,
      }),
    ).toEqual({ kind: "recent", showClearFilter: false });
    expect(
      resolvePromptHistoryEmptyState({
        scope: "recent",
        query: "nope",
        filteredCount: 0,
        unfilteredCount: 1,
      }),
    ).toEqual({ kind: "recentFilter", showClearFilter: true });
  });

  it("maps kinds to message keys", () => {
    expect(promptHistoryEmptyMessageKey("session")).toBe("promptHistory.empty");
    expect(promptHistoryEmptyMessageKey("sessionFilter")).toBe(
      "promptHistory.emptyFilter",
    );
    expect(promptHistoryEmptyMessageKey("recent")).toBe(
      "promptHistory.emptyRecent",
    );
    expect(promptHistoryEmptyMessageKey("recentFilter")).toBe(
      "promptHistory.emptyRecentFilter",
    );
  });
});
