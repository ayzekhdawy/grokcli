import { describe, expect, it } from "vitest";
import { clampContextMenuPos } from "./ContextMenu";

describe("clampContextMenuPos — stay inside a small pet overlay", () => {
  const pet = { width: 224, height: 360 };

  it("slides left when the click is against the right edge", () => {
    const pos = clampContextMenuPos(220, 200, 148, 80, pet);
    expect(pos.left + 148).toBeLessThanOrEqual(pet.width - 8);
    expect(pos.left).toBe(pet.width - 148 - 8);
  });

  it("slides up when the click is against the bottom edge", () => {
    const pos = clampContextMenuPos(40, 350, 148, 80, pet);
    expect(pos.top + 80).toBeLessThanOrEqual(pet.height - 8);
    expect(pos.top).toBe(pet.height - 80 - 8);
  });

  it("keeps an interior click as the anchor", () => {
    expect(clampContextMenuPos(48, 120, 148, 80, pet)).toEqual({
      left: 48,
      top: 120,
    });
  });

  it("does not leave the left/top margin", () => {
    const pos = clampContextMenuPos(-20, -10, 148, 80, pet);
    expect(pos.left).toBe(8);
    expect(pos.top).toBe(8);
  });
});
