# 2026-08-19 Host 退出后的回合治愈 + Windows 崩溃落盘

> 来源：会话 `7a57a3d1` 诊断（master 快进成功后卡在权限确认，宿主冷启动，界面显示成做完了）。  
> 范围选择：**方案 B**（回合租约 + 打开治愈 + 一键继续）**+ Windows 崩溃 / 非干净退出日志**。  
> 不做：agent 与宿主进程解耦（方案 C）。

## 问题

两件独立的事叠在一起：

1. **宿主进程死亡**（Windows 上这台机器多次「无 shutdown、短间隔冷启动」）。stdio agent 一起没了。ACP 不能从权限/工具边界精确续跑（`docs/SPIKE-ACP.md` in-flight continuity gap）。
2. **假完成**：agent 自己退出且宿主还活着时，已有 `turn_cancelled|agent_exit`。宿主整进程死掉时没人写标记；下次 `session/load` + `try_reconcile_linked_session` 把 `chat_history` 里半截助手文本拼回来，快照是 `Ready` + `lastError=null`。

本设计 **杜绝第 2 件**，并给第 1 件留下可诊断痕迹。不承诺「任务在宿主死后继续跑」。

## 目标

| 必须 | 不做 |
|------|------|
| 宿主冷启动后打开该会话，最后一条用户消息之后有 `turn_cancelled\|host_exit` 芯片，不能看起来像正常收工 | 不把 grok agent 拆成独立守护进程 |
| 芯片提供「继续」：新 `session/prompt`，带上未完成工具/命令；journal 显示短句，agent 看到断点上下文 | 不恢复那一次 `session/request_permission` RPC |
| 脏租约或 agent 轨迹验尸任一命中即可治愈；已有 end-of-turn 标记则跳过 | 不加设置开关（诊断默认开，对齐现有 `panic.log`） |
| 非干净退出写入日志；Windows 原生异常写 `last_crash.txt`；诊断 zip 带上这些文件 | 不自动上传、不做完整 minidump（体积/隐私） |
| 新 UI 不进 `App.tsx` | 不改权限策略（`auto` + 非 yolo 仍要点允许） |

## 架构

三块落盘状态 + 一条已有的 journal 芯片路径。

```
session/prompt 发出
  → 写 sessions/<id>/turn_lease.json  (status=active)
权限 / 工具开始
  → 更新 lease.pendingTool / permissionPending
权威 PromptComplete / 用户停止 / agent_exit 芯片
  → 删除 lease

宿主启动
  → 读 logs/host_runtime.json：shutdown!=true → 记 unclean restart
  → 扫有 dirty lease 的会话（或打开会话时）
      无 end-of-turn 标记 → journal_turn_cancelled(host_exit)
      lease.status = interrupted（保留 pendingTool 供继续）

用户点「继续」
  → sessionSend(agentText=断点说明, journalDisplay=短句)
  → 新回合覆盖为 active lease
```

宿主进程心跳与回合租约分开：前者解释「进程怎么没了」，后者解释「哪个聊天被切了」。

## 1. 回合租约

路径：`{app_data}/sessions/<appSessionId>/turn_lease.json`

```json
{
  "schema": 1,
  "status": "active",
  "sessionId": "7a57a3d1-…",
  "agentSessionId": "01a0181e-…",
  "turnId": "…",
  "startedAt": "2026-08-19T03:44:28Z",
  "updatedAt": "2026-08-19T03:45:47Z",
  "phase": "permission_prompt",
  "permissionPending": true,
  "pendingTool": {
    "toolCallId": "call-9e5f0e0d-…-5",
    "toolName": "run_terminal_command",
    "title": "List commits to merge into hzh/dev",
    "command": "git rev-parse master origin/master HEAD && …"
  }
}
```

`status`：`active`（回合进行中）| `interrupted`（已治愈、等继续）。文件不存在 = 空闲。

