import { describe, expect, it } from "vitest";
import {
  DEFAULT_TODO_GATE_MAX_FIRES,
  MAX_TODO_GATE_MAX_FIRES,
  MIN_TODO_GATE_MAX_FIRES,
  TODO_GATE_CLI_FLAG,
  TODO_GATE_ENABLED_CONFIG_KEY,
  TODO_GATE_MAX_FIRES_CONFIG_KEY,
  TODO_GATE_MIN_CLI,
  cliSupportsTodoGate,
  describeTodoGateSettings,
  isIndependentSessionDataMode,
  normalizeTodoGateEnabled,
  normalizeTodoGateMaxFires,
  resolveTodoGateActivity,
  todoGateConfigAssignments,
  todoGateEnabledEqual,
  todoGateMaxFiresApplyPath,
  todoGateMaxFiresApplyPathMessageKey,
  todoGateMaxFiresEqual,
  todoGateMaxFiresWasAdjusted,
  todoGateSoftRespawnNoteKey,
  todoGateSpawnArgs,
} from "./todoGate";

describe("normalizeTodoGateEnabled", () => {
  it("defaults to false", () => {
    expect(normalizeTodoGateEnabled(null)).toBe(false);
    expect(normalizeTodoGateEnabled(undefined)).toBe(false);
    expect(normalizeTodoGateEnabled(false)).toBe(false);
  });

  it("is true only for true", () => {
    expect(normalizeTodoGateEnabled(true)).toBe(true);
  });
});

describe("normalizeTodoGateMaxFires", () => {
  it("defaults for nullish / empty / zero / invalid", () => {
    expect(normalizeTodoGateMaxFires(null)).toBe(DEFAULT_TODO_GATE_MAX_FIRES);
    expect(normalizeTodoGateMaxFires(undefined)).toBe(
      DEFAULT_TODO_GATE_MAX_FIRES,
    );
    expect(normalizeTodoGateMaxFires("")).toBe(DEFAULT_TODO_GATE_MAX_FIRES);
    expect(normalizeTodoGateMaxFires("   ")).toBe(DEFAULT_TODO_GATE_MAX_FIRES);
    expect(normalizeTodoGateMaxFires(0)).toBe(DEFAULT_TODO_GATE_MAX_FIRES);
    expect(normalizeTodoGateMaxFires("0")).toBe(DEFAULT_TODO_GATE_MAX_FIRES);
    expect(normalizeTodoGateMaxFires(-2)).toBe(DEFAULT_TODO_GATE_MAX_FIRES);
    expect(normalizeTodoGateMaxFires(Number.NaN)).toBe(
      DEFAULT_TODO_GATE_MAX_FIRES,
    );
    expect(normalizeTodoGateMaxFires("nope")).toBe(DEFAULT_TODO_GATE_MAX_FIRES);
  });

  it("clamps to 1–20", () => {
    expect(normalizeTodoGateMaxFires(1)).toBe(MIN_TODO_GATE_MAX_FIRES);
    expect(normalizeTodoGateMaxFires(10)).toBe(10);
    expect(normalizeTodoGateMaxFires(20)).toBe(MAX_TODO_GATE_MAX_FIRES);
    expect(normalizeTodoGateMaxFires(99)).toBe(MAX_TODO_GATE_MAX_FIRES);
    expect(normalizeTodoGateMaxFires(1.6)).toBe(2);
    expect(normalizeTodoGateMaxFires("  7  ")).toBe(7);
  });
});

describe("todoGateMaxFiresWasAdjusted", () => {
  it("flags nullish / invalid / out-of-range / non-integer", () => {
    expect(todoGateMaxFiresWasAdjusted(null)).toBe(true);
    expect(todoGateMaxFiresWasAdjusted("")).toBe(true);
    expect(todoGateMaxFiresWasAdjusted(0)).toBe(true);
    expect(todoGateMaxFiresWasAdjusted(99)).toBe(true);
    expect(todoGateMaxFiresWasAdjusted(1.6)).toBe(true);
    expect(todoGateMaxFiresWasAdjusted(-1)).toBe(true);
  });

  it("is false for clean in-range integers", () => {
    expect(todoGateMaxFiresWasAdjusted(1)).toBe(false);
    expect(todoGateMaxFiresWasAdjusted(3)).toBe(false);
    expect(todoGateMaxFiresWasAdjusted(20)).toBe(false);
    expect(todoGateMaxFiresWasAdjusted("7")).toBe(false);
  });
});

