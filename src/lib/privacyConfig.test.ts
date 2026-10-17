import { describe, expect, it } from "vitest";
import {
  buildPrivacyPatch,
  classifyPrivacyProbeError,
  classifyPrivacyProbeResult,
  CLI_PRIVACY_COMMAND,
  hasPrivacyChanges,
  isPrivacyWritable,
  privacyApplyMessageKey,
  privacyInventedDefault,
  privacyIsUnset,
  privacyKeyDefaultHintMessageKey,
  privacyKeyPresence,
  privacyPresenceMessageKey,
  privacyProbeErrorMessageKey,
  privacyProbeIsHardFail,
  privacyProbeOutcomeMessageKey,
  privacyProbeTone,
  privacySummaryKind,
  privacySummaryMessageKey,
  privacyToggleChecked,
  resolvePrivacyProbeErrorCopy,
  summarizePrivacyValues,
  togglePrivacyTri,
  valuesFromPrivacySnapshot,
  type PrivacyValues,
} from "./privacyConfig";

const base: PrivacyValues = {
  telemetry: false,
  traceUpload: false,
  mixpanelEnabled: false,
  disableCodebaseUpload: true,
  disableWorkspaceTeleport: true,
};

describe("valuesFromPrivacySnapshot", () => {
  it("maps missing keys to null (soft-fail, never invents defaults)", () => {
    expect(valuesFromPrivacySnapshot({})).toEqual({
      telemetry: null,
      traceUpload: null,
      mixpanelEnabled: null,
      disableCodebaseUpload: null,
      disableWorkspaceTeleport: null,
    });
    expect(valuesFromPrivacySnapshot(null)).toEqual({
      telemetry: null,
      traceUpload: null,
      mixpanelEnabled: null,
      disableCodebaseUpload: null,
      disableWorkspaceTeleport: null,
    });
  });

  it("maps present bools", () => {
    expect(
      valuesFromPrivacySnapshot({
        telemetry: false,
        traceUpload: true,
        mixpanelEnabled: false,
        disableCodebaseUpload: true,
        disableWorkspaceTeleport: false,
      }),
    ).toEqual({
      telemetry: false,
      traceUpload: true,
      mixpanelEnabled: false,
      disableCodebaseUpload: true,
      disableWorkspaceTeleport: false,
    });
  });
});

describe("buildPrivacyPatch", () => {
  it("emits only changed concrete fields", () => {
    const draft: PrivacyValues = {
      ...base,
      telemetry: true,
      disableCodebaseUpload: false,
    };
    const patch = buildPrivacyPatch(draft, base);
    expect(patch).toEqual({
      telemetry: true,
      disableCodebaseUpload: false,
    });
    expect(hasPrivacyChanges(patch)).toBe(true);
    expect(hasPrivacyChanges(buildPrivacyPatch(base, base))).toBe(false);
  });

  it("does not emit null→null or null-only draft fields", () => {
    const baseline: PrivacyValues = {
      telemetry: null,
      traceUpload: null,
      mixpanelEnabled: null,
      disableCodebaseUpload: null,
      disableWorkspaceTeleport: null,
    };
    // Still unset — no write.
    expect(buildPrivacyPatch(baseline, baseline)).toEqual({});
    // User toggled telemetry on from unset.
    const draft = { ...baseline, telemetry: true as const };
    expect(buildPrivacyPatch(draft, baseline)).toEqual({ telemetry: true });
  });

  it("never emits false from an untouched unset key", () => {
    const baseline = valuesFromPrivacySnapshot({});
    const draft = { ...baseline, mixpanelEnabled: true as const };
    const patch = buildPrivacyPatch(draft, baseline);
    expect(patch).toEqual({ mixpanelEnabled: true });
    expect(patch.telemetry).toBeUndefined();
    expect(patch.traceUpload).toBeUndefined();
  });
});

describe("togglePrivacyTri / presence", () => {
  it("cycles unset → true → false → true (never invents off as first write)", () => {
    expect(togglePrivacyTri(null)).toBe(true);
    expect(togglePrivacyTri(true)).toBe(false);
    expect(togglePrivacyTri(false)).toBe(true);
  });

  it("presence and checked honesty", () => {
    expect(privacyKeyPresence(null)).toBe("unset");
    expect(privacyKeyPresence(true)).toBe("set_on");
    expect(privacyKeyPresence(false)).toBe("set_off");
    expect(privacyToggleChecked(null)).toBe(false);
    expect(privacyToggleChecked(true)).toBe(true);
    expect(privacyToggleChecked(false)).toBe(false);
    expect(privacyIsUnset(null)).toBe(true);
    expect(privacyIsUnset(false)).toBe(false);
    expect(privacyIsUnset(true)).toBe(false);
  });
});

