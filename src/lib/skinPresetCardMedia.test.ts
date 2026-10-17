import { describe, expect, it } from "vitest";
import {
  cssBackgroundUrl,
  isVideoAssetPath,
  presetCardStyle,
} from "./skinPresetCardMedia";
import type { SkinPresetListItem } from "./api/skin";

const preset: SkinPresetListItem = {
  id: "p1",
  sourceId: "local",
  name: "Whale",
  description: "",
  author: "",
  createdAt: 0,
  updatedAt: 0,
  skin: "default",
  scrim: 40,
  hasWallpaper: true,
  bytes: 1,
};

describe("skinPresetCardMedia", () => {
  it("treats mp4/webm as video assets", () => {
    expect(isVideoAssetPath("/a/wallpaper.mp4")).toBe(true);
    expect(isVideoAssetPath("/a/wallpaper.WEBM")).toBe(true);
    expect(isVideoAssetPath("/a/wallpaper.jpg")).toBe(false);
    expect(isVideoAssetPath("/a/preview.jpg")).toBe(false);
  });

  it("quotes CSS background urls so query-string media HTTP does not break", () => {
    const src =
      "http://127.0.0.1:9/v1/media?t=tok&p=%2FUsers%2Fme%2Fclip.mp4";
    expect(cssBackgroundUrl(src)).toBe(`url("${src}")`);
  });

  it("uses a flat swatch fill — no beveled dual-tone gradient", () => {
    const style = presetCardStyle(preset, {});
    expect(JSON.stringify(style)).not.toMatch(/135deg/);
    expect(JSON.stringify(style)).not.toMatch(/swatchAlt/);
    expect(style.background).toMatch(/^#/);
  });

  it("paints still thumbs as a quoted cover image, not a lighting gradient", () => {
    const src = "http://127.0.0.1:9/v1/media?t=tok&p=%2Fwall.jpg";
    const style = presetCardStyle(preset, { thumbSrc: src });
    expect(style.backgroundImage).toBe(`url("${src}")`);
    expect(style.backgroundSize).toBe("cover");
    expect(JSON.stringify(style)).not.toMatch(/135deg/);
  });

  it("keeps a flat fill under a video so the card is never an empty hole", () => {
    const style = presetCardStyle(preset, {
      videoSrc: "http://127.0.0.1:9/v1/media?t=tok&p=%2Fwall.mp4",
      thumbSrc: "http://127.0.0.1:9/poster.jpg",
    });
    expect(style.background).toMatch(/^#/);
    expect(style.backgroundImage).toBeUndefined();
  });
});
