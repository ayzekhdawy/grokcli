import { describe, expect, it } from "vitest";
import {
  clampSearchPanelIndex,
  flattenSearchPanelItems,
  resolveSearchPanelKey,
  searchPanelItemIndex,
  searchPanelNavFromKey,
  searchPanelSessionDigitIndex,
  stepSearchPanelIndex,
} from "./searchPanelNav";

describe("flattenSearchPanelItems", () => {
  it("orders actions, then projects, then sessions", () => {
    expect(
      flattenSearchPanelItems({
        actions: [{ id: "new-chat" }, { id: "doctor" }],
        projects: [{ id: "p1" }],
        sessions: [{ id: "s1" }, { id: "s2" }],
      }),
    ).toEqual([
      { kind: "action", id: "new-chat" },
      { kind: "action", id: "doctor" },
      { kind: "project", id: "p1" },
      { kind: "session", id: "s1" },
      { kind: "session", id: "s2" },
    ]);
  });

  it("skips empty groups", () => {
    expect(
      flattenSearchPanelItems({
        actions: [],
        sessions: [{ id: "s1" }],
      }),
    ).toEqual([{ kind: "session", id: "s1" }]);
  });
});

describe("searchPanelItemIndex", () => {
  const items = flattenSearchPanelItems({
    actions: [{ id: "a" }],
    projects: [{ id: "p" }],
    sessions: [{ id: "s" }],
  });

  it("finds flattened offsets", () => {
    expect(searchPanelItemIndex(items, "action", "a")).toBe(0);
    expect(searchPanelItemIndex(items, "project", "p")).toBe(1);
    expect(searchPanelItemIndex(items, "session", "s")).toBe(2);
    expect(searchPanelItemIndex(items, "session", "missing")).toBe(-1);
  });
});

describe("clampSearchPanelIndex", () => {
  it("clamps to last item; empty list stays 0", () => {
    expect(clampSearchPanelIndex(8, 3)).toBe(2);
    expect(clampSearchPanelIndex(-2, 3)).toBe(0);
    expect(clampSearchPanelIndex(1, 0)).toBe(0);
  });
});

describe("stepSearchPanelIndex", () => {
  it("wraps up/down like a command palette", () => {
    expect(stepSearchPanelIndex(0, 4, "down")).toBe(1);
    expect(stepSearchPanelIndex(3, 4, "down")).toBe(0);
    expect(stepSearchPanelIndex(0, 4, "up")).toBe(3);
    expect(stepSearchPanelIndex(2, 4, "up")).toBe(1);
  });

  it("pages without wrapping past the ends", () => {
    expect(stepSearchPanelIndex(1, 10, "pageDown", 5)).toBe(6);
    expect(stepSearchPanelIndex(8, 10, "pageDown", 5)).toBe(9);
    expect(stepSearchPanelIndex(3, 10, "pageUp", 5)).toBe(0);
  });

  it("empty list stays at 0", () => {
    expect(stepSearchPanelIndex(2, 0, "down")).toBe(0);
  });
});

describe("searchPanelNavFromKey", () => {
  it("maps vertical keys only (Home/End stay with the query caret)", () => {
    expect(searchPanelNavFromKey("ArrowUp")).toBe("up");
    expect(searchPanelNavFromKey("ArrowDown")).toBe("down");
    expect(searchPanelNavFromKey("PageUp")).toBe("pageUp");
    expect(searchPanelNavFromKey("PageDown")).toBe("pageDown");
    expect(searchPanelNavFromKey("Home")).toBeNull();
    expect(searchPanelNavFromKey("End")).toBeNull();
    expect(searchPanelNavFromKey("Enter")).toBeNull();
  });
});

describe("searchPanelSessionDigitIndex", () => {
  it("maps ⌘/Ctrl 1–9 to session offsets", () => {
    expect(
      searchPanelSessionDigitIndex({
        key: "1",
        metaKey: true,
        ctrlKey: false,
      }),
    ).toBe(0);
    expect(
      searchPanelSessionDigitIndex({
        key: "9",
        metaKey: false,
        ctrlKey: true,
      }),
    ).toBe(8);
    expect(
      searchPanelSessionDigitIndex({
        key: "0",
        metaKey: true,
        ctrlKey: false,
      }),
    ).toBeNull();
    expect(
      searchPanelSessionDigitIndex({
        key: "2",
        metaKey: false,
        ctrlKey: false,
      }),
    ).toBeNull();
  });
});

describe("resolveSearchPanelKey", () => {
  const base = {
    activeIndex: 1,
    itemCount: 5,
    sessionCount: 3,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
  };

  it("navigates unmodified arrows and activates Enter", () => {
    expect(resolveSearchPanelKey({ ...base, key: "ArrowDown" })).toEqual({
      type: "nav",
      index: 2,
    });
    expect(resolveSearchPanelKey({ ...base, key: "Enter" })).toEqual({
      type: "activate",
      index: 1,
    });
  });

  it("does not steal Shift+Arrow, Home, or IME composition", () => {
    expect(
      resolveSearchPanelKey({ ...base, key: "ArrowDown", shiftKey: true }),
    ).toEqual({ type: "none" });
    expect(resolveSearchPanelKey({ ...base, key: "Home" })).toEqual({
      type: "none",
    });
    expect(
      resolveSearchPanelKey({ ...base, key: "ArrowDown", isComposing: true }),
    ).toEqual({ type: "none" });
  });

  it("activates the Nth session via ⌘1–9", () => {
    expect(
      resolveSearchPanelKey({
        ...base,
        key: "2",
        metaKey: true,
      }),
    ).toEqual({ type: "activateSession", sessionIndex: 1 });
    expect(
      resolveSearchPanelKey({
        ...base,
        key: "9",
        metaKey: true,
        sessionCount: 3,
      }),
    ).toEqual({ type: "none" });
  });

  it("Enter on an empty list is a no-op", () => {
    expect(
      resolveSearchPanelKey({ ...base, key: "Enter", itemCount: 0 }),
    ).toEqual({ type: "none" });
  });
});
