import { describe, expect, it } from "vitest";
import {
  buildApplyFooterNote,
  buildApplyHonestyBanner,
  classifyModelEffortError,
  modelEffortErrorMessageKey,
  resolveEffortApplyEffect,
  resolveModelApplyEffect,
  sessionHasLiveAgent,
} from "./modelEffortApply";

describe("sessionHasLiveAgent", () => {
  it("is true for ready / streaming / awaiting_permission", () => {
    expect(sessionHasLiveAgent("ready")).toBe(true);
    expect(sessionHasLiveAgent("streaming")).toBe(true);
    expect(sessionHasLiveAgent("awaiting_permission")).toBe(true);
    expect(sessionHasLiveAgent("READY")).toBe(true);
  });

  it("is false for idle / disconnected / connecting / empty", () => {
    expect(sessionHasLiveAgent("idle")).toBe(false);
    expect(sessionHasLiveAgent("disconnected")).toBe(false);
    expect(sessionHasLiveAgent("connecting")).toBe(false);
    expect(sessionHasLiveAgent(null)).toBe(false);
    expect(sessionHasLiveAgent(undefined)).toBe(false);
    expect(sessionHasLiveAgent("")).toBe(false);
  });
});

describe("resolveModelApplyEffect", () => {
  it("idle session → next_message regardless of set_model support", () => {
    expect(
      resolveModelApplyEffect({ hasLiveAgent: false }),
    ).toBe("next_message");
    expect(
      resolveModelApplyEffect({
        hasLiveAgent: false,
        supportsSetModel: true,
      }),
    ).toBe("next_message");
    expect(
      resolveModelApplyEffect({
        hasLiveAgent: false,
        supportsSetModel: false,
      }),
    ).toBe("next_message");
  });

  it("live + supportsSetModel true → immediate_rpc", () => {
    expect(
      resolveModelApplyEffect({
        hasLiveAgent: true,
        supportsSetModel: true,
      }),
    ).toBe("immediate_rpc");
  });

  it("live + supportsSetModel false → soft_respawn", () => {
    expect(
      resolveModelApplyEffect({
        hasLiveAgent: true,
        supportsSetModel: false,
      }),
    ).toBe("soft_respawn");
  });

  it("live + supports unknown (default) → soft_respawn", () => {
    expect(
      resolveModelApplyEffect({ hasLiveAgent: true }),
    ).toBe("soft_respawn");
  });
});

describe("resolveEffortApplyEffect", () => {
  it("idle → next_message; live → soft_respawn (no set_effort)", () => {
    expect(
      resolveEffortApplyEffect({ hasLiveAgent: false }),
    ).toBe("next_message");
    expect(
      resolveEffortApplyEffect({ hasLiveAgent: true }),
    ).toBe("soft_respawn");
  });
});

describe("buildApplyHonestyBanner", () => {
  it("maps model effects to stable keys + optional model var", () => {
    expect(
      buildApplyHonestyBanner({
        kind: "model",
        effect: "immediate_rpc",
        modelId: "grok-4.5",
      }),
    ).toEqual({
      messageKey: "composer.apply.model.immediate",
      vars: { model: "grok-4.5" },
    });
    expect(
      buildApplyHonestyBanner({
        kind: "model",
        effect: "soft_respawn",
        modelId: "  x  ",
      }).messageKey,
    ).toBe("composer.apply.model.softRespawn");
    expect(
      buildApplyHonestyBanner({
        kind: "model",
        effect: "next_message",
      }),
    ).toEqual({
      messageKey: "composer.apply.model.nextMessage",
      vars: {},
    });
    expect(
      buildApplyHonestyBanner({
        kind: "model",
        effect: "unsupported",
      }).messageKey,
    ).toBe("composer.apply.model.unsupported");
  });

  it("maps effort effects to stable keys + optional effort var", () => {
    expect(
      buildApplyHonestyBanner({
        kind: "effort",
        effect: "soft_respawn",
        effortId: "high",
      }),
    ).toEqual({
      messageKey: "composer.apply.effort.softRespawn",
      vars: { effort: "high" },
    });
    expect(
      buildApplyHonestyBanner({
        kind: "effort",
        effect: "next_message",
        effortId: "low",
      }).messageKey,
    ).toBe("composer.apply.effort.nextMessage");
    expect(
      buildApplyHonestyBanner({
        kind: "effort",
        effect: "immediate_rpc",
      }).messageKey,
    ).toBe("composer.apply.effort.immediate");
    expect(
      buildApplyHonestyBanner({
        kind: "effort",
        effect: "unsupported",
      }).messageKey,
    ).toBe("composer.apply.effort.unsupported");
  });
});

