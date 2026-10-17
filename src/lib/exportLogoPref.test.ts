import { describe, expect, it } from "vitest";
import {
  EXPORT_LOGO_STORAGE_KEY,
  isExportLogoDataUrl,
  loadExportLogoPref,
  parseExportLogoPref,
  saveExportLogoPref,
} from "./exportLogoPref";

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("isExportLogoDataUrl", () => {
  it("accepts png/jpeg/webp/svg data URLs", () => {
    expect(isExportLogoDataUrl(tinyPng)).toBe(true);
    expect(isExportLogoDataUrl("data:image/jpeg;base64,abc")).toBe(true);
    expect(isExportLogoDataUrl("data:image/webp;base64,abc")).toBe(true);
    expect(isExportLogoDataUrl("data:image/svg+xml;base64,abc")).toBe(true);
  });

  it("rejects non-images and empty", () => {
    expect(isExportLogoDataUrl("")).toBe(false);
    expect(isExportLogoDataUrl("https://example.com/x.png")).toBe(false);
    expect(isExportLogoDataUrl("data:text/plain;base64,abc")).toBe(false);
    expect(isExportLogoDataUrl(null)).toBe(false);
  });
});

describe("parseExportLogoPref / load / save", () => {
  it("parses valid data URLs", () => {
    expect(parseExportLogoPref(tinyPng)).toBe(tinyPng);
    expect(parseExportLogoPref("  ")).toBeNull();
    expect(parseExportLogoPref("not-a-url")).toBeNull();
  });

  it("round-trips through storage", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    };
    expect(loadExportLogoPref(storage)).toBeNull();
    saveExportLogoPref(tinyPng, storage);
    expect(map.get(EXPORT_LOGO_STORAGE_KEY)).toBe(tinyPng);
    expect(loadExportLogoPref(storage)).toBe(tinyPng);
    saveExportLogoPref(null, storage);
    expect(map.has(EXPORT_LOGO_STORAGE_KEY)).toBe(false);
    expect(loadExportLogoPref(storage)).toBeNull();
  });
});
