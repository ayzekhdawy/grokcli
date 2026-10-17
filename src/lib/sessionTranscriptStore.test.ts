import { describe, expect, it, beforeEach, vi } from "vitest";
import { sessionTranscriptStore } from "./sessionTranscriptStore";
import type { ChatMessage } from "./session";
import { resolveTranscriptContentNotifyMs } from "./streamRenderPolicy";

const msg = (
  partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role">,
): ChatMessage => ({
  content: "",
  ...partial,
});

describe("sessionTranscriptStore", () => {
  beforeEach(() => {
    sessionTranscriptStore.resetForTests();
  });

  it("notifies content on stream growth but keeps structuralRev stable", () => {
    sessionTranscriptStore.setViewingSessionId("s1");
    sessionTranscriptStore.setMessages([
      msg({ id: "u1", role: "user", content: "hi" }),
      msg({ id: "a1", role: "assistant", content: "he", streaming: true }),
    ]);
    const rev1 = sessionTranscriptStore.getMetaSnapshot().structuralRev;
    let contentTicks = 0;
    let metaTicks = 0;
    const unsubC = sessionTranscriptStore.subscribeContent(() => {
      contentTicks += 1;
    });
    const unsubM = sessionTranscriptStore.subscribeMeta(() => {
      metaTicks += 1;
    });

    sessionTranscriptStore.setMessages((prev) =>
      prev.map((m) =>
        m.id === "a1" ? { ...m, content: m.content + "llo" } : m,
      ),
    );

    expect(sessionTranscriptStore.getMessages()[1]!.content).toBe("hello");
    expect(contentTicks).toBe(1);
    expect(metaTicks).toBe(0);
    expect(sessionTranscriptStore.getMetaSnapshot().structuralRev).toBe(rev1);

    unsubC();
    unsubM();
  });

  it("bumps structuralRev when streaming ends", () => {
    sessionTranscriptStore.setViewingSessionId("s1");
    sessionTranscriptStore.setMessages([
      msg({ id: "a1", role: "assistant", content: "x", streaming: true }),
    ]);
    const rev1 = sessionTranscriptStore.getMetaSnapshot().structuralRev;
    let metaTicks = 0;
    const unsubM = sessionTranscriptStore.subscribeMeta(() => {
      metaTicks += 1;
    });

    sessionTranscriptStore.setMessages((prev) =>
      prev.map((m) => (m.id === "a1" ? { ...m, streaming: false } : m)),
    );

    expect(metaTicks).toBe(1);
    expect(sessionTranscriptStore.getMetaSnapshot().structuralRev).toBe(
      rev1 + 1,
    );
    expect(sessionTranscriptStore.getMetaSnapshot().hasStreamingAssistant).toBe(
      false,
    );
    unsubM();
  });

  it("patchSession only updates cache for background sessions", () => {
    sessionTranscriptStore.setViewingSessionId("s1");
    sessionTranscriptStore.setMessages([
      msg({ id: "u1", role: "user", content: "viewing" }),
    ]);
    sessionTranscriptStore.cacheSession("s2", [
      msg({ id: "u2", role: "user", content: "bg" }),
    ]);

    let contentTicks = 0;
    const unsubC = sessionTranscriptStore.subscribeContent(() => {
      contentTicks += 1;
    });

    sessionTranscriptStore.patchSession("s2", (prev) => [
      ...prev,
      msg({ id: "a2", role: "assistant", content: "done" }),
    ]);

    expect(contentTicks).toBe(0);
    expect(sessionTranscriptStore.getCached("s2")).toHaveLength(2);
    expect(sessionTranscriptStore.getMessages()).toHaveLength(1);
    unsubC();
  });

  it("throttles content notifies for rapid stream growth (trailing flush)", () => {
    vi.useFakeTimers();
    sessionTranscriptStore.setViewingSessionId("s1");
    sessionTranscriptStore.setMessages([
      msg({ id: "a1", role: "assistant", content: "a", streaming: true }),
    ]);
    let contentTicks = 0;
    const unsubC = sessionTranscriptStore.subscribeContent(() => {
      contentTicks += 1;
    });

    // Leading edge
    sessionTranscriptStore.setMessages((prev) =>
      prev.map((m) =>
        m.id === "a1" ? { ...m, content: m.content + "b" } : m,
      ),
    );
    expect(contentTicks).toBe(1);

    // Inside throttle window — no extra tick yet
    sessionTranscriptStore.setMessages((prev) =>
      prev.map((m) =>
        m.id === "a1" ? { ...m, content: m.content + "c" } : m,
      ),
    );
    expect(contentTicks).toBe(1);
    expect(sessionTranscriptStore.getMessages()[0]!.content).toBe("abc");

    vi.advanceTimersByTime(resolveTranscriptContentNotifyMs());
    expect(contentTicks).toBe(2);

    unsubC();
    vi.useRealTimers();
  });

  it("does not poison the new session when viewing id moves before messages swap (#529)", () => {
    // Simulate openSession handoff: user was on s1, viewing id flips to s2
    // while s1's transcript is still painted (disk load not finished).
    sessionTranscriptStore.setViewingSessionId("s1");
    sessionTranscriptStore.setMessages([
      msg({ id: "u-a", role: "user", content: "project A question" }),
      msg({
        id: "a-a",
        role: "assistant",
        content: "answer for project A",
        streaming: false,
      }),
    ]);
    expect(sessionTranscriptStore.getMessagesOwnerSessionId()).toBe("s1");

    // openSession points viewing at s2 first (stream routing), without content yet.
    sessionTranscriptStore.setViewingSessionId("s2");
    // Stream / rehydrate for s2 must not reduce against project A's messages.
    sessionTranscriptStore.patchSession("s2", (prev) => [
      ...prev,
      msg({ id: "u-b", role: "user", content: "project B question" }),
      msg({
        id: "a-b",
        role: "assistant",
        content: "B",
        streaming: true,
      }),
    ]);

    const viewing = sessionTranscriptStore.getMessages();
    expect(viewing.map((m) => m.id)).toEqual(["u-b", "a-b"]);
    expect(viewing.some((m) => m.content.includes("project A"))).toBe(false);
    expect(sessionTranscriptStore.getMessagesOwnerSessionId()).toBe("s2");
    // s1 cache stays intact
    expect(sessionTranscriptStore.getCached("s1")?.map((m) => m.id)).toEqual([
      "u-a",
      "a-a",
    ]);
  });

  it("setMessages reducer ignores foreign transcript after viewing id handoff (#529)", () => {
    sessionTranscriptStore.setViewingSessionId("s1");
    sessionTranscriptStore.setMessages([
      msg({ id: "u-a", role: "user", content: "A body" }),
      msg({ id: "a-a", role: "assistant", content: "A ans", streaming: true }),
    ]);
    sessionTranscriptStore.setViewingSessionId("s2");
    // Functional update must not clear-streaming on A's rows into s2.
    sessionTranscriptStore.setMessages((prev) => {
      if (!prev.some((m) => m.streaming)) return prev;
      return prev.map((m) => (m.streaming ? { ...m, streaming: false } : m));
    });
    expect(sessionTranscriptStore.getMessages()).toEqual([]);
    expect(sessionTranscriptStore.getMessagesOwnerSessionId()).toBe("s2");
    expect(
      sessionTranscriptStore.getCached("s1")?.find((m) => m.id === "a-a")
        ?.streaming,
    ).toBe(true);
  });

  it("tracks journal loading vs hydrated so empty is not a fresh chat", () => {
    sessionTranscriptStore.setViewingSessionId("s2");
    let metaTicks = 0;
    const unsub = sessionTranscriptStore.subscribeMeta(() => {
      metaTicks += 1;
    });
    sessionTranscriptStore.beginJournalLoad("s2");
    expect(sessionTranscriptStore.getMetaSnapshot().journalLoading).toBe(true);
    expect(sessionTranscriptStore.getMetaSnapshot().journalHydrated).toBe(false);
    expect(sessionTranscriptStore.isJournalLoading("s2")).toBe(true);
    expect(sessionTranscriptStore.isJournalHydrated("s2")).toBe(false);
    expect(metaTicks).toBe(1);

    sessionTranscriptStore.finishJournalLoad("s2");
    expect(sessionTranscriptStore.getMetaSnapshot().journalLoading).toBe(false);
    expect(sessionTranscriptStore.getMetaSnapshot().journalHydrated).toBe(true);
    expect(sessionTranscriptStore.isJournalHydrated("s2")).toBe(true);
    expect(sessionTranscriptStore.isJournalLoading("s2")).toBe(false);

    sessionTranscriptStore.beginJournalLoad("s3");
    expect(sessionTranscriptStore.getMetaSnapshot().journalLoading).toBe(false);
    sessionTranscriptStore.abortJournalLoad("s3");
    expect(sessionTranscriptStore.isJournalHydrated("s3")).toBe(false);
    unsub();
  });
});
