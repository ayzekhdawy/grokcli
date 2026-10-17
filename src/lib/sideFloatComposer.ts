/**
 * Pure helpers for the expanded-side docked composer.
 * When the side workbench expands over chat, an optional bottom-docked
 * compressed composer can be toggled; the side pane height is reduced by
 * the dock height when active.
 */

/**
 * True when expanded side workbench should overlay the chat free area.
 * Chat DOM stays mounted; only interaction / cover is toggled.
 */
export function shouldHideChatForSideExpand(opts: {
  expanded: boolean;
  phoneLayout?: boolean;
}): boolean {
  return !!opts.expanded && !opts.phoneLayout;
}

/**
 * True when the compressed bottom-docked composer is shown (icon toggle).
 * Requires desktop expand + user-enabled dock — not automatic on expand.
 */
export function isSideDockComposerActive(opts: {
  expanded: boolean;
  dockComposer: boolean;
  phoneLayout?: boolean;
}): boolean {
  return (
    !!opts.expanded && !!opts.dockComposer && !opts.phoneLayout
  );
}
