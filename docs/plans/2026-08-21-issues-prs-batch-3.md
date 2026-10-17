# 2026-08-21 Issues/PRs 清空批次（第三波，跳过合入后复审）

维护者要求去掉合入后 pi 复审，加速 squash-merge。作者均为 @zhangxaochen（#785 除外）。

## 合入

| PR | Issue | 合入 | 主题 |
|----|-------|------|------|
| #787 | #786 | `7c3fd508` | Windows 标题栏往上拖不再拉高 |
| #788 | #793 | `4bdd8b96` | markdown / TipTap / xterm vendor chunks |
| #789 | #794 | `909163cd` | 启动不再加载 Streamdown CSS |
| #790 | #795 | `33998a32` | 流式 Markdown 稳定 components；维护者修 findCounter |
| #791 | #796 | `4e663820` | stream-perf 暂停壁纸视频、关掉 blur |
| #792 | #797 | `1b13a0f9` | journal 紧凑 JSON；维护者 rustfmt |
| #805 | #804 | `48b9ee64` | 宠物隐藏时降低光标轮询 |
| #806 | #803 | `af48ed3c` | PTY `terminal://data` 16ms/4KiB 合并 |
| #807 | #802 | `06002646` | 完成态 tool journal 离 ACP 泵 |
| #809 | #800 | `134420a3` | weave 保持历史行 identity |
| #808 | #801 | `0dea8628` | 进行中 tool 标题仍虚拟化 |
| #810 | #799 | `9f195ffc` | lazy BottomTerminal / TipTap / lightbox；维护者补 IconTerminal |
| #811 | #798 | `eaeb11b6` | 非英文 i18n 按需加载；维护者收窄 loaders 类型 |

## 未关

- **#785** clippy 清零，无 PR。
- **#812** 新开：自定义请求头（本批处理期间到达）。

## 维护者代修

- #790 find occurrence counter 每 paint 重置
- #792 rustfmt
- #810 `IconTerminal` import
- #811 `locale === "en"` 收窄后再索引 `loaders`
