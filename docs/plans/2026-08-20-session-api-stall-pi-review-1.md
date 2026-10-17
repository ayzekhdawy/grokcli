Warning: No models match pattern "xai-oauth/grok-4.5"
# 审核结论：有 blocker

已对照 `docs/plans/2026-08-20-session-api-stall-fix-plan.md` 审核全部 13 个改动文件。`cargo check --lib` 通过，新增测试 4+14 全绿。但存在 1 个 P0 blocker。

---

## Blocker

### B1. 刀 3 的 15s 超时把刀 1 的 90s abort watcher 一起丢掉了 —— 生产路径下锁恢复机制失效

**位置**：`session_api.rs` `dispatch_turn_or_timeout`（~858–875）⇄ `connect.rs` `connect()`（60–110）/ `on_connect_wall_clock_timeout`（112–143）

**为什么**：
- `dispatch_turn_or_timeout` 用 15s timeout 包 `dispatch_turn`；`dispatch_turn` 内 `await mgr.connect(...)`。
- `connect()` 的 **90s timeout wrapper 和 JoinHandle 都活在 `connect()` 的调用栈里**（即 `dispatch_turn` 的 future 内）。
- 15s 到点 → `dispatch_turn` future 被 drop → JoinHandle 被 drop（**detach，不 abort**，这点计划说对了）→ 但 90s timeout wrapper 也被 drop → **再也没有任何人会 abort 那个 sibling 任务**。
- 于是 `POST /turns` 和 Host drain（两个入口都走 `dispatch_turn_or_timeout`）路径下，刀 1 的 abort 永远不会触发。锁能否恢复完全取决于 connect_inner 自行返回：
  - 握手 wedge：60s budget（刀 2）能兜住 ✓（这也是本次报告场景能修好的原因）；
  - **但 connect_inner 内仍有三个无界 await**：unpark 路径 `acp.set_model_for(...)` / `acp.set_mode_for(...)`（connect.rs 483/486）、cold-spawn 路径 `client.set_mode(...)`（connect.rs 1175）——它们一旦 wedge，锁**永久占用**，复现原始"永久 busy"症状（只是从"挂 180s"变成"每 15s retry_later + connectLockBusy:true 永久"）。
- 计划原文的假设不成立："drop 掉 dispatch_turn 的 future **不会** abort 已 spawn 的 connect 任务……放锁靠刀 1（≤90s 恢复）"——drop 确实不 abort，但把**负责 abort 的 watcher 一并 drop 了**。这正是审核问题 1（"JoinHandle 是否仍被 timeout 吃掉"）的答案：**被 15s dispatch timeout 吃掉了**。

**怎么修**（建议两件都做，任一单独也能止血）：
1. 把 wall-clock 超时**搬进 sibling 任务内部**：任务内 `timeout(90s, connect_inner(...))`，超时后**在任务内**完成 sweep_pending_children + fail_stale_connecting 再返回。这样 drop 外层 JoinHandle 无损，abort 不再依赖调用方 future 存活。
2. 把 483/486/1175 三处 `set_*` await 用 `with_handshake_budget` 包住，完成刀 2"锁临界区内消灭无界 await"的完整意图（当前只包了 initialize+open，set_model/set_mode 漏了）。
3. 补回归测试：真实 wedged connect_inner 持锁 + 经 `dispatch_turn_or_timeout` 触发 → 断言 backstop 放锁 + pending child 被 bounded kill（现有测试只测了裸 tokio abort 语义）。

---

## 非 blocker 建议

