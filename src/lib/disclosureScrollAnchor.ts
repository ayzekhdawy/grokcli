/**
 * Keep a clicked disclosure (tool / thinking / phase row chevron) in place
 * while its body expands or collapses inside the chat scroller.
 *
 * Without this, the height change of the toggled row is fed to the
 * stick-to-bottom follow (pinned → snaps to the new bottom, the row the
 * user just clicked flies away) or to the virtualizer's "clipped short
 * shell" compensation (scrollTop += delta, the new body opens off-screen
 * above). Both read as "scroll jumps when I open details".
 */

/** How long after a toggle the clicked header is held in place (ms). */
export const DISCLOSURE_ANCHOR_HOLD_MS = 700;

const TOGGLE_SELECTOR =
  'button[aria-expanded], [role="button"][aria-expanded], summary';

/**
 * Disclosure toggle that owns `target`, if it lives inside `root`.
 * Returns null for any other click (links, copy buttons, composer…).
 */
export function findDisclosureToggle(
  target: EventTarget | null,
  root: Element,
): HTMLElement | null {
  if (!target || typeof (target as Element).closest !== "function") {
    return null;
  }
  const toggle = (target as Element).closest(TOGGLE_SELECTOR);
  if (!toggle || toggle === root || !root.contains(toggle)) return null;
  return toggle as HTMLElement;
}

/**
 * scrollTop that puts the anchor back at the viewport-relative top it had
 * when it was clicked, clamped to the scrollable range.
 */
export function anchoredScrollTop(input: {
  scrollTop: number;
  anchorTopAtClick: number;
  anchorTopNow: number;
  maxScrollTop: number;
}): number {
  const drift = input.anchorTopNow - input.anchorTopAtClick;
  if (!Number.isFinite(drift) || Math.abs(drift) < 0.5) {
    return input.scrollTop;
  }
  const max = Math.max(0, input.maxScrollTop);
  return Math.min(max, Math.max(0, input.scrollTop + drift));
}
