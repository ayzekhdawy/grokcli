import { describe, expect, it } from "vitest";
import {
  USER_ATTACH_COLLAPSE_AT,
  formatUserAttachOverflowLabel,
  partitionUserAttachments,
} from "./userAttachments";

describe("partitionUserAttachments", () => {
  const items = ["a", "b", "c", "d", "e"];

  it("shows all when count ≤ collapse threshold", () => {
    expect(partitionUserAttachments(items.slice(0, 3), false)).toEqual({
      visible: ["a", "b", "c"],
      overflow: 0,
    });
    expect(USER_ATTACH_COLLAPSE_AT).toBe(3);
  });

  it("collapses past threshold with overflow count", () => {
    expect(partitionUserAttachments(items, false)).toEqual({
      visible: ["a", "b", "c"],
      overflow: 2,
    });
  });

  it("shows all when expanded", () => {
    expect(partitionUserAttachments(items, true)).toEqual({
      visible: ["a", "b", "c", "d", "e"],
      overflow: 0,
    });
  });

  it("handles empty list", () => {
    expect(partitionUserAttachments([], false)).toEqual({
      visible: [],
      overflow: 0,
    });
  });
});

describe("formatUserAttachOverflowLabel", () => {
  it("prefixes plus", () => {
    expect(formatUserAttachOverflowLabel(2)).toBe("+2");
    expect(formatUserAttachOverflowLabel(0)).toBe("+0");
  });
});
