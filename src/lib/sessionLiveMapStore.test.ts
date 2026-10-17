import { describe, expect, it, beforeEach } from "vitest";
import { sessionLiveMapStore } from "./sessionLiveMapStore";
import { projectHostIntoLiveMap } from "./sessionLiveStore";

describe("sessionLiveMapStore", () => {
  beforeEach(() => {
    sessionLiveMapStore.resetForTests();
  });

  it("notifies map listeners on change", () => {
    let ticks = 0;
    const unsub = sessionLiveMapStore.subscribeMap(() => {
      ticks += 1;
    });
    sessionLiveMapStore.setMap((prev) =>
      projectHostIntoLiveMap(prev, {
        sessionId: "a",
        state: "streaming",
        streamingMessageId: "m1",
      }),
    );
    expect(ticks).toBe(1);
    expect(sessionLiveMapStore.getSnapshot("a")?.state).toBe("streaming");
    unsub();
  });

  it("busy meta only bumps when busy membership changes", () => {
    let busyTicks = 0;
    const unsub = sessionLiveMapStore.subscribeBusy(() => {
      busyTicks += 1;
    });
    sessionLiveMapStore.setMap((prev) =>
      projectHostIntoLiveMap(prev, {
        sessionId: "a",
        state: "streaming",
      }),
    );
    expect(busyTicks).toBe(1);
    expect(sessionLiveMapStore.getBusySnapshot().busyCount).toBe(1);

    // Same busy membership (still streaming a) — no busy notify if map identity
    // changes but busy set same... project creates new map so map notifies;
    // busy key still "a".
    sessionLiveMapStore.setMap((prev) =>
      projectHostIntoLiveMap(prev, {
        sessionId: "a",
        state: "streaming",
        streamingMessageId: "m2",
      }),
    );
    expect(busyTicks).toBe(1);

    sessionLiveMapStore.setMap((prev) =>
      projectHostIntoLiveMap(prev, { sessionId: "a", state: "ready" }),
    );
    expect(busyTicks).toBe(2);
    expect(sessionLiveMapStore.getBusySnapshot().busyCount).toBe(0);
    unsub();
  });

  it("setLiveMap identity when reducer returns same ref", () => {
    let ticks = 0;
    const unsub = sessionLiveMapStore.subscribeMap(() => {
      ticks += 1;
    });
    sessionLiveMapStore.setLiveMap((prev) => prev);
    expect(ticks).toBe(0);
    unsub();
  });
});
