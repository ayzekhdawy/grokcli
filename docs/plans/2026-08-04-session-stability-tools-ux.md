# 2026-08-04 — 会话稳定性 + 工具展示（落地清单）

> 分支：`feat/session-stability-and-tools-ux`
> 依据：源码对照分析（grok-build e5478ef + App 调用路径）。

## 已落地

| # | 项 | 改动 |
|---|----|------|
| P0-1 | **单进程多会话池（保守版）** | ① 事件按 `sessionId` 路由（`event_tx` 带 sid，不匹配丢弃——复用进程孤儿会话残流永不串扰）；② parked 进程复用（`reuse_gate` 门：policy/effort/sandbox/route 全匹配时新会话 `session/load|new` 免冷 spawn；失败回退冷 spawn）。设计见 `2026-08-04-per-route-agent-pool-DESIGN.md` |
| P0-2 | **MCP 热更新** | `acp_client.rs` 新增 `update_mcp_servers`（`_x.ai/session/update_mcp_servers`）；`control.rs apply_extensions_mcp_change` 优先热替换（live Ready 会话），失败/忙碌才回退 soft-respawn → 免掉扩展 MCP 变更的全进程重启 |
| P0-3 | **Host 重试 cap 12 → 15** | `acp_client.rs HOST_PROVIDER_MAX_RETRIES` 对齐 CLI `DEFAULT_MAX_RETRIES`（15），不再提前掐断 CLI 本可恢复的 turn |
| P1-4 | **省冗余 set_model RPC** | `connect.rs` 冷 spawn 后删除 set_model（进程 `--model` 已对齐，`session/new` 继承进程默认）；unpark 路径保留 |
| P1-5 | **mcp list 缓存 TTL 30s → 300s** | `extensions.rs MCP_CACHE_TTL`（config mtime 仍参与失效） |
| P1-6 | **声明增量 bash 输出** | `wire_initialize_params` 加 `x.ai/incrementalBashOutput` + `x.ai/bashOutputNoColor` → 长命令有进度反馈 |
| P1-8 | （已存在，确认）长任务跳过软 stall | tool_heartbeat 25s re-arm，open_tool 非空不触发 stall banner |
| P2-9 | **相邻 standalone 工具合并折叠** | `ConversationThread.tsx` 新增 `standaloneToolGroups`：连续未 weave 的 tool_step 行合并为 `TimelineToolGroup`（任意 kind），首行渲染组、其余 0 高占位；`TimelineToolRow.tsx` 用通用 `TimelineToolGroup` 替换死代码 `TimelineContextGroup` |
| P2-10 | **折叠状态互相影响修复** | ① `timelinePhases.ts` phase id `p-{startSi}-{endSi}` → `p-{startSi}`（流式追加不再 remount 重置）② `TimelinePhaseBlock`/`TimelineToolRow`/`TimelineToolGroup` running 时不再强制展开且清 userToggled——用户手动收起保持收起；③ pref 全局事件只改未手动操作的行 |
| i18n | en/zh/zh-TW `chat.ranTools` / `chat.runningTools` | 工具组合并头文案 |

## 设计未实现（独立测试周期）

- ~~**P0-1 单进程多会话池**~~ → 已实现保守版（`2026-08-04-per-route-agent-pool-DESIGN.md`）。
  未做单进程并发多会话宿主（需 AcpClient 多会话状态机 + 并发 golden 测试）。

## 验证

- `npx tsc -b` ✅
- `npx eslint src --max-warnings 0` ✅
- `npx vitest run` 4813/4813 ✅
- `cargo check` ✅
- `cargo test`（见提交记录）
