import { describe, expect, it } from "vitest";
import {
  CODE_FONT_SCALE_STORAGE_KEY,
  CODE_FONT_SCALES,
  DEFAULT_CODE_FONT_SCALE,
  applyCodeFontScale,
  codeFontScaleVars,
  isCodeFontScale,
  loadCodeFontScale,
  parseCodeFontScale,
  saveCodeFontScale,
  setCodeFontScale,
  type CodeFontScaleStorage,
} from "./codeFontScalePref";

function memoryStorage(
  initial: Record<string, string> = {},
): CodeFontScaleStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

describe("codeFontScalePref", () => {
  it("defaults to md and rejects unknown values", () => {
    expect(DEFAULT_CODE_FONT_SCALE).toBe("md");
    expect(parseCodeFontScale(null)).toBe("md");
    expect(parseCodeFontScale("")).toBe("md");
    expect(parseCodeFontScale("xl")).toBe("md");
    expect(isCodeFontScale("sm")).toBe(true);
    expect(isCodeFontScale("md")).toBe(true);
    expect(isCodeFontScale("lg")).toBe(true);
    expect(isCodeFontScale("xl")).toBe(false);
    expect(CODE_FONT_SCALES).toEqual(["sm", "md", "lg"]);
  });

  it("exposes pixel vars for sm / md / lg", () => {
    expect(codeFontScaleVars("sm")).toEqual({ fs: 11.5 });
    expect(codeFontScaleVars("md")).toEqual({ fs: 12.5 });
    expect(codeFontScaleVars("lg")).toEqual({ fs: 14 });
  });

  it("persists and reloads after simulated relaunch", () => {
    const storage = memoryStorage();
    expect(loadCodeFontScale(storage)).toBe("md");
    saveCodeFontScale("lg", storage);
    expect(storage.data[CODE_FONT_SCALE_STORAGE_KEY]).toBe("lg");
    expect(loadCodeFontScale(storage)).toBe("lg");
    saveCodeFontScale("sm", storage);
    expect(loadCodeFontScale(storage)).toBe("sm");
  });

  it("applyCodeFontScale sets data-code-font", () => {
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    };
    applyCodeFontScale("sm", el);
    expect(attrs.get("data-code-font")).toBe("sm");
    applyCodeFontScale("md", el);
    expect(attrs.get("data-code-font")).toBe("md");
    applyCodeFontScale("lg", el);
    expect(attrs.get("data-code-font")).toBe("lg");
  });

  it("setCodeFontScale saves and applies", () => {
    const storage = memoryStorage();
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    };
    setCodeFontScale("lg", storage, el);
    expect(storage.data[CODE_FONT_SCALE_STORAGE_KEY]).toBe("lg");
    expect(attrs.get("data-code-font")).toBe("lg");
  });
});