describe("buildApplyFooterNote", () => {
  it("returns null when idle", () => {
    expect(
      buildApplyFooterNote({ kind: "model", hasLiveAgent: false }),
    ).toBeNull();
    expect(
      buildApplyFooterNote({ kind: "effort", hasLiveAgent: false }),
    ).toBeNull();
  });

  it("live model with set_model → immediate footer key", () => {
    const note = buildApplyFooterNote({
      kind: "model",
      hasLiveAgent: true,
      supportsSetModel: true,
    });
    expect(note?.messageKey).toBe("composer.apply.model.immediate");
  });

  it("live effort → soft_respawn footer key", () => {
    const note = buildApplyFooterNote({
      kind: "effort",
      hasLiveAgent: true,
    });
    expect(note?.messageKey).toBe("composer.apply.effort.softRespawn");
  });
});

describe("classifyModelEffortError / modelEffortErrorMessageKey", () => {
  it("classifies soft kinds from free-form host text", () => {
    expect(classifyModelEffortError("session/set_model: timeout")).toBe(
      "set_model_failed",
    );
    expect(classifyModelEffortError("soft_respawn skipped mid-turn")).toBe(
      "soft_respawn_failed",
    );
    expect(classifyModelEffortError("model id empty")).toBe("invalid_model");
    expect(classifyModelEffortError("invalid effort: xyz")).toBe(
      "invalid_effort",
    );
    expect(classifyModelEffortError("not connected")).toBe("disconnected");
    expect(classifyModelEffortError("turn in progress / busy")).toBe("busy");
    expect(classifyModelEffortError("weird boom")).toBe("other");
    expect(classifyModelEffortError(null)).toBe("other");
    expect(classifyModelEffortError(new Error("AGENT gone"))).toBe(
      "disconnected",
    );
  });

  it("maps kinds to message keys", () => {
    expect(modelEffortErrorMessageKey("set_model_failed")).toBe(
      "composer.apply.error.setModelFailed",
    );
    expect(modelEffortErrorMessageKey("soft_respawn_failed")).toBe(
      "composer.apply.error.softRespawnFailed",
    );
    expect(modelEffortErrorMessageKey("invalid_model")).toBe(
      "composer.apply.error.invalidModel",
    );
    expect(modelEffortErrorMessageKey("invalid_effort")).toBe(
      "composer.apply.error.invalidEffort",
    );
    expect(modelEffortErrorMessageKey("disconnected")).toBe(
      "composer.apply.error.disconnected",
    );
    expect(modelEffortErrorMessageKey("busy")).toBe(
      "composer.apply.error.busy",
    );
    expect(modelEffortErrorMessageKey("other")).toBe(
      "composer.apply.error.other",
    );
  });
});

describe("live vs idle matrix (product truth)", () => {
  const cases: Array<{
    name: string;
    live: boolean;
    supportsSetModel?: boolean;
    model: ReturnType<typeof resolveModelApplyEffect>;
    effort: ReturnType<typeof resolveEffortApplyEffect>;
  }> = [
    {
      name: "idle",
      live: false,
      model: "next_message",
      effort: "next_message",
    },
    {
      name: "live + set_model",
      live: true,
      supportsSetModel: true,
      model: "immediate_rpc",
      effort: "soft_respawn",
    },
    {
      name: "live + no set_model",
      live: true,
      supportsSetModel: false,
      model: "soft_respawn",
      effort: "soft_respawn",
    },
    {
      name: "live + unknown support",
      live: true,
      model: "soft_respawn",
      effort: "soft_respawn",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(
        resolveModelApplyEffect({
          hasLiveAgent: c.live,
          supportsSetModel: c.supportsSetModel,
        }),
      ).toBe(c.model);
      expect(resolveEffortApplyEffect({ hasLiveAgent: c.live })).toBe(
        c.effort,
      );
    });
  }
});
