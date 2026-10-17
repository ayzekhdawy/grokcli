# Composer provider model picker — design

**Date:** 2026-07-31  
**Branch:** `feat/composer-effective-model-via-provider`  
**Status:** Approved

## Problem

Custom providers are separate **channels**. Users must open **Settings → Account → Custom providers → Use**, then return to the composer to pick a model. The composer chip also misleads when a relay is active (fixed earlier via `effectiveComposerModel`).

Daily flow should be: open model menu → see official + all configured providers → pick one → that channel is used for the next agent call.

## Goals

1. Model menu **aggregates** official catalog models and **each custom provider’s configured request model** (not remote `/models`).
2. Entries are **grouped by provider** (official group + one group per custom provider).
3. Selecting an entry **auto-activates** that route (`providersActivate`) so Settings “Use” is no longer required for switching.
4. Composer chip shows **display name only** for custom routes: provider `name`, defaulting to `model` when empty.
5. Provider form: when `name` is empty and user sets `model`, **auto-fill `name` from model id**.

## Non-goals

- Fetching full remote `/v1/models` catalogs into the composer.
- Session-scoped routes independent of global active route.
- New Host composite RPC (e.g. `providers_select_route_model`).
- Changing spawn/auth isolation rules in `providers.rs` (reuse `providers_activate` + recycle).

## Current architecture (constraints)

| Piece | Behavior |
|-------|----------|
| Custom provider | `id`, `name`, `model`, `baseUrl`, … in agent-home `config.toml` |
| Active route | Global: `official` \| `custom` + `activeProviderId` |
| Spawn model | Custom: pass **provider section id**; Official: catalog model id (`agent_spawn_model_id`) |
| Activate | `providers_activate` rebinds auth, sets default, recycles warm agents |
| Composer `modelId` | Official catalog selection; ignored for spawn when custom route is active |
| Chip | `effectiveComposerModel(modelId, activeCustom?.model)` — id only today |

## Approach (A): front-end aggregation + activate on pick

Reuse existing APIs only:

- `providersList` — list + active route
- `providersActivate("official" \| "custom", providerId?)` — switch channel
- `availableModels` — official catalog already loaded in App

No Host schema changes required for the picker itself.

### Selection identity

```ts
type ComposerModelPick =
  | { kind: "official"; modelId: string }
  | { kind: "custom"; providerId: string };
```

Custom picks do not need a separate model id in the pick payload: the provider’s configured `model` is the request body model.

### Data flow

```text
Menu open / App load
  → providersList + availableModels
  → buildComposerModelGroups(...)

User picks official M
  → if activeSource === "custom": providersActivate("official")
  → refreshProviderRoute()
  → setModelId(M) + composerPrefsSet({ modelId: M })

User picks custom P
  → providersActivate("custom", P.id)
  → refreshProviderRoute()
  → do not force setModelId to P.model (official prefs may stay)
  → chip label from activeCustomProvider name || model
```

### Chip label

| Route | Chip text |
|-------|-----------|
| Official | Existing catalog label for `modelId` |
| Custom | `name.trim() \|\| model` (display name only) |

Pure helper (extend `src/lib/effectiveModel.ts` or sibling):

```ts
composerModelChipLabel({
  modelId,
  officialLabel, // findModel(...).label
  activeCustom: { name, model } | null,
}): string
```

### Display name in Settings

- Field: existing `name` (no new TOML key).
- Create/edit form: when `model` changes and `name` is empty (or still equal to previous auto-filled model), set `name` to the new model id.
- Copy: clarify that **name is the composer chip label**.

## UI

### Desktop — `ComposerModelMenu`

Nested model panel:

1. Section **Official** (i18n) — list `availableModels`.
2. One section per custom provider — title = `name || id`; single row: primary = display name (`name || model`); if `name` differs from `model`, optional secondary line with raw `model`.
3. Search filters across all sections; hide empty sections.
4. Active highlight:
   - Official route + matching catalog id
   - Custom route + matching `providerId` (not catalog `findModel`)

Props evolve from `onModel(id)` to `onModelPick(pick)` (or keep `onModel` for official-only callers and add pick). Phone sheet mirrors the same contract.

### Phone — `PhoneComposerToolsSheet`

Same groups and pick semantics; reuse stacked row styles already introduced for via-provider rows.

### Loading / busy

While `providersActivate` is in flight: disable further picks; on failure toast and leave route/model unchanged; on success close nested panel and refresh route chrome.

## Edge cases

| Case | Behavior |
|------|----------|
| Zero custom providers | Official group only (status quo list) |
| Activate fails | Toast; no state flip |
| Same model string on two providers | Distinct groups; each activates its provider |
| Effort on custom | Existing `effortsForModel` → static efforts fallback |
| Web (non-Tauri) | No custom groups; official only |
| Streaming session | Same soft-respawn path as Settings activate (host recycle) |

## Product docs

Update `docs/llm-wiki/catalog.md`:

- Remove / soften “providers only switched in Account settings”.
- Document: composer model menu lists official + configured provider models; selection activates the channel.

Optional short note in `docs/llm-wiki/providers.md` under route switching: composer pick is an alternate entry to `providers_activate`.

## i18n

New keys (en / zh / zh-tw) as needed:

- `composer.modelGroupOfficial` — section header for official models
- Reuse / adjust `composer.modelViaProvider` if still needed for captions
- Provider form hint that name is used as the chip label (if not already clear)

No hardcoded user-facing strings.

## Testing

Pure unit tests (Vitest):

1. `buildComposerModelGroups` — official + N providers; empty providers; search filter shape if helper owns it.
2. `composerModelChipLabel` — official label; custom name; custom empty name → model.
3. Pick resolution helpers if extracted (which activate args from pick).

Do not require Tauri E2E for activate in this slice.

## Implementation sketch (files)

| Area | Files |
|------|--------|
| Helpers + tests | `src/lib/effectiveModel.ts` (+ test), new `src/lib/composerModelGroups.ts` (+ test) optional |
| Desktop menu | `src/components/ComposerModelMenu.tsx` |
| Phone sheet | `src/components/PhoneComposerToolsSheet.tsx` |
| Wire-up | `src/App.tsx` (`onModelPick`, providers list for menu, busy/toast) |
| Provider form default name | `src/components/ProvidersPanel.tsx` |
| i18n | `src/i18n/messages.ts`, `src/i18n/zh-tw.ts` |
| Styles | `src/styles/app.css` (group headers if missing) |
| Wiki | `docs/llm-wiki/catalog.md`, maybe `providers.md` |

## Success criteria

1. With ≥1 custom provider configured, opening the model menu shows official models and one entry per provider under group headers.
2. Picking a custom entry activates that provider (Settings “active” badge matches) without opening Account settings.
3. Picking an official model activates official and updates the catalog selection.
4. Chip shows display name only on custom route.
5. Saving a provider with empty name and a model results in name defaulting to model id (form and/or save path).
6. Unit tests for group build + chip label pass.
7. No new Host commands; no remote `/models` in composer.
