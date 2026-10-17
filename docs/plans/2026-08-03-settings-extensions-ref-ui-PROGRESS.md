# PROGRESS — Settings → Extensions redesign

**Branch:** `feat/settings-extensions-ref-ui`  
**Spec:** `docs/plans/2026-08-03-settings-extensions-ref-ui-GOAL.md`

| WP | Status | Notes |
|----|--------|-------|
| WP-0 | DONE | Branch + baseline; PROGRESS ledger |
| WP-1 | DONE | Removed market tab; market deep-link/search → plugins catalog; settings-ia wiki |
| WP-2 | DONE | Removed ext-toolbar; ext-ref-tabs with counts + co-located search; extensions-ref.css |
| WP-3 | DONE | ChatCut recommended + ensure openai/plugins + installable embedded + advanced; pluginRecommended tests; #subdir name fix |
| WP-4 | DONE | Installed ref rows (toggle+expand); MCP dual group; skills dense badge rows |
| WP-5 | DONE | Agents shell via ext-ref-shell; en/zh/zh-TW keys; scrub market-tab CTAs; typecheck green |
| WP-6 | DONE | §7 automation green; §8 P0 matrix PASS (static+unit); evidence under goal scratch |

## Verification snapshots

```
pnpm typecheck → exit 0
pnpm exec vitest run src/lib/settingsCatalog.test.ts src/lib/pluginMarketplace.test.ts src/lib/pluginMarketPro.test.ts src/lib/pluginRecommended.test.ts
→ 4 files, 70 tests PASS
cargo test plugin_name_from_install_source → ok (#codex → codex)
```

## FINAL: PASS

No P0 debt (cannot open extensions / lost list / cannot install / deep-link white screen / market tab / project bar / hardcoded UI walls / silent trust install).
