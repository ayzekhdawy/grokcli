# PR #790 审核结论：通过（复审后），已 squash-merge

pi `-p` 两轮。首轮 blocker：`findCounter` 放进 `useMemo`，流式+查找 occurrence 漂移。维护者 rebase 到含 #789 的 main，改 `findCounterRef` 每渲染重置，补 vitest rerender。复审无 blocker。合入 `33998a32`。Fixes #795。

CI 四门绿。MarkdownChat 5 测通过。

## 核对表

| # | 核对项 | 结果 |
|---|--------|------|
| 1 | 模块级 remarkPlugins / 叶子；path/code/img memo | ✅ |
| 2 | find 仍 wrap；counter 每 paint 重置 | ✅ 首轮 blocker 已清 |
| 3 | 无 App.tsx useState / confirm / secrets | ✅ |
| 4 | CHANGELOG Unreleased Changed 追加；Streamdown/Vendor/#786 仍在 | ✅ |
| 5 | 占位「pi 不可用」文档未落入 squash | ✅ |
