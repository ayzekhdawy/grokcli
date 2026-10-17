## 结论：**通过（无 blocker）**

审查对象：未提交的底部终端 hover 关闭 + 关闭所有终端。`pi -p`，工具仅 `read`/`bash`。

`npx vitest run src/lib/bottomTerminal.test.ts src/lib/bottomTerminalChrome.guard.test.ts src/i18n/messages.test.ts`：61/61 通过。

### 核对表

| # | 检查项 | 结果 | 证据 |
|---|--------|------|------|
| 1 | 每个标签都渲染 × | ✅ | 去掉 `active ?`；CSS 默认 opacity 0，hover 显示 |
| 2 | 关闭全部按钮 | ✅ | 加号与收起之间；`terminal.closeAll`；`IconClearAll` |
| 3 | model | ✅ | 清 tabs / activeId / open；空状态同一对象 |
| 4 | PTY unmount kill | ✅ | `TerminalTab` cleanup `terminalPtyKill` |
| 5 | CSS 限定 `.bt` | ✅ | `is-active:hover` 压过常显 0.55 |
| 6 | i18n 15 语言 | ✅ | `terminal.closeAll`；catalog 锁步 |
| 7 | App.tsx / confirm / 密钥 | ✅ | 仅 hook + 一行 prop；无 confirm |
| 8 | CHANGELOG Changed 中英 | ✅ | 成对 |

无 blocker，该项可标完成。
