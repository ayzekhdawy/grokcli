import { describe, expect, it } from "vitest";
import { automationsBackgroundStatus } from "./automationsBackgroundStatus";

describe("automationsBackgroundStatus", () => {
  it("is inactive when no enabled automations", () => {
    expect(
      automationsBackgroundStatus({
        openAtLogin: false,
        enabledCount: 0,
        runnerKnown: true,
      }),
    ).toEqual({
      severity: "none",
      messageKey: null,
      quitNoteKey: null,
      showOpenAtLoginLink: false,
      enabledCount: 0,
    });
    expect(
      automationsBackgroundStatus({
        openAtLogin: true,
        enabledCount: 0,
        runnerKnown: true,
      }).severity,
    ).toBe("none");
  });

  it("warns and offers launch-at-login link when schedules need the app", () => {
    const s = automationsBackgroundStatus({
      openAtLogin: false,
      enabledCount: 2,
      runnerKnown: true,
    });
    expect(s.severity).toBe("warn");
    expect(s.messageKey).toBe("automations.bg.needsApp");
    expect(s.quitNoteKey).toBe("app.quitBusy.automationsNote");
    expect(s.showOpenAtLoginLink).toBe(true);
    expect(s.enabledCount).toBe(2);
  });

  it("is info when login item is on (honest: still pauses until relaunch)", () => {
    const s = automationsBackgroundStatus({
      openAtLogin: true,
      enabledCount: 1,
      runnerKnown: true,
    });
    expect(s.severity).toBe("info");
    expect(s.messageKey).toBe("automations.bg.withLoginItem");
    expect(s.quitNoteKey).toBe("app.quitBusy.automationsNoteLogin");
    expect(s.showOpenAtLoginLink).toBe(false);
  });

  it("never claims a detached daemon when runner is unknown", () => {
    const s = automationsBackgroundStatus({
      openAtLogin: true,
      enabledCount: 3,
      runnerKnown: false,
    });
    expect(s.severity).toBe("warn");
    expect(s.messageKey).toBe("automations.bg.runnerUnknown");
    expect(s.quitNoteKey).toBe("app.quitBusy.automationsNote");
    // Login item already on — no redundant settings link.
    expect(s.showOpenAtLoginLink).toBe(false);

    const s2 = automationsBackgroundStatus({
      openAtLogin: false,
      enabledCount: 1,
      runnerKnown: false,
    });
    expect(s2.showOpenAtLoginLink).toBe(true);
  });

  it("normalizes fractional / invalid counts", () => {
    expect(
      automationsBackgroundStatus({
        openAtLogin: false,
        enabledCount: 1.8,
        runnerKnown: true,
      }).enabledCount,
    ).toBe(1);
    expect(
      automationsBackgroundStatus({
        openAtLogin: false,
        enabledCount: -3,
        runnerKnown: true,
      }).severity,
    ).toBe("none");
    expect(
      automationsBackgroundStatus({
        openAtLogin: false,
        enabledCount: Number.NaN,
        runnerKnown: true,
      }).severity,
    ).toBe("none");
  });
});