describe("isPrivacyWritable", () => {
  it("requires writable flag", () => {
    expect(isPrivacyWritable(undefined)).toBe(false);
    expect(isPrivacyWritable({ writable: false })).toBe(false);
    expect(isPrivacyWritable({ writable: true })).toBe(true);
  });
});

describe("CLI_PRIVACY_COMMAND", () => {
  it("is the coding-data slash command (not a config key)", () => {
    expect(CLI_PRIVACY_COMMAND).toBe("/privacy");
  });
});

describe("summarizePrivacyValues / clearer defaults", () => {
  it("counts unset separately from set_off (never invents off)", () => {
    const empty = summarizePrivacyValues(valuesFromPrivacySnapshot({}));
    expect(empty.allUnset).toBe(true);
    expect(empty.unsetCount).toBe(5);
    expect(empty.setOffCount).toBe(0);
    expect(empty.setOnCount).toBe(0);
    expect(empty.anySet).toBe(false);
    expect(privacySummaryKind(valuesFromPrivacySnapshot({}))).toBe(
      "all_unset",
    );
  });

  it("distinguishes partial and all_set", () => {
    const partial = summarizePrivacyValues({
      telemetry: false,
      traceUpload: null,
      mixpanelEnabled: null,
      disableCodebaseUpload: true,
      disableWorkspaceTeleport: null,
    });
    expect(partial.setCount).toBe(2);
    expect(partial.unsetCount).toBe(3);
    expect(partial.setOffCount).toBe(1);
    expect(partial.setOnCount).toBe(1);
    expect(privacySummaryKind({
      telemetry: false,
      traceUpload: null,
      mixpanelEnabled: null,
      disableCodebaseUpload: true,
      disableWorkspaceTeleport: null,
    })).toBe("partial");

    expect(privacySummaryKind(base)).toBe("all_set");
    expect(summarizePrivacyValues(base).allSet).toBe(true);
  });

  it("resolves summary and default-hint message keys", () => {
    expect(privacySummaryMessageKey("all_unset")).toBe(
      "settings.privacy.summary.allUnset",
    );
    expect(privacySummaryMessageKey("partial")).toBe(
      "settings.privacy.summary.partial",
    );
    expect(privacySummaryMessageKey("all_set")).toBe(
      "settings.privacy.summary.allSet",
    );
    expect(privacyKeyDefaultHintMessageKey("telemetry")).toBe(
      "settings.privacy.default.telemetry",
    );
    expect(privacyKeyDefaultHintMessageKey("traceUpload")).toBe(
      "settings.privacy.default.traceUpload",
    );
    expect(privacyKeyDefaultHintMessageKey("mixpanelEnabled")).toBe(
      "settings.privacy.default.mixpanel",
    );
    expect(privacyKeyDefaultHintMessageKey("disableCodebaseUpload")).toBe(
      "settings.privacy.default.disableCodebaseUpload",
    );
    expect(privacyKeyDefaultHintMessageKey("disableWorkspaceTeleport")).toBe(
      "settings.privacy.default.disableWorkspaceTeleport",
    );
    expect(privacyPresenceMessageKey("unset")).toBe(
      "settings.privacy.presence.unset",
    );
  });

  it("never invents a concrete default for unset keys", () => {
    for (const key of [
      "telemetry",
      "traceUpload",
      "mixpanelEnabled",
      "disableCodebaseUpload",
      "disableWorkspaceTeleport",
    ] as const) {
      expect(privacyInventedDefault(key)).toBeNull();
    }
  });
});

describe("classifyPrivacyProbeError", () => {
  it("classifies host-only / shared / path / io / empty / other", () => {
    expect(classifyPrivacyProbeError("Privacy center requires the desktop app.")).toBe(
      "host_only",
    );
    expect(classifyPrivacyProbeError("need tauri")).toBe("host_only");
    expect(
      classifyPrivacyProbeError(
        "shared session mode: agent-home config.toml is not the live GROK_HOME; switch to independent to edit privacy keys",
      ),
    ).toBe("shared_mode");
    expect(
      classifyPrivacyProbeError(
        "path not allowed: only agent-home config.toml may be edited",
      ),
    ).toBe("path_not_allowed");
    expect(classifyPrivacyProbeError("write config: Permission denied")).toBe(
      "io",
    );
    expect(classifyPrivacyProbeError("create agent-home: EACCES")).toBe("io");
    expect(classifyPrivacyProbeError("patch is empty")).toBe("empty_patch");
    expect(classifyPrivacyProbeError("weird boom")).toBe("other");
    expect(classifyPrivacyProbeError(null)).toBe("other");
  });

  it("resolves error message keys", () => {
    expect(privacyProbeErrorMessageKey("host_only")).toBe(
      "settings.privacy.probe.hostOnly",
    );
    expect(privacyProbeErrorMessageKey("shared_mode")).toBe(
      "settings.privacy.probe.sharedMode",
    );
    expect(privacyProbeErrorMessageKey("path_not_allowed")).toBe(
      "settings.privacy.probe.pathNotAllowed",
    );
    expect(privacyProbeErrorMessageKey("io")).toBe(
      "settings.privacy.probe.io",
    );
    expect(privacyProbeErrorMessageKey("empty_patch")).toBe(
      "settings.privacy.probe.emptyPatch",
    );
    expect(privacyProbeErrorMessageKey("other")).toBe(
      "settings.privacy.probe.other",
    );
  });
});

