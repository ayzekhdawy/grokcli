/**
 * Sidebar session-title marquee. Only run when the title is actually wider
 * than the clip. A constant "hover actions" reserve caused short titles
 * (and the same title on different rows) to scroll inconsistently.
 */

const MIN_LAID_OUT_CLIP_PX = 8;
const OVERFLOW_EPS_PX = 2;

/** True when `contentPx` overflows the visible name slot. */
export function titleNeedsMarquee(contentPx: number, clipPx: number): boolean {
  if (!Number.isFinite(contentPx) || !Number.isFinite(clipPx)) return false;
  if (clipPx < MIN_LAID_OUT_CLIP_PX) return false;
  return contentPx - clipPx > OVERFLOW_EPS_PX;
}