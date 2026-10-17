import { describe, expect, it } from "vitest";
import {
  analyzeContentStructure,
  buildSmartShareSummary,
  buildThemeFromContent,
  contentSeed,
  stripMarkdownLite,
} from "./shareCardSmart";
import { DEFAULT_SHARE_CARD_SKIN, SHARE_CARD_SKIN_IDS } from "./shareCardSkins";

describe("contentSeed", () => {
  it("is stable and in [0,1)", () => {
    const a = contentSeed("hello");
    const b = contentSeed("hello");
    const c = contentSeed("world");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(a).not.toBe(c);
  });
});

describe("analyzeContentStructure", () => {
  it("detects list-heavy structure without domain keywords", () => {
    const st = analyzeContentStructure(
      "# Title\n- one item here\n- two item here\n- three item here\n- four",
    );
    expect(st.listRatio).toBeGreaterThan(0.4);
    expect(st.headingRatio).toBeGreaterThan(0);
  });

  it("detects code fences", () => {
    const st = analyzeContentStructure("```\nconst x = 1\nconst y = 2\n```\nplain");
    expect(st.codeRatio).toBeGreaterThan(0.2);
  });
});

describe("buildThemeFromContent", () => {
  it("uses curated skin palette (not content-hash HSL rainbow)", () => {
    const a = buildThemeFromContent("A", "alpha beta gamma unique seed text one");
    const b = buildThemeFromContent(
      "B",
      "totally different corpus for another seed",
    );
    expect(a.skinId).toBe(DEFAULT_SHARE_CARD_SKIN);
    expect(a.bg0).toMatch(/^#|^rgba?\(/);
    expect(a.accent).toMatch(/^#|^rgba?\(/);
    expect(["editorial", "stack", "compact"]).toContain(a.layout);
    // Seed still tracks content; palette is skin-fixed.
    expect(a.seed).not.toBe(b.seed);
    expect(a.bg0).toBe(b.bg0);
  });

  it("applies each curated skin id", () => {
    for (const id of SHARE_CARD_SKIN_IDS) {
      const theme = buildThemeFromContent("T", "content", 3, id);
      expect(theme.skinId).toBe(id);
      expect(theme.badgeText.length).toBeGreaterThan(0);
    }
  });

  it("prefers stack layout for list-heavy text", () => {
    const lists = Array.from({ length: 12 }, (_, i) => `- bullet number ${i} detail`).join(
      "\n",
    );
    const theme = buildThemeFromContent("Notes", lists, 8);
    expect(theme.layout).toBe("stack");
  });
});

describe("buildSmartShareSummary", () => {
  it("extracts structure-based bullets for any topic", () => {
    const summary = buildSmartShareSummary({
      title: "任意主题讨论",
      messages: [
        { role: "user", content: "帮我整理要点" },
        {
          role: "assistant",
          content:
            "# 方案\n\n- 第一要点说明\n- 第二要点说明\n- 第三要点说明\n\n**一句话：** 先做结构再谈细节。",
        },
      ],
      skinId: "paper",
    });
    expect(summary.headline).toBeTruthy();
    expect(summary.bullets.length).toBeGreaterThan(0);
    expect(summary.theme.badgeText).toBe("PAPER");
    expect(summary.theme.skinId).toBe("paper");
    // no domain id field
    expect((summary as { themeId?: string }).themeId).toBeUndefined();
  });

  it("strips markdown noise", () => {
    expect(stripMarkdownLite("**hello** world")).toBe("hello world");
  });
});
