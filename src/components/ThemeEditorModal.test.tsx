/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const modal = readFileSync(
  resolve(__dirname, "./ThemeEditorModal.tsx"),
  "utf8",
);
const userMenu = readFileSync(resolve(__dirname, "./UserMenu.tsx"), "utf8");
const section = readFileSync(
  resolve(__dirname, "./settings/AppearanceSection.tsx"),
  "utf8",
);

describe("theme editor popup", () => {
  it("reuses AppearanceSection and omits the settings page title", () => {
    expect(modal).toContain("<AppearanceSection");
    expect(modal).toContain("theme-editor__title");
    expect(modal).not.toContain("settings-page__title");
    expect(section).toContain("SettingsTabStrip");
  });

  it("groups the theme editor action at the bottom of the theme flyout", () => {
    const flyout = userMenu.indexOf("THEME_OPTIONS.map");
    const sep = userMenu.indexOf("user-menu__flyout-sep");
    const action = userMenu.indexOf("onThemeEditor()");
    expect(flyout).toBeGreaterThanOrEqual(0);
    expect(sep).toBeGreaterThan(flyout);
    expect(action).toBeGreaterThan(sep);
  });
});
