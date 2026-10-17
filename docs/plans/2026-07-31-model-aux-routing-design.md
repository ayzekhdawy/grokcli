# Design: Model auxiliary routing (Hermes-style layers)

**Date:** 2026-07-31  
**Branch:** `feat/model-aux-routing`  
**Status:** Implementing

## Goal

Expose Grok Build’s native `[models]` side-task slots in the App so a cheap text main model (e.g. DeepSeek V4 Pro) can offload **image description**, **web search**, **session summary**, and **prompt suggestion** to a multimodal / search-capable model (e.g. Grok 4.5) — without breaking existing main-route / custom-provider configuration.

## CLI ground truth

```toml
[models]
default = "…"                 # main (unchanged ownership: providers / composer)
image_description = "…"       # vision → text for non-vision main models
web_search = "…"              # web_search tool model
session_summary = "…"         # summary / compaction side-job
prompt_suggestion = "…"       # prompt suggestions
```

Env mirrors: `GROK_IMAGE_DESCRIPTION_MODEL`, `GROK_WEB_SEARCH_MODEL`, `GROK_SESSION_SUMMARY_MODEL`, `GROK_PROMPT_SUGGESTIONS_MODEL`.

## Product

| Surface | Behavior |
|---------|----------|
| Settings → Account → **Model layers** (`#/settings/account/models`) | Four slots + pickers |
| **Save Grok** preset | Write all four slots to resolved multimodal target; **do not** change main / `default` |
| **Restore official defaults** | Remove the four override keys only; CLI built-in defaults apply |
| Shared session mode | Read-only / refuse writes (same as providers: never rewrite `~/.grok`) |

### Resolve multimodal target (Save Grok)

1. Official `grok-4.5` if an API key is available (write `[model.grok-4.5] api_key=…` when needed; **never** reintroduce `auth.json` on custom main routes).
2. Else a configured custom channel whose active/catalog model is Grok 4.5 (Amux / Yun / …).
3. Else fail with UI guidance (configure official key or multimodal provider).

## Safety invariants

1. **Never** change `[models].default` from aux APIs.
2. **Never** call `providers_activate` from aux set/reset.
3. **Never** remove/rewrite unrelated `[model.*]` sections except optional `api_key` ensure on the chosen official aux id.
4. Upsert/remove only the four allowlisted keys under `[models]`.
5. After write: `recycle_all_agents(..., "models_aux")` so warm agents pick up config (same pattern as provider route).

## Host API

| Command | Role |
|---------|------|
| `models_aux_get` | Current slot values + option list + session mode + resolve hints |
| `models_aux_set` | Partial update of slots (`null`/empty = clear key) |
| `models_aux_apply_save_grok` | Resolve target + set all four |
| `models_aux_reset_defaults` | Remove all four keys |

## Non-goals (this PR)

- Host-side pre-send image describe pipeline
- Hermes’ full 11-slot surface
- Auto-clear aux when activating official (user uses explicit Restore)
- Shared-mode writes to `~/.grok`
