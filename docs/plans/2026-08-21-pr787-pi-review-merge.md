# PR #787 审核结论：通过，已 squash-merge

pi `-p`（tools: read, bash；openrouter/stealth/ox-alpha）核对 `/tmp/grok-pr-diffs/pr787.diff`。无 blocker。合入 `7c3fd508`。Fixes #786。

CI 四门绿。`window_min` + `windowChrome` 测通过。`data-tauri-drag-region="false"` 跳过 Tauri drag.js `start_dragging`；`set_min_size` 在 maximized / pointer-down / min 未变时跳过。

## 核对表

| # | 核对项 | 结果 |
|---|--------|------|
| 1 | 根因：JS start_dragging + tao `set_min_size` 每次 Moved 都 `set_inner_size`，DWM offset 双计 | ✅ |
| 2 | Windows `data-tauri-drag-region="false"`，CSS compositor caption 仍 drag | ✅ |
| 3 | 不重演 #735；不回退 #784 caption defer / 去掉 body transform | ✅ LAST_MIN 锁内只写缓存，几何 API 在 drop 后 |
| 4 | 无 App.tsx useState / confirm / secrets | ✅ |
| 5 | CHANGELOG Unreleased 只追加 #786，#783 正文未改 | ✅ |
| 6 | `should_commit_min` + `tauriDragRegion` 测试 | ✅ |

## 非 blocker

Windows 关掉 JS dblclick maximize，改靠 compositor caption。macOS 无法验证。mac/linux 从裸属性改为 `"deep"` 后子树可拖。
