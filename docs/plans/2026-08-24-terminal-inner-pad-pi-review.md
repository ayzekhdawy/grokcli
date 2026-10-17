## 结论：**通过（无 blocker）**

审查对象：未提交的 PTY 终端 5px 内边距。`pi -p`，工具仅 `read`/`bash`。

`npx vitest run src/lib/terminalInnerPad.guard.test.ts`：4/4 通过。

### 核对表

| # | 检查项 | 结果 | 证据 |
|---|--------|------|------|
| 1 | veil 未缩 | ✅ | `.sw-terminal--pty` 保持 `padding: 0` + `background: var(--sw-term-veil)`；canvas 仍全透明 |
| 2 | padding 在 `.xterm` | ✅ | 外壳 / persist chrome 仍 0；`padding: var(--sw-term-pad, 5px)` 只在 `.xterm` |
| 3 | 数值 5px | ✅ | `--sw-term-pad: 5px`，fallback 同为 5px |
| 4 | border-box + FitAddon | ✅ | `box-sizing: border-box`；FitAddon 从 `.xterm` computed padding 扣 cols/rows |
| 5 | helpers 偏移 | ✅ | `.xterm-helpers` top/left 同 pad，IME/textarea 对齐第一格 |
| 6 | 底部 + 侧栏共用 | ✅ | `BottomTerminal` 与 `SideTabBody` 都用 `TerminalTab` |
| 7 | App.tsx / 文案 / 密钥 | ✅ | 仅 CSS + CHANGELOG + 守卫测试 |
| 8 | CHANGELOG Unreleased 中英成对 | ✅ | Fixed 与「中文 · 修复」各一条 |
| 9 | 测试 | ✅ | 4 passed |

### 非 blocker 备注

1. host `padding: 0` 守卫较宽松，`padding: 0 4px` 仍会过。
2. `.xterm-viewport` 仍铺满 host，滚动条贴右缘，与 leftover-px 遮罩一致。

无 blocker，该项可标完成。
