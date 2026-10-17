## 结论：**通过（无 blocker）**

审查对象：关闭终端真杀 PTY/shell（禁止假关闭泄露）。`pi -p`，工具仅 `read`/`bash`。首轮 blocker：`terminalPtySession.test.ts` `vi.fn` 零参导致 `tsc` TS2493。已改为 `(_sessionId: string)` 后复审通过。

`npx vitest run src/lib/bottomTerminal.test.ts src/lib/terminalPtySession.test.ts src/lib/bottomTerminalChrome.guard.test.ts`：26/26。  
`npx tsc --noEmit`：干净。  
`cargo test --lib pty_host`：5/5。

### 核对表

| # | 检查项 | 结果 | 证据 |
|---|--------|------|------|
| 1 | 关标签 / 关闭全部 / cap / 切项目显式 kill | ✅ | `useBottomTerminal` + registry |
| 2 | TerminalTab register + cleanup kill | ✅ | spawn 后 register；cleanup 双保险 |
| 3 | host 真杀进程 | ✅ | `clone_killer` + unix SIGKILL pid/pgid |
| 4 | 收起面板不杀 | ✅ | `closeBottomTerminal` 只 `open:false` |
| 5 | 幂等 | ✅ | take 后 no-op；未知 id Ok |
| 6 | CHANGELOG 中英 | ✅ | Fixed 成对 |
| 7 | App.tsx state | ✅ | 未加 |

无 blocker，该项可标完成。