写入点（都走同一 helper，失败只 `warn`，不挡发送）：

| 事件 | 动作 |
|------|------|
| `prompt_in_flight = true`（`turn.rs` 发出 prompt 前） | 创建 `active` |
| `PermissionRequest` | `phase=permission_prompt`，填 `pendingTool`（命令从 tool rawInput / 标题取，截断到 2k） |
| `tool_started` / open tool | 更新 `pendingTool`；权限落地则 `permissionPending=false` |
| 权威 `PromptComplete`、用户停止、已有 `journal_turn_cancelled` | **删除**文件 |
| 打开治愈命中 | 改为 `interrupted`，冻结 `pendingTool` |
| 用户发了一条全新 prompt（不是「继续」） | 删除旧 interrupted，写新 active |

命令文本可能含路径；诊断 zip 已有 redact。租约不进 git、不进 settings。

## 2. 打开 / 启动治愈

入口两处，幂等，都调用 `heal_interrupted_turn(app_session_id) -> bool`：

1. **冷启动**：扫 `sessions/*/turn_lease.json` 中 `status=active`（进程刚起来，这些回合不可能还活着）。
2. **`session_connect` / `try_reconcile_linked_session` 之后**：再跑一次，补上「租约没写成、但 agent 轨迹显示半截」的会话。

`has_turn_end_marker_after_last_user` 已存在 → 已有芯片则 return。

命中条件（任一）：

- 租约 `status=active`
- 或 agent `events`：`permission_requested` 数 > `permission_resolved`，且无 `turn_completed`
- 或 `chat_history` 最后一条 assistant 带 `tool_calls`，对应 id 没有 `tool_result`

然后：`journal_turn_cancelled(…, "host_exit")`（无 LiveSession 时走与 `journal_hard_end_for_busy_agents` 相同的 append + emit）。租约改为 `interrupted`。

`host_exit` 加入 `normalize_hard_end_reason`。前端 `endOfTurn.ts` 映射到新 key，tone=warning。

和解：继续允许把半截助手文本拼进 journal（用户能看见「接下来合并」），但 **必须** 在其后有中断芯片。不要把未完成 `tool_calls` 标成 completed tool_step。

## 3. 一键继续

芯片「继续」仅在 reason 为 `host_exit` 或 `agent_exit`、且该会话空闲时显示。

实现落在 `EndOfTurnChip` + `ConversationThread` 回调，**不**往 `App.tsx` 加 state。`AppWorkbench` 已有 `executeSend({ agentText, journalDisplay })`。

- Journal 显示：`endOfTurn.continuePrompt`（例如「继续上次中断的任务」）
- Agent 正文由纯函数生成（`src/lib/continueInterruptedTurn.ts` + Host 同源逻辑，或 Host 拼好经现有 send）：说明宿主/agent 中断、已完成步骤勿重做、贴上 `pendingTool.command`（若有）、要求从断点继续用户原目标。
- 点继续后若租约已是 interrupted，Host 读完即按新回合写成 active。
- 禁止 `window.confirm`。忙碌时按钮 disabled。

不自动发送。

## 4. Windows 崩溃 / 非干净退出日志

已有 Rust panic → `logs/panic.log`。本次事故没有 panic 行，进程直接没了，所以还要：

**`logs/host_runtime.json`**

```json
{
  "schema": 1,
  "pid": 1234,
  "startedAt": "…",
  "heartbeatAt": "…",
  "shutdown": false,
  "appVersion": "0.2.22",
  "os": "windows"
}
```

- `logging::init()` 之后创建，`shutdown=false`
- 现有 watchdog / 自动化 tick 顺带刷新 `heartbeatAt`（15–30s，不必新线程）
- `RunEvent::Exit`（已有 mirror `stop_sync`）写 `shutdown=true`
- 下次启动若文件存在且 `shutdown!=true`：追加 `logs/unclean-restart.log` 一行（旧 pid、uptime、心跳距今、当时 dirty lease 的 session id 列表），然后 `info!` 打到当天 `app.log`

