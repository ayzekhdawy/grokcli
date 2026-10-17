import { describe, expect, it } from "vitest";
import {
  loadComposerEnterInsertsLive,
  saveComposerEnterInsertsLive,
} from "./composerEnterInsertsLive";

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe("composerEnterInsertsLive", () => {
  it("defaults off", () => {
    expect(loadComposerEnterInsertsLive(memoryStorage())).toBe(false);
  });

  it("round-trips the switch", () => {
    const storage = memoryStorage();
    saveComposerEnterInsertsLive(true, storage);
    expect(loadComposerEnterInsertsLive(storage)).toBe(true);
    saveComposerEnterInsertsLive(false, storage);
    expect(loadComposerEnterInsertsLive(storage)).toBe(false);
  });
});
