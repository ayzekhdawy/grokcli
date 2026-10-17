import { describe, expect, it } from "vitest";
import { placePetContextMenu } from "./petMenuPlace";

const overlayW = 440;
const overlayH = 360;
const mark = { x: 156, y: 216, w: 128, h: 128 };
const menuW = 128;
const menuH = 80;
const work = { x: 0, y: 0, w: 1440, h: 900 };

describe("placePetContextMenu", () => {
  it("keeps an interior click as the top-left", () => {
    const pos = placePetContextMenu({
      overlayW,
      overlayH,
      clickX: 200,
      clickY: 140,
      menuW,
      menuH,
      winX: 400,
      winY: 200,
      work,
    });
    expect(pos).toEqual({ left: 200, top: 140 });
  });

  it("slides left only enough when the click is against the visible right edge", () => {
    // Mark center on the work-area right edge — right half of the overlay
    // is off-screen. Click is on the mark; menu must stay near the click.
    const winX = work.w - (mark.x + mark.w / 2);
    const clickX = mark.x + mark.w - 10;
    const clickY = mark.y + 40;
    const pos = placePetContextMenu({
      overlayW,
      overlayH,
      clickX,
      clickY,
      menuW,
      menuH,
      winX,
      winY: 500,
      work,
    });
    expect(winX + pos.left + menuW).toBeLessThanOrEqual(work.w - 8);
    expect(pos.left).toBeLessThan(clickX);
    expect(pos.left).toBeGreaterThan(40);
    expect(pos.top).toBe(clickY);
  });

  it("slides up only enough when the click is against the visible bottom", () => {
    const pos = placePetContextMenu({
      overlayW,
      overlayH,
      clickX: 200,
      clickY: 350,
      menuW,
      menuH,
      winX: 400,
      winY: 200,
      work,
    });
    expect(pos.left).toBe(200);
    expect(pos.top + menuH).toBeLessThanOrEqual(overlayH - 8);
    expect(350 - pos.top).toBeLessThan(menuH + 16);
  });

  it("does not jump to the overlay origin when work-area units are unusable", () => {
    const pos = placePetContextMenu({
      overlayW,
      overlayH,
      clickX: 210,
      clickY: 240,
      menuW,
      menuH,
      winX: 4000,
      winY: 3000,
      work,
    });
    expect(pos).toEqual({ left: 210, top: 240 });
  });
});


