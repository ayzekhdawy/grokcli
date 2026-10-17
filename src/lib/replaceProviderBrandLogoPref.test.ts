import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPLACE_PROVIDER_BRAND_LOGO,
  loadReplaceProviderBrandLogoPref,
  parseReplaceProviderBrandLogoPref,
  REPLACE_PROVIDER_BRAND_LOGO_STORAGE_KEY,
  saveReplaceProviderBrandLogoPref,
} from "./replaceProviderBrandLogoPref";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

describe("replaceProviderBrandLogoPref", () => {
  it("defaults off", () => {
    expect(DEFAULT_REPLACE_PROVIDER_BRAND_LOGO).toBe(false);
    expect(parseReplaceProviderBrandLogoPref(null)).toBe(false);
    expect(parseReplaceProviderBrandLogoPref("")).toBe(false);
    expect(parseReplaceProviderBrandLogoPref("nope")).toBe(false);
  });

  it("parses boolean-ish storage values", () => {
    expect(parseReplaceProviderBrandLogoPref("1")).toBe(true);
    expect(parseReplaceProviderBrandLogoPref("true")).toBe(true);
    expect(parseReplaceProviderBrandLogoPref(true)).toBe(true);
    expect(parseReplaceProviderBrandLogoPref("0")).toBe(false);
    expect(parseReplaceProviderBrandLogoPref("false")).toBe(false);
    expect(parseReplaceProviderBrandLogoPref(false)).toBe(false);
  });

  it("round-trips load/save", () => {
    const s = memoryStorage();
    expect(loadReplaceProviderBrandLogoPref(s)).toBe(false);
    saveReplaceProviderBrandLogoPref(true, s);
    expect(s.getItem(REPLACE_PROVIDER_BRAND_LOGO_STORAGE_KEY)).toBe("1");
    expect(loadReplaceProviderBrandLogoPref(s)).toBe(true);
    saveReplaceProviderBrandLogoPref(false, s);
    expect(s.getItem(REPLACE_PROVIDER_BRAND_LOGO_STORAGE_KEY)).toBe("0");
    expect(loadReplaceProviderBrandLogoPref(s)).toBe(false);
  });
});
