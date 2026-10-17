import { describe, expect, it } from "vitest";
import {
  resolveChatTranscriptEmptyState,
  shouldReopenUnhydratedSession,
} from "./chatTranscriptEmpty";

describe("resolveChatTranscriptEmptyState", () => {
  it("returns null when the transcript has rows", () => {
    expect(
      resolveChatTranscriptEmptyState({ empty: false, journalLoading: true }),
    ).toBeNull();
  });

  it("returns null when welcome copy is suppressed", () => {
    expect(
      resolveChatTranscriptEmptyState({
        empty: true,
        suppressEmptyCopy: true,
      }),
    ).toBeNull();
  });

  it("shows start chatting for a new draft", () => {
    expect(resolveChatTranscriptEmptyState({ empty: true })).toEqual({
      kind: "start",
      titleKey: "main.startTitle",
      hintKey: "main.startHint",
    });
  });

  it("shows loading copy while the selected journal is in flight", () => {
    expect(
      resolveChatTranscriptEmptyState({ empty: true, journalLoading: true }),
    ).toEqual({
      kind: "loading",
      titleKey: "main.loadingTitle",
      hintKey: "main.loadingHint",
    });
  });

  it("shows loading when a selected session has not hydrated yet", () => {
    expect(
      resolveChatTranscriptEmptyState({
        empty: true,
        hasSession: true,
        journalHydrated: false,
      }),
    ).toEqual({
      kind: "loading",
      titleKey: "main.loadingTitle",
      hintKey: "main.loadingHint",
    });
  });

  it("does not look like a new chat after an empty journal hydrates", () => {
    expect(
      resolveChatTranscriptEmptyState({
        empty: true,
        hasSession: true,
        journalHydrated: true,
      }),
    ).toBeNull();
  });
});

describe("shouldReopenUnhydratedSession", () => {
  const base = {
    sessionId: "s1",
    mainPaneIsChat: true,
    journalHydrated: false,
    journalLoading: false,
    messageCount: 0,
    rowExists: true,
  };

  it("reopens a selected session after HMR wiped the journal cache", () => {
    expect(shouldReopenUnhydratedSession(base)).toBe(true);
  });

  it("does not reopen a draft, a live load, or a painted thread", () => {
    expect(shouldReopenUnhydratedSession({ ...base, sessionId: null })).toBe(
      false,
    );
    expect(
      shouldReopenUnhydratedSession({ ...base, journalLoading: true }),
    ).toBe(false);
    expect(
      shouldReopenUnhydratedSession({ ...base, journalHydrated: true }),
    ).toBe(false);
    expect(shouldReopenUnhydratedSession({ ...base, messageCount: 3 })).toBe(
      false,
    );
    expect(shouldReopenUnhydratedSession({ ...base, rowExists: false })).toBe(
      false,
    );
    expect(
      shouldReopenUnhydratedSession({ ...base, mainPaneIsChat: false }),
    ).toBe(false);
  });
});
