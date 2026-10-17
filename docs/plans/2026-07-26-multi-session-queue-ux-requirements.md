# Grok App 多会话 / 资源编辑 / 发送队列 — 功能整改需求

> **文档性质**：产品 + 工程验收需求整理（从用户本轮要求与现场复现归纳）  
> **日期**：2026-07-26  
> **分支上下文**：`feat/chat-session-ux`  
> **关联**：`docs/llm-wiki/session-continuity.md` · `CHANGELOG.md` [Unreleased]

---

## 1. 总目标

在 **不打断已在跑的 Agent 回合** 的前提下，做到：

1. **多会话并行**：切会话 / 新建会话 / 在另一会话发送，均不得垄断或误杀进程。  
2. **发送队列诚实**：队列按「当前查看会话」隔离；绝不出现跨会话串台或空新会话上的假队列。  
3. **资源面板可编辑**：Markdown 与其它文件编辑体验可用（高度、工具栏、WYSIWYG）。  
4. **UI 杂项正确**：顶栏角标定位等小问题一并修掉。

一句话：**后台继续跑，前台可开新任务；队列只属于本会话。**

---

## 2. 需求清单（按用户意图）

### R1 — 资源面板文件编辑器高度与工具栏

| 项 | 说明 |
|----|------|
| **问题** | 文件编辑区高度塌缩（约两行），难以编辑长文。 |
| **要求** | 编辑区在资源面板内 **占满可用高度**；可正常滚动编辑。 |
| **工具栏** | 编辑 / 保存 / 还原从窗口顶栏 chrome **下移到文件内页顶部**（编辑器上方工具条），与内容同区操作。 |
| **验收** | 打开任意文本文件 → 进入编辑 → 正文区接近全高；工具条在正文上方；保存/还原可用。 |

### R2 — Markdown 使用 TipTap 编辑

| 项 | 说明 |
|----|------|
| **问题** | Markdown 仅用纯 `textarea`，体验差。 |
| **要求** | Markdown 文件用 **TipTap** 所见即所得编辑；支持通过 `tiptap-markdown` **序列化回写**源文件。 |
| **格式工具栏** | 至少：粗体 / 斜体 / 标题 / 列表 / 链接（与现有实现一致即可扩展）。 |
| **验收** | 打开 `.md` → WYSIWYG 编辑 → 保存后磁盘内容为合理 Markdown；非 md 文件不强制 TipTap。 |

### R3 — 顶栏数量角标定位

| 项 | 说明 |
|----|------|
| **问题** | 任务 / 变更 / 规则等 chrome 数量角标漂到窗口右上角。 |
| **要求** | 角标相对对应 **chrome 按钮** 定位，不漂出按钮区域。 |
| **实现约束** | `.chrome-btn`（或等价）须为定位上下文（如 `position: relative`）。 |
| **验收** | 有角标时贴在对应按钮右上，窗口缩放/多按钮时不串位。 |

### R4 — 多会话 Agent 非独占（核心）

| 项 | 说明 |
|----|------|
| **问题** | 切换会话 / 聚焦另一会话时，原回合被停掉或进程被抢占，表现为「一会话独占 Host」。 |
| **要求** | |
| R4.1 | 每个 App session **拥有自己的 ACP 进程**；焦点切换 **不得** 把另一会话的子进程 `session/new` 抢走。 |
| R4.2 | 正在进行的回合（streaming / 权限等待 / 连接中 / 有 open tools / deferred `prompt_complete` 等）在切走时 **demote 到 background**，继续跑完，**不得 park 后被回收杀掉**。 |
| R4.3 | Ready 会话可 **park**；容量不够时 **只回收 idle parked**，不得杀 busy background。 |
| R4.4 | UI 按 `sessionId` 消费 `session://stream` / `session://runtime`，后台回合切走后 transcript / liveMap 仍更新。 |
| R4.5 | 打开另一会话时：若有他会话 busy，**暂缓 warm-connect**；**第一次在该会话发送**仍应 demote+spawn。 |
| **验收** | A 跑长任务 → 切到 B 浏览/发送 → A 工具与最终回复仍写入 A 的 journal；侧栏 busy 状态诚实。 |

### R5 — 进程池容量与假 PROCESS_LIMIT

| 项 | 说明 |
|----|------|
| **问题** | 池子过紧；仅 1 个 busy 时浏览其它会话仍误报 `PROCESS_LIMIT`。 |
| **要求** | |
| R5.1 | 默认 `maxConcurrentAgents` **8**，上限 **32**（可配置）。 |
| R5.2 | spawn 前优先 **回收 idle parked**，直到有空位。 |
| R5.3 | 仅当槽位被 **busy** 工作占满时才报 `PROCESS_LIMIT`。 |
| **验收** | 1 个 busy + 多次切换 Ready 会话 → 不应误报 limit；真满 busy 时有明确 toast/错误。 |

