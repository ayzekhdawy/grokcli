import { describe, expect, it } from "vitest";
import {
  COMPOSER_MIN_ROWS_ATTR,
  COMPOSER_MIN_ROWS_OPTIONS,
  COMPOSER_MIN_ROWS_PX,
  COMPOSER_MIN_ROWS_STORAGE_KEY,
  DEFAULT_COMPOSER_MIN_ROWS,
  applyComposerMinRows,
  isComposerMinRows,
  loadComposerMinRows,
  parseComposerMinRows,
  saveComposerMinRows,
  setComposerMinRows,
  type ComposerMinRowsStorage,
} from "./composerMinRows";

function memoryStorage(
  initial: Record<string, string> = {},
): ComposerMinRowsStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

describe("composerMinRows", () => {
  it("defaults to 2 and rejects unknown values", () => {
    expect(DEFAULT_COMPOSER_MIN_ROWS).toBe("2");
    expect(parseComposerMinRows(null)).toBe("2");
    expect(parseComposerMinRows("")).toBe("2");
    expect(parseComposerMinRows("4")).toBe("2");
    expect(parseComposerMinRows("sm")).toBe("2");
    expect(parseComposerMinRows("lg")).toBe("2");
    expect(isComposerMinRows("2")).toBe(true);
    expect(isComposerMinRows("3")).toBe(true);
    expect(isComposerMinRows("5")).toBe(true);
    expect(isComposerMinRows("8")).toBe(true);
    expect(isComposerMinRows("4")).toBe(false);
    expect(isComposerMinRows(3)).toBe(false);
    expect(COMPOSER_MIN_ROWS_OPTIONS).toEqual(["2", "3", "5", "8"]);
  });

  it("accepts bare numbers 2|3|5|8", () => {
    expect(parseComposerMinRows(2)).toBe("2");
    expect(parseComposerMinRows(3)).toBe("3");
    expect(parseComposerMinRows(5)).toBe("5");
    expect(parseComposerMinRows(8)).toBe("8");
    expect(parseComposerMinRows(4)).toBe("2");
    expect(parseComposerMinRows(2.9)).toBe("2");
  });

  it("exposes px map matching line-height × rows", () => {
    expect(COMPOSER_MIN_ROWS_PX["2"]).toBe(44);
    expect(COMPOSER_MIN_ROWS_PX["3"]).toBe(66);
    expect(COMPOSER_MIN_ROWS_PX["5"]).toBe(110);
    expect(COMPOSER_MIN_ROWS_PX["8"]).toBe(176);
  });

  it("persists and reloads after simulated relaunch", () => {
    const storage = memoryStorage();
    expect(loadComposerMinRows(storage)).toBe("2");
    saveComposerMinRows("5", storage);
    expect(storage.data[COMPOSER_MIN_ROWS_STORAGE_KEY]).toBe("5");
    expect(loadComposerMinRows(storage)).toBe("5");
    saveComposerMinRows("8", storage);
    expect(loadComposerMinRows(storage)).toBe("8");
    saveComposerMinRows("3", storage);
    expect(loadComposerMinRows(storage)).toBe("3");
  });

  it("applyComposerMinRows sets data-composer-min-rows", () => {
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    };
    applyComposerMinRows("3", el);
    expect(attrs.get(COMPOSER_MIN_ROWS_ATTR)).toBe("3");
    applyComposerMinRows("8", el);
    expect(attrs.get(COMPOSER_MIN_ROWS_ATTR)).toBe("8");
    applyComposerMinRows("2", el);
    expect(attrs.get(COMPOSER_MIN_ROWS_ATTR)).toBe("2");
  });

  it("setComposerMinRows saves and applies", () => {
    const storage = memoryStorage();
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    };
    setComposerMinRows("5", storage, el);
    expect(storage.data[COMPOSER_MIN_ROWS_STORAGE_KEY]).toBe("5");
    expect(attrs.get(COMPOSER_MIN_ROWS_ATTR)).toBe("5");
  });
});
