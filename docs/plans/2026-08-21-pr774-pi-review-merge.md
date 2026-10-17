# PR #774 审核结论：通过，已 squash-merge

pi `-p`（tools: read, bash）核对 `/tmp/pr774.diff`。无功能 blocker。合入 `364d91f7`。Fixes #773。

首轮 Rust CI 红：`cargo fmt` 要把 `WS_MAXIMIZEBOX, WS_MINIMIZEBOX` 写在同一 import 行。维护者 rebase + rustfmt 后代推，CI 四门绿。CHANGELOG Unreleased 冲突已解。

## 核对表

| # | 核对项 | 结果 |
|---|--------|------|
| 1 | 根因：#628 Linux setSize 在 isMaximized 滞后时取消 Windows OS maximize | ✅ |
| 2 | Win/mac 等 OS flag，不假铺满；Linux 仍 work-area fill | ✅ |
| 3 | frameless HWND 保留 WS_MAXIMIZEBOX | ✅ |
| 4 | 不重演 #735 死锁 | ✅ 纯前端轮询 |
| 5 | visualViewport pin 防还原后拖顶边 pan | ✅ |
| 6 | secrets / confirm / App.tsx | ✅ |
| 7 | rustfmt | ✅ 维护者代修 |

## 非 blocker

`waitForOsMaximized` 返回值在 unmaximize 分支被丢弃。`other` 平台不再有 work-area fallback。
