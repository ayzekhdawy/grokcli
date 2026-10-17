# PR #769 审核结论：通过，已 squash-merge

pi `-p`（tools: read, bash）核对 `/tmp/pr769.diff`。无 blocker。合入 `bd6eadc4`。Fixes #767。

## 核对表

| # | 核对项 | 结果 |
|---|--------|------|
| 1 | Ctrl+/ 复用 GlassModal，列表可滚，筛选打开即聚焦 | ✅ |
| 2 | zoom / newline / promptHistory / typeToFocus 为 display-only | ✅ 不进 `REMAPPABLE_SHORTCUT_IDS` |
| 3 | 15 locale 锁步；settingsCatalog 登记 `group.view` | ✅ |
| 4 | 无原生 `<select>` / 透明 `menu-panel` | ✅ |
| 5 | CHANGELOG Unreleased | ✅ |
| 6 | 测试：筛选 / 空态 / 聚焦 / 换行随发送键 | ✅ |
| 7 | CI | ✅ rebase 后全绿 |

## 非 blocker

- `fil` 的 `group.view` 译成 `Tanaw`，与该 locale 其它分组保留英文不完全一致。
- 非 mac 一律显示 Win 和弦（与 `formatShortcutHint` 相同）。

维护者 rebase 解决 CHANGELOG 冲突。
