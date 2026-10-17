/**
 * Coordinate temporary hide of Tauri child Webviews under DOM overlays.
 *
 * Native Webviews paint above HTML (z-index cannot win). When a portaled
 * floating menu / modal would cover a browser host, callers acquire a cover
 * token so EmbeddedBrowser can hide() without destroying the webview.
 */

export const NATIVE_WEBVIEW_COVER_EVENT = "grok:nativeWebviewCover";
export const NATIVE_WEBVIEW_FLOAT_EXCLUDE_EVENT =
  "grok:nativeWebviewFloatExclude";
export const NATIVE_WEBVIEW_HOST_ATTR = "data-native-webview-host";

let coverDepth = 0;

export type NativeWebviewCoverDetail = {
  covered: boolean;
  depth: number;
};

export type RectLike = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/** Long-lived float card: shrink webview bounds instead of full hide. */
let floatExcludeRect: RectLike | null = null;

function notify(): void {
  try {
    window.dispatchEvent(
      new CustomEvent<NativeWebviewCoverDetail>(NATIVE_WEBVIEW_COVER_EVENT, {
        detail: { covered: coverDepth > 0, depth: coverDepth },
      }),
    );
  } catch {
    /* SSR / tests without window events */
  }
}

function notifyFloatExclude(): void {
  try {
    window.dispatchEvent(
      new CustomEvent<RectLike | null>(NATIVE_WEBVIEW_FLOAT_EXCLUDE_EVENT, {
        detail: floatExcludeRect,
      }),
    );
  } catch {
    /* SSR / tests */
  }
}

/** Current cover depth (for tests). */
export function nativeWebviewCoverDepth(): number {
  return coverDepth;
}

export function isNativeWebviewCovered(): boolean {
  return coverDepth > 0;
}

/**
 * Increment cover count. Returns a release function (idempotent).
 * Use while a DOM layer must sit above native browser surfaces.
 * Full hide — use for short-lived overlays (menus / modals). Long-lived
 * UI should shrink the host (e.g. expanded side docks the composer and
 * shortens the aside so the webview host simply resizes).
 */
export function acquireNativeWebviewCover(): () => void {
  coverDepth += 1;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    coverDepth = Math.max(0, coverDepth - 1);
    notify();
  };
}

/**
 * Publish a DOM rect that native webviews should not cover (e.g. floating composer).
 * Pass `null` to clear. EmbeddedBrowser shrinks bounds instead of blanking the page.
 */
export function setNativeWebviewFloatExclude(rect: RectLike | null): void {
  if (
    !rect ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    if (floatExcludeRect == null) return;
    floatExcludeRect = null;
    notifyFloatExclude();
    return;
  }
  const next: RectLike = {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
  const prev = floatExcludeRect;
  if (
    prev &&
    Math.abs(prev.left - next.left) < 0.5 &&
    Math.abs(prev.top - next.top) < 0.5 &&
    Math.abs(prev.width - next.width) < 0.5 &&
    Math.abs(prev.height - next.height) < 0.5
  ) {
    return;
  }
  floatExcludeRect = next;
  notifyFloatExclude();
}

export function getNativeWebviewFloatExclude(): RectLike | null {
  return floatExcludeRect;
}

export function subscribeNativeWebviewFloatExclude(
  cb: (rect: RectLike | null) => void,
): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<RectLike | null>).detail;
    cb(detail ?? getNativeWebviewFloatExclude());
  };
  window.addEventListener(NATIVE_WEBVIEW_FLOAT_EXCLUDE_EVENT, handler);
  cb(getNativeWebviewFloatExclude());
  return () =>
    window.removeEventListener(NATIVE_WEBVIEW_FLOAT_EXCLUDE_EVENT, handler);
}

/**
 * Shrink host bounds so a floating DOM card is not painted over by the webview.
 * Prefers the cut that preserves the largest remaining host area (usually bottom).
 */
