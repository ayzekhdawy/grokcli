# 联合 review：2026-08-21 Issues/PRs 清空批次（第二波）

pi `-p`（tools: read, bash）通审已合 PR、已关 Issue、CHANGELOG Unreleased、致谢、branch hygiene。无 blocker。

## 结论

当时全部 open Issues / PRs 已关闭。五个社区 PR squash 进 `main`（#779 含 #772），linked issues `COMPLETED`。

## 合入

| PR | Issue | 合入 | 主题 |
|----|-------|------|------|
| #779 | #778 #771 | `0d106452` | 触控板慢慢上滚能离开贴底；含 #772 图片/PDF 解码 bounce |
| #772 | #771 | CLOSED via #779 | 媒体 bounce（提交已在 #779） |
| #782 | #776 | `94f0f904` | 深色任务栏托盘白标透明底 |
| #781 | #777 | `c5d25623` | 应用内更新须 GlassModal 确认后再安装重启 |
| #780 | #775 | `3dff5076` | 可选 Windows 任务栏未读 overlay，默认关 |
| #774 | #773 | `364d91f7` | Windows 最大化走 OS maximize，不再假铺满 |

作者：@erict16（#779/#772）、@ynjmxn（#782/#781/#780）、@zhangxaochen（#774）。#774 维护者 rustfmt import 行；#779 CHANGELOG 维护者代写；#780 icons 列表层级维护者代修。

## 核对表

| # | 项 | 结果 |
|---|----|------|
| 1 | open Issues / PRs 为空 | ✅ |
| 2 | #771 #773 #775 #776 #777 #778 CLOSED COMPLETED | ✅ |
| 3 | CHANGELOG Unreleased 含本批六条，未覆盖 0.2.24 | ✅ |
| 4 | 每 PR 有 `Merged, thanks @author` | ✅ |
| 5 | 本地 `pr-*` 已删；origin 仅 main + 既有 WIP 分支 | ✅ |
| 6 | 无 secrets / confirm / App.tsx 新增 useState | ✅ |

## 非 blocker

#782 thanks 评论发了两次。`origin/feat/plugin-ui-host` 与 `origin/docs/x-creator-plugin-workbench` 是既有未合入分支，与本批无关。
