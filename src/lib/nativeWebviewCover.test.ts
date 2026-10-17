import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  acquireNativeWebviewCover,
  applyFloatExcludeToBounds,
  getNativeWebviewFloatExclude,
  isNativeWebviewCovered,
  nativeWebviewCoverDepth,
  rectOverlapsNativeWebviewHost,
  rectsIntersect,
  resetNativeWebviewCoverForTests,
  setNativeWebviewFloatExclude,
  subscribeNativeWebviewCover,
  NATIVE_WEBVIEW_HOST_ATTR,
} from "./nativeWebviewCover";

/** Minimal EventTarget for node vitest (no jsdom). */
class MiniTarget {
  private listeners = new Map<string, Set<(e: Event) => void>>();
  addEventListener(type: string, fn: (e: Event) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: Event) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatchEvent(e: Event): boolean {
    const set = this.listeners.get(e.type);
    if (set) for (const fn of set) fn(e);
    return true;
  }
}

beforeAll(() => {
  if (typeof globalThis.window === "undefined") {
    const target = new MiniTarget();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = target;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).CustomEvent = class CustomEvent {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    };
  }
});

afterEach(() => {
  resetNativeWebviewCoverForTests();
});

describe("nativeWebviewCover", () => {
  it("refcount covers and releases", () => {
    expect(isNativeWebviewCovered()).toBe(false);
    const r1 = acquireNativeWebviewCover();
    expect(isNativeWebviewCovered()).toBe(true);
    expect(nativeWebviewCoverDepth()).toBe(1);
    const r2 = acquireNativeWebviewCover();
    expect(nativeWebviewCoverDepth()).toBe(2);
    r1();
    expect(isNativeWebviewCovered()).toBe(true);
    r2();
    expect(isNativeWebviewCovered()).toBe(false);
    r2(); // idempotent
    expect(nativeWebviewCoverDepth()).toBe(0);
  });

  it("subscribe fires on acquire/release", () => {
    const seen: boolean[] = [];
    const unsub = subscribeNativeWebviewCover((c) => seen.push(c));
    expect(seen[0]).toBe(false);
    const release = acquireNativeWebviewCover();
    expect(seen.at(-1)).toBe(true);
    release();
    expect(seen.at(-1)).toBe(false);
    unsub();
  });
});

describe("rectsIntersect", () => {
  it("detects overlap and non-overlap", () => {
    expect(
      rectsIntersect(
        { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
        { left: 50, top: 50, right: 150, bottom: 150, width: 100, height: 100 },
      ),
    ).toBe(true);
    expect(
      rectsIntersect(
        { left: 0, top: 0, right: 40, bottom: 40, width: 40, height: 40 },
        { left: 40, top: 0, right: 80, bottom: 40, width: 40, height: 40 },
      ),
    ).toBe(false);
  });
});

describe("applyFloatExcludeToBounds", () => {
  const host = {
    left: 100,
    top: 0,
    right: 900,
    bottom: 800,
    width: 800,
    height: 800,
  };

  it("returns host unchanged when exclude is null or non-overlapping", () => {
    expect(applyFloatExcludeToBounds(host, null)).toEqual({
      left: 100,
      top: 0,
      width: 800,
      height: 800,
    });
    expect(
      applyFloatExcludeToBounds(host, {
        left: 0,
        top: 0,
        right: 50,
        bottom: 50,
        width: 50,
        height: 50,
      }),
    ).toEqual({ left: 100, top: 0, width: 800, height: 800 });
  });

  it("cuts bottom when float sits near the bottom (keeps page above)", () => {
    const float = {
      left: 250,
      top: 620,
      right: 750,
      bottom: 780,
      width: 500,
      height: 160,
    };
    const clipped = applyFloatExcludeToBounds(host, float, 8);
    expect(clipped.top).toBe(0);
    expect(clipped.left).toBe(100);
    expect(clipped.width).toBe(800);
    // height ends just above float with gap
    expect(clipped.height).toBe(620 - 8 - 0);
  });

  it("setNativeWebviewFloatExclude stores and clears", () => {
    expect(getNativeWebviewFloatExclude()).toBeNull();
    setNativeWebviewFloatExclude({
      left: 1,
      top: 2,
      right: 11,
      bottom: 22,
      width: 10,
      height: 20,
    });
    expect(getNativeWebviewFloatExclude()?.width).toBe(10);
    setNativeWebviewFloatExclude(null);
    expect(getNativeWebviewFloatExclude()).toBeNull();
  });
});

describe("rectOverlapsNativeWebviewHost", () => {
  it("returns true when menu rect overlaps a host", () => {
    const host = {
      getBoundingClientRect: () => ({
        left: 100,
        top: 100,
        right: 300,
        bottom: 400,
        width: 200,
        height: 300,
      }),
      closest: () => null,
    };
    const doc = {
      querySelectorAll: (sel: string) => {
        expect(sel).toContain(NATIVE_WEBVIEW_HOST_ATTR);
        return [host];
      },
    };
    // Avoid getComputedStyle path
    const prev = globalThis.window;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = {
      ...prev,
      getComputedStyle: undefined,
    };

    expect(
      rectOverlapsNativeWebviewHost(
        {
          left: 120,
          top: 80,
          right: 280,
          bottom: 200,
          width: 160,
          height: 120,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        doc as any,
      ),
    ).toBe(true);

    expect(
      rectOverlapsNativeWebviewHost(
        {
          left: 0,
          top: 0,
          right: 50,
          bottom: 50,
          width: 50,
          height: 50,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        doc as any,
      ),
    ).toBe(false);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = prev;
  });

  it("ignores hosts under [hidden] ancestors", () => {
    const host = {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 400,
        width: 400,
        height: 400,
      }),
      closest: (sel: string) => (sel === "[hidden]" ? {} : null),
    };
    const doc = {
      querySelectorAll: () => [host],
    };
    const prev = globalThis.window;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = { ...prev, getComputedStyle: undefined };

    expect(
      rectOverlapsNativeWebviewHost(
        {
          left: 10,
          top: 10,
          right: 50,
          bottom: 50,
          width: 40,
          height: 40,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        doc as any,
      ),
    ).toBe(false);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = prev;
  });
});
