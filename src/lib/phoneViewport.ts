/**
 * Phone viewport helpers for mirror clients.
 * Pure functions — unit-tested; no DOM required.
 */

/** Matches `app.css` @media (max-width: 820px) phone chrome. */
export const PHONE_BREAKPOINT_PX = 820;

/**
 * Space taken by the on-screen keyboard (CSS px), derived from visualViewport.
 * Returns 0 when the keyboard is closed or visualViewport is unavailable.
 *
 * Formula: window.innerHeight − visualViewport.height − visualViewport.offsetTop
 * (iOS Safari scrolls the layout viewport when the keyboard opens; offsetTop
 * accounts for that so the composer can sit above the keyboard).
 */
export function keyboardInsetBottom(
  visualViewport: { height: number; offsetTop: number } | null | undefined,
  windowInnerHeight: number,
): number {
  if (!visualViewport || !Number.isFinite(windowInnerHeight)) return 0;
  const { height, offsetTop } = visualViewport;
  if (!Number.isFinite(height) || !Number.isFinite(offsetTop)) return 0;
  const occupied = windowInnerHeight - height - offsetTop;
  return Math.max(0, Math.round(occupied));
}

/** CSS custom property written on the document root for phone keyboard inset. */
export const PHONE_KEYBOARD_INSET_VAR = "--phone-keyboard-inset";

/**
 * Phone drawer width as a fraction of the viewport (matches CSS ~85vw).
 * Clamped so very wide “phone” tablets still leave a visible scrim.
 */
export function phoneDrawerWidthPx(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 0;
  return Math.min(Math.round(viewportWidth * 0.85), 320);
}