1. **drain 的 `prepare_send` Err 分支静默丢项**（`session_api.rs` `drain_ready_external_queues`）：`take_persisted_head` 已取走、`emit_external_queue_take` 已把 GUI 展示移除，然后 `Err(_) => continue` 不 requeue → 落盘项永久丢失，调用方拿过 202 却永不执行。建议失败时 requeue + 次数上限，或回写失败状态并发事件通知。
2. **abort 路径 kill 顺序与注释不符**（connect.rs `on_connect_wall_clock_timeout` → sweep 先于 `fail_stale_connecting`）：post-open set_mode wedge 时 child 已 `handshake_ok`（Ready）但仍登记在 pending → sweep 会杀掉注释声称"必须不杀"的 working agent，slot 留死 acp（下次 send 失败重连可自愈）。低风险但行为与 `fail_stale_connecting` 的 Ready no-op 语义冲突，建议 sweep 前按 slot 状态过滤或先 fail_stale_connecting 再 sweep。
3. **升级日志节奏与计划不符**：`CONNECT_LOCK_BUSY_ESCALATE_TICKS=12` 但 `tick_idle_recycle` 挂在 **30s** idle watchdog（watchdog.rs:17–28）上 → 实际约 6 分钟才 `error!`，不是计划的"12 次 ≈ 1 分钟"。常量注释也是 1 分钟口径。要么把升级计数也接到 5s watchdog，要么改注释。
4. **测试未测生产路径**（审核问题 7）：
   - `dispatch_timeout_returns_retry_later` 内联了 timeout 逻辑，**没调用 `dispatch_turn_or_timeout`**，也测不出 B1；
   - `abort_drops_holder_and_sweep_does_not_hang` 的 sweep 跑在**空 pending 列表**上，注册真实 child 的清扫路径无测试；
   - `drain_ready_external_queues`（含 requeue、prepare_send 失败分支）无测试；
   - 计划要求的 stall_tests 风格 wedged 握手 → 锁释放 + child 清理端到端测试未落地。
   - 优点：CLI 分类测试、persist roundtrip（正确用 `APP_HOME_ENV_LOCK` + `GROK_APP_HOME` 隔离）、health 探针 <1s 测试都是好的。
5. **drain 阻塞 IO**：每 5s 在 tokio worker 上做 parking_lot + `fs::read_to_string/write`（文件小，风险低），可接受；要更稳可 `spawn_blocking`。
6. **刀 4 偏差（可接受）**：用 5s 轮询代替计划"turn end 事件 drain"——功能等价，延迟 ≤5s。drain 在 stream-stall watchdog（5s）里跑，正确。

---

## 验收对照（六刀）

| 刀 | 结论 | 覆盖/缺口 |
|---|---|---|
| 刀1 wall-clock abort | **部分** | `join.abort()` + sweep + `kill_acp_bounded` 已实现、单测过；**但 dispatch 路径下 abort watcher 被 15s drop 吃掉（B1）**；health <1s 只测了探针函数，未测 HTTP 端点/真实 wedged child |
| 刀2 锁内无界 await | **部分** | `rg '\.kill\(\)\.await'` 在 session_manager 内为 0 ✓（control.rs 11 处、process/turn 全部换 bounded）；握手 60s budget ✓；**锁内仍有 3 处无界 `set_*` await（483/486/1175）→ B1** |
| 刀3 15s/503/CLI/health | ✓（自身） | 15s → 503 `retry_later`、不记 idempotency ✓；CLI 分类 + exit code ✓（有测试）；health `connectLockBusy` ✓；**但与刀 1 的交互产生 B1** |
| 刀4 落盘 + Host drain | ✓ | 落盘 + Host 5s 轮询 drain + webview 只展示（`claimQueueHead`/auto-flush 双门禁跳过 external）✓；无窗口仍 202 + 落盘（优于最小修）✓；重启不丢（测试过）✓；双发检查通过（Host 与 GUI 无双发同一 item）✓；prepare_send 失败静默丢项（非 blocker #1） |
| 刀5 僵尸抑制 + holder | ✓ | `sweep_pending_for_session`（connect_inner 开头）+ `ConnectHolderGuard` + 12 tick 升级 error ✓；升级节奏 ~6min ≠ 计划 1min（非 blocker #3） |
| 刀6 文档 | ✓ | `session-api.md` 故障排查（app_not_running 语义表、lockBusy、Windows 代理）+ CHANGELOG Unreleased（中英）✓ |

**结论**：除 B1 外六刀主体均已落地且质量良好；B1 修掉（建议把 abort 内嵌进 sibling 任务 + 补齐锁内三个无界 `set_*` 的 budget）并补上对应回归测试后，方可标记本批完成。
