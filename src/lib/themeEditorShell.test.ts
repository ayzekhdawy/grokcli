import { describe, expect, it } from "vitest";
import {
  isThemeEditorDocument,
  isThemeEditorHash,
  readThemeEditorBootLocale,
} from "./themeEditorShell";

describe("isThemeEditorHash", () => {
  it("matches the standalone editor route only", () => {
    expect(isThemeEditorHash("#/theme-editor")).toBe(true);
    expect(isThemeEditorHash("#/theme-editor?")).toBe(true);
    expect(isThemeEditorHash("#/settings/appearance")).toBe(false);
    expect(isThemeEditorHash("#/pet")).toBe(false);
    expect(isThemeEditorHash("")).toBe(false);
  });
});

describe("readThemeEditorBootLocale", () => {
  it("prefers the Host catalog id over html lang (zh-CN is not a catalog id)", () => {
    expect(
      readThemeEditorBootLocale(
        { __GROK_BOOT_LOCALE__: "zh", __GROK_BOOT_OS_LANG__: "en-US" },
        "en",
      ),
    ).toBe("zh");
    expect(
      readThemeEditorBootLocale({ __GROK_BOOT_LOCALE__: "zh-TW" }, "zh-CN"),
    ).toBe("zh-TW");
  });

  it("falls back to html lang aliases when boot locale is missing", () => {
    expect(readThemeEditorBootLocale({}, "zh-CN")).toBe("zh");
    expect(readThemeEditorBootLocale({}, "zh-TW")).toBe("zh-TW");
  });
});

describe("isThemeEditorDocument", () => {
  it("matches the editor hash or Host boot attribute", () => {
    expect(isThemeEditorDocument("#/theme-editor", { hasAttribute: () => false })).toBe(
      true,
    );
    expect(
      isThemeEditorDocument("#/workbench", {
        hasAttribute: (name) => name === "data-theme-editor-shell",
      }),
    ).toBe(true);
    expect(isThemeEditorDocument("#/workbench", { hasAttribute: () => false })).toBe(
      false,
    );
  });
});
