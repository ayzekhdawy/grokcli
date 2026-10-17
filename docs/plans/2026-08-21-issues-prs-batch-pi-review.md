# 联合 review：2026-08-21 Issues/PRs 清空批次

pi `-p`（tools: read, bash）通审已合 PR、已关 Issue、CHANGELOG Unreleased、致谢、branch hygiene。无 blocker。

## 结论

当时全部 open Issues / PRs 已关闭。三个社区 PR squash 进 `main`，linked issues `COMPLETED`。

## 合入

| PR | Issue | 合入 | 主题 |
|----|-------|------|------|
| #770 | #768 | `b3b14766` | Windows Alt+Tab 把键盘焦点转进 WebView2 |
| #769 | #767 | `bd6eadc4` | Ctrl+/ 快捷键帮助可筛选、分组、补全目录 |
| #766 | #765 | `e78d6e06` | Win+Right 在矮屏贴真正半屏（Host cap OS min） |

作者均为 @zhangxaochen。#766 维护者代修测试期望（1080 高一半是 540）并把 CHANGELOG 从已发 0.2.24 挪到 Unreleased。

## 核对表

| # | 项 | 结果 |
|---|----|------|
| 1 | open Issues / PRs 为空 | ✅ |
| 2 | #765 #767 #768 CLOSED；#766 #769 #770 MERGED | ✅ |
| 3 | CHANGELOG Unreleased 保留官网 Changed + 三条合入，未覆盖 0.2.24 | ✅ |
| 4 | 每 PR 有 `Merged, thanks @zhangxaochen` | ✅ |
| 5 | 本批 PR 头与本地 `pr-*` worktree 已清 | ✅ |
| 6 | 无 secrets / confirm / App.tsx 新增 useState | ✅ |

## 非 blocker

`origin/feat/plugin-ui-host` 是既有未合入分支，与本批无关。
