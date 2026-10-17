import { describe, expect, it } from "vitest";
import type { CustomProvider, ProviderModelEntry } from "@/lib/api";
import {
  findProviderModel,
  materializeActiveModelChannel,
  mergeRemoteModelCaps,
  resolveProviderContextWindow,
  resolveProviderEfforts,
  resolveProviderSupportsVideo,
  resolveProviderSupportsVision,
  withModelContextWindow,
} from "./providerModelConfig";

const channelEfforts = [
  { id: "low", name: "low" },
  { id: "medium", name: "medium", isDefault: true },
  { id: "high", name: "high" },
];

const modelEfforts = [
  { id: "low", name: "low" },
  { id: "high", name: "high", isDefault: true },
  { id: "max", name: "max" },
];

function provider(
  partial: Partial<CustomProvider> & Pick<CustomProvider, "model">,
): CustomProvider {
  return {
    id: "relay",
    baseUrl: "https://example.com/v1",
    name: "Relay",
    hasApiKey: true,
    apiBackend: "chat_completions",
    providerMode: "generic",
    isDefault: true,
    models: [],
    efforts: channelEfforts,
    contextWindow: 200_000,
    supportsVision: false,
    ...partial,
  };
}

describe("findProviderModel", () => {
  it("picks the active request id, else first catalog row", () => {
    const models: ProviderModelEntry[] = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ];
    expect(findProviderModel({ models, model: "b" })?.id).toBe("b");
    expect(findProviderModel({ models, model: "missing" })?.id).toBe("a");
    expect(findProviderModel({ models: [], model: "a" })).toBeNull();
  });
});

describe("resolveProviderEfforts", () => {
  it("uses per-model efforts when the active row has them", () => {
    const p = provider({
      model: "thinker",
      models: [
        { id: "plain", name: "Plain" },
        { id: "thinker", name: "Thinker", efforts: modelEfforts },
      ],
    });
    expect(resolveProviderEfforts(p)?.map((e) => e.id)).toEqual([
      "low",
      "high",
      "max",
    ]);
    expect(resolveProviderEfforts(p, "plain")?.map((e) => e.id)).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });

  it("falls back to channel efforts when the model has none (legacy TOML)", () => {
    const p = provider({
      model: "plain",
      models: [{ id: "plain", name: "Plain" }],
    });
    expect(resolveProviderEfforts(p)?.map((e) => e.id)).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });
});

describe("resolveProviderContextWindow / vision", () => {
  it("prefers the active model's window and vision flags", () => {
    const p = provider({
      model: "vision",
      supportsVision: false,
      contextWindow: 200_000,
      models: [
        {
          id: "vision",
          name: "Vision",
          contextWindow: 1_048_576,
          supportsVision: true,
          supportsVideo: true,
        },
        { id: "text", name: "Text", supportsVision: false },
      ],
    });
    expect(resolveProviderContextWindow(p)).toBe(1_048_576);
    expect(resolveProviderSupportsVision(p)).toBe(true);
    expect(resolveProviderSupportsVideo(p)).toBe(true);
    expect(resolveProviderSupportsVision(p, "text")).toBe(false);
    expect(resolveProviderContextWindow(p, "text")).toBe(200_000);
  });

  it("keeps channel vision when the model does not set a flag", () => {
    const p = provider({
      model: "ox",
      supportsVision: true,
      models: [{ id: "ox", name: "Ox" }],
    });
    expect(resolveProviderSupportsVision(p)).toBe(true);
  });
});

describe("materializeActiveModelChannel", () => {
  it("copies the picked model's extras onto channel fields for Host", () => {
    const p = provider({
      model: "a",
      models: [
        { id: "a", name: "A" },
        {
          id: "b",
          name: "B",
          efforts: modelEfforts,
          contextWindow: 64_000,
          supportsVision: true,
        },
      ],
    });
    expect(materializeActiveModelChannel({ provider: p, modelId: "b" })).toEqual(
      {
        efforts: modelEfforts,
        contextWindow: 64_000,
        supportsVision: true,
      },
    );
  });
});

describe("mergeRemoteModelCaps", () => {
  it("applies API context / modality when the live catalog provides them", () => {
    const model: ProviderModelEntry = { id: "ox", name: "Ox" };
    expect(
      mergeRemoteModelCaps(model, {
        id: "ox",
        contextWindow: 1_048_576,
        supportsVision: true,
        supportsVideo: false,
      }),
    ).toEqual({
      id: "ox",
      name: "Ox",
      contextWindow: 1_048_576,
      supportsVision: true,
      supportsVideo: false,
    });
  });

  it("does not invent caps when the live row omits them", () => {
    const model: ProviderModelEntry = {
      id: "ox",
      name: "Ox",
      contextWindow: 8000,
      supportsVision: true,
    };
    expect(mergeRemoteModelCaps(model, { id: "ox" })).toEqual(model);
  });
});

describe("withModelContextWindow", () => {
  it("updates the active catalog row", () => {
    const next = withModelContextWindow(
      [{ id: "a", name: "A" }, { id: "b", name: "B" }],
      "b",
      32000,
    );
    expect(next.find((m) => m.id === "b")?.contextWindow).toBe(32000);
    expect(next.find((m) => m.id === "a")?.contextWindow).toBeUndefined();
  });
});