describe("todoGateSpawnArgs", () => {
  it("emits --todo-gate only when enabled", () => {
    expect(todoGateSpawnArgs(true)).toEqual([TODO_GATE_CLI_FLAG]);
    expect(todoGateSpawnArgs(false)).toEqual([]);
    expect(todoGateSpawnArgs(null)).toEqual([]);
    expect(todoGateSpawnArgs(undefined)).toEqual([]);
  });

  it("is a top-level flag (not under agent/stdio) and has no max-fires flag", () => {
    const args = todoGateSpawnArgs(true);
    expect(args[0]).toBe("--todo-gate");
    expect(args).not.toContain("agent");
    expect(args).not.toContain("stdio");
    expect(args.join(" ")).not.toMatch(/max.?fires/i);
  });
});

describe("todoGateConfigAssignments", () => {
  it("formats top-level keys with normalized values", () => {
    const a = todoGateConfigAssignments(true, 99);
    expect(a.enabled).toBe(`${TODO_GATE_ENABLED_CONFIG_KEY} = true`);
    expect(a.maxFires).toBe(`${TODO_GATE_MAX_FIRES_CONFIG_KEY} = 20`);
    const b = todoGateConfigAssignments(false, null);
    expect(b.enabled).toBe(`${TODO_GATE_ENABLED_CONFIG_KEY} = false`);
    expect(b.maxFires).toBe(
      `${TODO_GATE_MAX_FIRES_CONFIG_KEY} = ${DEFAULT_TODO_GATE_MAX_FIRES}`,
    );
  });
});

describe("todoGateMaxFiresEqual / todoGateEnabledEqual", () => {
  it("compares after normalize", () => {
    expect(todoGateMaxFiresEqual(3, "3")).toBe(true);
    expect(todoGateMaxFiresEqual(null, DEFAULT_TODO_GATE_MAX_FIRES)).toBe(true);
    expect(todoGateMaxFiresEqual(5, 6)).toBe(false);
    expect(todoGateMaxFiresEqual(99, 20)).toBe(true);
    expect(todoGateEnabledEqual(true, true)).toBe(true);
    expect(todoGateEnabledEqual(true, false)).toBe(false);
    expect(todoGateEnabledEqual(null, false)).toBe(true);
  });
});

describe("cliSupportsTodoGate", () => {
  it("accepts ≥ 0.2.117", () => {
    expect(cliSupportsTodoGate("0.2.117")).toBe(true);
    expect(cliSupportsTodoGate("grok 0.2.117 (abc)")).toBe(true);
    expect(cliSupportsTodoGate("0.2.118")).toBe(true);
    expect(cliSupportsTodoGate("0.3.0")).toBe(true);
  });

  it("rejects known older", () => {
    expect(cliSupportsTodoGate("0.2.116")).toBe(false);
    expect(cliSupportsTodoGate("0.2.100")).toBe(false);
    expect(cliSupportsTodoGate("0.1.99")).toBe(false);
  });

  it("soft-fails unknown", () => {
    expect(cliSupportsTodoGate(null)).toBe(null);
    expect(cliSupportsTodoGate(undefined)).toBe(null);
    expect(cliSupportsTodoGate("")).toBe(null);
    expect(cliSupportsTodoGate("nope")).toBe(null);
  });

  it("documents min CLI constant", () => {
    expect(TODO_GATE_MIN_CLI).toBe("0.2.117");
  });
});

describe("max-fires apply path honesty", () => {
  it("classifies independent vs shared session data mode", () => {
    expect(isIndependentSessionDataMode("independent")).toBe(true);
    expect(isIndependentSessionDataMode("")).toBe(true);
    expect(isIndependentSessionDataMode(null)).toBe(true);
    expect(isIndependentSessionDataMode("shared")).toBe(false);
    expect(isIndependentSessionDataMode("SHARED")).toBe(false);
  });

  it("returns inactive when gate is off", () => {
    expect(todoGateMaxFiresApplyPath(false, "independent")).toBe("inactive");
    expect(todoGateMaxFiresApplyPath(null, "shared")).toBe("inactive");
  });

  it("returns independent_config vs shared_app_only when on", () => {
    expect(todoGateMaxFiresApplyPath(true, "independent")).toBe(
      "independent_config",
    );
    expect(todoGateMaxFiresApplyPath(true, "shared")).toBe("shared_app_only");
  });

  it("maps apply path to stable message keys", () => {
    expect(todoGateMaxFiresApplyPathMessageKey("inactive")).toBe(
      "settings.todoGateMaxFires.inactive",
    );
    expect(todoGateMaxFiresApplyPathMessageKey("independent_config")).toBe(
      "settings.todoGateMaxFires.independent",
    );
    expect(todoGateMaxFiresApplyPathMessageKey("shared_app_only")).toBe(
      "settings.todoGateMaxFires.shared",
    );
    expect(todoGateSoftRespawnNoteKey()).toBe(
      "settings.todoGate.softRespawnNote",
    );
  });
});