### R6 — 新建会话不得杀死 live Agent

| 项 | 说明 |
|----|------|
| **问题** | 发送后立刻点「新建会话」调用 `sessionDisconnect`，中断刚发出的回合；出现 **有 agentSessionId、journal 空** 的僵尸会话。 |
| **要求** | |
| R6.1 | `newChat` **禁止** `sessionDisconnect`。 |
| R6.2 | Host `disconnect`：busy → demote background；Ready → park；**不得** mid-turn kill。 |
| R6.3 | UI 已切到 draft 后，in-flight `executeSend` 仍须完成 `sessionSend`。 |
| R6.4 | `soft_respawn` 在 mid-turn **no-op**。 |
| **验收** | A 刚发送 → 立刻新建 → A 继续产出 journal；不出现「仅 meta、无消息」的空会话假死。 |

### R7 — 发送队列按会话隔离（含跨会话假队列修复）

| 项 | 说明 |
|----|------|
| **问题 A** | flush 认领 key 回落到 live host sessionId → 队列串台（他会话消息出现在当前会话）。 |
| **问题 B** | Host 他会话 busy 时，在 **空新会话** 发送被错误入队，出现「本会话队列 1 条」+ 欢迎页空态（跨会话任务队列异常截图）。 |
| **要求** | |
| R7.1 | 队列 map 按 `queueSessionKey(sessionId \| __draft__)` 隔离。 |
| R7.2 | **flush 只 claim 当前查看会话** 的 key，**禁止** fallback 到 `live.sessionId`。 |
| R7.3 | **仅当「本会话」busy / connecting** 时入队 follow-up；`awaiting_permission` 不入队（先处理权限）。 |
| R7.4 | Host **他会话** busy + 用户在 draft/另一会话发送 → **不得入队**；走 `executeSend` → **demote + 并行 spawn**。 |
| R7.5 | flush hold：仅当 claim 的会话 == 当前 live busy 会话时等待；draft / 他会话不因 foreign busy 阻塞。 |
| R7.6 | 乐观 `liveHost` / 失败回滚 **不得** 篡改 foreign mid-turn 状态。 |
| R7.7 | 删除会话时 drop 对应 queue key；draft 物化成功后再 `migrateDraft`。 |
| **验收** | |
| | ① A streaming 时在 A 再发 → 进 A 队列，A 结束后 flush。 |
| | ② A streaming 时新建并发送 → **立即开 B**，欢迎页 **无**「本会话队列」；A 后台继续。 |
| | ③ 切 B 时不显示 A 的队列条。 |
| | ④ 单元测试覆盖 key / hold / enqueue 边界。 |

### R8 — 现场故障复盘能力（工程侧，服务上述验收）

| 项 | 说明 |
|----|------|
| **问题** | 部分会话中途停、空 journal，需可对账。 |
| **要求** | 后台 tool journal、`agent_exit` 等标记足够排查；busy 判定含 open tools / deferred complete，避免「看起来 idle 被 park 杀掉」。 |
| **验收** | 长工具（如 `find`）切走后仍完成；进程退出在 journal 有迹可查。 |

### R9 — 权限 / 交互与查看会话绑定（伴随约束）

| 项 | 说明 |
|----|------|
| **要求** | 权限条 / ask_user 优先只展示 **当前查看** 且需要处理的会话；后台权限 toast/通知提示，不抢占无关会话的 composer。 |
| **新建会话** | 离开时清除本机 `perm` / `askUser` 展示态；回到 awaiting 会话时应能再次处理（若当前未完全做到，记为后续缺口）。 |
| **验收** | 在空 draft 上不应长期挂着他会话的 workspace write 权限条而不说明来源。 |

---

## 3. 非目标（本整改不做）

| 不做 | 原因 |
|------|------|
| 取消进程上限 | 仍需 `maxConcurrentAgents` 护栏 |
| 全局统一发送队列（跨会话一条 FIFO） | 与「每会话独立 Agent」冲突 |
| 换 Electron / 换消息存储 | 架构外 |
| 强制同一时刻 UI 同时展示多会话全文 stream | 单 workbench 焦点模型；侧栏 + 回切即可 |

---

## 4. 状态模型（实现约定摘要）

```
live          当前 Host 焦点槽（sessionSend 目标）
background    busy 被 demote，进程仍跑，stream 按 sessionId 入 journal
parked        Ready 被挤出焦点，可被 idle 回收
draft         UI sessionId=null，队列 key=__draft__
```

