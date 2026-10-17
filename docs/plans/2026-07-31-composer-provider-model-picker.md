# Composer provider model picker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Composer model menu lists official catalog models plus each custom provider’s configured request model (grouped); picking an entry activates that route; chip shows display name only on custom routes.

**Architecture:** Pure helpers build grouped menu rows and chip labels from `availableModels` + `providersList`. UI (`ComposerModelMenu`, `PhoneComposerToolsSheet`) renders groups and calls `onModelPick`. App wires `providersActivate` + `refreshProviderRoute` + official `setModelId`/prefs. No new Host RPCs. Reuse provider `name` as chip label (auto-fill from `model` when empty in Settings form).

**Tech Stack:** React/TS (Vite), Vitest, existing Tauri `providers_*` commands, i18n via `src/i18n/`.

**Design:** `docs/plans/2026-07-31-composer-provider-model-picker-design.md`

---

### Task 1: Pure helpers — groups + chip label + tests

**Files:**
- Create: `src/lib/composerModelGroups.ts`
- Create: `src/lib/composerModelGroups.test.ts`
- Modify: `src/lib/effectiveModel.ts`
- Modify: `src/lib/effectiveModel.test.ts`

**Step 1: Write failing tests for chip label**

In `src/lib/effectiveModel.test.ts`, add:

```ts
import { composerModelChipLabel } from "./effectiveModel";

describe("composerModelChipLabel", () => {
  it("uses official label when no custom route", () => {
    expect(
      composerModelChipLabel({
        modelId: "grok-4.5",
        officialLabel: "Grok 4.5",
        activeCustom: null,
      }),
    ).toBe("Grok 4.5");
  });

  it("uses custom name when set", () => {
    expect(
      composerModelChipLabel({
        modelId: "grok-4.5",
        officialLabel: "Grok 4.5",
        activeCustom: { name: "云驿 DeepSeek", model: "deepseek-chat" },
      }),
    ).toBe("云驿 DeepSeek");
  });

  it("falls back to custom model when name empty", () => {
    expect(
      composerModelChipLabel({
        modelId: "grok-4.5",
        officialLabel: "Grok 4.5",
        activeCustom: { name: "  ", model: "deepseek-chat" },
      }),
    ).toBe("deepseek-chat");
  });
});
```

**Step 2: Run tests — expect fail**

```bash
npx vitest run src/lib/effectiveModel.test.ts
```

Expected: FAIL — `composerModelChipLabel` not exported.

**Step 3: Implement chip label**

In `src/lib/effectiveModel.ts`, keep `effectiveComposerModel` and add:

```ts
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
```

**Step 4: Write failing tests for groups**

Create `src/lib/composerModelGroups.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildComposerModelGroups,
  filterComposerModelGroups,
  type ComposerModelGroup,
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
  },
  {
    id: "local",
    name: "",
    model: "llama3",
  },
];

describe("buildComposerModelGroups", () => {
  it("builds official group plus one group per provider", () => {
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
    expect(groups[1].entries[0]).toMatchObject({
      pick: { kind: "custom", providerId: "yunyi" },
      title: "云驿",
      subtitle: "deepseek-chat",
    });
    expect(groups[2].entries[0]).toMatchObject({
      pick: { kind: "custom", providerId: "local" },
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

  it("skips providers with empty model", () => {
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
    const filtered = filterComposerModelGroups(groups, "deep");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].entries[0].pick).toEqual({
      kind: "custom",
      providerId: "yunyi",
    });
  });
});
```

**Step 5: Implement groups helper**

Create `src/lib/composerModelGroups.ts`:

