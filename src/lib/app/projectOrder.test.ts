import { describe, expect, it } from "vitest";
import {
  applyProjectPinPartition,
  canMoveProjectInPinGroup,
  moveProjectInPinGroup,
  projectPinGroupBounds,
  reorderProjectInPinGroup,
  reorderProjectsByIds,
  resolveProjectDropIndex,
} from "./projectOrder";

type P = { id: string; pinned?: boolean };

const p = (id: string, pinned = false): P => ({ id, pinned });

describe("applyProjectPinPartition", () => {
  it("moves pinned block first and keeps relative order", () => {
    const list = [p("u1"), p("p2", true), p("u2"), p("p1", true)];
    const next = applyProjectPinPartition(list);
    expect(next.map((x) => x.id)).toEqual(["p2", "p1", "u1", "u2"]);
  });

  it("returns same ref when already partitioned", () => {
    const list = [p("p1", true), p("u1")];
    expect(applyProjectPinPartition(list)).toBe(list);
  });
});

describe("reorderProjectsByIds", () => {
  it("reorders within groups and clamps unpinned below pinned", () => {
    const list = [p("p1", true), p("p2", true), p("u1"), p("u2")];
    const illegal = reorderProjectsByIds(list, ["u2", "p2", "u1", "p1"]);
    expect(illegal.map((x) => x.id)).toEqual(["p2", "p1", "u2", "u1"]);
  });

  it("appends missing ids in prior order", () => {
    const list = [p("a"), p("b"), p("c")];
    const next = reorderProjectsByIds(list, ["c", "a"]);
    expect(next.map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
});

describe("reorderProjectInPinGroup", () => {
  it("reorders only inside pinned group", () => {
    const list = [p("p1", true), p("p2", true), p("u1"), p("u2")];
    const next = reorderProjectInPinGroup(list, 0, 1);
    expect(next.map((x) => x.id)).toEqual(["p2", "p1", "u1", "u2"]);
  });

  it("clamps cross-group destination", () => {
    const list = [p("p1", true), p("p2", true), p("u1"), p("u2")];
    // Try to move u1 into pinned zone → clamp to unpinned start
    const next = reorderProjectInPinGroup(list, 2, 0);
    expect(next.map((x) => x.id)).toEqual(["p1", "p2", "u1", "u2"]);
  });

  it("reorders unpinned group", () => {
    const list = [p("p1", true), p("u1"), p("u2"), p("u3")];
    const next = reorderProjectInPinGroup(list, 3, 1);
    expect(next.map((x) => x.id)).toEqual(["p1", "u3", "u1", "u2"]);
  });
});

describe("moveProjectInPinGroup", () => {
  it("blocks move above group start / below group end", () => {
    const list = [p("p1", true), p("u1"), p("u2")];
    expect(moveProjectInPinGroup(list, "p1", "up")).toBe(list);
    expect(moveProjectInPinGroup(list, "u1", "up")).toBe(list);
    expect(moveProjectInPinGroup(list, "u2", "down")).toBe(list);
    expect(moveProjectInPinGroup(list, "u2", "up").map((x) => x.id)).toEqual([
      "p1",
      "u2",
      "u1",
    ]);
  });

  it("canMove reflects boundaries", () => {
    const list = [p("p1", true), p("p2", true), p("u1")];
    expect(canMoveProjectInPinGroup(list, "p1", "up")).toBe(false);
    expect(canMoveProjectInPinGroup(list, "p1", "down")).toBe(true);
    expect(canMoveProjectInPinGroup(list, "u1", "up")).toBe(false);
    expect(canMoveProjectInPinGroup(list, "u1", "down")).toBe(false);
  });
});

describe("projectPinGroupBounds", () => {
  it("returns pin and unpinned ranges", () => {
    const list = [p("p1", true), p("p2", true), p("u1")];
    expect(projectPinGroupBounds(list, 0)).toEqual({ start: 0, end: 2 });
    expect(projectPinGroupBounds(list, 2)).toEqual({ start: 2, end: 3 });
  });
});

describe("resolveProjectDropIndex", () => {
  it("keeps unpinned drops inside unpinned group", () => {
    const list = [p("p1", true), p("p2", true), p("u1"), p("u2")];
    // Drag u2 over p1
    expect(resolveProjectDropIndex(list, 3, 0, false)).toBe(2);
  });

  it("moves within unpinned", () => {
    const list = [p("p1", true), p("u1"), p("u2"), p("u3")];
    expect(resolveProjectDropIndex(list, 3, 1, false)).toBe(1);
  });
});
