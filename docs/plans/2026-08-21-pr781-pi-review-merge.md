# PR #781 审核结论：通过，已 squash-merge

pi `-p`（tools: read, bash）核对 `/tmp/pr781.diff`。无 blocker。Fixes #777。

维护者 rebase 解决 Unreleased CHANGELOG 冲突。相关 vitest 83 通过。rebase 后 CI 四门绿。GlassModal，无 `window.confirm`。

## 核对表

| # | 核对项 | 结果 |
|---|--------|------|
| 1 | GlassModal，无 window.confirm | ✅ |
| 2 | About 检查更新停在 ready | ✅ `planUserCheckUpdate` 不 arm 自动安装 |
| 3 | 侧栏 / Install and restart 确认后才装 | ✅ Cancel 不安装 |
| 4 | 未签名 GitHub 路径不变 | ✅ |
| 5 | i18n 15 locale + `{version}` | ✅ |
| 6 | 无 App.tsx useState | ✅ |
| 7 | CHANGELOG Unreleased 只追加 | ✅ rebase 保留既有条目 |

## 非 blocker

`applyAvailableUpdate` 在 idle 路径仍可能 arm installWhenReady；侧栏在那些状态不可见。`busy` prop 未被调用方使用。