**Windows 原生异常**（`src-tauri/src/win_shell.rs` 或新 `win_crash.rs`）：`SetUnhandledExceptionFilter` 同步写 `logs/last_crash.txt`（时间、异常码、地址、pid）。不做 MiniDump。macOS/Linux 只靠 panic hook + host_runtime。

**WebView**：若 Tauri 本版 `RunEvent` 能区分 webview 崩溃，同样追加一行到 `last_crash.txt`。没有对应事件就跳过，不为这个去升 Tauri。

**诊断 zip**（`support_bundle.rs`）：加入 `turn_lease.json`、`host_runtime.json`、`unclean-restart.log`、`last_crash.txt`、`panic.log`（已有 logs 目录的话确认这几份在包内）。

不加 Settings 项，不改 `settingsCatalog`。

## 数据流

```
冷启动
  logging::init
  host_runtime: 检测上一份 → 记 unclean → 写新 pid
  heal 所有 active lease
  …
打开会话 7a57a3d1
  session/load + reconcile（半截「master 已快进」可以出现）
  heal_interrupted_turn → turn_cancelled|host_exit
  UI：EndOfTurnChip + 继续
点继续
  executeSend(journal=短句, agent=断点说明+未跑命令)
  新 prompt / 新 active lease
```

## 错误处理

- 租约 IO 失败：warn，回合照常。治愈仍可靠 agent 轨迹。
- 无 agent 目录、只有 dirty lease：仍写 `host_exit`。
- 双芯片：`has_turn_end_marker_after_last_user` 挡住。
- 治愈时 WebView 还没挂事件：journal 已落盘，打开会话会 hydrate。
- 「继续」时租约丢失：仍发送通用续跑句（「上次回合被宿主中断，请根据对话历史从断点继续，不要重做已成功的 git」）。

## 测试

纯函数优先（租约解析、验尸、reason 映射、续跑 prompt、unclean 检测）。

| 用例 | 期望 |
|------|------|
| 事故包形状：最后 assistant 有 tool_calls、permission 6/5、无 turn_completed、无 end marker | 写 `host_exit`，lease → interrupted |
| 已有 `agent_exit` 芯片 | 不写第二块 |
| 正常 PromptComplete | 无 lease 文件 |
| host_runtime `shutdown=false` 再启动 | unclean-restart 多一行 |
| `shutdown=true` 再启动 | 不记 unclean |
| `mapEndOfTurnReason("host_exit")` | warning + 新 i18n key |
| 续跑 prompt 含 pending command，journal 短句不含整段 shell |

Rust：`heal_interrupted_turn` 用临时 session dir + 伪造 events/chat_history。前端：`endOfTurn.ts` + chip 有继续按钮。不把整份用户 zip 当 CI fixture。

## i18n

`en` 权威；同 PR 填 `zh` / `zh-TW`。俄语走 English fallback，可在 `ru/session.ts` 或 `ru/extra.ts` 加覆盖。

建议 key：

- `endOfTurn.hostExit` — 应用重启，这一轮没做完
- `endOfTurn.continue` — 继续
- `endOfTurn.continuePrompt` — 继续上次中断的任务

禁止硬编码中英文。

## 文档

- `docs/llm-wiki/session-continuity.md`：Host 死后打开会话必须治愈；in-flight 仍不在工具边界恢复。
- `CHANGELOG.md` 随实现 PR。
- 本文件是设计源。

## 风险

- 误伤：空闲会话被标中断。缓解：必须 dirty lease 或明确半截轨迹；已有芯片跳过。
- 租约里的命令可能敏感：只进本机 app_data 与已 redact 的诊断包。
- 写租约太勤：只在回合边界和权限/工具变化时写，不要每个 token。
- Windows 异常过滤器里只做同步写文件，禁止分配失败路径上的复杂逻辑。