```ts
import type { ModelOption } from "@/lib/grokCatalog";

export type ComposerModelPick =
  | { kind: "official"; modelId: string }
  | { kind: "custom"; providerId: string };

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

export type ComposerProviderInput = {
  id: string;
  name: string;
  model: string;
};

export function buildComposerModelGroups(opts: {
  officialModels: ModelOption[];
  providers: ComposerProviderInput[];
  officialGroupTitle: string;
}): ComposerModelGroup[] {
  const groups: ComposerModelGroup[] = [];
  const officialEntries: ComposerModelEntry[] = opts.officialModels.map(
    (m) => ({
      key: `official:${m.id}`,
      pick: { kind: "official", modelId: m.id },
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
    const model = p.model?.trim() ?? "";
    if (!model) continue;
    const name = p.name?.trim() ?? "";
    const title = name || model;
    const subtitle = name && name !== model ? model : undefined;
    groups.push({
      key: `provider:${p.id}`,
      title: name || p.id,
      entries: [
        {
          key: `custom:${p.id}`,
          pick: { kind: "custom", providerId: p.id },
          title,
          subtitle,
        },
      ],
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
            : e.pick.providerId.toLowerCase().includes(q)),
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
    modelId: string;
  },
): boolean {
  if (entry.pick.kind === "official") {
    return (
      opts.activeSource !== "custom" && entry.pick.modelId === opts.modelId
    );
  }
  return (
    opts.activeSource === "custom" &&
    opts.activeProviderId === entry.pick.providerId
  );
}
```

Add a small test for `isComposerModelEntryActive` in the same test file (official match / custom match / cross mismatch).

**Step 6: Run tests — expect pass**

```bash
npx vitest run src/lib/effectiveModel.test.ts src/lib/composerModelGroups.test.ts
```

**Step 7: Commit**

```bash
git add src/lib/effectiveModel.ts src/lib/effectiveModel.test.ts \
  src/lib/composerModelGroups.ts src/lib/composerModelGroups.test.ts
git commit -m "feat(composer): helpers for provider-grouped model picker"
```

---

### Task 2: i18n strings

**Files:**
- Modify: `src/i18n/messages.ts` (en + zh)
- Modify: `src/i18n/zh-tw.ts`

**Step 1: Add keys**

English (`en`):

```ts
"composer.modelGroupOfficial": "Official",
"prov.nameChipHint": "Shown as the model chip label in the composer",
```

Chinese (`zh`):

```ts
"composer.modelGroupOfficial": "官方",
"prov.nameChipHint": "作为输入框模型芯片的展示名称",
```

Traditional (`zh-tw.ts`):

```ts
"composer.modelGroupOfficial": "官方",
"prov.nameChipHint": "作為輸入框模型晶片的顯示名稱",
```

Ensure `MessageKey` union picks up new keys (same pattern as existing composer.* / prov.* keys).

**Step 2: Commit**

```bash
git add src/i18n/messages.ts src/i18n/zh-tw.ts
git commit -m "i18n: composer official group + provider name chip hint"
```

---

### Task 3: ComposerModelMenu — grouped list + onModelPick

**Files:**
- Modify: `src/components/ComposerModelMenu.tsx`
- Modify: `src/styles/app.css` (group header styles if needed)

**Step 1: Extend props**

```ts
import {
  buildComposerModelGroups,
  filterComposerModelGroups,
  isComposerModelEntryActive,
  type ComposerModelPick,
  type ComposerProviderInput,
} from "@/lib/composerModelGroups";
import { composerModelChipLabel } from "@/lib/effectiveModel";

// props:
providers?: ComposerProviderInput[]; // default []
/** official | custom */
activeSource?: string;
activeProviderId?: string | null;
/** Prefer over onModel when provided */
onModelPick?: (pick: ComposerModelPick) => void;
// labels add:
modelGroupOfficial: string;
// modelViaProvider can remain optional for back-compat but via-provider synthetic row is replaced by real custom groups
```

**Step 2: Trigger label**

```ts
const officialLabel = activeModel?.label ?? modelId;
const modelLabel = composerModelChipLabel({
  modelId,
  officialLabel,
  activeCustom:
    activeSource === "custom" && activeProviderId
      ? (() => {
          const p = (providers ?? []).find((x) => x.id === activeProviderId);
          return p
            ? { name: p.name, model: p.model }
            : { name: "", model: modelId };
        })()
      : null,
});
```

