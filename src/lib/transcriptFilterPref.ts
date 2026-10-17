/**
 * User preference: filter chat transcript paint list.
 * localStorage-only — does not touch Host AppSettings.
 *
 * - all (default): full activity (Worked-for phases + any standalone tool rows)
 * - conversation: drop standalone tool_step journal rows from the paint list.
 *   Inlined Grok “Worked for …” activity rails on assistant messages stay visible
 *   (they are the clean official summary, not raw tool dumps).
 */

import type { ChatMessage } from "./session";
import { filterTranscriptMessages, isToolStepMessage } from "./session";

export const TRANSCRIPT_FILTER_STORAGE_KEY = "grok.transcriptFilter";

/** Fired on `window` after a successful save (detail = TranscriptFilterMode). */
export const TRANSCRIPT_FILTER_CHANGE_EVENT = "grok-transcript-filter-change";

export type TranscriptFilterMode = "all" | "conversation";

/** Prefer conversation-only by default — fewer tool rows = less DOM thrash mid-stream. */
export const DEFAULT_TRANSCRIPT_FILTER: TranscriptFilterMode = "conversation";

/** Minimal storage surface so unit tests need no jsdom. */
export interface TranscriptFilterStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): TranscriptFilterStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → default (conversation). */
export function parseTranscriptFilterPref(raw: unknown): TranscriptFilterMode {
  if (raw === "conversation" || raw === "conversation_only") {
    return "conversation";
  }
  if (raw === "all" || raw === "full") return "all";
  return DEFAULT_TRANSCRIPT_FILTER;
}

export function loadTranscriptFilterPref(
  storage: TranscriptFilterStorage = defaultStorage(),
): TranscriptFilterMode {
  try {
    return parseTranscriptFilterPref(
      storage.getItem(TRANSCRIPT_FILTER_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_TRANSCRIPT_FILTER;
  }
}

export function saveTranscriptFilterPref(
  mode: TranscriptFilterMode,
  storage: TranscriptFilterStorage = defaultStorage(),
): void {
  const next: TranscriptFilterMode =
    mode === "conversation" ? "conversation" : "all";
  try {
    storage.setItem(TRANSCRIPT_FILTER_STORAGE_KEY, next);
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(TRANSCRIPT_FILTER_CHANGE_EVENT, { detail: next }),
      );
    } catch {
      /* ignore */
    }
  }
}

/**
 * Pure paint-list filter for the chat transcript.
 *
 * Always drops tool_step journal rows already woven into an assistant timeline
 * (virtualization hygiene — same as {@link filterTranscriptMessages}).
 *
 * When `mode === "conversation"`, also drops every remaining standalone
 * tool_step row. Assistant Worked-for phases stay (tools live in segments).
 */
export function filterMessagesForTranscript(
  messages: ChatMessage[],
  mode: TranscriptFilterMode = DEFAULT_TRANSCRIPT_FILTER,
): ChatMessage[] {
  const base = filterTranscriptMessages(messages);
  if (mode !== "conversation") return base;
  return base.filter((m) => !isToolStepMessage(m));
}

/**
 * Standalone / live mid-stream tool chrome (tool_step rows, live tool line).
 * Does **not** gate the assistant Worked-for activity rail — that always paints.
 */
export function shouldShowTranscriptToolChrome(
  mode: TranscriptFilterMode,
): boolean {
  return mode !== "conversation";
}