| 用户动作 | 期望 |
|----------|------|
| 同会话 follow-up（busy） | 入本会话队列 → 回合结束 auto-flush |
| 他会话 / 新建发送（foreign busy） | demote foreign → spawn/connect 本会话 → 立即发 |
| 新建会话（不发送） | 清 draft UI；**不** disconnect live |
| 打开 Ready 会话 | 可 park 前一 Ready；busy 只 demote |
| 池满且全 busy | `PROCESS_LIMIT` + 提示 |

---

## 5. 验收清单（汇总）

- [x] **R1** 资源编辑区全高 + 内页工具栏  
- [x] **R2** Markdown TipTap 编辑与保存回写  
- [x] **R3** chrome 角标贴按钮（`.chrome-btn { position: relative }`）  
- [x] **R4** A 长任务 + 切 B 发送：A 不中断，B 可并行  
- [x] **R5** 单 busy 浏览不误报 PROCESS_LIMIT；默认并发 8（上限 32）  
- [x] **R6** 发送后立刻新建：A 仍有 journal，无空壳会话  
- [x] **R7** 空新会话无假队列；队列仅本会话 follow-up；无串台  
- [x] **R8** 长工具 background 可完成  
- [x] **R9** 权限不无故霸占空 draft composer；回到 awaiting 会话可再次处理  

### R10 —（补充）Host 指令按会话寻址

R4/R6/R7 的前端与进程池策略都做对了，但仍留着一处根因：**`session_send`
等指令没有会话参数，一律作用于「当前 live 槽」**。warm connect / 侧栏切换 /
automation 只要插在 `ensureConnected` 与 `sessionSend` 之间，就会把这条消息发到
别的会话——表现为串台回复，以及「有 `agentSessionId`、journal 为空」的僵尸会话。
后台会话发起的权限同理：响应发到了 live 槽的子进程，rpc id 对不上，后台回合永久
卡住，这正是「无法正常调用 Agent 完成任务」。

| 项 | 说明 |
|----|------|
| R10.1 | `session_send` / `session_stop` / `session_rewind_drop_last_user` / 权限 · Plan · ask_user 响应均携带 `sessionId`。 |
| R10.2 | Host 在 `connect_lock` 内把目标会话重新聚焦（background / parked → live）再执行；目标无进程时返回 `CONNECT_FAILED`，**不得**回退到 live 槽。 |
| R10.3 | 前端收到 `CONNECT_FAILED` 后冷连接目标会话并**重试同一条消息一次**。 |
| R10.4 | 后台会话的权限 / ask_user 按 `sessionId` 缓存，切回该会话时恢复；回合结束 / 出错 / 删除会话时清理。 |
| R10.5 | 等待中的后台会话发自己的 `session://runtime`，而不是 live 快照。 |
| R10.6 | 有 send / connect 进行中时暂缓 warm-connect。 |
| **验收** | A streaming 时在 B 发送 → B 的消息只进 B 的 journal，A 后台跑完；A 在后台请求权限 → 切回 A 仍能审批并继续。 |

### R11 —（补充）回合生命周期与事件入口

现场复盘会话 `a46455c7`（`docs` 无需保留细节，结论如下）：agent 侧 `turn_ended outcome=completed`、完整答案 2332 字；App journal 只有前 1433 字，停在 16:28:13，而 agent 一直输出到 16:28:20。无报错、无 `turn_cancelled`、无 `agent_exit`，两端进程都还活着 —— 输出被 Host **静默丢弃**，界面表现为「卡住」。

根因：Host 用 **FSM** 判断回合是否结束，而 agent 会提前发 `prompt_complete`。FSM 一旦 Ready，后续 chunk 全部命中「不在回合中」的丢弃分支；同时会话变成可 park，而 parked 的 agent 没有事件路由。

| 项 | 说明 |
|----|------|
| R11.1 | 回合生命周期以 `prompt_in_flight`（`session/prompt` RPC 未 resolve）为准，**不看 FSM**。 |
| R11.2 | `_x.ai/session/prompt_complete` 通知为 `authoritative: false`，只做 defer；只有 RPC 结果（排在所有 chunk 之后）才终结回合。 |
| R11.3 | 提前 `prompt_complete` 之后到达的 chunk 必须**重新打开回合**并写入 journal。 |
| R11.4 | `prompt_in_flight` 的会话不得被 park / 闲置回收；`try_finish_deferred_prompt_complete` 在其为真时不得结束回合。 |
| R11.5 | `handle_acp_event` 对承载回合输出的事件不得静默 `return`：先尝试把仍在输出的 parked agent 救回 `background`，否则打 `warn`。 |
| R11.6 | prompt RPC 失败按 **session id** 归属错误，不得写进 live 槽。 |
| R11.7 | 切回后台流式会话时，UI 从 live map 恢复 streaming / 等待权限状态，不得显示为 idle。 |
| R11.8 | 同一会话同时只允许一个 `session/prompt` 在飞。 |
| **验收** | 长回答 + 提前 `prompt_complete` → journal 与 UI 拿到完整答案；切走再切回，输出管线不断、回合正常收尾。 |

