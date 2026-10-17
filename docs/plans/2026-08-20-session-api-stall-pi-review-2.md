Warning: No models match pattern "xai-oauth/grok-4.5"
## 结论：**通过** —— B1 已清，无 blocker

逐条核对 B1 修复项，全部落地：

| B1 要求 | 位置 | 状态 |
|---|---|---|
| wall-clock 移进 sibling 内部，drop JoinHandle 只 detach | `connect.rs:79-110`（sibling 内 `timeout(90s, lock+connect_inner)`），外层仅 `join.await`（`connect.rs:112`） | ✓ |
| sibling 超时后任务内自愈（epoch bump + fail + sweep） | `connect.rs:129-152` `reap_timed_out_connect`：`fail_stale_connecting` → `sweep_pending_children`，运行于 sibling 任务内 | ✓ |
| 回归测试 `inner_wall_clock_releases_lock_after_caller_drops` | `connect.rs` 测试模块（drop(join) 后断言 inner timeout 自行放锁） | ✓ 测试通过 |
| set_model/set_mode 有界化 | unpark 路径 `connect.rs:502-516`（`set_model_for`/`set_mode_for` 包 `with_soft_rpc_budget`）；post-open `connect.rs:1203-1208` | ✓ |
| handshake_ok 后先 unregister 再 set_mode | `connect.rs:1195-1203` | ✓ |
| reap 先 fail_stale_connecting 再 sweep | `connect.rs:147-150`；且 `should_fail_connect_on_wall_clock` 仅匹配 `Connecting`（`types.rs:1799`），Ready no-op —— 顺带清掉上轮非 blocker #2 | ✓ |
| drain prepare_send Err 改 requeue | `session_api.rs` `drain_ready_external_queues`：Err 分支 `requeue_persisted_front`，dispatch 非 started/queued 也 requeue | ✓ |

**锁临界区无界 await 复核**：`session_manager` 内 `\.kill\(\)\.await` 为 0，全部换 `kill_acp_bounded`（`process.rs:984-992`，ACP_KILL_TIMEOUT_SECS 有界）。握手 60s budget（`CONNECT_HANDSHAKE_BUDGET_SECS=60 < 90` wall-clock）兜底，set_* 60s soft-fail 兜底，锁恢复最坏 ≤90s 且不依赖 HTTP 调用方存活。

**测试**：`connect_timeout_tests` 5/5、`session_api` 14/14 全绿（cargo test 实跑）。

**残留（非 blocker）**：`session_api.rs` 测试 `dispatch_timeout_returns_retry_later` 仍内联 timeout 逻辑、未真正调用 `dispatch_turn_or_timeout`（上轮非 blocker #4 未修，纯测试质量问题；B1 语义已由 `inner_wall_clock_releases_lock_after_caller_drops` 覆盖）。
