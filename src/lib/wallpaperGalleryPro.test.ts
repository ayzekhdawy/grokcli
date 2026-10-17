import { describe, expect, it } from "vitest";
import {
  classifyWallpaperGalleryError,
  countGalleryByKind,
  filterGalleryItems,
  galleryKindBucket,
  isWallpaperGallerySoftFail,
  resolveWallpaperGalleryEmptyState,
  wallpaperGalleryErrorHintKey,
  wallpaperGalleryErrorTitleKey,
  wallpaperGalleryHasActiveFilters,
  wallpaperGalleryKindFilterLabelKey,
  WALLPAPER_GALLERY_ERROR_KINDS,
  WALLPAPER_GALLERY_KIND_FILTERS,
  type WallpaperGalleryItemLike,
} from "./wallpaperGalleryPro";

function item(
  partial: Partial<WallpaperGalleryItemLike> &
    Pick<WallpaperGalleryItemLike, "kind"> & { id?: string },
): WallpaperGalleryItemLike & { id: string } {
  return {
    id: partial.id ?? "1",
    kind: partial.kind,
    source: partial.source ?? "x",
    username: partial.username ?? null,
    textPreview: partial.textPreview ?? null,
    prompt: partial.prompt ?? null,
    fullUrl: partial.fullUrl ?? "https://pbs.twimg.com/media/a.jpg",
    thumbUrl: partial.thumbUrl ?? partial.fullUrl ?? "https://pbs.twimg.com/media/a.jpg",
    localPath: partial.localPath ?? null,
    postUrl: partial.postUrl ?? null,
  };
}

describe("classifyWallpaperGalleryError", () => {
  it("maps explicit codes", () => {
    expect(classifyWallpaperGalleryError({ code: "network" })).toBe("network");
    expect(classifyWallpaperGalleryError({ code: "search_failed" })).toBe(
      "network",
    );
    expect(classifyWallpaperGalleryError({ code: "timeout" })).toBe("network");
    expect(classifyWallpaperGalleryError({ code: "download_failed" })).toBe(
      "network",
    );
    expect(classifyWallpaperGalleryError({ code: "cli_missing" })).toBe("host");
    expect(classifyWallpaperGalleryError({ code: "host_only" })).toBe("host");
    expect(classifyWallpaperGalleryError({ code: "desktop_only" })).toBe(
      "host",
    );
    expect(classifyWallpaperGalleryError({ code: "url_blocked" })).toBe(
      "untrusted",
    );
    expect(classifyWallpaperGalleryError({ code: "untrusted" })).toBe(
      "untrusted",
    );
    expect(classifyWallpaperGalleryError({ code: "empty" })).toBe("empty");
    expect(classifyWallpaperGalleryError({ code: "auth_required" })).toBe(
      "other",
    );
    expect(classifyWallpaperGalleryError({ errorCode: "imagine_failed" })).toBe(
      "other",
    );
  });

  it("maps free-form host strings", () => {
    expect(classifyWallpaperGalleryError("search_failed: boom")).toBe(
      "network",
    );
    expect(classifyWallpaperGalleryError("download_failed: HTTP 403")).toBe(
      "network",
    );
    expect(classifyWallpaperGalleryError(new Error("timed out"))).toBe(
      "network",
    );
    expect(classifyWallpaperGalleryError("cli_missing")).toBe("host");
    expect(
      classifyWallpaperGalleryError("Wallpaper search requires the desktop app"),
    ).toBe("host");
    expect(classifyWallpaperGalleryError("url_blocked: evil.com")).toBe(
      "untrusted",
    );
    expect(classifyWallpaperGalleryError("path not allowed")).toBe("untrusted");
    expect(classifyWallpaperGalleryError("empty")).toBe("empty");
    expect(classifyWallpaperGalleryError("No images found")).toBe("empty");
    expect(classifyWallpaperGalleryError("auth_required")).toBe("other");
    expect(classifyWallpaperGalleryError("weird boom")).toBe("other");
    expect(classifyWallpaperGalleryError(null)).toBe("other");
    expect(classifyWallpaperGalleryError("")).toBe("other");
  });

  it("maps every kind to title + hint keys", () => {
    for (const kind of WALLPAPER_GALLERY_ERROR_KINDS) {
      expect(wallpaperGalleryErrorTitleKey(kind)).toMatch(
        /^settings\.wallpaperSource\.errKind\./,
      );
      expect(wallpaperGalleryErrorHintKey(kind)).toMatch(
        /^settings\.wallpaperSource\.errKind\.hint\./,
      );
    }
  });

  it("soft-fails host / empty / untrusted only", () => {
    expect(isWallpaperGallerySoftFail("host")).toBe(true);
    expect(isWallpaperGallerySoftFail("empty")).toBe(true);
    expect(isWallpaperGallerySoftFail("untrusted")).toBe(true);
    expect(isWallpaperGallerySoftFail("network")).toBe(false);
    expect(isWallpaperGallerySoftFail("other")).toBe(false);
  });
});

