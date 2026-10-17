/**
 * Windows WebView2 can paint the page and keep JS timers running while it
 * ignores the mouse and keyboard. Chromium 153–155 gets there when a
 * page-started drag aborts and the drag state is left down
 * (crbug 522564418, 559347435, 561821308). WebView2 155.0.4283.45
 * (2026-10-08) is the runtime where this shows up after a few minutes of
 * selecting chat text; quitting and reopening clears it until the next drag.
 *
 * Cancelling `dragstart` is the workaround Chromium reporters verified.
 * A drop that starts in Explorer never fires `dragstart` in this page, so
 * file drop stays. A source that must drag opts in with `data-allow-drag`.
 */

import { detectAppPlatform, type AppPlatform } from "@/lib/appPlatform";

export const ALLOW_PAGE_DRAG_ATTR = "data-allow-drag";

export function dragSourceAllowsPageDrag(target: EventTarget | null): boolean {
  const el = elementFromEventTarget(target);
  if (!el) return false;
  return el.closest(`[${ALLOW_PAGE_DRAG_ATTR}]`) != null;
}

/** True when this drag would enter the WebView2 stuck-input state. */
export function dragStartShouldBeCancelled(target: EventTarget | null): boolean {
  return !dragSourceAllowsPageDrag(target);
}

export function installWindowsDragInputGuard(
  doc: Document = document,
  platform: AppPlatform = detectAppPlatform(),
): () => void {
  if (platform !== "win") return () => {};
  const onDragStart = (event: Event) => {
    if (!dragStartShouldBeCancelled(event.target)) return;
    event.preventDefault();
  };
  doc.addEventListener("dragstart", onDragStart, true);
  return () => doc.removeEventListener("dragstart", onDragStart, true);
}

function elementFromEventTarget(target: EventTarget | null): Element | null {
  if (target == null) return null;
  if (typeof Element !== "undefined" && target instanceof Element) return target;
  if (typeof Node !== "undefined" && target instanceof Node) {
    return target.parentElement;
  }
  return null;
}
