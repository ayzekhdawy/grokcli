# 2026-08-21 Issues/PRs 清空批次（第四波）

作者均为 @zhangxaochen。每 PR squash-merge 前 pi `-p` 审查；#816 先 rebase 再合。

## 合入

| PR | Issue | 合入 | 主题 |
|----|-------|------|------|
| #815 | #813 | `0aacfcdd` | 宠物浮层与主窗分 entry，不解析工作台 |
| #816 | #814 | `dac30983` | 权限倒计时 / git 芯片 / Tasks liveMap 离开 shell |
| #818 | #817 | `23bed027` | 长文件 CodePreview 窗口化 |
| #820 | #819 | `9a19e17f` | 窄窗侧栏 overlay，宽窗瞬时切分 |

## 维护者代修

- #816 rebase 到含 #815 的 main；CHANGELOG 两边 Changed 条目都保留
- #816 的 CI 修复 commit（locale catalogs + NotificationExt）已由 #815 带上，rebase drop

## 核对

- open Issues / PRs 应为空
- 致谢：两 PR 均有 `Merged, thanks @zhangxaochen`
- #813 #814 CLOSED COMPLETED
