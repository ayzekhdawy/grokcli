import { describe, expect, it } from "vitest";
import {
  addIdsToSet,
  areAllIdsSelected,
  isSelectModifierEvent,
  pruneSelectedIds,
  rangeIdsInclusive,
  toggleIdInSet,
  toggleIdsInSet,
} from "./sessionSelect";

describe("isSelectModifierEvent", () => {
  it("is true for Cmd or Ctrl", () => {
    expect(isSelectModifierEvent({ metaKey: true })).toBe(true);
    expect(isSelectModifierEvent({ ctrlKey: true })).toBe(true);
    expect(isSelectModifierEvent({})).toBe(false);
    expect(isSelectModifierEvent({ metaKey: false, ctrlKey: false })).toBe(
      false,
    );
  });
});

describe("toggleIdInSet", () => {
  it("adds a missing id", () => {
    const next = toggleIdInSet(new Set(["a"]), "b");
    expect([...next].sort()).toEqual(["a", "b"]);
  });

  it("removes an existing id", () => {
    const next = toggleIdInSet(new Set(["a", "b"]), "a");
    expect([...next]).toEqual(["b"]);
  });

  it("does not mutate the input set", () => {
    const input = new Set(["a"]);
    const next = toggleIdInSet(input, "a");
    expect(input.has("a")).toBe(true);
    expect(next.has("a")).toBe(false);
    expect(next).not.toBe(input);
  });
});

describe("addIdsToSet", () => {
  it("unions ids without mutating the input", () => {
    const input = new Set(["a"]);
    const next = addIdsToSet(input, ["b", "a"]);
    expect([...next].sort()).toEqual(["a", "b"]);
    expect(input.has("b")).toBe(false);
    expect(next).not.toBe(input);
  });
});

describe("rangeIdsInclusive", () => {
  const ordered = ["a", "b", "c", "d", "e"];

  it("returns the inclusive slice in either direction", () => {
    expect(rangeIdsInclusive(ordered, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeIdsInclusive(ordered, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("returns a single id when endpoints match", () => {
    expect(rangeIdsInclusive(ordered, "c", "c")).toEqual(["c"]);
  });

  it("falls back when the anchor is missing", () => {
    expect(rangeIdsInclusive(ordered, "gone", "c")).toEqual(["c"]);
  });

  it("returns empty when the target is missing", () => {
    expect(rangeIdsInclusive(ordered, "a", "gone")).toEqual([]);
  });
});

describe("areAllIdsSelected", () => {
  it("is false for an empty group", () => {
    expect(areAllIdsSelected(new Set(["a"]), [])).toBe(false);
  });

  it("is true only when every id is selected", () => {
    const selected = new Set(["a", "b"]);
    expect(areAllIdsSelected(selected, ["a", "b"])).toBe(true);
    expect(areAllIdsSelected(selected, ["a", "b", "c"])).toBe(false);
  });
});

describe("toggleIdsInSet", () => {
  it("selects the whole group when any id is missing", () => {
    const next = toggleIdsInSet(new Set(["a"]), ["a", "b", "c"]);
    expect([...next].sort()).toEqual(["a", "b", "c"]);
  });

  it("deselects the whole group when all ids are already selected", () => {
    const next = toggleIdsInSet(new Set(["a", "b", "x"]), ["a", "b"]);
    expect([...next]).toEqual(["x"]);
  });

  it("does not mutate the input set", () => {
    const input = new Set(["a"]);
    const next = toggleIdsInSet(input, ["b"]);
    expect(input.has("b")).toBe(false);
    expect(next.has("b")).toBe(true);
    expect(next).not.toBe(input);
  });
});

describe("pruneSelectedIds", () => {
  it("keeps the same Set when all ids are live", () => {
    const selected = new Set(["a", "b"]);
    const live = new Set(["a", "b", "c"]);
    expect(pruneSelectedIds(selected, live)).toBe(selected);
  });

  it("drops stale ids", () => {
    const selected = new Set(["a", "gone"]);
    const live = new Set(["a", "b"]);
    const next = pruneSelectedIds(selected, live);
    expect([...next]).toEqual(["a"]);
    expect(next).not.toBe(selected);
  });

  it("returns empty for empty selection", () => {
    const selected = new Set<string>();
    expect(pruneSelectedIds(selected, new Set(["a"]))).toBe(selected);
  });
});
