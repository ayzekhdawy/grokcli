# PR #766 审核结论：通过，已 squash-merge

pi `-p`（tools: read, bash）核对 `/tmp/pr766-fixed.diff`。无 blocker。合入 `e78d6e06`。Fixes #765。

首轮 CI 红：`snap_friendly_min(600, 1080)` 期望 600，实际 540（半屏算法）。维护者代改测试，并把 CHANGELOG 从已发 `0.2.24` 挪到 Unreleased。

## 核对表

| # | 核对项 | 结果 |
|---|--------|------|
| 1 | 根因：JSON `minWidth` 900 卡住 1440 屏 Win+Right | ✅ |
| 2 | JSON 舒适下限仍 900；只 cap OS min | ✅ |
| 3 | `apply_main` 不重演 #735 | ✅ 不碰 window-state 插件 mutex |
| 4 | 高度也被 cap（1080p minHeight 540） | ✅ 算法自洽，1200+ 恢复 600 |
| 5 | CHANGELOG Unreleased | ✅ 维护者代挪，0.2.24 无残留 |
| 6 | 测试与算法一致 | ✅ 本地 `cargo test --lib window_min` 6/6；CI 绿 |
| 7 | secrets / confirm / 夹带 | ✅ |

## 非 blocker

`Moved` 每次拖拽都 `set_min_size`，幂等但可后续只在跨屏时重算。
