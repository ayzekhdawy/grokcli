# PR #818 审核结论：通过，已 squash-merge

pi `-p`（tools: read, bash；openrouter/stealth/ox-alpha）核对 `/tmp/grok-pr-diffs/pr818.rebased.diff`。无 blocker。合入 `23bed027`。Fixes #817。

CI 四门绿。`codePreviewWindow.test.ts` + `CodePreview.test.tsx` 7 测通过。维护者 rebase 到含 #815/#816 的 main，仅 CHANGELOG 冲突，三条 Changed 都保留。

## 核对表

| # | 项 | 结果 |
|---|----|------|
| 1 | 根因：长文件整文件 highlight + 一行一 DOM | ✅ |
| 2 | ≥200 行 VirtualList；短文件仍全量 | ✅ |
| 3 | 按行 highlight 拆跨行 token | 非 blocker |
| 4 | VirtualList `initialWindow` 首帧不挂全表；layout 前纠正 | ✅ |
| 5 | path:line `scrollToKey`；行高 20px 与 CSS 一致 | ✅ |
| 6 | 无 App.tsx useState / confirm / secrets | ✅ |
| 7 | CHANGELOG 追加本条，#815/#816 仍在 | ✅ |

## 非 blocker

长文件跨行注释/模板字符串着色降级。聚焦滚动从平滑居中改为瞬时跳转。