describe("countGalleryByKind / galleryKindBucket", () => {
  it("buckets image vs video kinds", () => {
    expect(galleryKindBucket("image")).toBe("image");
    expect(galleryKindBucket("IMAGE")).toBe("image");
    expect(galleryKindBucket("video")).toBe("video");
    expect(galleryKindBucket("video/mp4")).toBe("video");
    expect(galleryKindBucket("mp4")).toBe("video");
    expect(galleryKindBucket("")).toBe("image");
    expect(galleryKindBucket(null)).toBe("image");
  });

  it("counts kinds without inventing rows", () => {
    const items = [
      item({ id: "1", kind: "image" }),
      item({ id: "2", kind: "image" }),
      item({ id: "3", kind: "video" }),
      item({ id: "4", kind: "video/mp4" }),
    ];
    expect(countGalleryByKind(items)).toEqual({
      all: 4,
      image: 2,
      video: 2,
    });
    expect(countGalleryByKind([])).toEqual({ all: 0, image: 0, video: 0 });
  });

  it("exports ordered kind filters + label keys", () => {
    expect([...WALLPAPER_GALLERY_KIND_FILTERS]).toEqual([
      "all",
      "image",
      "video",
    ]);
    expect(wallpaperGalleryKindFilterLabelKey("all")).toBe(
      "settings.wallpaperSource.kind.all",
    );
    expect(wallpaperGalleryKindFilterLabelKey("image")).toBe(
      "settings.wallpaperSource.kind.image",
    );
    expect(wallpaperGalleryKindFilterLabelKey("video")).toBe(
      "settings.wallpaperSource.kind.video",
    );
  });
});

