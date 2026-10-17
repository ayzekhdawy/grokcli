import { describe, expect, it } from "vitest";
import {
  automationsRunnerBanner,
  shouldHideToTrayOnClose,
} from "./automationsRunnerPolicy";

describe("shouldHideToTrayOnClose", () => {
  it("always hides when closeToTray is on", () => {
    expect(
      shouldHideToTrayOnClose({
        closeToTray: true,
        keepTrayForSchedules: false,
        anyEnabledAutomation: false,
      }),
    ).toBe(true);
  });

  it("hides when keep-tray-for-schedules and an enabled task exist", () => {
    expect(
      shouldHideToTrayOnClose({
        closeToTray: false,
        keepTrayForSchedules: true,
        anyEnabledAutomation: true,
      }),
    ).toBe(true);
  });

  it("does not hide when close-to-tray is off and no enabled tasks", () => {
    expect(
      shouldHideToTrayOnClose({
        closeToTray: false,
        keepTrayForSchedules: true,
        anyEnabledAutomation: false,
      }),
    ).toBe(false);
  });

  it("does not hide when both policies are off", () => {
    expect(
      shouldHideToTrayOnClose({
        closeToTray: false,
        keepTrayForSchedules: false,
        anyEnabledAutomation: true,
      }),
    ).toBe(false);
  });
});

describe("automationsRunnerBanner", () => {
  it("is quiet when no enabled tasks", () => {
    const b = automationsRunnerBanner({
      enabledCount: 0,
      keepTrayForSchedules: true,
      closeToTray: true,
      launchAgentSupported: true,
      launchAgentEnabled: false,
      runnerKnown: true,
    });
    expect(b.severity).toBe("none");
    expect(b.messageKey).toBeNull();
    expect(b.showKeepTrayToggle).toBe(true);
  });

  it("info when tray residency keeps process alive", () => {
    const b = automationsRunnerBanner({
      enabledCount: 2,
      keepTrayForSchedules: true,
      closeToTray: false,
      launchAgentSupported: true,
      launchAgentEnabled: false,
      runnerKnown: true,
    });
    expect(b.severity).toBe("info");
    expect(b.messageKey).toBe("automations.runner.activeTray");
  });

  it("warns when close would quit with schedules enabled", () => {
    const b = automationsRunnerBanner({
      enabledCount: 1,
      keepTrayForSchedules: false,
      closeToTray: false,
      launchAgentSupported: true,
      launchAgentEnabled: false,
      runnerKnown: true,
    });
    expect(b.severity).toBe("warn");
    expect(b.messageKey).toBe("automations.runner.needsTray");
  });

  it("does not claim a daemon when runner is unknown", () => {
    const b = automationsRunnerBanner({
      enabledCount: 3,
      keepTrayForSchedules: true,
      closeToTray: true,
      launchAgentSupported: false,
      launchAgentEnabled: false,
      runnerKnown: false,
    });
    expect(b.severity).toBe("warn");
    expect(b.messageKey).toBe("automations.runner.quitPauses");
    expect(b.showLaunchAgent).toBe(false);
  });
});
