import { describe, expect, it } from "vitest";
import {
  MAIN_WINDOW_LABEL,
  buildSessionDeepLinkHash,
  canLiveParticipate,
  canOpenSessionInNewWindow,
  canStreamConcurrently,
  concurrentConnectPreservesOther,
  demotePreservesAgent,
  isLiveSlotTurnBusy,
  isMainWindowLabel,
  isSessionWindowLabel,
  liveSlotBusyFromState,
  liveSlotSoftFailMessageKey,
  parseSessionDeepLinkHash,
  parseSessionWindowLabel,
  planConnectToSession,
  resolveSecondarySessionId,
  resolveStopTargets,
  sanitizeSessionIdForLabel,
  sessionWindowLabel,
  shouldDeferWarmConnectForForeignBusy,
  shouldSkipAgentSpawn,
  shouldSkipWarmConnect,
  stopScopeMessageKey,
  type LiveAgentSlot,
} from "./multiWindow";

const UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const UUID_B = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

describe("multiWindow", () => {
  it("sanitizes session ids for labels (UUID-safe)", () => {
    expect(sanitizeSessionIdForLabel(UUID)).toBe(UUID);
    expect(sanitizeSessionIdForLabel(`  ${UUID}  `)).toBe(UUID);
    expect(sanitizeSessionIdForLabel("")).toBeNull();
    expect(sanitizeSessionIdForLabel("bad id")).toBeNull();
    expect(sanitizeSessionIdForLabel("../etc")).toBeNull();
    expect(sanitizeSessionIdForLabel("a/b")).toBeNull();
  });

  it("builds and parses session window labels", () => {
    expect(sessionWindowLabel(UUID)).toBe(`session-${UUID}`);
    expect(parseSessionWindowLabel(`session-${UUID}`)).toBe(UUID);
    expect(parseSessionWindowLabel(MAIN_WINDOW_LABEL)).toBeNull();
    expect(parseSessionWindowLabel("session-")).toBeNull();
    expect(isSessionWindowLabel(`session-${UUID}`)).toBe(true);
    expect(isSessionWindowLabel(MAIN_WINDOW_LABEL)).toBe(false);
    expect(isMainWindowLabel(MAIN_WINDOW_LABEL)).toBe(true);
    expect(isMainWindowLabel(`session-${UUID}`)).toBe(false);
  });

  it("builds and parses #/session/<id> deep links", () => {
    expect(buildSessionDeepLinkHash(UUID)).toBe(`#/session/${UUID}`);
    expect(parseSessionDeepLinkHash(`#/session/${UUID}`)).toBe(UUID);
    expect(parseSessionDeepLinkHash(`/session/${UUID}`)).toBe(UUID);
    expect(parseSessionDeepLinkHash(`session/${UUID}`)).toBe(UUID);
    expect(parseSessionDeepLinkHash(`#/session/${UUID}?x=1`)).toBe(UUID);
    expect(parseSessionDeepLinkHash("#/settings/general")).toBeNull();
    expect(parseSessionDeepLinkHash("#/workbench")).toBeNull();
    expect(parseSessionDeepLinkHash("")).toBeNull();
    expect(buildSessionDeepLinkHash("bad id")).toBe("");
  });

  it("resolves secondary focus from hash then label", () => {
    expect(
      resolveSecondarySessionId({
        hash: `#/session/${UUID}`,
        windowLabel: "session-other",
      }),
    ).toBe(UUID);
    expect(
      resolveSecondarySessionId({
        hash: "#/workbench",
        windowLabel: `session-${UUID}`,
      }),
    ).toBe(UUID);
    expect(
      resolveSecondarySessionId({ hash: "", windowLabel: "main" }),
    ).toBeNull();
  });

  it("gates open-in-new-window to desktop main only", () => {
    expect(
      canOpenSessionInNewWindow({
        isDesktopHost: true,
        isSecondaryWindow: false,
        sessionId: UUID,
      }),
    ).toBe(true);
    expect(
      canOpenSessionInNewWindow({
        isDesktopHost: false,
        isSecondaryWindow: false,
        sessionId: UUID,
      }),
    ).toBe(false);
    expect(
      canOpenSessionInNewWindow({
        isDesktopHost: true,
        isSecondaryWindow: true,
        sessionId: UUID,
      }),
    ).toBe(false);
    expect(
      canOpenSessionInNewWindow({
        isDesktopHost: true,
        isSecondaryWindow: false,
        sessionId: "",
      }),
    ).toBe(false);
  });

  it("allows passive warm-connect on main and secondary (session-keyed pool)", () => {
    // A1: secondary no longer skips passive warm-connect by role alone.
    expect(shouldSkipWarmConnect(true)).toBe(false);
    expect(shouldSkipWarmConnect(false)).toBe(false);
    expect(shouldSkipAgentSpawn(true)).toBe(false);
    expect(shouldSkipAgentSpawn(false)).toBe(false);
  });

  it("never defers foreign-busy warm-connect (process sharing)", () => {
    // Process sharing + concurrent multi-session: connecting another chat no
    // longer steals the live slot from a streaming turn — deferring left
    // viewed history chats unconnected whenever anything else was mid-turn.
    expect(
      shouldDeferWarmConnectForForeignBusy({
        isSecondaryWindow: false,
        foreignBusy: true,
      }),
    ).toBe(false);
    expect(
      shouldDeferWarmConnectForForeignBusy({
        isSecondaryWindow: false,
        foreignBusy: false,
      }),
    ).toBe(false);
    expect(
      shouldDeferWarmConnectForForeignBusy({
        isSecondaryWindow: true,
        foreignBusy: true,
      }),
    ).toBe(false);
  });

  it("allows live send/stop from main and secondary (shared Host)", () => {
    expect(canLiveParticipate(false)).toBe(true);
    expect(canLiveParticipate(true)).toBe(true);
  });
});