describe("filterGalleryItems", () => {
  const items = [
    item({
      id: "a",
      kind: "image",
      username: "alice",
      textPreview: "cyberpunk city neon",
      fullUrl: "https://pbs.twimg.com/media/a.jpg",
    }),
    item({
      id: "b",
      kind: "video",
      username: "bob",
      textPreview: "ocean waves",
      fullUrl: "https://video.twimg.com/b.mp4",
    }),
    item({
      id: "c",
      kind: "image",
      source: "imagine",
      prompt: "misty mountain lake",
      fullUrl: "file:///wallpapers/c.png",
      localPath: "/wallpapers/c.png",
    }),
  ];

  it("filters by free-text query string overload", () => {
    expect(filterGalleryItems(items, "alice").map((i) => i.id)).toEqual(["a"]);
    expect(filterGalleryItems(items, "OCEAN").map((i) => i.id)).toEqual(["b"]);
    expect(filterGalleryItems(items, "mountain").map((i) => i.id)).toEqual([
      "c",
    ]);
    expect(filterGalleryItems(items, "twimg").map((i) => i.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("filters by kind chip", () => {
    expect(
      filterGalleryItems(items, { kind: "video" }).map((i) => i.id),
    ).toEqual(["b"]);
    expect(
      filterGalleryItems(items, { kind: "image" }).map((i) => i.id),
    ).toEqual(["a", "c"]);
    expect(filterGalleryItems(items, { kind: "all" })).toHaveLength(3);
  });

  it("combines kind + query with AND", () => {
    expect(
      filterGalleryItems(items, { kind: "image", query: "city" }).map(
        (i) => i.id,
      ),
    ).toEqual(["a"]);
    expect(
      filterGalleryItems(items, { kind: "video", query: "city" }),
    ).toEqual([]);
  });

  it("never invents items when source list is empty", () => {
    expect(filterGalleryItems([], "anything")).toEqual([]);
    expect(filterGalleryItems([], { kind: "image", query: "x" })).toEqual([]);
  });

  it("hasActiveFilters detects kind and query", () => {
    expect(wallpaperGalleryHasActiveFilters({})).toBe(false);
    expect(wallpaperGalleryHasActiveFilters({ kind: "all", query: "" })).toBe(
      false,
    );
    expect(wallpaperGalleryHasActiveFilters({ kind: "video" })).toBe(true);
    expect(wallpaperGalleryHasActiveFilters({ query: "  neon " })).toBe(true);
  });
});

describe("resolveWallpaperGalleryEmptyState", () => {
  const base = {
    loading: false,
    query: "",
    itemCount: 0,
  };

  it("returns null when there are visible items", () => {
    expect(
      resolveWallpaperGalleryEmptyState({ ...base, itemCount: 3 }),
    ).toBeNull();
  });

  it("loading while search/generate is in flight", () => {
    const empty = resolveWallpaperGalleryEmptyState({
      ...base,
      loading: true,
    });
    expect(empty?.kind).toBe("loading");
    expect(empty?.titleKey).toBe("settings.wallpaperSource.empty.loading");
    expect(empty?.softFail).toBe(true);
    expect(empty?.showClearFilters).toBe(false);
  });

  it("idle when never searched", () => {
    const empty = resolveWallpaperGalleryEmptyState(base);
    expect(empty?.kind).toBe("idle");
    expect(empty?.titleKey).toBe("settings.wallpaperSource.emptyGallery");
    expect(empty?.hintKey).toBe("settings.wallpaperSource.empty.idleHint");
    expect(empty?.softFail).toBe(true);
  });

  it("empty after search with zero results", () => {
    const empty = resolveWallpaperGalleryEmptyState({
      ...base,
      hasSearched: true,
      totalCount: 0,
    });
    expect(empty?.kind).toBe("empty");
    expect(empty?.titleKey).toBe("settings.wallpaperSource.empty.noResults");
    expect(empty?.showClearFilters).toBe(false);
  });

  it("empty from classified empty error code", () => {
    const empty = resolveWallpaperGalleryEmptyState({
      ...base,
      error: "empty",
    });
    expect(empty?.kind).toBe("empty");
    expect(empty?.errorKind).toBe("empty");
    expect(empty?.softFail).toBe(true);
  });

  it("error from network / host / untrusted with soft-fail flags", () => {
    const net = resolveWallpaperGalleryEmptyState({
      ...base,
      error: { code: "search_failed" },
    });
    expect(net?.kind).toBe("error");
    expect(net?.errorKind).toBe("network");
    expect(net?.softFail).toBe(false);
    expect(net?.titleKey).toBe("settings.wallpaperSource.errKind.network");

    const host = resolveWallpaperGalleryEmptyState({
      ...base,
      error: "cli_missing",
    });
    expect(host?.kind).toBe("error");
    expect(host?.errorKind).toBe("host");
    expect(host?.softFail).toBe(true);

    const blocked = resolveWallpaperGalleryEmptyState({
      ...base,
      error: "url_blocked",
    });
    expect(blocked?.kind).toBe("error");
    expect(blocked?.errorKind).toBe("untrusted");
    expect(blocked?.softFail).toBe(true);
  });

  it("filter_empty when chips/query hide all items", () => {
    const empty = resolveWallpaperGalleryEmptyState({
      ...base,
      query: "zzzz",
      totalCount: 5,
      itemCount: 0,
    });
    expect(empty?.kind).toBe("filter_empty");
    expect(empty?.showClearFilters).toBe(true);
    expect(empty?.softFail).toBe(true);

    const kindOnly = resolveWallpaperGalleryEmptyState({
      ...base,
      kindFilter: "video",
      totalCount: 3,
      itemCount: 0,
    });
    expect(kindOnly?.kind).toBe("filter_empty");
    expect(kindOnly?.showClearFilters).toBe(true);
  });

  it("prefers loading over error when both set", () => {
    const empty = resolveWallpaperGalleryEmptyState({
      ...base,
      loading: true,
      error: "search_failed",
    });
    expect(empty?.kind).toBe("loading");
  });

  it("does not invent gallery content on error", () => {
    // itemCount stays 0 — UI must not fabricate CDN cards
    const empty = resolveWallpaperGalleryEmptyState({
      ...base,
      error: { code: "network", message: "fetch failed" },
      itemCount: 0,
      totalCount: 0,
    });
    expect(empty).not.toBeNull();
    expect(empty?.kind).toBe("error");
  });
});
