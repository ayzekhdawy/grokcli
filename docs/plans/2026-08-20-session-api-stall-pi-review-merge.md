Warning: No models match pattern "xai-oauth/grok-4.5"
## 结论：**通过** —— 无 blocker，可 squash-merge。

独立复核了 `/tmp/pr759.diff`（相对 `main` = `ce32fc06`）、PR #759 body、CHANGELOG、以及 `b7551359` 的实际源码。B1 已真正确认落地，无新 blocker。

## 核对表

| # | 核对项 | 结论 |
|---|---|---|
| 1 | **合入范围** | ✓ 仅 session API 卡死修复。14 个文件全部相关（`session_manager/*`、`session_api.rs`、`acp_client.rs`、`useSendQueue.ts`、`sendQueue.ts`、docs、CHANGELOG）。本地 HEAD 的宠物/文案两个未推送 commit **不在**本 PR（`git log` 确认 `b7551359` 是 PR 唯一 commit，diff 相对 `main` 只含它）。前端 3 个文件里有 prettier 重排，属已触文件的格式噪声，非夹带功能。 |
| 2 | **B1 生产路径** | ✓ wall-clock 已移入 sibling 内部：`connect()` 外层只剩 `join.await`（`connect.rs:112`），sibling 内 `timeout(90s, {lock + connect_inner})` 超时后**在任务内**调 `reap_timed_out_connect`（epoch bump + `fail_stale_connecting` + `sweep_pending_children`，`connect.rs:79-152`）。15s 掉 JoinHandle 只 detach 不 abort，sibling 仍自行 reap/放锁；回归测试 `inner_wall_clock_releases_lock_after_caller_drops` 覆盖该语义。 |
| 3 | **connect_lock 临界区无界 await** | ✓ `session_manager` 内 `\.kill\(\)\.await` 为 **0**（仅 `kill_acp_bounded` 内层一处，已 5s 有界）。握手 RPC（spawn / `open_session_at` / `initialize_and_open_session`）全部 `with_handshake_budget`（60s）；`set_model` / `set_mode` / `set_model_for` / `set_mode_for` 全部 `with_soft_rpc_budget`（60s）。事件泵与 `prewarm_force` 均为 `tokio::spawn`，不在锁内。`flush_pending_soft_respawn` 用 bounded kill。 |
| 4 | **CHANGELOG Unreleased** | ✓ 只**追加 2 行**（1 条 EN Fixed + 1 条中文修复，各插在对应 Fixed 列表顶部），未覆盖/删除 `main` 上既有 Unreleased 条目（已逐条比对 `main:CHANGELOG.md`）。 |
| 5 | **PR body Fixes/Closes** | ✓ 无 `Fixes`/`Closes`，且**无对应 open Issue 漏关**——本项源于外部 Codex 报告，非 GitHub issue；`gh issue list` 仅 #754（UI 线程锁，另一根因）/#757（feature），均无关。 |
| 6 | **secrets / 破坏 API / 双发 / 杀 Ready** | ✓ 无 secrets（队列文件 unix `0o600`；`random_token` 未动）。API 为**增量**（`RetryLater` 枚举、health 加 `connectLockBusy`），CLI exit code 变更属修正。无双发：GUI `claimQueueHead` 对 `source: external` 返回 null，Host drain 是唯一发送方（`drain_lock` try_lock 串行 + `take_persisted_head` 先取走）。不杀 Ready：`handshake_ok` 后、`set_mode` 前先 `unregister_pending_child`，且 `should_fail_connect_on_wall_clock` 仅匹配 `Connecting`（`types.rs:1802`），`fail_stale_connecting` 对 Ready/Streaming 是 no-op。 |

## 残留（非 blocker，仅记录）

- **极窄代际竞态**：`reap_timed_out_connect` 的 `sweep_pending_children` 无条件取走**全部** pending children。理论上旧代 reap 若与新 connect 的冷启动 spawn 撞在同一毫秒级窗口，可能扫掉新代的刚登记 child。实践中不可达（新 spawn 需 ~1s+，旧 reap 的 sweep 在放锁后立即完成），且命中也只是新代 connect 回退重连，非永久 wedge。`next_connect_epoch_on_timeout` 已保证旧代不 bump epoch。
- 测试 `dispatch_timeout_returns_retry_later` 仍内联 timeout 逻辑、未真正调用 `dispatch_turn_or_timeout`（review-2 已记录，纯测试质量问题；语义由 `inner_wall_clock_releases_lock_after_caller_drops` 覆盖）。

**结论：可 squash-merge。** 合并后确认未覆盖 Unreleased、感谢作者、branch hygiene。
