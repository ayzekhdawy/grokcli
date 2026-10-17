# COMPLETION — Settings → Extensions redesign

**Branch:** `feat/settings-extensions-ref-ui`  
**PROGRESS:** `FINAL: PASS`  
**Spec:** `docs/plans/2026-08-03-settings-extensions-ref-ui-GOAL.md`

## Summary

- Removed top-level **Market** tab and **project scope toolbar** from Settings → Extensions.
- Tabs: **Plugins · MCP · Skills · Agents · Hooks** with counts and co-located search.
- Plugins page: **Recommended (ChatCut `#codex`)** → **Installed** → **Installable** (ensure `openai/plugins`) → **Advanced**.
- MCP: dual groups (servers + from plugins). Skills: dense rows with source badge + toggle.
- Installs confirm via **GlassModal** only; no auto-install; other marketplace sources preserved.
- Deep-link `#/settings/extensions/market` and search “marketplace/市场” land on plugins installable catalog.

## Verification

| Check | Result |
|-------|--------|
| `pnpm typecheck` | exit 0 |
| vitest settingsCatalog / pluginMarketplace / pluginMarketPro / pluginRecommended | 70 PASS |
| i18n messages.test | 18 PASS |
| `cargo test plugin_name_from_install_source` | PASS (`#codex` → `codex`) |
| §8 P0 matrix | PASS (static + unit; O4/C2 destructive skipped) |

## Known limits

- Full desktop GUI screenshots not captured in agent environment; structure verified in source + pure tests.
- Optional live install (O4/C2) skipped to avoid mutating local plugin installs.
