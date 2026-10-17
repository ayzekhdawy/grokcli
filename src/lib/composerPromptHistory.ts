/**
 * Composer prompt history — CLI-like ↑/↓ recall + `/history` **This chat** tab.
 *
 * Session scope matches Grok Build (current chat only). Cross-session recent
 * lives in `recentPromptHistory.ts` (localStorage ring) and shares the same
 * picker UI under the **Recent (all chats)** tab.
 * History is newest-first (index 0 = most recent user message).
 * Index `null` means not browsing (live draft).
 *
 * COMPOSER-HISTORY-PRO adds pure list navigation (Home/End/Page), empty-state
 * resolution, and optional recent meta on picker rows.
 */

export type PromptHistoryStep = {
  /** Index into history (0 = newest), or null when not browsing. */
  index: number | null;
  /** Draft text to apply ("" when leaving history). */
  text: string;
};

/** One row in the `/history` picker (filtered view of session / recent history). */
export type PromptHistoryEntry = {
  /** Index into the unfiltered newest-first history list. */
  historyIndex: number;
  /** Stored prompt text (`[[skill:…]]` form). */
  text: string;
  /** Cross-session recent only — app session id at send time. */
  sessionId?: string;
  /** Cross-session recent only — ISO-8601 timestamp. */
  at?: string;
};

/** Picker tab scope (matches PromptHistoryPanel). */
export type PromptHistoryScope = "session" | "recent";

/**
 * Empty-state kinds for the prompt history picker list.
 * Callers map to i18n keys (`promptHistory.empty*`).
 */
export type PromptHistoryEmptyKind =
  | "session"
  | "sessionFilter"
  | "recent"
  | "recentFilter";

export type PromptHistoryEmptyInput = {
  scope: PromptHistoryScope;
  /** Filter query (trim inside). */
  query: string;
  /** Filtered row count currently shown. */
  filteredCount: number;
  /** Unfiltered count for the active scope (for clear-filter affordance). */
  unfilteredCount: number;
};

export type PromptHistoryEmptyPresentation = {
  kind: PromptHistoryEmptyKind;
  /** Offer "Clear filter" when a query hid every row. */
  showClearFilter: boolean;
};

/** List keyboard direction for the open picker (not CLI empty-↑ browse). */
export type PromptHistoryListNav =
  | "up"
  | "down"
  | "home"
  | "end"
  | "pageUp"
  | "pageDown";

/** Default page jump size for PageUp / PageDown in the picker. */
export const PROMPT_HISTORY_PAGE_SIZE = 5;

/**
 * Extract prior user prompt strings from session messages, newest first.
 * Skips empty / whitespace-only content. Keeps stored display form
 * (`[[skill:…]]` tokens) so the composer can re-render chips.
 */
export function collectUserPromptHistory(
  messages: ReadonlyArray<{ role: string; content?: string | null }>,
): string[] {
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    const c = m.content ?? "";
    if (!c.trim()) continue;
    out.push(c);
  }
  return out;
}

/**
 * Fuzzy-filter current-session prompt history (newest first).
 * Empty query returns every entry. Match is case-insensitive substring.
 */
export function filterPromptHistory(
  history: readonly string[],
  query: string,
): PromptHistoryEntry[] {
  const q = query.trim().toLowerCase();
  const out: PromptHistoryEntry[] = [];
  for (let historyIndex = 0; historyIndex < history.length; historyIndex++) {
    const text = history[historyIndex] ?? "";
    if (q && !text.toLowerCase().includes(q)) continue;
    out.push({ historyIndex, text });
  }
  return out;
}

/**
 * One-line preview for the history list: collapse whitespace/newlines.
 * Caller may pre-map skill tokens (`previewStoredAsSlash`).
 */
export function promptHistoryListPreview(
  text: string,
  maxLen = 120,
): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLen) return flat;
  return `${flat.slice(0, Math.max(1, maxLen - 1))}…`;
}

/**
 * Compute next history index for ↑ / ↓.
 * - null means "live empty draft" (not browsing)
 * - up from null → 0; up clamps at oldest
 * - down from 0 → null (clear); down from null stays null
 */
export function nextPromptHistoryIndex(
  currentIndex: number | null,
  historyLength: number,
  direction: "up" | "down",
): number | null {
  if (historyLength <= 0) return null;
  if (direction === "up") {
    if (currentIndex == null) return 0;
    return Math.min(currentIndex + 1, historyLength - 1);
  }
  // down
  if (currentIndex == null) return null;
  if (currentIndex <= 0) return null;
  return currentIndex - 1;
}