describe("resolveTodoGateActivity", () => {
  it("is honest N/A without a host signal", () => {
    const v = resolveTodoGateActivity(null, 3);
    expect(v.kind).toBe("na");
    expect(v.fires).toBe(null);
    expect(v.messageKey).toBe("settings.todoGate.activity.na");
    expect(v.tone).toBe("muted");
  });

  it("does not invent idle from an empty object", () => {
    const v = resolveTodoGateActivity({}, 3);
    expect(v.kind).toBe("na");
    expect(v.messageKey).toBe("settings.todoGate.activity.na");
  });

  it("marks unavailable when host available:false", () => {
    const v = resolveTodoGateActivity({ available: false }, 5);
    expect(v.kind).toBe("unavailable");
    expect(v.messageKey).toBe("settings.todoGate.activity.unavailable");
    expect(v.tone).toBe("warn");
    expect(v.maxFires).toBe(5);
  });

  it("reports idle when host reports zero fires", () => {
    const v = resolveTodoGateActivity(
      { firesThisPrompt: 0, maxFires: 3, available: true },
      3,
    );
    expect(v.kind).toBe("idle");
    expect(v.fires).toBe(0);
    expect(v.messageKey).toBe("settings.todoGate.activity.idle");
    expect(v.vars).toEqual({ max: 3 });
  });

  it("reports fired counts without inventing max", () => {
    const v = resolveTodoGateActivity(
      {
        firesThisPrompt: 2,
        maxFires: 3,
        lastFiredAt: 1_700_000_000_000,
        sessionId: "s1",
      },
      3,
    );
    expect(v.kind).toBe("fired");
    expect(v.fires).toBe(2);
    expect(v.maxFires).toBe(3);
    expect(v.sessionId).toBe("s1");
    expect(v.lastFiredAt).toBe(1_700_000_000_000);
    expect(v.messageKey).toBe("settings.todoGate.activity.fired");
    expect(v.vars).toEqual({ n: 2, max: 3 });
    expect(v.tone).toBe("info");
  });

  it("warns when fires reach max", () => {
    const v = resolveTodoGateActivity({ firesThisPrompt: 3, maxFires: 3 }, 3);
    expect(v.kind).toBe("fired");
    expect(v.tone).toBe("warn");
  });

  it("accepts numeric string-ish fires via number only (no invent)", () => {
    const v = resolveTodoGateActivity({ firesThisPrompt: 1.9 as number }, 3);
    expect(v.kind).toBe("fired");
    expect(v.fires).toBe(1);
  });
});

describe("describeTodoGateSettings", () => {
  it("builds independent-on view with soft-respawn and N/A activity", () => {
    const v = describeTodoGateSettings({
      enabled: true,
      maxFires: 5,
      sessionDataMode: "independent",
      cliVersion: "0.2.117",
      fireSignal: null,
    });
    expect(v.enabled).toBe(true);
    expect(v.maxFires).toBe(5);
    expect(v.maxFiresAdjusted).toBe(false);
    expect(v.applyPath).toBe("independent_config");
    expect(v.applyPathKey).toBe("settings.todoGateMaxFires.independent");
    expect(v.softRespawnKey).toBe("settings.todoGate.softRespawnNote");
    expect(v.clampedKey).toBe(null);
    expect(v.activity.kind).toBe("na");
    expect(v.cliTooOld).toBe(false);
    expect(v.cliSoftFailKey).toBe(null);
  });

  it("honest shared-mode max-fires path + clamp note", () => {
    const v = describeTodoGateSettings({
      enabled: true,
      maxFires: 99,
      maxFiresRaw: 99,
      sessionDataMode: "shared",
      cliVersion: "0.2.100",
    });
    expect(v.maxFires).toBe(20);
    expect(v.maxFiresAdjusted).toBe(true);
    expect(v.clampedKey).toBe("settings.todoGateMaxFires.clamped");
    expect(v.applyPath).toBe("shared_app_only");
    expect(v.cliTooOld).toBe(true);
    expect(v.cliSoftFailKey).toBe("settings.todoGate.cliTooOld");
  });

  it("inactive path when disabled", () => {
    const v = describeTodoGateSettings({
      enabled: false,
      maxFires: 3,
      sessionDataMode: "independent",
    });
    expect(v.applyPath).toBe("inactive");
    expect(v.applyPathKey).toBe("settings.todoGateMaxFires.inactive");
  });
});
