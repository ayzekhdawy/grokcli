/**
 * Pipeline e2e: drives the shipped export path
 * messages → buildExportImagePipeline → PNG Blob.
 *
 * Installs node-canvas as document.createElement('canvas') so the real
 * rasterize* functions run (not a reimplementation).
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildExportImagePipeline,
  buildShareCardModel,
  exportableToShareMessages,
  GROK_APP_SHARE_FOOTER,
} from "./sessionExportImage";
import {
  buildSmartShareSummary,
  buildThemeFromContent,
} from "./shareCardSmart";

const FIXTURE_MESSAGES = exportableToShareMessages([
  {
    role: "user",
    content: "请整理本周要点，并给一句总结。",
    createdAt: "2026-07-30T10:00:00Z",
  },
  {
    role: "assistant",
    content: [
      "# 本周进展",
      "",
      "- 完成导出分享卡片预览",
      "- 修复跨会话串图问题",
      "- 补充 pipeline e2e 测试",
      "",
      "**一句话：** 先把导出链路做稳，再谈花样。",
    ].join("\n"),
    createdAt: "2026-07-30T10:01:00Z",
  },
  {
    role: "user",
    content: "再补一条风险说明",
    createdAt: "2026-07-30T10:02:00Z",
  },
  {
    role: "assistant",
    content: "- 风险：Tauri WebView 下载需走原生保存对话框",
    createdAt: "2026-07-30T10:03:00Z",
  },
]);

async function installCanvasPolyfill() {
  const canvasMod = await import("canvas");
  const { createCanvas, Image } = canvasMod;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;

  if (typeof g.Blob === "undefined") {
    throw new Error("Blob global required for pipeline e2e");
  }

  /** Attach browser-like toBlob using node-canvas toBuffer. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function patchToBlob(c: any) {
    if (typeof c.toBlob === "function") return c;
    c.toBlob = (cb: (b: Blob | null) => void, type = "image/png") => {
      try {
        const buf: Buffer = c.toBuffer("image/png");
        const copy = Uint8Array.from(buf);
        cb(new Blob([copy], { type: type || "image/png" }));
      } catch {
        cb(null);
      }
    };
    return c;
  }

  g.document = {
    createElement(tag: string) {
      if (tag !== "canvas") {
        throw new Error(`unexpected createElement(${tag})`);
      }
      const c = createCanvas(8, 8);
      return patchToBlob(c);
    },
  };
  g.Image = Image;
}

describe("export image pipeline e2e (shipped)", () => {
  beforeAll(async () => {
    await installCanvasPolyfill();
  });

  it("smart path: curated skin + non-empty PNG blob", async () => {
    const summary = buildSmartShareSummary({
      title: "周报整理",
      messages: FIXTURE_MESSAGES,
      skinId: "noir",
    });
    expect(summary.bullets.length).toBeGreaterThan(0);
    expect(summary.headline).toBeTruthy();
    expect((summary.theme as { id?: string }).id).toBeUndefined();
    expect(["editorial", "stack", "compact"]).toContain(summary.theme.layout);
    expect(summary.theme.skinId).toBe("noir");
    expect(summary.theme.bg0).toMatch(/^#/);

    const result = await buildExportImagePipeline({
      title: "周报整理",
      sessionId: "sess-e2e-001",
      messages: FIXTURE_MESSAGES,
      smart: true,
      skinId: "noir",
      pixelRatio: 1,
    });
    expect(result.mode).toBe("smart");
    expect(result.skinId).toBe("noir");
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.byteLength).toBeGreaterThanOrEqual(1024);
    const buf = new Uint8Array(await result.blob.arrayBuffer());
    expect(Array.from(buf.slice(0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    expect(result.layout).toBeTruthy();
    expect(result.bulletCount).toBeGreaterThan(0);
  });

  it("full path: transcript model + non-empty PNG blob", async () => {
    const model = buildShareCardModel({
      title: "周报整理",
      sessionId: "sess-e2e-001",
      messages: FIXTURE_MESSAGES,
      includeThoughts: false,
    });
    expect(model.messages.length).toBeGreaterThanOrEqual(3);
    expect(model.footerText).toBe(GROK_APP_SHARE_FOOTER);

    const result = await buildExportImagePipeline({
      title: "周报整理",
      projectName: "grok-app",
      sessionId: "sess-e2e-001",
      messages: FIXTURE_MESSAGES,
      smart: false,
      skinId: "paper",
      pixelRatio: 1,
    });
    expect(result.mode).toBe("full");
    expect(result.skinId).toBe("paper");
    expect(result.byteLength).toBeGreaterThanOrEqual(1024);
    const buf = new Uint8Array(await result.blob.arrayBuffer());
    expect(Array.from(buf.slice(0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    expect(result.messageCount).toBeGreaterThanOrEqual(3);
  }, 15_000);

  it("empty conversation throws empty code", async () => {
    await expect(
      buildExportImagePipeline({
        title: "空",
        messages: [],
        smart: false,
      }),
    ).rejects.toMatchObject({ message: "empty" });
  });

  it("seed tracks content; palette tracks skin (not domain buckets)", () => {
    const a = buildThemeFromContent(
      "A",
      "alpha unique seed corpus one two three",
      0,
      "terminal",
    );
    const b = buildThemeFromContent(
      "B",
      "completely different words for another hash",
      0,
      "terminal",
    );
    const c = buildThemeFromContent("C", "same skin other", 0, "rose");
    expect(a.seed).not.toBe(b.seed);
    expect(a.skinId).toBe("terminal");
    expect(a.bg0).toBe(b.bg0);
    expect(c.skinId).toBe("rose");
    expect(c.bg0).not.toBe(a.bg0);
  });
});