describe("classifyPrivacyProbeResult", () => {
  it("marks unavailable host as host_only without inventing off", () => {
    const r = classifyPrivacyProbeResult(null, { available: false });
    expect(r.outcome).toBe("host_only");
    expect(r.tone).toBe("muted");
    expect(r.errorKind).toBe("host_only");
    expect(r.values.telemetry).toBeNull();
    expect(r.summary.allUnset).toBe(true);
    expect(privacyProbeIsHardFail(r)).toBe(false);
  });

  it("classifies invoke errors with soft-fail kinds", () => {
    const shared = classifyPrivacyProbeResult(null, {
      invokeError:
        "shared session mode: agent-home config.toml is not the live GROK_HOME",
    });
    expect(shared.outcome).toBe("error");
    expect(shared.errorKind).toBe("shared_mode");
    expect(shared.tone).toBe("err");
    expect(privacyProbeIsHardFail(shared)).toBe(true);
    expect(shared.values.telemetry).toBeNull();

    const host = classifyPrivacyProbeResult(null, {
      invokeError: "need tauri",
    });
    expect(host.outcome).toBe("host_only");
    expect(host.errorKind).toBe("host_only");
  });

  it("soft-succeeds missing file as ok_missing_file with all unset", () => {
    const r = classifyPrivacyProbeResult({
      path: "/tmp/agent-home/config.toml",
      mode: "independent",
      writable: true,
      fileExists: false,
    });
    expect(r.outcome).toBe("ok_missing_file");
    expect(r.tone).toBe("info");
    expect(r.fileExists).toBe(false);
    expect(r.writable).toBe(true);
    expect(r.summary.allUnset).toBe(true);
    expect(r.values.telemetry).toBeNull();
    expect(privacyProbeOutcomeMessageKey(r.outcome)).toBe(
      "settings.privacy.probe.okMissing",
    );
  });

  it("classifies existing file with no keys as ok_all_unset (not off)", () => {
    const r = classifyPrivacyProbeResult({
      path: "/tmp/config.toml",
      mode: "independent",
      writable: true,
      fileExists: true,
      telemetry: null,
      traceUpload: null,
    });
    expect(r.outcome).toBe("ok_all_unset");
    expect(r.summary.setOffCount).toBe(0);
    expect(r.values.telemetry).toBeNull();
    expect(privacyProbeTone("ok_all_unset")).toBe("info");
  });

  it("classifies partial and all_set snapshots", () => {
    const partial = classifyPrivacyProbeResult({
      fileExists: true,
      writable: true,
      mode: "independent",
      telemetry: false,
      disableCodebaseUpload: true,
    });
    expect(partial.outcome).toBe("ok_partial");
    expect(partial.summary.setCount).toBe(2);
    expect(partial.values.traceUpload).toBeNull();

    const all = classifyPrivacyProbeResult({
      fileExists: true,
      writable: true,
      mode: "shared",
      telemetry: false,
      traceUpload: false,
      mixpanelEnabled: false,
      disableCodebaseUpload: true,
      disableWorkspaceTeleport: true,
    });
    expect(all.outcome).toBe("ok_all_set");
    expect(all.writable).toBe(true);
    // writable flag from snap — shared mode UI still uses mode string.
    expect(all.mode).toBe("shared");
  });

  it("resolvePrivacyProbeErrorCopy pairs kind + message key + detail", () => {
    const r = resolvePrivacyProbeErrorCopy({
      err: new Error("write config: Permission denied (os error 13)"),
    });
    expect(r.kind).toBe("io");
    expect(r.messageKey).toBe("settings.privacy.probe.io");
    expect(r.detail).toContain("Permission denied");
  });

  it("apply honesty keys", () => {
    expect(privacyApplyMessageKey("saved_soft_respawn")).toBe(
      "settings.privacy.apply.softRespawn",
    );
    expect(privacyApplyMessageKey("independent_only")).toBe(
      "settings.privacy.apply.independentOnly",
    );
  });
});
