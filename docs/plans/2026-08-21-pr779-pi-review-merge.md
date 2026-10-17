# PR #779 审核结论：通过，已 squash-merge

pi `-p`（tools: read, bash）核对 `/tmp/pr779.diff`。无 blocker。合入 `0d106452`。Fixes #778。同分支含 #772，Fixes #771。#772 作为已落地关闭。

本地 `stickToBottom` + `chatVirtualList` 79 测通过。CI frontend + Rust 三平台绿。CHANGELOG Unreleased 由维护者代写。

## 核对表

| # | 核对项 | 结果 |
|---|--------|------|
| 1 | 根因：trackpad 2–8px tick 够不到单事件 10px | ✅ `distanceFromBottom >= 10` 累积释放 |
| 2 | 根因：虚拟列表 layout 再 snap 回底部 | ✅ `shouldSnapPinnedLayoutToBottom` 仅 `<10px` 才 snap |
| 3 | 边界 10px 无 gap | ✅ release `>=10`，snap `<10` |
| 4 | 流式跟底 / 发送贴底 | ✅ `<24px` 当帧 follow |
| 5 | secrets / confirm / App.tsx useState | ✅ |
| 6 | 测试 | ✅ 累积 10px 释放 + layout 不 snap + 媒体 coalesce |

## 非 blocker

`shouldWriteScrollOnRowCommit(true)` 调用点恒 false，伪参数；行为正确。媒体 follow 64ms 是有意 coalesce。