### R12 —（补充）`prompt_complete` 兜底不得替 agent 结算回合

现场复盘会话 `9019d19a`：R11 的修复已在运行的二进制中，症状却完全复现 —— agent 端 `turn_ended outcome=completed`、完整答案 2380 字符；App journal 只有 **1528 字符且是完整文本的前缀**，缺尾部 852 字符（36%）。journal 最后一次写在 `09:27:32.31`，agent 一直输出到 `09:27:40.20`，中间 8 秒的输出全部消失，无报错、无 `turn_cancelled`、无 `agent_exit`。

根因不在事件路由，而在 R11 依赖的那个「安全阀」：`_x.ai/session/prompt_complete` 到达时会挂起 `schedule_prompt_complete_fallback`，**固定 3 秒**后直接把 pending 的 `session/prompt` 用合成结果 resolve 掉。`AcpClient::prompt()` 随即发出 `Stream{done:true}` + `PromptComplete{authoritative:true}`，Host 于是 force-flush 当前缓冲（那 1528 字符）并置 `prompt_in_flight = false`。此后所有 chunk 命中 replay 守卫被丢弃。**R11.2 要求「只有 RPC 结果才能终结回合」，但兜底逻辑自己伪造了一个 RPC 结果**，把 R11 的修复从内部废掉了。

与「其他会话结束抢占进程」无关：`pending` 表是每个 ACP client 私有的，一个 App 会话一个子进程。

| 项 | 说明 |
|----|------|
| R12.1 | `prompt_complete` 兜底窗口是**空闲窗口**而非固定截止时间：每条入站 `session/update` 都重新计时。 |
| R12.2 | 只有 agent 在整个窗口内**完全没有输出**时，才释放 `session/prompt` 等待者；RPC 结果已到达则直接退出，不做任何事。 |
| R12.3 | 真正卡死的 RPC 由 `PROMPT_TIMEOUT_SECS` 兜底，兜底重新计时不得引入新的永久挂起路径。 |
| R12.4 | background 路径上因 `prompt_in_flight == false` 丢弃 chunk 必须打 `warn`（后台会话不存在 `session/load` replay，这种丢弃一定是真实输出丢失）。 |
| **验收** | 长回答 + 提前 `prompt_complete` + 中途持续输出 > 3 秒 → journal 与 UI 拿到完整答案；agent 提前 complete 后真的静默 → 3 秒后回合正常收尾，不挂起。 |

---

## 6. 实现落点（对照，非需求正文）

| 区域 | 主要位置 |
|------|----------|
| Host demote / pool / disconnect | `src-tauri/src/session_manager.rs` · `process_limits.rs` |
| 新建会话 / send / 队列接线 | `src/App.tsx` · `src/hooks/useSendQueue.ts` · `src/lib/sendQueue.ts` |
| 资源编辑 / TipTap | `src/components/ResourceViewer.tsx` · `MarkdownTiptapEditor.tsx` · `app.css` |
| 角标 | `src/styles/app.css`（`.chrome-btn`） |
| 产品规则 | `docs/llm-wiki/session-continuity.md` |
| 变更记录 | `CHANGELOG.md` [Unreleased] |

---

## 7. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-26 | 首版：汇总资源编辑、TipTap、角标、多会话并行、进程池、newChat 不杀进程、发送队列隔离与「空新会话假队列」整改要求 |
| 2026-07-26 | 复审：R1–R9 已落地并核对；新增 R10「Host 指令按会话寻址」——修复多会话 ACP 打架根因（无 sessionId 的 `session_send` / 权限响应打到 live 槽）与后台权限无法回答导致回合卡死 |
| 2026-07-26 | 现场复盘会话 `9019d19a` 后新增 R12「`prompt_complete` 兜底不得替 agent 结算回合」——R11 已上线仍复现截断（缺 36%），根因是提前 `prompt_complete` 挂起的 3 秒兜底定时器自行合成 authoritative 完成事件；改为空闲窗口计时 |
| 2026-07-26 | 现场复盘会话 `a46455c7` 后新增 R11「回合生命周期与事件入口」——修复提前 `prompt_complete` 导致的输出静默截断（答案缺 39%、界面假卡死）、parked 会话事件丢弃、回合错误归属错会话、切回后台会话显示为 idle |
