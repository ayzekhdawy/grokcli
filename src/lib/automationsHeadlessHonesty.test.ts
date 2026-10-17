import { describe, expect, it } from "vitest";
import {
  automationsHonestyMatrix,
  automationsOneShotHelperSurface,
  deriveAutomationsRunnerSurface,
  FIRE_DUE_SCHEDULES_FLAG,
  fireDueOutcomeMessageKey,
  formatLaunchAgentSoftFailDetail,
  launchAgentSoftFail,
  wantsFireDueSchedules,
} from "./automationsHeadlessHonesty";

describe("deriveAutomationsRunnerSurface", () => {
  const base = {
    runnerKnown: true,
    running: true,
    lastTickAt: "2026-07-31T12:00:00.000Z",
    tickIntervalSecs: 30,
    enabledCount: 2,
    closeToTray: true,
    keepTrayForSchedules: true,
    launchAgentEnabled: false,
  };

  it("is quiet when nothing is enabled", () => {
    const s = deriveAutomationsRunnerSurface({
      ...base,
      enabledCount: 0,
    });
    expect(s.pausedReason).toBe("no_enabled");
    expect(s.severity).toBe("none");
    expect(s.phase).toBe("running");
    expect(s.pausedReasonKey).toBe("automations.runner.reason.noEnabled");
  });

  it("warns when runner is unknown with enabled tasks (no daemon claim)", () => {
    const s = deriveAutomationsRunnerSurface({
      ...base,
      runnerKnown: false,
      running: false,
    });
    expect(s.phase).toBe("unknown");
    expect(s.pausedReason).toBe("runner_unknown");
    expect(s.severity).toBe("warn");
    expect(s.pausedReasonKey).toBe("automations.runner.reason.unknown");
  });

  it("warns when close would quit the process (no tray residency)", () => {
    const s = deriveAutomationsRunnerSurface({
      ...base,
      closeToTray: false,
      keepTrayForSchedules: false,
    });
    expect(s.pausedReason).toBe("close_exits");
    expect(s.severity).toBe("warn");
    expect(s.hidesOnClose).toBe(false);
  });

  it("info process_bound when tray residency keeps process alive", () => {
    const s = deriveAutomationsRunnerSurface(base);
    expect(s.phase).toBe("running");
    expect(s.pausedReason).toBe("process_bound");
    expect(s.severity).toBe("info");
    expect(s.hidesOnClose).toBe(true);
    expect(s.lastTickAt).toBe(base.lastTickAt);
  });

  it("treats keep-tray-for-schedules like close-to-tray when tasks enabled", () => {
    const s = deriveAutomationsRunnerSurface({
      ...base,
      closeToTray: false,
      keepTrayForSchedules: true,
    });
    expect(s.hidesOnClose).toBe(true);
    expect(s.pausedReason).toBe("process_bound");
  });

  it("LaunchAgent alone does not replace tray residency (still close_exits)", () => {
    // LaunchAgent only relaunches full app at login/crash — not this process.
    const s = deriveAutomationsRunnerSurface({
      ...base,
      closeToTray: false,
      keepTrayForSchedules: false,
      launchAgentEnabled: true,
    });
    expect(s.pausedReason).toBe("close_exits");
    expect(s.hidesOnClose).toBe(false);
    expect(s.severity).toBe("warn");
  });

  it("awaiting_tick when running but no tick yet", () => {
    const s = deriveAutomationsRunnerSurface({
      ...base,
      lastTickAt: null,
    });
    expect(s.pausedReason).toBe("awaiting_tick");
    expect(s.severity).toBe("info");
  });

  it("normalizes bad counts and tick intervals", () => {
    const s = deriveAutomationsRunnerSurface({
      ...base,
      enabledCount: -2,
      tickIntervalSecs: 0,
      lastTickAt: "  ",
    });
    expect(s.enabledCount).toBe(0);
    expect(s.tickIntervalSecs).toBe(30);
    expect(s.lastTickAt).toBeNull();
  });
});

