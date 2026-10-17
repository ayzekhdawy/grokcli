# PR #782 审核结论：通过，已 squash-merge

pi `-p`（tools: read, bash）核对 `/tmp/pr782.diff`。无 blocker。Fixes #776。

维护者 rebase 解决与 #779 Unreleased 的 CHANGELOG 冲突。Python tray badge 测试 6/6。rebase 后 CI 四门绿。

## 核对表

| # | 核对项 | 结果 |
|---|--------|------|
| 1 | 不重演 #748 跨线程 `set_icon` 死锁 | ✅ 只改资产/注释/测试，主线程 `set_icon` 路径未动 |
| 2 | 不退回 #747 黑标透明底 | ✅ 白标 + 测试禁止黑标 |
| 3 | 跟任务栏 `SystemUsesLightTheme` | ✅ 不跟应用内 Theme |
| 4 | 测试：无白方块、有白标、无黑标 | ✅ Python + Rust |
| 5 | CHANGELOG Unreleased 只追加 | ✅ rebase 后保留 #778/#771 |
| 6 | secrets / confirm / App.tsx | ✅ |
