import { describe, expect, it } from "vitest";
import { titleNeedsMarquee } from "./sidebarTitleMarquee";

describe("titleNeedsMarquee", () => {
  it("is false when the title fits the clip", () => {
    expect(titleNeedsMarquee(80, 140)).toBe(false);
    expect(titleNeedsMarquee(140, 140)).toBe(false);
    expect(titleNeedsMarquee(141, 140)).toBe(false);
  });

  it("is true only when the title is actually wider than the clip", () => {
    expect(titleNeedsMarquee(160, 140)).toBe(true);
    expect(titleNeedsMarquee(200, 100)).toBe(true);
  });

  it("ignores rows that are not laid out yet", () => {
    expect(titleNeedsMarquee(200, 0)).toBe(false);
    expect(titleNeedsMarquee(200, 7)).toBe(false);
    expect(titleNeedsMarquee(NaN, 140)).toBe(false);
  });
});