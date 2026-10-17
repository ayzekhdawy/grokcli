/**
 * User preference: session search ranking mode (command palette).
 * localStorage-only — does not touch Host AppSettings.
 *
 * - keyword (default): substring match, stable title-then-content order
 * - hybrid: keyword + local token-overlap ranking on titles/snippets
 *   (honest local hybrid — not cloud embeddings)
 */

import {
  DEFAULT_SESSION_SEARCH_RANK_MODE,
  parseSessionSearchRankMode,
  type SessionSearchRankMode,
} from "./sessionSearch";

export const SESSION_SEARCH_RANK_STORAGE_KEY = "grok.sessionSearchRank";

/** Fired on `window` after a successful save (detail = SessionSearchRankMode). */
export const SESSION_SEARCH_RANK_CHANGE_EVENT = "grok-session-search-rank-change";

export const DEFAULT_SESSION_SEARCH_RANK_PREF: SessionSearchRankMode =
  DEFAULT_SESSION_SEARCH_RANK_MODE;

/** Minimal storage surface so unit tests need no jsdom. */
export interface SessionSearchRankStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): SessionSearchRankStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

export function loadSessionSearchRankPref(
  storage: SessionSearchRankStorage = defaultStorage(),
): SessionSearchRankMode {
  try {
    return parseSessionSearchRankMode(
      storage.getItem(SESSION_SEARCH_RANK_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_SESSION_SEARCH_RANK_PREF;
  }
}

export function saveSessionSearchRankPref(
  mode: SessionSearchRankMode,
  storage: SessionSearchRankStorage = defaultStorage(),
): void {
  const next: SessionSearchRankMode =
    mode === "hybrid" ? "hybrid" : "keyword";
  try {
    storage.setItem(SESSION_SEARCH_RANK_STORAGE_KEY, next);
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(SESSION_SEARCH_RANK_CHANGE_EVENT, { detail: next }),
      );
    } catch {
      /* ignore */
    }
  }
}
