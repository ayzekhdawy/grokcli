import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_SEARCH_RANK_PREF,
  loadSessionSearchRankPref,
  saveSessionSearchRankPref,
  SESSION_SEARCH_RANK_STORAGE_KEY,
} from "./sessionSearchRankPref";

function memStorage(seed?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

describe("sessionSearchRankPref", () => {
  it("defaults to keyword", () => {
    expect(loadSessionSearchRankPref(memStorage())).toBe(
      DEFAULT_SESSION_SEARCH_RANK_PREF,
    );
    expect(DEFAULT_SESSION_SEARCH_RANK_PREF).toBe("keyword");
  });

  it("round-trips hybrid / keyword", () => {
    const s = memStorage();
    saveSessionSearchRankPref("hybrid", s);
    expect(s.getItem(SESSION_SEARCH_RANK_STORAGE_KEY)).toBe("hybrid");
    expect(loadSessionSearchRankPref(s)).toBe("hybrid");
    saveSessionSearchRankPref("keyword", s);
    expect(loadSessionSearchRankPref(s)).toBe("keyword");
  });

  it("treats invalid stored values as keyword", () => {
    expect(
      loadSessionSearchRankPref(
        memStorage({ [SESSION_SEARCH_RANK_STORAGE_KEY]: "embeddings" }),
      ),
    ).toBe("keyword");
  });
});
