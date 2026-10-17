import { describe, expect, it, beforeEach } from "vitest";
import {
  flushImageAspectCache,
  getImageAspect,
  imageAspectBasenameKey,
  imageAspectCacheKey,
  resetImageAspectCacheForTests,
  setImageAspect,
  type ImageAspectStorage,
} from "./imageAspectCache";

function memStorage(): ImageAspectStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

beforeEach(() => {
  resetImageAspectCacheForTests();
});

describe("imageAspectCacheKey", () => {
  it("prefers absolute path over media URL", () => {
    const path = "/Users/me/out/shot.png";
    const url =
      "http://127.0.0.1:54321/v1/media?t=abc&p=" +
      encodeURIComponent(path);
    expect(imageAspectCacheKey(url, path)).toBe(path);
  });

  it("extracts path from loopback media query", () => {
    const path = "/Users/me/a.jpg";
    const url =
      "http://127.0.0.1:9/v1/media?t=tok&p=" + encodeURIComponent(path);
    expect(imageAspectCacheKey(url)).toBe(path);
  });

  it("normalizes windows backslashes", () => {
    expect(imageAspectCacheKey("C:\\Users\\x\\a.png")).toBe(
      "C:/Users/x/a.png",
    );
  });

  it("keeps %-encoded path segments (agent-home sessions/%2F… dirs) intact", () => {
    // The p= value is already decoded once by URLSearchParams; a second decode
    // would turn `%2F` into `/` and never match the real on-disk path.
    const path =
      "/Users/me/Library/Application Support/app/agent-home/sessions/%2FUsers%2Fme%2Fproj/019f/images/1.jpg";
    const url =
      "http://127.0.0.1:9/v1/media?t=tok&p=" + encodeURIComponent(path);
    expect(imageAspectCacheKey(url)).toBe(path);
  });

  it("fused t:/… query keys are not treated as local cache keys", () => {
    expect(imageAspectCacheKey("t:/Users/me/pic.png")).toBe(
      "t:/Users/me/pic.png",
    );
  });
});

describe("get/setImageAspect", () => {
  it("returns null when empty", () => {
    const s = memStorage();
    expect(getImageAspect("/nope.png", undefined, s)).toBeNull();
  });

  it("stores and reads by path; media URL hits same entry", () => {
    const s = memStorage();
    const path = "/Users/me/img.png";
    setImageAspect(path, path, 1.5, [], s);
    flushImageAspectCache(s);
    expect(getImageAspect(path, path, s)).toBeCloseTo(1.5);
    const url =
      "http://127.0.0.1:1/v1/media?t=x&p=" + encodeURIComponent(path);
    expect(getImageAspect(url, undefined, s)).toBeCloseTo(1.5);
  });

  it("survives rehydrate from storage", () => {
    const s = memStorage();
    const path = "/tmp/x.webp";
    setImageAspect(path, path, 0.75, [], s);
    flushImageAspectCache(s);
    resetImageAspectCacheForTests();
    expect(getImageAspect(path, path, s)).toBeCloseTo(0.75);
  });

  it("ignores invalid ratios", () => {
    const s = memStorage();
    setImageAspect("/a.png", "/a.png", 0, [], s);
    setImageAspect("/a.png", "/a.png", NaN, [], s);
    expect(getImageAspect("/a.png", "/a.png", s)).toBeNull();
  });

  it("stores a basename alias so tick citations hit the same occupancy box", () => {
    const s = memStorage();
    const path = "/Users/ronglecat/Documents/workspace/grok/puppy-soda-pixel.png";
    setImageAspect(path, path, 1.2, [], s);
    flushImageAspectCache(s);
    expect(imageAspectBasenameKey(path)).toBe("bn:puppy-soda-pixel.png");
    expect(getImageAspect("puppy-soda-pixel.png", undefined, s)).toBeCloseTo(
      1.2,
    );
    expect(
      getImageAspect("puppy-soda-pixel.png", "puppy-soda-pixel.png", s),
    ).toBeCloseTo(1.2);
  });
});
