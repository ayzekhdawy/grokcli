import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APPEARANCE_CHANGED_EVENT } from "./appearanceLiveSync";

describe("appearance live sync", () => {
  it("uses a stable cross-window event name", () => {
    expect(APPEARANCE_CHANGED_EVENT).toBe("grok://appearance-changed");
  });

  it("is wired from ThemeProvider apply paths", () => {
    const src = readFileSync(
      resolve(__dirname, "../providers/ThemeProvider.tsx"),
      "utf8",
    );
    expect(src).toContain("notifyAppearanceChanged");
    expect(src).toContain("subscribeAppearanceChanged");
    expect(src).toContain("hydrateDocumentAppearancePrefs");
  });
});