export function applyFloatExcludeToBounds(
  host: RectLike,
  exclude: RectLike | null,
  gap = 8,
): { left: number; top: number; width: number; height: number } {
  const base = {
    left: host.left,
    top: host.top,
    width: host.width,
    height: host.height,
  };
  if (!exclude || host.width <= 0 || host.height <= 0) return base;
  if (!rectsIntersect(host, exclude)) return base;

  const g = Math.max(0, gap);
  const cutBottomH = Math.max(0, exclude.top - g - host.top);
  const cutTopH = Math.max(0, host.bottom - (exclude.bottom + g));
  const cutRightW = Math.max(0, exclude.left - g - host.left);
  const cutLeftW = Math.max(0, host.right - (exclude.right + g));

  const areaBottom = cutBottomH * host.width;
  const areaTop = cutTopH * host.width;
  const areaRight = cutRightW * host.height;
  const areaLeft = cutLeftW * host.height;
  const best = Math.max(areaBottom, areaTop, areaLeft, areaRight);
  const minSide = 40;

  if (best === areaBottom && cutBottomH >= minSide) {
    return { left: host.left, top: host.top, width: host.width, height: cutBottomH };
  }
  if (best === areaTop && cutTopH >= minSide) {
    const top = exclude.bottom + g;
    return {
      left: host.left,
      top,
      width: host.width,
      height: Math.max(0, host.bottom - top),
    };
  }
  if (best === areaRight && cutRightW >= minSide) {
    return {
      left: host.left,
      top: host.top,
      width: cutRightW,
      height: host.height,
    };
  }
  if (best === areaLeft && cutLeftW >= minSide) {
    const left = exclude.right + g;
    return {
      left,
      top: host.top,
      width: Math.max(0, host.right - left),
      height: host.height,
    };
  }
  if (cutBottomH >= minSide) {
    return { left: host.left, top: host.top, width: host.width, height: cutBottomH };
  }
  return base;
}

/** Reset depth (tests only). */
export function resetNativeWebviewCoverForTests(): void {
  coverDepth = 0;
  floatExcludeRect = null;
  notify();
  notifyFloatExclude();
}

export function subscribeNativeWebviewCover(
  cb: (covered: boolean) => void,
): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<NativeWebviewCoverDetail>).detail;
    cb(detail?.covered ?? isNativeWebviewCovered());
  };
  window.addEventListener(NATIVE_WEBVIEW_COVER_EVENT, handler);
  // Sync initial
  cb(isNativeWebviewCovered());
  return () => window.removeEventListener(NATIVE_WEBVIEW_COVER_EVENT, handler);
}

/** Axis-aligned rect intersection (inclusive edges, zero-area does not count). */
export function rectsIntersect(a: RectLike, b: RectLike): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) {
    return false;
  }
  return !(
    a.right <= b.left ||
    a.left >= b.right ||
    a.bottom <= b.top ||
    a.top >= b.bottom
  );
}

/**
 * True if `rect` overlaps any registered native webview host in the document.
 */
type HostLike = {
  getBoundingClientRect: () => RectLike;
  closest?: (selectors: string) => unknown;
};

export function rectOverlapsNativeWebviewHost(
  rect: RectLike,
  doc: {
    querySelectorAll: (selectors: string) => ArrayLike<unknown>;
  } | null = typeof document !== "undefined" ? document : null,
): boolean {
  if (!doc || typeof doc.querySelectorAll !== "function") {
    return false;
  }
  const nodes = doc.querySelectorAll(`[${NATIVE_WEBVIEW_HOST_ATTR}]`);
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i] as HostLike | null;
    if (!el || typeof el.getBoundingClientRect !== "function") continue;
    // Skip hosts under [hidden] ancestors (inactive persist hosts).
    if (typeof el.closest === "function" && el.closest("[hidden]")) continue;
    // Skip display:none / visibility:hidden when computed style is available.
    if (
      typeof window !== "undefined" &&
      typeof window.getComputedStyle === "function" &&
      // Element-like only
      typeof (el as unknown as Node).nodeType === "number"
    ) {
      try {
        const style = window.getComputedStyle(el as unknown as Element);
        if (style.display === "none" || style.visibility === "hidden") {
          continue;
        }
      } catch {
        /* ignore non-elements */
      }
    }
    const r = el.getBoundingClientRect();
    if (
      rectsIntersect(rect, {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      })
    ) {
      return true;
    }
  }
  return false;
}
