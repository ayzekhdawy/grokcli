import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_SEARCH_FILTER_PREF,
  loadSessionSearchFilterPref,
  saveSessionSearchFilterPref,
  SESSION_SEARCH_FILTER_STORAGE_KEY,
} from "./sessionSearchFilterPref";

function memStorage(seed?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

describe("sessionSearchFilterPref", () => {
  it("defaults to all mode, archived off", () => {
    expect(loadSessionSearchFilterPref(memStorage())).toEqual(
      DEFAULT_SESSION_SEARCH_FILTER_PREF,
    );
    expect(DEFAULT_SESSION_SEARCH_FILTER_PREF).toEqual({
      mode: "all",
      includeArchived: false,
    });
  });

  it("round-trips mode + includeArchived", () => {
    const s = memStorage();
    const saved = saveSessionSearchFilterPref(
      { mode: "content", includeArchived: true },
      s,
    );
    expect(saved).toEqual({ mode: "content", includeArchived: true });
    expect(loadSessionSearchFilterPref(s)).toEqual({
      mode: "content",
      includeArchived: true,
    });
    const raw = s.getItem(SESSION_SEARCH_FILTER_STORAGE_KEY);
    expect(raw).toContain("content");
    expect(raw).toContain("true");
  });

  it("merges partial updates over existing pref", () => {
    const s = memStorage();
    saveSessionSearchFilterPref({ mode: "title", includeArchived: true }, s);
    saveSessionSearchFilterPref({ mode: "all" }, s);
    expect(loadSessionSearchFilterPref(s)).toEqual({
      mode: "all",
      includeArchived: true,
    });
  });

  it("accepts legacy plain mode strings", () => {
    expect(
      loadSessionSearchFilterPref(
        memStorage({ [SESSION_SEARCH_FILTER_STORAGE_KEY]: "title" }),
      ),
    ).toEqual({ mode: "title", includeArchived: false });
  });

  it("treats invalid / corrupt storage as defaults", () => {
    expect(
      loadSessionSearchFilterPref(
        memStorage({ [SESSION_SEARCH_FILTER_STORAGE_KEY]: "not-json{" }),
      ),
    ).toEqual(DEFAULT_SESSION_SEARCH_FILTER_PREF);
    expect(
      loadSessionSearchFilterPref(
        memStorage({
          [SESSION_SEARCH_FILTER_STORAGE_KEY]: JSON.stringify({
            mode: "embeddings",
            includeArchived: "yes",
          }),
        }),
      ),
    ).toEqual({ mode: "all", includeArchived: false });
  });
});
