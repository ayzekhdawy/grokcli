/**
 * Effective inference model shown in composer model chips.
 *
 * A custom provider is a channel. The chip shows the model this chat picked
 * when that id is in the provider catalog. Otherwise it shows the provider's
 * configured `model`, never a leftover official catalog id such as Grok 4.5.
 */

export function resolveCustomRouteDisplay(
  provider:
    | {
        name?: string | null;
        model?: string | null;
        models?: ReadonlyArray<{ id: string; name?: string | null }> | null;
      }
    | null
    | undefined,
  sessionModelId: string,
): {
  chip: { name: string; model: string };
  requestModel: string | null;
} | null {
  if (!provider) return null;
  const models = provider.models ?? [];
  const sessionId = sessionModelId.trim();
  const sessionEntry = sessionId
    ? models.find((m) => m.id === sessionId)
    : undefined;
  const configured = provider.model?.trim() ?? "";
  const configuredEntry = configured
    ? models.find((m) => m.id === configured)
    : undefined;
  const entry =
    sessionEntry ??
    configuredEntry ??
    (configured ? { id: configured, name: configured } : undefined);
  const model = (entry?.id || configured).trim();
  const name =
    (entry?.name || "").trim() || model || (provider.name || "").trim();
  if (!name && !model) return null;
  return {
    chip: { name: name || model, model: model || name },
    requestModel: sessionEntry ? sessionEntry.id : configured || null,
  };
}

/**
 * Resolve the model id the composer chip should display.
 *
 * @param modelId Official catalog selection (composer state).
 * @param activeCustomModel Request model of the active custom provider, or
 *   null/undefined when the official route is active.
 */
export function effectiveComposerModel(
  modelId: string,
  activeCustomModel: string | null | undefined,
): string {
  const custom = activeCustomModel?.trim();
  return custom ? custom : modelId;
}

/**
 * Label for the composer model chip.
 *
 * Official route: catalog label (or model id).
 * Custom route: provider display `name`, falling back to request `model`.
 */
export function composerModelChipLabel(opts: {
  modelId: string;
  officialLabel: string;
  activeCustom: { name: string; model: string } | null | undefined;
}): string {
  const custom = opts.activeCustom;
  if (custom) {
    const name = custom.name?.trim();
    if (name) return name;
    const model = custom.model?.trim();
    if (model) return model;
  }
  return opts.officialLabel || opts.modelId;
}
