## 结论：**通过**

pi `-p`（tools: read, bash）核对 `fix/windows-end-of-turn-freeze-754` / `7f2f7386`。无 blocker。

| # | 检查项 | 核对结果 |
|---|--------|----------|
| 1 | 根因成立 | 迟到 `prompt_complete` 在 RPC Ok 后再武装 deferred finish；第二次结束持 `inner` 发 IPC，与 post-turn reconcile 的 store 锁重叠，Windows WndProc 在 SendMessage 里等锁 |
| 2 | should_rearm 不误伤 | `prompt_in_flight` 或 Streaming / AwaitingPermission 仍放行 |
| 3 | 重复 try_finish 变 no-op | Ready + 无 active_turn_id 清 flag 返回 None；测试覆盖 |
| 4 | JOURNAL_REHYDRATE_RECONCILE 范围 | 只改回合结束 `scheduleJournalRehydrate`；侧栏切换 deferred reconcile 未动 |
| 5 | CHANGELOG 只追加 | Unreleased Fixed 顶部中英各一条 |
| 6 | 安全扫描 | 无 secrets / confirm / App.tsx state / i18n 硬编码 |

非阻塞：`acp_client.rs` 里「Duplicate authoritative completes are safe」注释已过时。
