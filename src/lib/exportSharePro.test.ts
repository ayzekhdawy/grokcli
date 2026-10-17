import { describe, expect, it } from "vitest";
import {
  buildExportImageMetaParts,
  canExportImageActions,
  classifyExportImageError,
  deriveExportImagePreviewPhase,
  exportImageBlobMatchesOptions,
  exportImageErrorMessageKey,
  exportImageErrorSilent,
  exportImageModeMessageKey,
  formatExportImageBytes,
  normalizeExportImageSkinId,
  resolveExportImageError,
  shareCardLayoutMessageKey,
  shareCardSkinMessageKey,
  stampFromPipelineResult,
  type ExportImageBlobStamp,
} from "./exportSharePro";
import { DEFAULT_SHARE_CARD_SKIN, SHARE_CARD_SKIN_IDS } from "./shareCardSkins";

describe("classifyExportImageError", () => {
  it("maps empty pipeline codes and messages", () => {
    const empty = new Error("empty");
    (empty as Error & { code?: string }).code = "empty";
    expect(classifyExportImageError(empty)).toBe("empty");
    expect(classifyExportImageError(new Error("empty"))).toBe("empty");
    expect(classifyExportImageError("Error: empty")).toBe("empty");
  });

  it("maps rasterize / small blob / clipboard / cancel / save", () => {
    expect(
      classifyExportImageError(new Error("smart rasterize produced empty/small blob")),
    ).toBe("blob_small");
    expect(classifyExportImageError(new Error("toBlob failed"))).toBe("rasterize");
    expect(classifyExportImageError(new Error("clipboard blocked"))).toBe(
      "clipboard",
    );
    expect(classifyExportImageError(new Error("User cancelled"))).toBe("cancelled");
    expect(classifyExportImageError(new Error("save failed"))).toBe("save_failed");
    expect(classifyExportImageError(new Error("session not found"))).toBe(
      "load_failed",
    );
  });

  it("falls back to other without inventing success", () => {
    expect(classifyExportImageError(new Error("weird host boom"))).toBe("other");
    expect(classifyExportImageError(null)).toBe("other");
  });
});

describe("exportImageErrorMessageKey / silent", () => {
  it("uses specific keys; cancel is silent", () => {
    expect(exportImageErrorMessageKey("empty")).toBe("session.exportImageEmpty");
    expect(exportImageErrorMessageKey("rasterize")).toBe(
      "session.exportImageRasterFail",
    );
    expect(exportImageErrorMessageKey("clipboard")).toBe(
      "session.exportImageClipboardFail",
    );
    expect(exportImageErrorSilent("cancelled")).toBe(true);
    expect(exportImageErrorSilent("empty")).toBe(false);
  });

  it("resolveExportImageError hides detail for known kinds", () => {
    const r = resolveExportImageError(new Error("empty"));
    expect(r.kind).toBe("empty");
    expect(r.messageKey).toBe("session.exportImageEmpty");
    expect(r.detail).toBe("");
    const other = resolveExportImageError(new Error("host xyz"));
    expect(other.kind).toBe("other");
    expect(other.detail).toContain("host xyz");
  });
});

describe("deriveExportImagePreviewPhase", () => {
  it("is honest about closed / rendering / ready / error", () => {
    expect(
      deriveExportImagePreviewPhase({
        open: false,
        busy: true,
        hasPreviewUrl: true,
        hasError: false,
      }),
    ).toBe("closed");
    expect(
      deriveExportImagePreviewPhase({
        open: true,
        busy: true,
        hasPreviewUrl: false,
        hasError: false,
      }),
    ).toBe("rendering");
    expect(
      deriveExportImagePreviewPhase({
        open: true,
        busy: false,
        hasPreviewUrl: true,
        hasError: false,
      }),
    ).toBe("ready");
    expect(
      deriveExportImagePreviewPhase({
        open: true,
        busy: false,
        hasPreviewUrl: false,
        hasError: true,
      }),
    ).toBe("error");
    // URL present → ready even if an old error flag lingered
    expect(
      deriveExportImagePreviewPhase({
        open: true,
        busy: false,
        hasPreviewUrl: true,
        hasError: true,
      }),
    ).toBe("ready");
    expect(
      deriveExportImagePreviewPhase({
        open: true,
        busy: false,
        hasPreviewUrl: false,
        hasError: false,
      }),
    ).toBe("idle");
  });
});

