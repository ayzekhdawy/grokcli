/**
 * Resolve per-model extras on a custom provider without dropping the
 * channel-level fields Grok Build still reads (`app_efforts`,
 * `context_window`, `app_supports_vision`).
 *
 * Runtime: composer / Host keep using the channel fields. When the user
 * picks a model, App copies that model's extras onto the channel so spawn
 * stays compatible with old TOML.
 */

import type {
  CustomProvider,
  ProviderEffortEntry,
  ProviderModelEntry,
} from "@/lib/api";
import { alignGrokPresetEfforts } from "@/lib/providerPresets";

export type RemoteModelCaps = {
  id: string;
  ownedBy?: string | null;
  supportsBackendSearch?: boolean | null;
  contextWindow?: number | null;
  supportsVision?: boolean | null;
  supportsVideo?: boolean | null;
};

export function findProviderModel(
  provider: Pick<CustomProvider, "models" | "model">,
  modelId?: string | null,
): ProviderModelEntry | null {
  const models = provider.models ?? [];
  if (!models.length) return null;
  const want = (modelId ?? provider.model ?? "").trim();
  if (want) {
    const hit = models.find((m) => m.id.trim() === want);
    if (hit) return hit;
  }
  return models[0] ?? null;
}

function positiveWindow(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/** Channel efforts the composer should show for the active (or given) model. */
export function resolveProviderEfforts(
  provider: Pick<CustomProvider, "id" | "baseUrl" | "model" | "models" | "efforts">,
  modelId?: string | null,
): ProviderEffortEntry[] | undefined {
  const model = findProviderModel(provider, modelId);
  const raw =
    model?.efforts && model.efforts.length > 0
      ? model.efforts
      : provider.efforts;
  const aligned = alignGrokPresetEfforts({
    providerId: provider.id,
    baseUrl: provider.baseUrl,
    efforts: raw,
  });
  return aligned ?? raw;
}

export function resolveProviderContextWindow(
  provider: Pick<CustomProvider, "model" | "models" | "contextWindow">,
  modelId?: string | null,
): number | null {
  const model = findProviderModel(provider, modelId);
  return (
    positiveWindow(model?.contextWindow) ??
    positiveWindow(provider.contextWindow) ??
    null
  );
}

/**
 * Effective vision flag for the active model.
 * Explicit per-model true/false wins; otherwise channel flag.
 */
export function resolveProviderSupportsVision(
  provider: Pick<CustomProvider, "model" | "models" | "supportsVision">,
  modelId?: string | null,
): boolean {
  const model = findProviderModel(provider, modelId);
  if (model?.supportsVision === true) return true;
  if (model?.supportsVision === false) return false;
  return !!provider.supportsVision;
}

export function resolveProviderSupportsVideo(
  provider: Pick<CustomProvider, "model" | "models">,
  modelId?: string | null,
): boolean {
  return findProviderModel(provider, modelId)?.supportsVideo === true;
}

/** Copy the active model's extras onto channel fields for Host / CLI. */
export function materializeActiveModelChannel(opts: {
  provider: CustomProvider;
  modelId: string;
  models?: ProviderModelEntry[];
}): {
  efforts?: ProviderEffortEntry[];
  contextWindow?: number | null;
  supportsVision?: boolean;
} {
  const models = opts.models ?? opts.provider.models;
  const view = {
    ...opts.provider,
    models,
    model: opts.modelId,
  };
  const efforts = resolveProviderEfforts(view, opts.modelId);
  const contextWindow = resolveProviderContextWindow(view, opts.modelId);
  const supportsVision = resolveProviderSupportsVision(view, opts.modelId);
  return {
    efforts,
    contextWindow: contextWindow ?? undefined,
    supportsVision,
  };
}

/**
 * Apply live `/models` caps onto a catalog row.
 * API values win when present (more accurate than a stale form).
 */
export function mergeRemoteModelCaps(
  model: ProviderModelEntry,
  remote: RemoteModelCaps | null | undefined,
): ProviderModelEntry {
  if (!remote || remote.id.trim() !== model.id.trim()) return model;
  const contextWindow = positiveWindow(remote.contextWindow ?? null);
  return {
    ...model,
    contextWindow:
      contextWindow ?? model.contextWindow ?? null,
    supportsVision:
      remote.supportsVision == null
        ? model.supportsVision
        : remote.supportsVision,
    supportsVideo:
      remote.supportsVideo == null
        ? model.supportsVideo
        : remote.supportsVideo,
  };
}

/** Patch the active model's context window inside a catalog (composer chip). */
export function withModelContextWindow(
  models: ProviderModelEntry[] | null | undefined,
  modelId: string,
  tokens: number,
): ProviderModelEntry[] {
  const list = models?.length ? models.slice() : [];
  const id = modelId.trim();
  if (!id) return list;
  const next = positiveWindow(tokens);
  let found = false;
  const mapped = list.map((m) => {
    if (m.id.trim() !== id) return m;
    found = true;
    return { ...m, contextWindow: next };
  });
  if (found) return mapped;
  return [...mapped, { id, name: id, contextWindow: next }];
}