Or accept `chipLabel?: string` from App to avoid re-deriving — prefer computing in menu for self-containment when providers are passed.

**Step 3: Nested model list**

Replace flat `filteredModels.map` + `showViaProviderEntry` with:

```ts
const groups = buildComposerModelGroups({
  officialModels: modelList,
  providers: providers ?? [],
  officialGroupTitle: labels.modelGroupOfficial,
});
const filteredGroups = filterComposerModelGroups(groups, modelQuery);
// empty state when filteredGroups.length === 0
// map groups → section title div.cmm__section + entries as cmm__opt
// is-active via isComposerModelEntryActive
// onClick:
//   if (onModelPick) onModelPick(entry.pick);
//   else if (entry.pick.kind === "official") onModel(entry.pick.modelId);
//   setNested(null);
```

**Step 4: CSS**

Reuse existing section styles if any (phone-sheet has `phone-sheet__section`). Add minimal:

```css
.cmm__section {
  padding: 8px 12px 4px;
  font-size: 12px;
  color: var(--text-tertiary);
  /* match nearby cmm tokens */
}
```

**Step 5: Manual smoke (optional)** — typecheck:

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | head -40
```

**Step 6: Commit**

```bash
git add src/components/ComposerModelMenu.tsx src/styles/app.css
git commit -m "feat(composer): group official and provider models in menu"
```

---

### Task 4: PhoneComposerToolsSheet — same groups

**Files:**
- Modify: `src/components/PhoneComposerToolsSheet.tsx`

**Step 1: Mirror props**

Add `providers`, `activeSource`, `activeProviderId`, `onModelPick`, `labels.modelGroupOfficial`.

**Step 2: Model panel**

Replace the synthetic “not in catalog” row + flat list with the same `buildComposerModelGroups` / `filterComposerModelGroups` rendering pattern (section headers already exist as `phone-sheet__section`).

Active row: `isComposerModelEntryActive`. Stacked row when `subtitle` present.

**Step 3: Commit**

```bash
git add src/components/PhoneComposerToolsSheet.tsx
git commit -m "feat(composer): provider-grouped models on phone sheet"
```

---

### Task 5: App wire-up — activate on pick

**Files:**
- Modify: `src/App.tsx`

**Step 1: Hold full provider list for menu**

Today App only keeps `activeCustomProvider`. Add:

```ts
const [customProviders, setCustomProviders] = useState<api.CustomProvider[]>([]);
const [providerActiveSource, setProviderActiveSource] = useState<string>("official");
const [providerActiveId, setProviderActiveId] = useState<string | null>(null);
```

In `refreshProviderRoute`:

```ts
const list = await api.providersList();
setCustomProviders(list.providers);
setProviderActiveSource(list.activeSource);
setProviderActiveId(list.activeProviderId);
// active custom as today
```

**Step 2: Shared pick handler**

```ts
const [modelPickBusy, setModelPickBusy] = useState(false);

const handleModelPick = useCallback(
  async (pick: ComposerModelPick) => {
    if (modelPickBusy) return;
    setModelPickBusy(true);
    try {
      if (pick.kind === "official") {
        if (providerActiveSource === "custom" && api.isTauri()) {
          await api.providersActivate("official");
          await refreshProviderRoute();
        }
        if (!isValidModelId(pick.modelId, availableModels)) return;
        setModelId(pick.modelId);
        void api
          .composerPrefsSet({
            projectId: activeProject?.id ?? null,
            sessionId: session.sessionId ?? null,
            modelId: pick.modelId,
          })
          .catch((e) => showToast(String(e), 4000));
      } else {
        if (!api.isTauri()) return;
        await api.providersActivate("custom", pick.providerId);
        await refreshProviderRoute();
      }
    } catch (e) {
      showToast(String(e), 4000);
    } finally {
      setModelPickBusy(false);
    }
  },
  [/* deps */],
);
```

**Step 3: Pass props to ComposerModelMenu + PhoneComposerToolsSheet**

Replace `onModel` with `onModelPick={handleModelPick}` (keep `onModel` no-op or remove if fully migrated).

```tsx
providers={customProviders.map((p) => ({
  id: p.id,
  name: p.name,
  model: p.model,
}))}
activeSource={providerActiveSource}
activeProviderId={providerActiveId}
modelId={/* keep modelId for official highlight; chip uses groups helper inside menu */}
// Prefer passing effective chip via menu internals; stop forcing effectiveModelId as modelId if it breaks official highlight — pass true catalog modelId + activeSource/activeProviderId instead.
```

**Important:** Chip / active highlight should use catalog `modelId` + `activeSource`/`activeProviderId`, **not** replace `modelId` prop with `effectiveModelId` for official matching. Chip label comes from `composerModelChipLabel` inside the menu (or pass precomputed `chipLabel`).

If current branch passes `modelId={effectiveModelId}`, change to:

```tsx
modelId={modelId}
activeSource={providerActiveSource}
activeProviderId={providerActiveId}
providers={...}
```

and derive chip inside menu.

**Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(composer): activate provider route when picking model"
```

