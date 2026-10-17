import { beforeAll, describe, expect, it } from "vitest";
import {
  GROK_APP_SHARE_FOOTER,
  buildShareCardModel,
  buildShareContentParts,
  exportableToShareMessages,
  sessionExportImageFilename,
  shareCardToHtml,
  wrapTextLines,
} from "./sessionExportImage";

describe("sessionExportImageFilename", () => {
  it("builds safe png names", () => {
    expect(sessionExportImageFilename("Fix Doctor Reset!", "abcdef12-xxxx")).toBe(
      "grok-fix-doctor-reset-abcdef12.png",
    );
    expect(sessionExportImageFilename("", null)).toBe("grok-session.png");
  });
});

describe("buildShareCardModel", () => {
  it("drops tools, caps messages, keeps branding footer", () => {
    const model = buildShareCardModel({
      title: "Demo",
      projectName: "app",
      sessionId: "sid-1",
      messages: [
        { role: "user", content: "hi" },
        { role: "tool", content: "tool_step|bash|ok" },
        { role: "assistant", content: "hello", thought: "secret" },
      ],
      includeThoughts: false,
    });
    expect(model.messages).toHaveLength(2);
    expect(model.messages[0]?.role).toBe("user");
    expect(model.messages[1]?.thought).toBeUndefined();
    expect(model.footerText).toBe(GROK_APP_SHARE_FOOTER);
    expect(model.logoDataUrl).toBeNull();
  });

  it("includes thoughts when requested and truncates long bodies", () => {
    const long = "x".repeat(5000);
    const model = buildShareCardModel({
      title: "Long",
      messages: [{ role: "assistant", content: long, thought: "think" }],
      includeThoughts: true,
      maxBodyChars: 100,
    });
    expect(model.messages[0]?.content.length).toBeLessThanOrEqual(100);
    expect(model.messages[0]?.thought).toBe("think");
  });

  it("omits oldest messages when over maxMessages", () => {
    const messages = Array.from({ length: 5 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `m${i}`,
    }));
    const model = buildShareCardModel({
      title: "T",
      messages,
      maxMessages: 2,
    });
    expect(model.messages).toHaveLength(2);
    expect(model.truncatedCount).toBe(3);
    expect(model.messages[0]?.content).toBe("m3");
  });
});

describe("shareCardToHtml", () => {
  it("escapes content and always shows Grok App footer", () => {
    const model = buildShareCardModel({
      title: '<script>alert(1)</script>',
      messages: [{ role: "user", content: "a <b>b</b>" }],
      logoDataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    });
    const html = shareCardToHtml(model);
    expect(html).toContain("Generated with Grok App");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain('class="sc-logo"');
    expect(html).toContain("a &lt;b&gt;b&lt;/b&gt;");
  });

  it("uses mark fallback without logo", () => {
    const model = buildShareCardModel({
      title: "No logo",
      messages: [{ role: "assistant", content: "ok" }],
    });
    const html = shareCardToHtml(model);
    expect(html).toContain("sc-logo--mark");
  });
});

describe("exportableToShareMessages", () => {
  it("maps fields", () => {
    const out = exportableToShareMessages([
      { role: "user", content: "x", thought: "t", createdAt: "1" },
    ]);
    expect(out).toEqual([
      { role: "user", content: "x", thought: "t", createdAt: "1" },
    ]);
  });
});

describe("buildShareContentParts", () => {
  it("extracts backtick + markdown image refs via pathMap", () => {
    const pathMap = {
      "images/1.jpg": "/sess/images/1.jpg",
      "images/2.png": "/sess/images/2.png",
    };
    const parts = buildShareContentParts(
      "封面：\n\n`images/1.jpg`\n\n说明文字\n\n![alt](images/2.png)\n\n结尾",
      pathMap,
    );
    const kinds = parts.map((p) => p.kind);
    expect(kinds).toContain("image");
    expect(kinds).toContain("text");
    const images = parts.filter((p) => p.kind === "image");
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({
      kind: "image",
      path: "/sess/images/1.jpg",
    });
    expect(images[1]).toMatchObject({
      kind: "image",
      path: "/sess/images/2.png",
    });
  });

  it("appends attachment images not already inlined", () => {
    const parts = buildShareContentParts("只有文字", null, [
      {
        path: "/abs/extra.png",
        name: "extra.png",
        isDir: false,
      },
    ]);
    expect(parts.some((p) => p.kind === "image" && p.path === "/abs/extra.png")).toBe(
      true,
    );
  });

  it("keeps absolute image paths without pathMap", () => {
    const abs = "/Users/me/pic.webp";
    const parts = buildShareContentParts(`见 \`${abs}\``, null);
    expect(parts.some((p) => p.kind === "image" && p.path === abs)).toBe(true);
  });
});

describe("wrapTextLines", () => {
  beforeAll(async () => {
    const canvasMod = await import("canvas");
    const { createCanvas } = canvasMod;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (!g.document) {
      g.document = {
        createElement(tag: string) {
          if (tag !== "canvas") throw new Error(`unexpected ${tag}`);
          return createCanvas(8, 8);
        },
      };
    }
  });

  it("breaks long CJK / mixed paragraphs so no line exceeds maxWidth", () => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d");
    const font =
      '13.5px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    const maxW = 200;
    const long =
      "先查深圳未来一周天气，再据此生成动漫风天气卡片。天气数据已齐：未来一周以雷雨为主，周末有暴雨风险。按技 HTML 天气卡片并导出为图片。把动漫画也复制到工作区，方便你直接使用。";
    const lines = wrapTextLines(ctx, long, maxW, font);
    expect(lines.length).toBeGreaterThan(1);
    ctx.font = font;
    for (const line of lines) {
      expect(ctx.measureText(line).width).toBeLessThanOrEqual(maxW + 0.5);
    }
  });

  it("breaks overlong tokens without spaces (URLs)", () => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d");
    const font = "13.5px monospace";
    const maxW = 120;
    const url = "https://example.com/very/long/path/segment/without/spaces/here";
    const lines = wrapTextLines(ctx, url, maxW, font);
    expect(lines.length).toBeGreaterThan(1);
    ctx.font = font;
    for (const line of lines) {
      expect(ctx.measureText(line).width).toBeLessThanOrEqual(maxW + 0.5);
    }
  });
});
