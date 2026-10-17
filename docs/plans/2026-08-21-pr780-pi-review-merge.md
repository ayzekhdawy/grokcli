# PR #780 审核结论：通过，已 squash-merge

pi `-p`（tools: read, bash）核对 `/tmp/pr780.diff`。无 blocker。Fixes #775。

维护者 rebase 到含 #782/#781 的 main。icons.md 列表层级被 overlay 条目打断，维护者代修后 CI 四门绿。Rust overlay 4 测 + vitest pref/catalog 19 测通过。

## 核对表

| # | 核对项 | 结果 |
|---|--------|------|
| 1 | 默认关闭 | ✅ |
| 2 | 独立于 dock/tray badge | ✅ 独立 command，busy_count 不画 overlay |
| 3 | 不重演 #748/#735 死锁 | ✅ 不 spawn 线程、不持 TrayIcon mutex |
| 4 | settingsCatalog + 15 locale | ✅ |
| 5 | 无 App.tsx useState | ✅ hook + AppWorkbench |
| 6 | hide-to-tray AddTab 后再贴 overlay | ✅ |
| 7 | CHANGELOG Unreleased 只追加 | ✅ Added |

## 非 blocker

设置搜索在非 Windows 仍能命中该条目。overlay ≥10 画加号，复用 tray cap 99 无实际差异。