/**
 * Pure step: given history (newest first) and direction, return next
 * index + text for the composer.
 */
export function stepPromptHistory(
  history: readonly string[],
  currentIndex: number | null,
  direction: "up" | "down",
): PromptHistoryStep {
  const index = nextPromptHistoryIndex(
    currentIndex,
    history.length,
    direction,
  );
  if (index == null) return { index: null, text: "" };
  return { index, text: history[index] ?? "" };
}

/**
 * Whether ↑/↓ should be claimed for history navigation.
 * Parent must ensure slash palette is closed before calling.
 *
 * - ArrowUp: only when draft is empty (start) or already browsing
 * - ArrowDown: only while already browsing (forward / clear)
 */
export function shouldHandlePromptHistoryKey(input: {
  key: string;
  draftEmpty: boolean;
  browsing: boolean;
  historyLength: number;
}): boolean {
  if (input.historyLength <= 0) return false;
  if (input.key !== "ArrowUp" && input.key !== "ArrowDown") return false;
  if (input.key === "ArrowUp") {
    return input.draftEmpty || input.browsing;
  }
  return input.browsing;
}

/**
 * Clamp a picker highlight index into `[0, length-1]` (or 0 when empty).
 */
export function clampPromptHistoryActive(
  index: number,
  length: number,
): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.trunc(index), length - 1));
}

/**
 * Step the open picker's highlight for ↑/↓/Home/End/PageUp/PageDown.
 * Does not wrap. Empty list → 0.
 */
export function stepPromptHistoryListIndex(
  currentIndex: number,
  length: number,
  nav: PromptHistoryListNav,
  pageSize = PROMPT_HISTORY_PAGE_SIZE,
): number {
  if (length <= 0) return 0;
  const cur = clampPromptHistoryActive(currentIndex, length);
  const page = Math.max(1, Math.trunc(pageSize) || PROMPT_HISTORY_PAGE_SIZE);
  switch (nav) {
    case "up":
      // List is newest-first; ArrowUp walks toward older (higher index).
      return clampPromptHistoryActive(cur + 1, length);
    case "down":
      return clampPromptHistoryActive(cur - 1, length);
    case "home":
      return 0;
    case "end":
      return length - 1;
    case "pageUp":
      return clampPromptHistoryActive(cur + page, length);
    case "pageDown":
      return clampPromptHistoryActive(cur - page, length);
    default:
      return cur;
  }
}

/**
 * Map a keyboard event key to list navigation, or null if not a list nav key.
 * Shift+Tab / Tab are selection keys handled elsewhere.
 */
export function promptHistoryListNavFromKey(
  key: string,
): PromptHistoryListNav | null {
  switch (key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "Home":
      return "home";
    case "End":
      return "end";
    case "PageUp":
      return "pageUp";
    case "PageDown":
      return "pageDown";
    default:
      return null;
  }
}

/**
 * Resolve empty-state presentation for the prompt history picker list.
 * Returns `null` when there is at least one filtered row (no empty UI).
 */
export function resolvePromptHistoryEmptyState(
  input: PromptHistoryEmptyInput,
): PromptHistoryEmptyPresentation | null {
  if (input.filteredCount > 0) return null;
  const q = input.query.trim();
  const scope: PromptHistoryScope =
    input.scope === "recent" ? "recent" : "session";
  const hasFilter = q.length > 0;
  const unfiltered = Math.max(0, input.unfilteredCount | 0);

  if (scope === "recent") {
    return {
      kind: hasFilter ? "recentFilter" : "recent",
      showClearFilter: hasFilter && unfiltered > 0,
    };
  }
  return {
    kind: hasFilter ? "sessionFilter" : "session",
    showClearFilter: hasFilter && unfiltered > 0,
  };
}

/**
 * Map empty kind → i18n message key (catalog `promptHistory.*`).
 */
export function promptHistoryEmptyMessageKey(
  kind: PromptHistoryEmptyKind,
):
  | "promptHistory.empty"
  | "promptHistory.emptyFilter"
  | "promptHistory.emptyRecent"
  | "promptHistory.emptyRecentFilter" {
  switch (kind) {
    case "sessionFilter":
      return "promptHistory.emptyFilter";
    case "recent":
      return "promptHistory.emptyRecent";
    case "recentFilter":
      return "promptHistory.emptyRecentFilter";
    case "session":
    default:
      return "promptHistory.empty";
  }
}
