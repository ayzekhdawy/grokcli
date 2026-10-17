# PR #770 审核结论：通过，已 squash-merge

pi `-p`（tools: read, bash）核对 `/tmp/pr770.diff`。无 blocker。合入 `b3b14766`。Fixes #768。

## 核对表

| # | 核对项 | 结果 |
|---|--------|------|
| 1 | 根因（Tauri `unstable` 子窗 `WRY_WEBVIEW`，wry 不 `MoveFocus`） | ✅ |
| 2 | WndProc 子类化 + `SetFocus` 重入/死锁 | ✅ `FORWARDING_KEYBOARD_FOCUS` + 纯 Win32，避开 #735/#754/#748 |
| 3 | 多 webview 误交侧栏 | ✅ 非 blocker（Z 序首个可见 `WRY_WEBVIEW`） |
| 4 | CHANGELOG Unreleased | ✅ 未写入 0.2.24 |
| 5 | secrets / confirm / 夹带 | ✅ |
| 6 | 纯函数测试 | ✅ class 名 + `WM_SETFOCUS`/`WM_ACTIVATE` |
| 7 | CI | ✅ rebase 后 frontend + Rust 三平台绿 |

## 非 blocker

Alt+Tab 时若侧栏浏览器是最上层可见 `WRY_WEBVIEW`，焦点可能落到该面板。语义可接受。

作者 Windows 主机无 `pi`，合前 pi 由维护者补。维护者 rebase 解决与官网 homepage 的 CHANGELOG 冲突。