describe("automationsHonestyMatrix", () => {
  it("includes tray, quit, launchAgent, and oneShot by default", () => {
    const rows = automationsHonestyMatrix();
    expect(rows.map((r) => r.id)).toEqual([
      "tray",
      "quit",
      "launchAgent",
      "oneShot",
    ]);
  });

  it("can omit LaunchAgent row when unsupported (oneShot remains)", () => {
    const rows = automationsHonestyMatrix({ launchAgentSupported: false });
    expect(rows.map((r) => r.id)).toEqual(["tray", "quit", "oneShot"]);
  });

  it("can omit oneShot row", () => {
    const rows = automationsHonestyMatrix({ includeOneShot: false });
    expect(rows.map((r) => r.id)).toEqual(["tray", "quit", "launchAgent"]);
  });
});

describe("wantsFireDueSchedules / fireDueOutcomeMessageKey", () => {
  it("detects flag and env", () => {
    expect(
      wantsFireDueSchedules({ argv: ["grok-app", FIRE_DUE_SCHEDULES_FLAG] }),
    ).toBe(true);
    expect(wantsFireDueSchedules({ argv: ["grok-app"], envVal: "1" })).toBe(
      true,
    );
    expect(wantsFireDueSchedules({ argv: ["grok-app"], envVal: "true" })).toBe(
      true,
    );
    expect(wantsFireDueSchedules({ argv: ["grok-app"] })).toBe(false);
    expect(wantsFireDueSchedules({ argv: ["grok-app"], envVal: "0" })).toBe(
      false,
    );
  });

  it("maps stable outcome kinds", () => {
    expect(fireDueOutcomeMessageKey("fired")).toBe(
      "automations.oneshot.outcome.fired",
    );
    expect(fireDueOutcomeMessageKey("none_due")).toBe(
      "automations.oneshot.outcome.noneDue",
    );
    expect(fireDueOutcomeMessageKey("busy")).toBe(
      "automations.oneshot.outcome.busy",
    );
    expect(fireDueOutcomeMessageKey("error")).toBe(
      "automations.oneshot.outcome.error",
    );
    expect(fireDueOutcomeMessageKey("already_claimed")).toBe(
      "automations.oneshot.outcome.alreadyClaimed",
    );
    expect(fireDueOutcomeMessageKey("weird")).toBe(
      "automations.oneshot.outcome.unknown",
    );
  });

  it("exposes honest one-shot surface (not KeepAlive daemon)", () => {
    const s = automationsOneShotHelperSurface();
    expect(s.flagHint).toBe(FIRE_DUE_SCHEDULES_FLAG);
    expect(s.scriptName).toBe("fire-due-schedules.sh");
    expect(s.titleKey).toBe("automations.oneshot.title");
    expect(s.honestyKey).toBe("automations.oneshot.honesty");
  });
});

describe("launchAgentSoftFail", () => {
  it("formats empty detail as unknown error", () => {
    expect(formatLaunchAgentSoftFailDetail("")).toBe("unknown error");
    expect(formatLaunchAgentSoftFailDetail(null)).toBe("unknown error");
  });

  it("truncates huge launchctl dumps", () => {
    const long = "x".repeat(600);
    const d = formatLaunchAgentSoftFailDetail(long);
    expect(d.length).toBeLessThanOrEqual(480);
    expect(d.endsWith("…")).toBe(true);
  });

  it("builds enable soft-fail with honesty key", () => {
    const f = launchAgentSoftFail(new Error("launchctl bootstrap failed"), "enable");
    expect(f.titleKey).toBe("automations.launchAgent.failTitle");
    expect(f.bodyKey).toBe("automations.launchAgent.failEnable");
    expect(f.honestyKey).toBe("automations.launchAgent.failHonesty");
    expect(f.detail).toContain("launchctl");
    expect(f.action).toBe("enable");
  });

  it("maps disable and reveal actions", () => {
    expect(launchAgentSoftFail("nope", "disable").bodyKey).toBe(
      "automations.launchAgent.failDisable",
    );
    expect(launchAgentSoftFail("nope", "reveal").bodyKey).toBe(
      "automations.launchAgent.failReveal",
    );
  });
});
