/**
 * User preference: command-palette session search filter chips.
 * localStorage-only — does not touch Host AppSettings.
 *
 * Persists scope mode (all / title / content) and include-archived.
 * Rank mode lives in `sessionSearchRankPref` (separate setting).
 */

import {
  DEFAULT_SESSION_SEARCH_INCLUDE_ARCHIVED,
  DEFAULT_SESSION_SEARCH_MODE,
  parseSessionSearchMode,
  type SessionSearchFilterState,
  type SessionSearchMode,
  defaultSessionSearchFilterState,
} from "./sessionSearch";

export const SESSION_SEARCH_FILTER_STORAGE_KEY = "grok.sessionSearchFilters";

/** Fired on `window` after a successful save (detail = SessionSearchFilterState). */
export const SESSION_SEARCH_FILTER_CHANGE_EVENT =
  "grok-session-search-filter-change";

export const DEFAULT_SESSION_SEARCH_FILTER_PREF: SessionSearchFilterState =
  defaultSessionSearchFilterState();

/** Minimal storage surface so unit tests need no jsdom. */
export interface SessionSearchFilterStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): SessionSearchFilterStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

function normalizeState(
  partial: Partial<SessionSearchFilterState> | null | undefined,
): SessionSearchFilterState {
  const mode = parseSessionSearchMode(partial?.mode);
  const includeArchived =
    typeof partial?.includeArchived === "boolean"
      ? partial.includeArchived
      : DEFAULT_SESSION_SEARCH_INCLUDE_ARCHIVED;
  return { mode, includeArchived };
}

export function loadSessionSearchFilterPref(
  storage: SessionSearchFilterStorage = defaultStorage(),
): SessionSearchFilterState {
  try {
    const raw = storage.getItem(SESSION_SEARCH_FILTER_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SESSION_SEARCH_FILTER_PREF };
    // Accept JSON object or legacy plain mode string.
    if (raw === "all" || raw === "title" || raw === "content") {
      return normalizeState({ mode: raw as SessionSearchMode });
    }
    const parsed = JSON.parse(raw) as Partial<SessionSearchFilterState>;
    if (!parsed || typeof parsed !== "object") {
      return { ...DEFAULT_SESSION_SEARCH_FILTER_PREF };
    }
    return normalizeState(parsed);
  } catch {
    /* private mode / bad JSON */
    return { ...DEFAULT_SESSION_SEARCH_FILTER_PREF };
  }
}

export function saveSessionSearchFilterPref(
  state: Partial<SessionSearchFilterState>,
  storage: SessionSearchFilterStorage = defaultStorage(),
): SessionSearchFilterState {
  const next = normalizeState({
    ...loadSessionSearchFilterPref(storage),
    ...state,
  });
  // Ensure mode is never left as invalid after merge.
  next.mode = parseSessionSearchMode(next.mode);
  if (next.mode !== "title" && next.mode !== "content") {
    next.mode = DEFAULT_SESSION_SEARCH_MODE;
  }
  try {
    storage.setItem(
      SESSION_SEARCH_FILTER_STORAGE_KEY,
      JSON.stringify({
        mode: next.mode,
        includeArchived: !!next.includeArchived,
      }),
    );
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(SESSION_SEARCH_FILTER_CHANGE_EVENT, { detail: next }),
      );
    } catch {
      /* ignore */
    }
  }
  return next;
}
