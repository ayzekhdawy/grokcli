import { describe, expect, it, beforeEach } from "vitest";
import { sessionShellStore } from "./sessionShellStore";
import { IDLE_SNAPSHOT } from "./session";

describe("sessionShellStore", () => {
  beforeEach(() => {
    sessionShellStore.resetForTests();
  });

  it("notifies session on real change; skips identical snapshot", () => {
    let ticks = 0;
    const unsub = sessionShellStore.subscribeSession(() => {
      ticks += 1;
    });
    sessionShellStore.setSession({
      ...IDLE_SNAPSHOT,
      sessionId: "s1",
      state: "ready",
    });
    expect(ticks).toBe(1);
    sessionShellStore.setSession({
      ...IDLE_SNAPSHOT,
      sessionId: "s1",
      state: "ready",
    });
    expect(ticks).toBe(1);
    unsub();
  });

  it("meta rev bumps only on structural fields", () => {
    let metaTicks = 0;
    const unsub = sessionShellStore.subscribeMeta(() => {
      metaTicks += 1;
    });
    sessionShellStore.setSession({
      ...IDLE_SNAPSHOT,
      sessionId: "s1",
      state: "streaming",
      streamingMessageId: "m1",
    });
    expect(metaTicks).toBe(1);
    const rev1 = sessionShellStore.getMetaSnapshot().rev;

    // streamingMessageId is ignored for shell equality (state already streaming)
    let sessionTicks = 0;
    const unsubS = sessionShellStore.subscribeSession(() => {
      sessionTicks += 1;
    });
    sessionShellStore.setSession({
      ...IDLE_SNAPSHOT,
      sessionId: "s1",
      state: "streaming",
      streamingMessageId: "m2",
    });
    expect(sessionShellStore.getMetaSnapshot().rev).toBe(rev1);
    expect(metaTicks).toBe(1);
    expect(sessionTicks).toBe(0);
    unsubS();

    sessionShellStore.setSession({
      ...IDLE_SNAPSHOT,
      sessionId: "s1",
      state: "ready",
    });
    expect(metaTicks).toBe(2);
    unsub();
  });
});