---

### Task 6: ProvidersPanel — default name from model

**Files:**
- Modify: `src/components/ProvidersPanel.tsx`

**Step 1: Auto-fill name when model changes**

On model input `onChange` (and when picking from remote models list):

```ts
setForm((f) => {
  const nextModel = e.target.value;
  const prevModel = f.model;
  const nameWasAuto = !f.name.trim() || f.name.trim() === prevModel.trim();
  return {
    ...f,
    model: nextModel,
    name: nameWasAuto ? nextModel.trim() : f.name,
  };
});
```

When selecting a remote model chip that sets `form.model`, apply the same rule.

**Step 2: Hint under name field**

```tsx
<span className="prov-field__hint">{tr("prov.nameChipHint")}</span>
```

(Use existing hint class if present, else muted small text.)

**Step 3: Commit**

```bash
git add src/components/ProvidersPanel.tsx
git commit -m "feat(providers): default display name from model id"
```

---

### Task 7: Product docs

**Files:**
- Modify: `docs/llm-wiki/catalog.md`
- Modify: `docs/llm-wiki/providers.md` (short cross-link)

**Step 1: catalog.md**

Replace the line that says UI only shows official models / providers only in Account settings with:

- Composer model menu lists official catalog + each custom provider’s configured request model, grouped by provider.
- Selecting a custom entry calls `providers_activate` (same as Settings Use).
- Chip shows provider display name (`name`, else `model`).

**Step 2: providers.md**

Under route switching, note composer pick as an alternate activate entry point.

**Step 3: Commit**

```bash
git add docs/llm-wiki/catalog.md docs/llm-wiki/providers.md
git commit -m "docs: composer can activate custom provider routes"
```

---

### Task 8: Verify

**Step 1: Unit tests**

```bash
npx vitest run src/lib/effectiveModel.test.ts src/lib/composerModelGroups.test.ts src/lib/modelMenuSearch.test.ts
```

Expected: all pass.

**Step 2: Typecheck (if project script exists)**

```bash
npm test -- --run src/lib/composerModelGroups.test.ts src/lib/effectiveModel.test.ts
# or package.json test script
```

**Step 3: Manual checklist (Tauri)**

1. No custom providers → menu only official group.
2. Add provider with model + empty name → name fills to model; save.
3. Open composer model menu → official + provider groups.
4. Pick custom → Settings shows that provider active; chip shows name.
5. Pick official → official route; chip shows catalog label; send uses catalog model.
6. Phone sheet same behavior if phone layout available.

**Step 4: Final commit if any fixups**

```bash
git status
# commit remaining polish if needed
```

---

## Notes for implementer

- **Do not** call `providers_list_models` from the composer path.
- **Do not** change `agent_spawn_model_id` semantics.
- Soft-fail activate errors with toast; never leave UI claiming a route that Host rejected.
- All user-facing strings through `tr()` / i18n.
- Branch: `feat/composer-effective-model-via-provider` (no push unless asked).
