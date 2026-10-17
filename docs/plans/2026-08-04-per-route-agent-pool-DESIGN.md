# 2026-08-04 — 单进程多会话池（per-route agent process reuse）

> **状态：IMPLEMENTED（并发多会话宿主，已完成）**
> ① 事件按 `sessionId` 路由（防串扰安全网）；② parked 进程**共享**（复用不移交，
> 一个进程承载多个 App 会话，A↔B 切换均为进程内 unpark，双向免冷 spawn）；
> ③ **复用候选扩展到 background（busy）进程**——一个进程可同时承载多个活跃 turn
> （CLI per-session dispatch lock 支持并发）；④ 所有会话级 RPC（prompt/interject/
> cancel/rewind/set_model/set_mode）显式按 sid 定位；⑤ prompt_complete 回退按
> sid 隔离（并发时 A 的早 complete 不会释放 B 的 waiter）。

## 已实现（本期）

### Phase A — 事件按 sessionId 路由（安全网）
- `acp_client.rs`：`event_tx` 改为 `(Option<String>, AcpEvent)`；
  `handle_session_update` 从通知 params 提取 `sessionId` 并随事件下发（CLI 网关
  每个 update 都带）。进程级事件（State/stderr/ProcessExited/Error）不带 sid。
- `session_manager/events.rs handle_acp_event`：事件带 sid 时严格路由到
  live/background/parked 中 `agent_session_id == sid` 的会话；不匹配即**丢弃**
  （复用进程上孤儿会话的残流永远不会写进别的 chat）。
- `official_aux.rs` 事件泵同步解包。

### Phase C — parked 进程共享（进程内多会话保持，双向免冷）
- `ParkedAgent` 增加 `sandbox_profile`（进程级 spawn flag，来自 `AcpClient`）。
- `connect_inner`：冷 spawn 前查找可复用 parked 进程，复用门（纯函数
  `reuse_gate`）要求 **policy / effort / sandbox / route 大类（official|custom）**
  全部匹配；model 是会话级不参与门。
- **复用不移交**：复用后旧会话的 parked 条目**保留**（多个条目共享同一
  `Arc<AcpClient>`），新会话在该进程上 `open_session_at(cwd=新项目)`；切换回旧
  会话走 unpark（agent 会话仍在进程上）→ **A↔B 双向免冷 spawn**。
- 复用过滤 busy 进程（`busy_process_ids`：live busy / background 不用于新会话复用）。
- **会话级 RPC 显式按 sid**：`prompt/interject/cancel/rewind/set_model/set_mode`
  全部新增 `*_for(sid, …)` 版本，调用方传目标会话的 `agent_session_id`（共享进程
  下“最近绑定”可能属于别的会话）。
- **回收按进程组**：idle/容量回收整组 kill（共享进程只 kill 一次，组内全过期才回收）；
  live idle kill 时清理共享 parked 条目。
- 失败安全：open_session 失败 → kill 旧进程 → 回退冷 spawn。

## 边界（未做 / 为什么）

- **App 启动即预热**不做，改为**进入新建会话界面时预热**（用户明确要开新会话，命中率高）：
  `session_prewarm` 只 spawn + initialize + auth（**不建会话**，cwd 用通用工作区占位，
  不绑定项目——提交时 `session/new` 才绑定实际项目 cwd）。提交时 connect 优先
  复用预热进程。10 分钟未消耗自动回收。
- ~~**单进程并发多会话宿主**~~ → 已实现：复用候选含 background（busy）进程，
  一个进程可同时承载多个活跃 turn（CLI per-session dispatch lock + 事件 sid 路由
  + prompt_complete 回退按 sid 隔离）。
- 崩溃风险：共享进程崩溃 = 该进程上所有会话中断（ProcessExited 按 process_id
  清理全部共享条目；会话重连走 session/load 快速重建）。多进程仍保留（不同
  route / policy / effort / sandbox 不共享，天然分池）。

## 池边界（与切模型/切服务商的关系，已确认）

- **切模型**：不受影响。模型会话级（`session/set_model` / meta `modelId`），
  进程内可任意切。
- **custom ↔ custom 切服务商**：同一 config.toml 多 section，同进程支持。
- **official ↔ custom 切**：OIDC（auth.json）与 api_key 不能共存一个进程 →
  复用门按 route 大类隔离；换池 = 冷 spawn 一次（与本期前成本相同）。
- **shared 模式**（home 固定 `~/.grok`）：无法 per-route 隔离，复用门仍按
  route 大类限制（official 进程不供 custom 会话复用）。

## 验证

- `cargo test -- --test-threads=1` 989/989（含新 `reuse_gate` 单测）。
- 事件流类型改造已过 `acp_golden_test`（handshake fixture 同步更新）。
