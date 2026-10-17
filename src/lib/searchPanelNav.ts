/**
 * Command-palette keyboard selection for the session search panel.
 *
 * Rows are a flat list: actions → projects → sessions. ArrowUp/Down wrap.
 * Home/End stay with the query caret. ⌘/Ctrl 1–9 open the Nth session row
 * (same numbering already shown in the row meta).
 */

export type SearchPanelItemKind = "action" | "project" | "session";

export type SearchPanelItem = {
  kind: SearchPanelItemKind;
  id: string;
};

export type SearchPanelNav = "up" | "down" | "pageUp" | "pageDown";

export const SEARCH_PANEL_PAGE_SIZE = 8;

export function flattenSearchPanelItems(input: {
  actions?: ReadonlyArray<{ id: string }>;
  projects?: ReadonlyArray<{ id: string }>;
  sessions?: ReadonlyArray<{ id: string }>;
}): SearchPanelItem[] {
  const out: SearchPanelItem[] = [];
  for (const a of input.actions ?? []) out.push({ kind: "action", id: a.id });
  for (const p of input.projects ?? []) out.push({ kind: "project", id: p.id });
  for (const s of input.sessions ?? []) out.push({ kind: "session", id: s.id });
  return out;
}

export function searchPanelItemIndex(
  items: ReadonlyArray<SearchPanelItem>,
  kind: SearchPanelItemKind,
  id: string,
): number {
  return items.findIndex((it) => it.kind === kind && it.id === id);
}

export function clampSearchPanelIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), length - 1);
}

export function searchPanelNavFromKey(key: string): SearchPanelNav | null {
  switch (key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "PageUp":
      return "pageUp";
    case "PageDown":
      return "pageDown";
    default:
      return null;
  }
}

export function stepSearchPanelIndex(
  current: number,
  length: number,
  nav: SearchPanelNav,
  pageSize = SEARCH_PANEL_PAGE_SIZE,
): number {
  if (length <= 0) return 0;
  const cur = clampSearchPanelIndex(current, length);
  const page = Math.max(1, Math.trunc(pageSize) || SEARCH_PANEL_PAGE_SIZE);
  switch (nav) {
    case "down":
      return (cur + 1) % length;
    case "up":
      return (cur - 1 + length) % length;
    case "pageDown":
      return clampSearchPanelIndex(cur + page, length);
    case "pageUp":
      return clampSearchPanelIndex(cur - page, length);
    default:
      return cur;
  }
}

export function searchPanelSessionDigitIndex(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): number | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return null;
  if (!/^[1-9]$/.test(e.key)) return null;
  return Number(e.key) - 1;
}

export type SearchPanelKeyResult =
  | { type: "none" }
  | { type: "nav"; index: number }
  | { type: "activate"; index: number }
  | { type: "activateSession"; sessionIndex: number };

export function resolveSearchPanelKey(input: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  activeIndex: number;
  itemCount: number;
  sessionCount: number;
}): SearchPanelKeyResult {
  if (input.isComposing) return { type: "none" };

  const digit = searchPanelSessionDigitIndex(input);
  if (digit != null) {
    if (digit >= 0 && digit < input.sessionCount) {
      return { type: "activateSession", sessionIndex: digit };
    }
    return { type: "none" };
  }

  if (input.metaKey || input.ctrlKey || input.altKey) return { type: "none" };

  const nav = searchPanelNavFromKey(input.key);
  if (nav && !input.shiftKey) {
    return {
      type: "nav",
      index: stepSearchPanelIndex(input.activeIndex, input.itemCount, nav),
    };
  }

  if (input.key === "Enter" && !input.shiftKey && input.itemCount > 0) {
    return {
      type: "activate",
      index: clampSearchPanelIndex(input.activeIndex, input.itemCount),
    };
  }

  return { type: "none" };
}
