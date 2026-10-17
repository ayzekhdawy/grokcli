import { describe, expect, it } from "vitest";
import {
  buildComposerModelGroups,
  filterComposerModelGroups,
  isComposerModelEntryActive,
  type ComposerModelEntry,
} from "./composerModelGroups";
import type { ModelOption } from "./grokCatalog";

const official: ModelOption[] = [
  { id: "grok-4.5", label: "Grok 4.5" },
  { id: "grok-4", label: "Grok 4" },
];

const providers = [
  {
    id: "yunyi",
    name: "云驿",
    model: "deepseek-chat",
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat" },
      { id: "deepseek-reasoner", name: "Reasoner" },
    ],
  },
  {
    id: "local",
    name: "",
    model: "llama3",
  },
];

describe("buildComposerModelGroups", () => {
  it("builds official group plus multi-model provider groups", () => {
    const groups = buildComposerModelGroups({
      officialModels: official,
      providers,
      officialGroupTitle: "Official",
    });
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({
      key: "official",
      title: "Official",
      entries: [
        {
          pick: { kind: "official", modelId: "grok-4.5" },
          title: "Grok 4.5",
        },
        {
          pick: { kind: "official", modelId: "grok-4" },
          title: "Grok 4",
        },
      ],
    });
    expect(groups[1].title).toBe("云驿");
    expect(groups[1].entries).toHaveLength(2);
    expect(groups[1].entries[0]).toMatchObject({
      pick: {
        kind: "custom",
        providerId: "yunyi",
        modelId: "deepseek-chat",
      },
      title: "DeepSeek Chat",
      subtitle: "deepseek-chat",
    });
    expect(groups[1].entries[1]).toMatchObject({
      pick: {
        kind: "custom",
        providerId: "yunyi",
        modelId: "deepseek-reasoner",
      },
      title: "Reasoner",
      subtitle: "deepseek-reasoner",
    });
    expect(groups[2].entries[0]).toMatchObject({
      pick: { kind: "custom", providerId: "local", modelId: "llama3" },
      title: "llama3",
      subtitle: undefined,
    });
  });

  it("omits provider groups when providers empty", () => {
    const groups = buildComposerModelGroups({
      officialModels: official,
      providers: [],
      officialGroupTitle: "Official",
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("official");
  });

  it("skips providers with empty model catalog", () => {
    const groups = buildComposerModelGroups({
      officialModels: [],
      providers: [{ id: "x", name: "X", model: "  " }],
      officialGroupTitle: "Official",
    });
    expect(groups).toEqual([]);
  });
});

describe("filterComposerModelGroups", () => {
  it("filters entries and drops empty groups", () => {
    const groups = buildComposerModelGroups({
      officialModels: official,
      providers,
      officialGroupTitle: "Official",
    });
    const filtered = filterComposerModelGroups(groups, "reason");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].entries[0].pick).toEqual({
      kind: "custom",
      providerId: "yunyi",
      modelId: "deepseek-reasoner",
    });
  });
});

describe("isComposerModelEntryActive", () => {
  const officialEntry: ComposerModelEntry = {
    key: "official:grok-4.5",
    pick: { kind: "official", modelId: "grok-4.5" },
    title: "Grok 4.5",
  };
  const customEntry: ComposerModelEntry = {
    key: "custom:yunyi:deepseek-chat",
    pick: {
      kind: "custom",
      providerId: "yunyi",
      modelId: "deepseek-chat",
    },
    title: "DeepSeek Chat",
  };

  it("matches official when route is official and model id equals", () => {
    expect(
      isComposerModelEntryActive(officialEntry, {
        activeSource: "official",
        activeProviderId: null,
        modelId: "grok-4.5",
      }),
    ).toBe(true);
  });

  it("matches custom when route, provider, and request model equal", () => {
    expect(
      isComposerModelEntryActive(customEntry, {
        activeSource: "custom",
        activeProviderId: "yunyi",
        activeRequestModel: "deepseek-chat",
        modelId: "grok-4.5",
      }),
    ).toBe(true);
  });

  it("does not match a different request model on same provider", () => {
    expect(
      isComposerModelEntryActive(customEntry, {
        activeSource: "custom",
        activeProviderId: "yunyi",
        activeRequestModel: "deepseek-reasoner",
        modelId: "grok-4.5",
      }),
    ).toBe(false);
  });

  it("does not match official while custom route is active", () => {
    expect(
      isComposerModelEntryActive(officialEntry, {
        activeSource: "custom",
        activeProviderId: "yunyi",
        activeRequestModel: "deepseek-chat",
        modelId: "grok-4.5",
      }),
    ).toBe(false);
  });
});
