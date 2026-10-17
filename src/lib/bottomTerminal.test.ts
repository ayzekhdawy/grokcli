import { describe, expect, it } from "vitest";
import {
  BOTTOM_TERMINAL_HEIGHT_DEFAULT,
  BOTTOM_TERMINAL_HEIGHT_MIN,
  BOTTOM_TERMINAL_HEIGHT_STORAGE_KEY,
  BOTTOM_TERMINAL_ORPHAN_KEY,
  addBottomTerminalTab,
  applyBottomTerminalProjectSlice,
  bottomTerminalProjectKey,
  clampBottomTerminalHeight,
  closeAllBottomTerminalTabs,
  closeBottomTerminal,
  closeBottomTerminalTab,
  droppedBottomTerminalTabIds,
  emptyBottomTerminalState,
  loadBottomTerminalHeight,
  openBottomTerminal,
  saveBottomTerminalHeight,
  setActiveBottomTerminalTab,
  setBottomTerminalHeight,
  switchBottomTerminalProject,
  toggleBottomTerminal,
} from "./bottomTerminal";

function memoryStorage(seed: Record<string, string> = {}): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  _map: Map<string, string>;
} {
  const map = new Map(Object.entries(seed));
  return {
    _map: map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe("emptyBottomTerminalState", () => {
  it("starts closed with no tabs and the default height", () => {
    const s = emptyBottomTerminalState();
    expect(s.open).toBe(false);
    expect(s.tabs).toEqual([]);
    expect(s.activeId).toBeNull();
    expect(s.height).toBe(BOTTOM_TERMINAL_HEIGHT_DEFAULT);
  });
});

describe("clampBottomTerminalHeight", () => {
  it("floors at the minimum and uses the default for non-finite input", () => {
    expect(clampBottomTerminalHeight(40)).toBe(BOTTOM_TERMINAL_HEIGHT_MIN);
    expect(clampBottomTerminalHeight(Number.NaN)).toBe(
      BOTTOM_TERMINAL_HEIGHT_DEFAULT,
    );
    expect(clampBottomTerminalHeight(320)).toBe(320);
  });

  it("caps at maxPx when that max is above the minimum", () => {
    expect(clampBottomTerminalHeight(900, 300)).toBe(300);
    expect(clampBottomTerminalHeight(900, 80)).toBe(900);
  });
});

describe("load / save height", () => {
  it("returns the default when storage is missing or empty", () => {
    expect(loadBottomTerminalHeight(null)).toBe(BOTTOM_TERMINAL_HEIGHT_DEFAULT);
    expect(loadBottomTerminalHeight(memoryStorage())).toBe(
      BOTTOM_TERMINAL_HEIGHT_DEFAULT,
    );
  });

  it("round-trips a valid height and clamps junk", () => {
    const store = memoryStorage();
    saveBottomTerminalHeight(360, store);
    expect(store.getItem(BOTTOM_TERMINAL_HEIGHT_STORAGE_KEY)).toBe("360");
    expect(loadBottomTerminalHeight(store)).toBe(360);

    saveBottomTerminalHeight(10, store);
    expect(loadBottomTerminalHeight(store)).toBe(BOTTOM_TERMINAL_HEIGHT_MIN);

    const junk = memoryStorage({ [BOTTOM_TERMINAL_HEIGHT_STORAGE_KEY]: "nope" });
    expect(loadBottomTerminalHeight(junk)).toBe(BOTTOM_TERMINAL_HEIGHT_DEFAULT);
  });
});

describe("toggle / open / close", () => {
  it("opens by creating the first tab, then closes without dropping tabs", () => {
    let s = emptyBottomTerminalState();
    s = toggleBottomTerminal(s);
    expect(s.open).toBe(true);
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(s.tabs[0]!.id);

    const tabId = s.tabs[0]!.id;
    s = toggleBottomTerminal(s);
    expect(s.open).toBe(false);
    expect(s.tabs.map((t) => t.id)).toEqual([tabId]);

    s = toggleBottomTerminal(s);
    expect(s.open).toBe(true);
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(tabId);
  });

  it("open is a no-op when already open with tabs", () => {
    let s = openBottomTerminal(emptyBottomTerminalState());
    const again = openBottomTerminal(s);
    expect(again).toBe(s);
    expect(closeBottomTerminal(closeBottomTerminal(s)).open).toBe(false);
  });
});

describe("add / close / activate tabs", () => {
  it("always mints a new shell and focuses it", () => {
    let s = emptyBottomTerminalState();
    s = addBottomTerminalTab(s, { id: "a" });
    s = addBottomTerminalTab(s, { id: "b" });
    expect(s.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(s.activeId).toBe("b");
    expect(s.open).toBe(true);
  });

  it("keeps the first created tab at index 0 so chip numbers stay stable", () => {
    let s = emptyBottomTerminalState();
    s = addBottomTerminalTab(s, { id: "first" });
    s = addBottomTerminalTab(s, { id: "second" });
    s = addBottomTerminalTab(s, { id: "third" });
    expect(s.tabs.map((t) => t.id)).toEqual(["first", "second", "third"]);
    expect(s.activeId).toBe("third");
  });

  it("drops the oldest tab when over the cap", () => {
    let s = emptyBottomTerminalState();
    s = addBottomTerminalTab(s, { id: "a" }, 2);
    s = addBottomTerminalTab(s, { id: "b" }, 2);
    s = addBottomTerminalTab(s, { id: "c" }, 2);
    expect(s.tabs.map((t) => t.id)).toEqual(["b", "c"]);
    expect(s.activeId).toBe("c");
  });

  it("closing the last tab collapses the panel", () => {
    let s = addBottomTerminalTab(emptyBottomTerminalState(), { id: "only" });
    s = closeBottomTerminalTab(s, "only");
    expect(s.tabs).toEqual([]);
    expect(s.activeId).toBeNull();
    expect(s.open).toBe(false);
  });

  it("closing the active tab focuses a neighbor", () => {
    let s = addBottomTerminalTab(emptyBottomTerminalState(), { id: "a" });
    s = addBottomTerminalTab(s, { id: "b" });
    s = addBottomTerminalTab(s, { id: "c" });
    s = closeBottomTerminalTab(s, "c");
    expect(s.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(s.activeId).toBe("b");

    s = addBottomTerminalTab(s, { id: "c" });
    s = setActiveBottomTerminalTab(s, "a");
    s = closeBottomTerminalTab(s, "a");
    expect(s.tabs.map((t) => t.id)).toEqual(["b", "c"]);
    expect(s.activeId).toBe("b");
  });

  it("reports dropped tab ids for close, close-all, and cap overflow", () => {
    const a = addBottomTerminalTab(emptyBottomTerminalState(), { id: "a" });
    const ab = addBottomTerminalTab(a, { id: "b" });
    expect(droppedBottomTerminalTabIds(ab, closeBottomTerminalTab(ab, "a"))).toEqual(
      ["a"],
    );
    expect(droppedBottomTerminalTabIds(ab, closeAllBottomTerminalTabs(ab))).toEqual(
      ["a", "b"],
    );
    const abc = addBottomTerminalTab(ab, { id: "c" }, 2);
    expect(droppedBottomTerminalTabIds(ab, abc)).toEqual(["a"]);
    expect(droppedBottomTerminalTabIds(ab, ab)).toEqual([]);
    expect(droppedBottomTerminalTabIds(ab, closeBottomTerminal(ab))).toEqual([]);
  });

  it("close all drops every tab and collapses the panel", () => {
    let s = addBottomTerminalTab(emptyBottomTerminalState(), { id: "a" });
    s = addBottomTerminalTab(s, { id: "b" });
    s = { ...s, height: 300 };
    s = closeAllBottomTerminalTabs(s);
    expect(s.tabs).toEqual([]);
    expect(s.activeId).toBeNull();
    expect(s.open).toBe(false);
    expect(s.height).toBe(300);
    expect(closeAllBottomTerminalTabs(s)).toBe(s);
  });

  it("activate ignores unknown ids and is a no-op for the current tab", () => {
    let s = addBottomTerminalTab(emptyBottomTerminalState(), { id: "a" });
    expect(setActiveBottomTerminalTab(s, "missing")).toBe(s);
    expect(setActiveBottomTerminalTab(s, "a")).toBe(s);
    s = addBottomTerminalTab(s, { id: "b" });
    const focused = setActiveBottomTerminalTab(s, "a");
    expect(focused.activeId).toBe("a");
  });
});

describe("setBottomTerminalHeight", () => {
  it("clamps and returns the same object when unchanged", () => {
    const s = emptyBottomTerminalState();
    expect(setBottomTerminalHeight(s, 240)).toBe(s);
    expect(setBottomTerminalHeight(s, 80).height).toBe(
      BOTTOM_TERMINAL_HEIGHT_MIN,
    );
    expect(setBottomTerminalHeight(s, 500, 300).height).toBe(300);
  });
});

describe("project isolation", () => {
  it("maps empty / null to the orphan bucket", () => {
    expect(bottomTerminalProjectKey(null)).toBe(BOTTOM_TERMINAL_ORPHAN_KEY);
    expect(bottomTerminalProjectKey("")).toBe(BOTTOM_TERMINAL_ORPHAN_KEY);
    expect(bottomTerminalProjectKey("proj-a")).toBe("proj-a");
  });

  it("stashes tabs per project and keeps layout flags", () => {
    let state = addBottomTerminalTab(emptyBottomTerminalState(), { id: "term-a" });
    state = { ...state, open: true, height: 300 };

    const first = switchBottomTerminalProject(
      state,
      new Map(),
      "proj-a",
      "proj-b",
    );
    expect(first.state.tabs).toEqual([]);
    expect(first.state.activeId).toBeNull();
    expect(first.state.open).toBe(true);
    expect(first.state.height).toBe(300);

    let b = addBottomTerminalTab(first.state, { id: "term-b" });
    const back = switchBottomTerminalProject(
      b,
      first.store,
      "proj-b",
      "proj-a",
    );
    expect(back.state.tabs.map((t) => t.id)).toEqual(["term-a"]);
    expect(back.state.open).toBe(true);
    expect(back.state.height).toBe(300);

    const same = switchBottomTerminalProject(
      back.state,
      back.store,
      "proj-a",
      "proj-a",
    );
    expect(same.state).toBe(back.state);
  });

  it("apply with no slice clears tabs", () => {
    const s = addBottomTerminalTab(emptyBottomTerminalState(), { id: "x" });
    const next = applyBottomTerminalProjectSlice(s, undefined);
    expect(next.tabs).toEqual([]);
    expect(next.activeId).toBeNull();
    expect(next.height).toBe(s.height);
  });
});
