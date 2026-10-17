import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_SHADOW,
  DEFAULT_TEXT_COLOR,
  FONT_SHADOW_STORAGE_KEY,
  TEXT_COLOR_STORAGE_KEY,
  applyAppearanceChrome,
  applyFontShadow,
  applyTextColor,
  isDefaultAppearanceChrome,
  loadAppearanceChrome,
  parseFontShadow,
  parseTextColor,
  resetAppearanceChrome,
  saveFontShadow,
  saveTextColor,
} from "./appearanceChromePref";

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}

function fakeRoot() {
  const props = new Map<string, string>();
  const attrs = new Map<string, string>();
  return {
    props,
    attrs,
    style: {
      setProperty(name: string, value: string) {
        props.set(name, value);
      },
      removeProperty(name: string) {
        props.delete(name);
      },
    },
    setAttribute(name: string, value: string) {
      attrs.set(name, value);
    },
    removeAttribute(name: string) {
      attrs.delete(name);
    },
  };
}

describe("parseTextColor", () => {
  it("accepts #rgb and #rrggbb and lowercases", () => {
    expect(parseTextColor("#AbC")).toBe("#aabbcc");
    expect(parseTextColor("#Ff00aa")).toBe("#ff00aa");
    expect(parseTextColor("  #000  ")).toBe("#000000");
  });

  it("treats empty / default / junk as follow-theme", () => {
    expect(parseTextColor(null)).toBeNull();
    expect(parseTextColor("")).toBeNull();
    expect(parseTextColor("default")).toBeNull();
    expect(parseTextColor("theme")).toBeNull();
    expect(parseTextColor("red")).toBeNull();
    expect(parseTextColor("#ffff")).toBeNull();
    expect(parseTextColor("rgb(0,0,0)")).toBeNull();
  });
});

describe("parseFontShadow", () => {
  it("is off unless an explicit true-ish value", () => {
    expect(parseFontShadow(undefined)).toBe(false);
    expect(parseFontShadow(null)).toBe(false);
    expect(parseFontShadow("0")).toBe(false);
    expect(parseFontShadow(false)).toBe(false);
    expect(parseFontShadow(true)).toBe(true);
    expect(parseFontShadow("1")).toBe(true);
    expect(parseFontShadow("true")).toBe(true);
  });
});

describe("load / save / apply", () => {
  it("persists a custom hex and clears it on default", () => {
    const storage = memory();
    expect(loadAppearanceChrome(storage)).toEqual({
      textColor: DEFAULT_TEXT_COLOR,
      fontShadow: DEFAULT_FONT_SHADOW,
    });
    saveTextColor("#f00", storage);
    saveFontShadow(true, storage);
    expect(storage.data.get(TEXT_COLOR_STORAGE_KEY)).toBe("#ff0000");
    expect(storage.data.get(FONT_SHADOW_STORAGE_KEY)).toBe("1");
    expect(loadAppearanceChrome(storage)).toEqual({
      textColor: "#ff0000",
      fontShadow: true,
    });
    saveTextColor(null, storage);
    saveFontShadow(false, storage);
    expect(storage.data.has(TEXT_COLOR_STORAGE_KEY)).toBe(false);
    expect(storage.data.has(FONT_SHADOW_STORAGE_KEY)).toBe(false);
  });

  it("applyTextColor writes scoped chrome ink, not global --text-primary", () => {
    const root = fakeRoot();
    // Simulate a stale global override from an older build.
    root.style.setProperty("--text-primary", "#ff0000");
    applyTextColor("#abc", root);
    expect(root.attrs.get("data-text-color")).toBe("custom");
    expect(root.props.get("--appearance-chrome-ink")).toBe("#aabbcc");
    expect(root.props.has("--text-primary")).toBe(false);
    expect(root.props.has("--text-secondary")).toBe(false);
    expect(root.props.has("--wallpaper-chrome-foreground")).toBe(false);
    applyTextColor(null, root);
    expect(root.attrs.has("data-text-color")).toBe(false);
    expect(root.props.has("--appearance-chrome-ink")).toBe(false);
  });

  it("applyFontShadow toggles data-font-shadow", () => {
    const root = fakeRoot();
    applyFontShadow(true, root);
    expect(root.attrs.get("data-font-shadow")).toBe("1");
    applyFontShadow(false, root);
    expect(root.attrs.has("data-font-shadow")).toBe(false);
  });

  it("reset restores factory chrome", () => {
    const storage = memory();
    const root = fakeRoot();
    saveTextColor("#112233", storage);
    saveFontShadow(true, storage);
    applyAppearanceChrome(loadAppearanceChrome(storage), root);
    const next = resetAppearanceChrome(storage, root);
    expect(next).toEqual({ textColor: null, fontShadow: false });
    expect(isDefaultAppearanceChrome(next)).toBe(true);
    expect(root.attrs.has("data-text-color")).toBe(false);
    expect(root.attrs.has("data-font-shadow")).toBe(false);
  });
});
