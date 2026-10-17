import type { ModelOption } from "@/lib/grokCatalog";

export type ComposerModelPick =
  | { kind: "official"; modelId: string }
  | { kind: "custom"; providerId: string; modelId: string };

export type ComposerModelEntry = {
  pick: ComposerModelPick;
  title: string;
  /** Raw model id when title is a display name that differs. */
  subtitle?: string;
  /** Stable row key for React. */
  key: string;
};

export type ComposerModelGroup = {
  key: string;
  title: string;
  entries: ComposerModelEntry[];
};

export type ComposerProviderModelInput = {
  id: string;
  name: string;
};

export type ComposerProviderInput = {
  id: string;
  name: string;
  /** Active request model for this channel. */
  model: string;
  /** Catalog of selectable models; falls back to single `model` when empty. */
  models?: ComposerProviderModelInput[];
};

function modelsForProvider(
  p: ComposerProviderInput,
): ComposerProviderModelInput[] {
  if (p.models && p.models.length > 0) {
    return p.models
      .map((m) => ({
        id: m.id?.trim() ?? "",
        name: (m.name?.trim() || m.id?.trim()) ?? "",
      }))
      .filter((m) => m.id);
  }
  const id = p.model?.trim() ?? "";
  if (!id) return [];
  return [{ id, name: id }];
}

export function buildComposerModelGroups(opts: {
  officialModels: ModelOption[];
  providers: ComposerProviderInput[];
  officialGroupTitle: string;
}): ComposerModelGroup[] {
  const groups: ComposerModelGroup[] = [];
  const officialEntries: ComposerModelEntry[] = opts.officialModels.map(
    (m) => ({
      key: `official:${m.id}`,
      pick: { kind: "official" as const, modelId: m.id },
      title: m.label || m.id,
    }),
  );
  if (officialEntries.length > 0) {
    groups.push({
      key: "official",
      title: opts.officialGroupTitle,
      entries: officialEntries,
    });
  }
  for (const p of opts.providers) {
    const models = modelsForProvider(p);
    if (models.length === 0) continue;
    const groupTitle = p.name?.trim() || p.id;
    groups.push({
      key: `provider:${p.id}`,
      title: groupTitle,
      entries: models.map((m) => {
        const title = m.name || m.id;
        const subtitle = title !== m.id ? m.id : undefined;
        return {
          key: `custom:${p.id}:${m.id}`,
          pick: {
            kind: "custom" as const,
            providerId: p.id,
            modelId: m.id,
          },
          title,
          subtitle,
        };
      }),
    });
  }
  return groups;
}

export function filterComposerModelGroups(
  groups: ComposerModelGroup[],
  query: string,
): ComposerModelGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => ({
      ...g,
      entries: g.entries.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          (e.subtitle?.toLowerCase().includes(q) ?? false) ||
          g.title.toLowerCase().includes(q) ||
          (e.pick.kind === "official"
            ? e.pick.modelId.toLowerCase().includes(q)
            : e.pick.providerId.toLowerCase().includes(q) ||
              e.pick.modelId.toLowerCase().includes(q)),
      ),
    }))
    .filter((g) => g.entries.length > 0);
}

/** Whether a menu entry is the active selection. */
export function isComposerModelEntryActive(
  entry: ComposerModelEntry,
  opts: {
    activeSource: "official" | "custom" | string;
    activeProviderId: string | null | undefined;
    /** Active custom request model (provider.model). */
    activeRequestModel?: string | null;
    modelId: string;
  },
): boolean {
  if (entry.pick.kind === "official") {
    return (
      opts.activeSource !== "custom" && entry.pick.modelId === opts.modelId
    );
  }
  const requestOk =
    !opts.activeRequestModel ||
    opts.activeRequestModel === entry.pick.modelId;
  return (
    opts.activeSource === "custom" &&
    opts.activeProviderId === entry.pick.providerId &&
    requestOk
  );
}
