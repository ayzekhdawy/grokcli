/**
 * Settings → Account → Providers: left rail must scroll when many channels exist.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  resolve(__dirname, "../components/SettingsPage.tsx"),
  "utf8",
);
const panel = readFileSync(
  resolve(__dirname, "../components/ProvidersPanel.tsx"),
  "utf8",
);
const part1 = readFileSync(
  resolve(__dirname, "../styles/composer.part1.css"),
  "utf8",
);
const part2 = readFileSync(
  resolve(__dirname, "../styles/composer.part2.css"),
  "utf8",
);
const part3 = readFileSync(
  resolve(__dirname, "../styles/composer.part3.css"),
  "utf8",
);

describe("providers panel dual-pane scroll", () => {
  it("locks the settings page to pane-fill on the providers tab", () => {
    expect(page).toMatch(/providersPaneFill[\s\S]*section === "account"/);
    expect(page).toMatch(/activeTab === "providers"/);
    expect(page).toContain("settings-page__content--pane-fill");
    expect(page).toContain("settings-page__main--pane-fill");
  });

  it("keeps add/import above an independent OverlayScroll rail", () => {
    const split = panel.indexOf('className="prov-split"');
    const list = panel.indexOf('className="prov-split__list"');
    const actions = panel.indexOf("prov-list-actions");
    const rail = panel.indexOf('className="prov-rail"');
    const overlay = panel.indexOf("<OverlayScroll");
    const detail = panel.indexOf('className="prov-split__detail"');
    expect(split).toBeGreaterThanOrEqual(0);
    expect(list).toBeGreaterThan(split);
    expect(actions).toBeGreaterThan(list);
    expect(overlay).toBeGreaterThan(actions);
    expect(rail).toBeGreaterThan(overlay);
    expect(detail).toBeGreaterThan(rail);
    expect(panel).toContain('className="prov-rail__items"');
  });

  it("caps the pane-fill grid row so the left rail can overflow-y", () => {
    expect(part1).toMatch(
      /\.settings-page__main--pane-fill\s*>\s*\.prov-panel\s*\{[^}]*overflow:\s*hidden/s,
    );
    expect(part1).toMatch(
      /\.settings-page__main--pane-fill\s*>\s*\.prov-panel\s*\{[^}]*flex:\s*1 1 0%/s,
    );
    expect(part1).toMatch(
      /@media \(min-width:\s*861px\)\s*\{[^}]*\.settings-page__main--pane-fill \.prov-split\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/s,
    );
    expect(part2).toMatch(
      /\.prov-rail\.overlay-scroll\s*\{[^}]*flex:\s*1 1 auto/s,
    );
    expect(part2).toMatch(
      /\.prov-rail \.overlay-scroll__viewport\s*\{[^}]*overscroll-behavior:\s*contain/s,
    );
    expect(part2).toMatch(
      /\.prov-split__detail\.overlay-scroll\s*\{[^}]*min-height:\s*0/s,
    );
    expect(panel.match(/<OverlayScroll/g)?.length).toBe(2);
    expect(part3).toMatch(
      /@media \(max-width:\s*860px\)\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*40%\) minmax\(0,\s*1fr\)/s,
    );
  });
});
