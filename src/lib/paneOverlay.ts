/**
 * When a pane at its in-flow floor plus the chat floor would not fit,
 * overlay it instead of interpolating flex width (and growing the OS window).
 *
 * Preferred / stored pane widths are ignored here: a wide saved aside still
 * clamps and squeezes chat. Overlay is only the tight-window fallback.
 *
 * Overlay is not full-cover: the chat column stays painted. Only the
 * user-toggled side-workbench expand hides `.main`.
 */

import {
  ASIDE_WIDTH_MIN,
  MAIN_CHAT_MIN_WIDTH,
  SIDEBAR_WIDTH_MIN,
} from "@/lib/layout";

export type WorkbenchPaneOverlay = {
  sidebarOverlay: boolean;
  asideOverlay: boolean;
};

export function resolveWorkbenchPaneOverlay(opts: {
  viewportWidth: number;
  sidebarOpen: boolean;
  /** Preferred/stored width; overlay ignores this and uses the in-flow floor. */
  sidebarWidth: number;
  asideOpen: boolean;
  /** Preferred/stored width; overlay ignores this and uses the in-flow floor. */
  asideWidth: number;
  chatMin?: number;
}): WorkbenchPaneOverlay {
  const vw = opts.viewportWidth;
  const chatMin = opts.chatMin ?? MAIN_CHAT_MIN_WIDTH;
  if (!(vw > 0) || !Number.isFinite(vw) || !Number.isFinite(chatMin)) {
    return { sidebarOverlay: false, asideOverlay: false };
  }
  const side = opts.sidebarOpen ? SIDEBAR_WIDTH_MIN : 0;
  const aside = opts.asideOpen ? ASIDE_WIDTH_MIN : 0;
  if (side + aside + chatMin <= vw) {
    return { sidebarOverlay: false, asideOverlay: false };
  }
  if (side > 0 && aside > 0) {
    if (side + chatMin <= vw) {
      return { sidebarOverlay: false, asideOverlay: true };
    }
    if (aside + chatMin <= vw) {
      return { sidebarOverlay: true, asideOverlay: false };
    }
    return { sidebarOverlay: true, asideOverlay: true };
  }
  return {
    sidebarOverlay: side > 0,
    asideOverlay: aside > 0,
  };
}
