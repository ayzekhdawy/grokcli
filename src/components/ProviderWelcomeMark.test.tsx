import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DeepSeekFullMark,
  OpenCodeWordmark,
  VolcanoArkWelcomeMark,
  ZhipuWelcomeMark,
} from "./ProviderWelcomeMark";

describe("DeepSeekFullMark", () => {
  it("renders the full wordmark with theme-aware ink class", () => {
    const html = renderToStaticMarkup(<DeepSeekFullMark />);
    expect(html).toContain("deepseek-full-mark");
    expect(html).toContain("deepseek-full-mark__ink");
    // 9 wordmark text paths + 1 whale mark path.
    expect(html.match(/class="deepseek-full-mark__ink"/g)?.length).toBe(10);
    // No hardcoded fill in the rendered tree — CSS drives light/dark.
    expect(html).not.toContain("#4D6BFE");
  });

  it("carries an accessible label", () => {
    const html = renderToStaticMarkup(
      <DeepSeekFullMark title="DeepSeek" />,
    );
    expect(html).toContain("<title>DeepSeek</title>");
  });
});

describe("OpenCodeWordmark", () => {
  it("renders the simple monochrome wordmark via currentColor", () => {
    const html = renderToStaticMarkup(<OpenCodeWordmark />);
    // Single-color art — CSS `color` drives black (light) / white (dark).
    expect(html).toContain("opencode-wordmark");
    expect(html.match(/<path /g)?.length).toBe(8);
    expect(html).toContain('fill="currentColor"');
    // No hardcoded black/white in the rendered tree.
    expect(html).not.toContain("#000000");
    expect(html).not.toContain("#ffffff");
    expect(html).not.toContain("#CFCECD");
    expect(html).not.toContain("#4B4646");
  });

  it("carries an accessible label", () => {
    const html = renderToStaticMarkup(<OpenCodeWordmark title="OpenCode" />);
    expect(html).toContain("<title>OpenCode</title>");
  });
});

describe("VolcanoArkWelcomeMark", () => {
  it("renders brand icon plus 火山方舟 label", () => {
    const html = renderToStaticMarkup(<VolcanoArkWelcomeMark />);
    expect(html).toContain("volcano-ark-welcome-mark");
    expect(html).toContain("volcano-ark-welcome-mark__text");
    expect(html).toContain("火山方舟");
    expect(html).toContain("provider-brand-icon--volcano-ark");
    expect(html).toContain("#00DCFF");
    expect(html).toContain("#006AFF");
  });

  it("carries an accessible label", () => {
    const html = renderToStaticMarkup(
      <VolcanoArkWelcomeMark title="火山方舟" />,
    );
    expect(html).toContain('aria-label="火山方舟"');
  });
});

describe("ZhipuWelcomeMark", () => {
  it("renders brand icon plus 智谱 label", () => {
    const html = renderToStaticMarkup(<ZhipuWelcomeMark />);
    expect(html).toContain("zhipu-welcome-mark");
    expect(html).toContain("zhipu-welcome-mark__text");
    expect(html).toContain("智谱");
    expect(html).toContain("provider-brand-icon--zhipu");
    expect(html).toContain("zhipu-mark__tile");
    expect(html).toContain("zhipu-mark__z");
  });

  it("carries an accessible label", () => {
    const html = renderToStaticMarkup(<ZhipuWelcomeMark title="智谱" />);
    expect(html).toContain('aria-label="智谱"');
  });
});
