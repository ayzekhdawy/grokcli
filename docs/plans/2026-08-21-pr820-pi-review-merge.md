# PR #820 审核结论：通过（复审后），已 squash-merge

pi `-p` 两轮。首轮 CI blocker：`usePaneSplitMotion.ts` 未读 `sidebarChanged`。维护者删变量后复审无 blocker。合入 `9a19e17f`。Fixes #819。

CI 四门绿。`paneOverlay.test.ts` + `paneSplitMotion.test.ts` 19 测通过。维护者 rebase 到含 #818 的 main，仅 CHANGELOG 冲突，四条 Changed 都保留。

## 核对表

| # | 项 | 结果 |
|---|----|------|
| 1 | 宽窗 snap、窄窗 overlay，不再 flex 挤聊天/拉大窗口 | ✅ |
| 2 | `viewportWidth` resize 打穿 shell | 非 blocker |
| 3 | 未读 `sidebarChanged` | ✅ 首轮 blocker 已清 |
| 4 | phone drawer 不受 overlay 影响 | ✅ |
| 5 | scrim 实心、走 t()、点关 overlay | ✅ |
| 6 | overlay 跳过 `ensureWindowFitsLayout` | ✅ |
| 7 | 无 App.tsx useState / confirm / secrets | ✅ |
| 8 | CHANGELOG 追加本条，#815/#816/#818 仍在 | ✅ |
