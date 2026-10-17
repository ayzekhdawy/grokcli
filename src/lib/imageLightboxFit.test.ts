import { describe, expect, it } from "vitest";
import {
  containSize,
  lightboxCanPan,
  lightboxSlideDimensions,
  lightboxSlideRect,
  lightboxYarlSlideSize,
} from "./imageLightboxFit";

describe("lightboxSlideRect", () => {
  it("subtracts padding on all sides", () => {
    expect(lightboxSlideRect(1000, 800, 16)).toEqual({
      width: 968,
      height: 768,
    });
  });
});

describe("containSize", () => {
  it("downscales large landscape into the box", () => {
    const r = containSize({ width: 1000, height: 800 }, { width: 4000, height: 2000 });
    expect(r.width).toBe(1000);
    expect(r.height).toBe(500);
  });

  it("downscales large portrait into the box", () => {
    const r = containSize({ width: 1000, height: 800 }, { width: 1000, height: 2000 });
    expect(r.width).toBe(400);
    expect(r.height).toBe(800);
  });

  it("upscales small square to fill the shorter side", () => {
    const r = containSize({ width: 1000, height: 800 }, { width: 200, height: 200 });
    expect(r.width).toBe(800);
    expect(r.height).toBe(800);
  });
});

describe("lightboxSlideDimensions", () => {
  it("uses contain size when natural is smaller than stage (upscale path)", () => {
    const d = lightboxSlideDimensions(
      { width: 200, height: 200 },
      { width: 1000, height: 800 },
    );
    expect(d.width).toBe(800);
    expect(d.height).toBe(800);
    expect(d.width).toBeGreaterThan(200);
  });

  it("keeps natural when larger than stage (downscale path)", () => {
    const d = lightboxSlideDimensions(
      { width: 4000, height: 3000 },
      { width: 1000, height: 800 },
    );
    expect(d.width).toBe(4000);
    expect(d.height).toBe(3000);
  });

  it("keeps natural when equal to contain", () => {
    const d = lightboxSlideDimensions(
      { width: 800, height: 600 },
      { width: 800, height: 600 },
    );
    expect(d).toEqual({ width: 800, height: 600 });
  });
});

describe("lightboxYarlSlideSize", () => {
  it("emits srcSet at logical size so pan math survives naturalWidth overwrite", () => {
    const s = lightboxYarlSlideSize("http://x/a.jpg", { width: 800, height: 800 });
    expect(s).toEqual({
      width: 800,
      height: 800,
      srcSet: [{ src: "http://x/a.jpg", width: 800, height: 800 }],
    });
  });

  it("returns null for empty size", () => {
    expect(lightboxYarlSlideSize("http://x/a.jpg", { width: 0, height: 0 })).toBeNull();
  });
});

describe("lightboxCanPan", () => {
  it("false at zoom 1 even when image fills stage", () => {
    expect(
      lightboxCanPan({ width: 1000, height: 800 }, { width: 1000, height: 800 }, 1),
    ).toBe(false);
  });

  it("true when zoomed past stage (logical fit size)", () => {
    expect(
      lightboxCanPan({ width: 800, height: 800 }, { width: 1000, height: 800 }, 2),
    ).toBe(true);
  });

  it("false when zoomed but imageRect still under stage (natural-cap bug)", () => {
    // 200px natural * zoom 2 = 400 < 1000 stage → cannot pan (the bug we fix)
    expect(
      lightboxCanPan({ width: 200, height: 200 }, { width: 1000, height: 800 }, 2),
    ).toBe(false);
  });
});