describe("exportImageBlobMatchesOptions / canExportImageActions", () => {
  const stamp: ExportImageBlobStamp = {
    sessionId: "s1",
    skinId: "noir",
    smart: true,
    mode: "smart",
    layout: "stack",
    byteLength: 4096,
    messageCount: 4,
  };

  it("requires session + skin + smart + size", () => {
    expect(
      exportImageBlobMatchesOptions(stamp, {
        sessionId: "s1",
        skinId: "noir",
        smart: true,
      }),
    ).toBe(true);
    expect(
      exportImageBlobMatchesOptions(stamp, {
        sessionId: "s2",
        skinId: "noir",
        smart: true,
      }),
    ).toBe(false);
    expect(
      exportImageBlobMatchesOptions(stamp, {
        sessionId: "s1",
        skinId: "paper",
        smart: true,
      }),
    ).toBe(false);
    expect(
      exportImageBlobMatchesOptions(stamp, {
        sessionId: "s1",
        skinId: "noir",
        smart: false,
      }),
    ).toBe(false);
    expect(
      exportImageBlobMatchesOptions(
        { ...stamp, byteLength: 10 },
        { sessionId: "s1", skinId: "noir", smart: true },
      ),
    ).toBe(false);
    expect(
      exportImageBlobMatchesOptions(null, {
        sessionId: "s1",
        skinId: "noir",
        smart: true,
      }),
    ).toBe(false);
  });

  it("actions only when open + matching blob", () => {
    expect(
      canExportImageActions({ open: true, hasMatchingBlob: true }),
    ).toBe(true);
    expect(
      canExportImageActions({ open: true, hasMatchingBlob: false }),
    ).toBe(false);
    expect(
      canExportImageActions({ open: false, hasMatchingBlob: true }),
    ).toBe(false);
  });
});

describe("skin / layout / mode keys", () => {
  it("maps every curated skin id", () => {
    for (const id of SHARE_CARD_SKIN_IDS) {
      expect(shareCardSkinMessageKey(id)).toBe(`session.exportImageSkin.${id}`);
    }
    expect(normalizeExportImageSkinId("nope")).toBe(DEFAULT_SHARE_CARD_SKIN);
    expect(shareCardSkinMessageKey("bogus")).toBe(
      `session.exportImageSkin.${DEFAULT_SHARE_CARD_SKIN}`,
    );
  });

  it("maps known layouts only", () => {
    expect(shareCardLayoutMessageKey("editorial")).toBe(
      "session.exportImageLayout.editorial",
    );
    expect(shareCardLayoutMessageKey("stack")).toBe(
      "session.exportImageLayout.stack",
    );
    expect(shareCardLayoutMessageKey("compact")).toBe(
      "session.exportImageLayout.compact",
    );
    expect(shareCardLayoutMessageKey("fitness")).toBeNull();
    expect(shareCardLayoutMessageKey(null)).toBeNull();
  });

  it("mode keys", () => {
    expect(exportImageModeMessageKey("smart")).toBe(
      "session.exportImageMode.smart",
    );
    expect(exportImageModeMessageKey(false)).toBe("session.exportImageMode.full");
  });
});

describe("stampFromPipelineResult / meta parts / bytes", () => {
  it("stamps pipeline result for dialog options", () => {
    const stamp = stampFromPipelineResult(
      { sessionId: "abc", skinId: "rose", smart: true },
      {
        skinId: "rose",
        mode: "smart",
        layout: "editorial",
        byteLength: 12_000,
        messageCount: 3,
      },
    );
    expect(stamp).toEqual({
      sessionId: "abc",
      skinId: "rose",
      smart: true,
      mode: "smart",
      layout: "editorial",
      byteLength: 12_000,
      messageCount: 3,
    });
    const meta = buildExportImageMetaParts({ stamp });
    expect(meta.modeKey).toBe("session.exportImageMode.smart");
    expect(meta.skinKey).toBe("session.exportImageSkin.rose");
    expect(meta.layoutKey).toBe("session.exportImageLayout.editorial");
  });

  it("full mode drops layout chip", () => {
    const stamp = stampFromPipelineResult(
      { sessionId: "x", skinId: "paper", smart: false },
      { mode: "full", layout: "stack", byteLength: 2000, messageCount: 5 },
    );
    const meta = buildExportImageMetaParts({ stamp });
    expect(meta.mode).toBe("full");
    expect(meta.layoutKey).toBeNull();
  });

  it("formats bytes honestly", () => {
    expect(formatExportImageBytes(null)).toBeNull();
    expect(formatExportImageBytes(500)).toBe("500 B");
    expect(formatExportImageBytes(2048)).toMatch(/KB/);
    expect(formatExportImageBytes(3 * 1024 * 1024)).toMatch(/MB/);
  });
});
