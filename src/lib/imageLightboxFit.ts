/**
 * Lightbox image fit math for yet-another-react-lightbox.
 *
 * YARL ImageSlide caps `max-width` / `max-height` at the slide's declared
 * width/height (or natural pixels). Small images therefore render tiny in a
 * large window. We declare logical width/height as at least the
 * viewport-contain size so zoom=1 fills the stage (upscale when smaller;
 * downscale when larger), and pan/max-zoom stay consistent.
 */

export type Size = { width: number; height: number };

/** Default carousel padding (px each side) — matches YARL default `16px`. */
export const LIGHTBOX_PAD_PX = 16;

/**
 * Viewport area available for the slide (window minus padding on all sides).
 */
export function lightboxSlideRect(
  viewportW: number,
  viewportH: number,
  padPx: number = LIGHTBOX_PAD_PX,
): Size {
  const p = Math.max(0, padPx);
  return {
    width: Math.max(1, viewportW - p * 2),
    height: Math.max(1, viewportH - p * 2),
  };
}

/**
 * Contain `natural` inside `box`, preserving aspect ratio.
 * May be larger than natural (upscale) or smaller (downscale).
 */
export function containSize(box: Size, natural: Size): Size {
  const nw = Math.max(0, natural.width);
  const nh = Math.max(0, natural.height);
  if (!(nw > 0 && nh > 0)) {
    return { width: Math.max(1, box.width), height: Math.max(1, box.height) };
  }
  const bw = Math.max(1, box.width);
  const bh = Math.max(1, box.height);
  const ar = nw / nh;
  const width = Math.min(bw, bh * ar);
  const height = Math.min(bh, bw / ar);
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

/**
 * Logical slide width/height for YARL zoom + ImageSlide caps.
 *
 * - Image smaller than stage → use contain size (allows zoom=1 to fill stage).
 * - Image larger than stage → keep natural (maxZoom still reaches full-res × ratio).
 */
export function lightboxSlideDimensions(
  natural: Size,
  stage: Size,
): Size {
  const nw = Math.max(0, natural.width);
  const nh = Math.max(0, natural.height);
  if (!(nw > 0 && nh > 0)) {
    return { width: 0, height: 0 };
  }
  const fit = containSize(stage, { width: nw, height: nh });
  return {
    width: Math.max(nw, fit.width),
    height: Math.max(nh, fit.height),
  };
}

/**
 * Load natural pixel size of an image URL (or 0×0 on failure).
 */
export function loadImageNaturalSize(src: string): Promise<Size> {
  return new Promise((resolve) => {
    if (!src) {
      resolve({ width: 0, height: 0 });
      return;
    }
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth || 0,
        height: img.naturalHeight || 0,
      });
    };
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });
}

/**
 * YARL slide fields that keep zoom pan math aligned with fit-to-stage display.
 *
 * Why `srcSet`: ZoomWrapper's ImageSlide `onLoad` overwrites slide width/height
 * with `naturalWidth`/`naturalHeight`. useZoomImageRect then takes
 * `Math.max(srcSet widths, slide.width)`, so a srcSet entry at the **logical**
 * size wins over a smaller natural size. Without that, imageRect stays at
 * natural pixels → max pan offset is 0 until extreme zoom → cannot drag.
 */
export function lightboxYarlSlideSize(
  src: string,
  logical: Size,
): {
  width: number;
  height: number;
  srcSet: Array<{ src: string; width: number; height: number }>;
} | null {
  if (!(logical.width > 0 && logical.height > 0) || !src) return null;
  return {
    width: logical.width,
    height: logical.height,
    srcSet: [
      {
        src,
        width: logical.width,
        height: logical.height,
      },
    ],
  };
}

/**
 * Whether zoomed image can pan (exceeds stage on at least one axis).
 * Mirrors YARL: maxOffset > 0 when imageRect * zoom > slideRect.
 */
export function lightboxCanPan(
  imageRect: Size,
  stage: Size,
  zoom: number,
): boolean {
  if (!(zoom > 1)) return false;
  const w = imageRect.width * zoom;
  const h = imageRect.height * zoom;
  return w > stage.width + 0.5 || h > stage.height + 0.5;
}