describe("live agent slot pool", () => {
  const liveAStreaming: LiveAgentSlot = {
    sessionId: UUID,
    kind: "live",
    busy: "streaming",
  };
  const liveAReady: LiveAgentSlot = {
    sessionId: UUID,
    kind: "live",
    busy: "idle",
  };

  it("maps host states to slot busy", () => {
    expect(liveSlotBusyFromState("streaming")).toBe("streaming");
    expect(liveSlotBusyFromState("awaiting_permission")).toBe(
      "awaiting_permission",
    );
    expect(liveSlotBusyFromState("connecting")).toBe("connecting");
    expect(liveSlotBusyFromState("ready")).toBe("idle");
    expect(liveSlotBusyFromState(null)).toBe("idle");
  });

  it("treats streaming/connecting/permission as turn-busy", () => {
    expect(isLiveSlotTurnBusy("streaming")).toBe(true);
    expect(isLiveSlotTurnBusy("awaiting_permission")).toBe(true);
    expect(isLiveSlotTurnBusy("connecting")).toBe(true);
    expect(isLiveSlotTurnBusy("idle")).toBe(false);
  });

  it("concurrent connect never kills a busy foreign agent", () => {
    expect(concurrentConnectPreservesOther(liveAStreaming)).toBe(true);
    expect(concurrentConnectPreservesOther(liveAReady)).toBe(true);
    expect(
      concurrentConnectPreservesOther({
        sessionId: UUID,
        kind: "background",
        busy: "streaming",
      }),
    ).toBe(true);
    expect(concurrentConnectPreservesOther(null)).toBe(true);
    expect(demotePreservesAgent(liveAStreaming)).toBe(true);
    expect(demotePreservesAgent(liveAReady)).toBe(true);
  });

  it("plans connect: noop when target already warm", () => {
    expect(
      planConnectToSession({
        targetSessionId: UUID,
        live: liveAStreaming,
      }),
    ).toEqual({
      action: "noop",
      reason: "already_live",
      targetSessionId: UUID,
    });

    expect(
      planConnectToSession({
        targetSessionId: UUID_B,
        live: liveAStreaming,
        background: {
          [UUID_B]: {
            sessionId: UUID_B,
            kind: "background",
            busy: "streaming",
          },
        },
      }),
    ).toEqual({
      action: "noop",
      reason: "already_background",
      targetSessionId: UUID_B,
    });

    expect(
      planConnectToSession({
        targetSessionId: UUID_B,
        live: liveAReady,
        parked: {
          [UUID_B]: { sessionId: UUID_B, kind: "parked", busy: "idle" },
        },
      }),
    ).toEqual({
      action: "noop",
      reason: "already_parked_ready",
      targetSessionId: UUID_B,
    });
  });

  it("plans connect: demote busy live preserves agent (two-window concurrent)", () => {
    const plan = planConnectToSession({
      targetSessionId: UUID_B,
      live: liveAStreaming,
      activeProcessCount: 1,
      maxConcurrentAgents: 8,
    });
    expect(plan).toEqual({
      action: "connect",
      targetSessionId: UUID_B,
      demotesSessionId: UUID,
      demotePreservesAgent: true,
    });
    // Two distinct sessions can stream concurrently under the pool.
    expect(canStreamConcurrently(UUID, UUID_B)).toBe(true);
    expect(canStreamConcurrently(UUID, UUID)).toBe(false);
  });

  it("plans connect: soft-fail process limit on cold spawn when pool full", () => {
    expect(
      planConnectToSession({
        targetSessionId: UUID_B,
        live: liveAStreaming,
        activeProcessCount: 8,
        maxConcurrentAgents: 8,
      }),
    ).toEqual({
      action: "soft_fail",
      reason: "process_limit",
      targetSessionId: UUID_B,
    });
    // Warm target does not soft-fail capacity (no new process).
    expect(
      planConnectToSession({
        targetSessionId: UUID_B,
        live: liveAStreaming,
        targetHasWarmProcess: true,
        activeProcessCount: 8,
        maxConcurrentAgents: 8,
      }).action,
    ).toBe("connect");
  });

  it("plans connect: invalid session soft-fails", () => {
    expect(
      planConnectToSession({
        targetSessionId: "bad id",
        live: null,
      }),
    ).toEqual({
      action: "soft_fail",
      reason: "invalid_session",
      targetSessionId: null,
    });
  });

  it("resolves stop targets: current vs all_busy", () => {
    expect(
      resolveStopTargets({
        scope: "current",
        currentSessionId: UUID,
        busySessionIds: [UUID, UUID_B],
      }),
    ).toEqual([UUID]);

    expect(
      resolveStopTargets({
        scope: "current",
        currentSessionId: null,
        busySessionIds: [UUID],
      }),
    ).toEqual([]);

    expect(
      resolveStopTargets({
        scope: "all_busy",
        currentSessionId: UUID,
        busySessionIds: [UUID, UUID_B, UUID, "bad id"],
      }),
    ).toEqual([UUID, UUID_B]);
  });

  it("maps soft-fail / stop scope to stable message keys", () => {
    expect(liveSlotSoftFailMessageKey("process_limit")).toBe(
      "agent.processLimitToast",
    );
    expect(stopScopeMessageKey("current")).toBe("composer.stop");
    expect(stopScopeMessageKey("all_busy")).toBe("tasks.activity.stopAll");
  });
});
