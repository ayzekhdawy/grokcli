# PR #816 审核结论：通过，已 squash-merge

pi `-p`（tools: read, bash；openrouter/stealth/ox-alpha）核对 `/tmp/grok-pr-diffs/pr816.rebased.diff`。无 blocker。合入 `dac30983`。Fixes #814。

CI 四门绿。`pnpm typecheck` 通过。`workspaceGit.test.ts` + `PermissionCountdown.test.tsx` 15 测通过。维护者 rebase 到含 #815 的 main，仅 CHANGELOG 冲突，两边条目都保留；CI 修复 commit 已在 #815 上游，rebase 时 drop。

## 核对表

| # | 项 | 结果 |
|---|----|------|
| 1 | 250ms 倒计时 tick 离开 AppWorkbench；auto-deny timeout 仍在 shell | ✅ |
| 2 | render 路径 `resumeGateClock` 幂等，StrictMode 不重置 | 非 blocker |
| 3 | git dirty 仅 count/label 变化 setState | ✅ |
| 4 | Tasks 自己订 liveMap；dashboard/reliability/stall 仍走 shell | ✅ |
| 5 | ConversationThreadLive memo + 稳定回调；executeSendLatestRef | ✅ |
| 6 | 无 App.tsx useState / confirm / secrets | ✅ |
| 7 | CHANGELOG 追加本条，#815 宠物浮层条目仍在 | ✅ |
| 8 | PermissionCountdown + gitDirtySummariesEqual 测试 | ✅ |

## 非 blocker

`structuredOutputUsage` useMemo 依赖字段而非对象（lint 风格）。Countdown 在 startedAt 变化到 effect 重跑之间可能有一帧旧秒数。
