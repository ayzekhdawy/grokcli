import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProviderBrandIcon } from "./ProviderBrandIcon";

const composerCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../styles/composer.part2b.css"),
  "utf8",
);

describe("ProviderBrandIcon", () => {
  it("renders OpenRouter with currentColor so CSS can switch light/dark", () => {
    const html = renderToStaticMarkup(
      <ProviderBrandIcon brand="openrouter" title="OpenRouter" />,
    );
    expect(html).toContain("provider-brand-icon--openrouter");
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain("<title>OpenRouter</title>");
    expect(html).not.toContain("#7624F4");
    expect(html).not.toContain("#7624f4");
  });

  it("renders Zhipu with theme classes (no hardcoded fills)", () => {
    const html = renderToStaticMarkup(
      <ProviderBrandIcon brand="zhipu" title="智谱" />,
    );
    expect(html).toContain("provider-brand-icon--zhipu");
    expect(html).toContain("zhipu-mark__tile");
    expect(html).toContain("zhipu-mark__z");
    expect(html).toContain("<title>智谱</title>");
    expect(html).not.toContain("#2D2D2D");
    expect(html).not.toContain("#2d2d2d");
    expect(html).not.toContain("#FFFFFF");
    expect(html).not.toContain("#ffffff");
  });

  it("inverts the official Zhipu tile in dark theme CSS", () => {
    expect(composerCss).toMatch(
      /\.provider-brand-icon--zhipu \.zhipu-mark__tile\s*\{[^}]*fill:\s*#2d2d2d/s,
    );
    expect(composerCss).toMatch(
      /\.provider-brand-icon--zhipu \.zhipu-mark__z\s*\{[^}]*fill:\s*#ffffff/s,
    );
    expect(composerCss).toMatch(
      /\[data-theme="dark"\] \.provider-brand-icon--zhipu \.zhipu-mark__tile\s*\{[^}]*fill:\s*#ffffff/s,
    );
    expect(composerCss).toMatch(
      /\[data-theme="dark"\] \.provider-brand-icon--zhipu \.zhipu-mark__z\s*\{[^}]*fill:\s*#2d2d2d/s,
    );
  });
});
