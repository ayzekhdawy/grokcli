# 联合 review：2026-08-21/22 Issues/PRs 第四波

pi `-p`（tools: read, bash）通审已合 PR、已关 Issue、CHANGELOG Unreleased、致谢、branch hygiene。无 blocker。

## 结论

open Issues / PRs 为空。四个社区 PR squash 进 `main`，linked issues `COMPLETED`。

## 合入

| PR | Issue | 合入 | 主题 |
|----|-------|------|------|
| #815 | #813 | `0aacfcdd` | 宠物浮层与主窗分 entry |
| #816 | #814 | `dac30983` | 权限/git/Tasks tick 离开 shell |
| #818 | #817 | `23bed027` | 长文件 CodePreview 窗口化 |
| #820 | #819 | `9a19e17f` | 窄窗侧栏 overlay |

作者均为 @zhangxaochen。#816/#818/#820 维护者 rebase CHANGELOG。#820 维护者代修未读 `sidebarChanged`。

## 核对表

| # | 项 | 结果 |
|---|----|------|
| 1 | open Issues / PRs 为空 | ✅ |
| 2 | #813 #814 #817 #819 CLOSED；#815 #816 #818 #820 MERGED | ✅ |
| 3 | CHANGELOG Unreleased 四条都在，0.2.24 未覆盖 | ✅ |
| 4 | 每 PR 有 `Merged, thanks @zhangxaochen` | ✅ |
| 5 | 本批 PR 头与本地 `pr-*` worktree 已清 | ✅ |
| 6 | 无 secrets / confirm / App.tsx 新增 useState | ✅ |
