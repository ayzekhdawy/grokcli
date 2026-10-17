# CodePilot → Grok App：会话 / 聊天 / 思考 / 工具 / 内容展示 审查报告

> **对照对象**：[op7418/CodePilot](https://github.com/op7418/CodePilot)（本地研究副本：`desktop-app/CodePilot-study`，克隆于 2026-07-25）  
> **被审对象**：Grok App（本仓库 `main` @ `503d4f8`）  
> **审查立场**：以 **CodePilot 已上线、长期打磨的聊天产品视角** 审视 Grok App；承认两边技术栈与产品定位不同，但在「用户能不能看懂 Agent 在干什么」这条体验链上对标。  
> **范围**：会话生命周期、流式与持久化、思考/推理展示、工具调用展示、消息正文与富内容渲染。不含 Provider 矩阵、IM Bridge 全量、Gallery 等外围能力（仅在影响聊天信任层时点到）。

---

## 0. 一句话结论

| 维度 | CodePilot | Grok App | 判定 |
|------|-----------|----------|------|
| 会话状态机 | SQLite + 客户端 StreamSession 单例 + phase 对账 | Host 侧 Rust FSM + 前端投影 | Grok **后端更干净**；前端**跨会话流态**弱 |
| 消息数据模型 | 结构化 content blocks（text/thinking/tool_use/tool_result） | 扁平 `ChatMessage` + marker 行 + segments | CodePilot **可回放、可折叠、可配对**；Grok **更轻但丢审计轨迹** |
| 思考展示 | 工具组内 ThinkingRow + 标题摘要 + 全量持久化 | 交错 segments + 计时折叠偏好 | Grok **交错顺序更真实**；折叠态**信息密度不足** |
| 工具展示 | 正文内可展开组 + 注册表 + 上下文归组 + 错误态 + bash 滚窗 | **仅直播一行**，历史 tool_step 故意不渲染 | Grok 更像 Codex 终端；**长任务回看几乎空白** |
| 内容渲染 | Streamdown 插件族 + 结构化 fence（widget/image/diff）+ 缓冲首屏 | MarkdownChat + smooth stream + 附件卡 | Grok **够用**；缺结构化产物层与首屏缓冲策略 |
| 运行信任层 | RunCockpit / RunCheckpoint / TerminalReason / RateLimit | ErrorDeck / 权限弹层 / Plan 面板 / 侧栏 Tasks | Grok 有零件，**缺少「发送前/回合结束」统一叙事** |

**核心差距不在「有没有 markdown」**，而在：

1. **工具与思考是否成为 transcript 的一等公民**（CodePilot：是；Grok：直播有、历史几乎无）。  
2. **流是否脱离 UI 生命周期**（CodePilot：`stream-session-manager` 单例；Grok：强绑定当前会话视图与 `App.tsx` 事件处理）。  
3. **回合结束是否「诚实收口」**（terminal reason、is_error、phase reconcile、tool-only 消息落库）。

---

## 1. CodePilot 可取之处（按用户价值排序）

### 1.1 结构化消息块（Message Content Blocks）

```ts
// CodePilot MessageContentBlock
| { type: 'text'; text: string }
| { type: 'thinking'; thinking: string }
| { type: 'tool_use'; id; name; input }
| { type: 'tool_result'; tool_use_id; content; is_error?; media? }
| { type: 'code'; language; code }
```

- **落库即完整回合**：`buildFinalMessageContent` 专门处理 text-only / thinking-only / **tool-only**（无正文也要落助手消息——他们修过 GPT-Image 类「只出工具无散文」导致消息消失的 bug）。  
- **历史可回放**：`MessageItem.parseToolBlocks` + `pairTools` 把 use/result 配对后交给 `ToolActionsGroup`。  
- **压缩安全**：`message-normalizer` 用 `<prior-tool-call …/>` / `<prior-reasoning>` XML 风格摘要，避免模型 few-shot 模仿伪工具调用。

**对 Grok 的启示**：现在 journal 的 `tool_step|…` 行与 assistant 文本是**并列消息**，transcript 渲染又**主动丢弃** tool 行 → 历史里「Agent 做了什么」断裂。

### 1.2 Stream Session Manager：流与 React 解耦

`stream-session-manager.ts`（~1400 行）要点：

| 能力 | 行为 |
|------|------|
| 全局单例 | `globalThis` Map，HMR / 切会话不丢流 |
| Snapshot | `phase / streamingContent / thinking / tools / results / permission / terminalReason / rateLimit / contextUsage` |
| 双档 idle | 首 token 前 10min、首 token 后 5.5min（防代理静默 vs 真卡死） |
| 停流 | interrupt + **无条件 2s force-abort**（防 `/interrupt` 挂死锁死 composer，#578） |
| phase 对账 | `stream-phase-reconcile`：后端 `runtime_status` ↔ 客户端 `phase` |
| 文本节流 | 100ms `throttledTextEmit`，非 text 事件强制 flush |
| thinking 相位 | `accumulatedThinking` / `fullThinking` / `thinkingPhaseEnded` 多轮工具间分隔 |
| 文件变更 | write 类 tool_result → `codepilot:file-changed` 事件驱动 Preview |

**用户可感知收益**：切换聊天再回来，流还在；Stop 不会假死；卡死有超时诚实结束。

### 1.3 工具 UX 体系（产品文档级成熟度）

CodePilot 有完整链路文档：`docs/insights/tool-call-ux.md` + 竞品调研 + handover。落地包括：

1. **ToolRegistry**：bash / edit / read / search / agent 各自 icon、摘要、`renderDetail`  
2. **上下文归组**：连续 ≥3 个 read/glob/grep → `Gathering context (N)`  
3. **is_error 全链路**：SSE → snapshot → StatusDot 红叉  
4. **Bash 滚窗**：运行中最后 5 行；完成后截断 20 行  
5. **Thinking 嵌在工具组第一行**：折叠摘要取 `**bold**` / `# heading`  
6. **DiffSummary**：本回合 edit/write 文件列表，可点开预览  
7. **状态动画**：running spinner / success spring / error  

竞品结论他们明确采用：Opencode 归组与标题、CraftAgent 缓冲与动画、Codex reasoning 状态感。

### 1.4 流式内容「可读性工程」

- **智能缓冲** `useBufferedContent`：40 词或 2.5s 再放出首段，避免中文逐字抽搐；**结构化 fence 旁路**（widget / batch-plan / image-gen）。  
- **StreamingStatusBar**：状态文案 + 已运行秒数 + 强制停止。  
- **TerminalReasonChip**：回合结束原因（SDK terminal reason）。  
- **RateLimitBanner**：订阅配额警告。

### 1.5 信任层（发送前 / 异常时）

设计原则（composer redesign / run checkpoint）：

> **「出问题才提示，没出问题就不要显示」**

- `RunCockpit`：常态不堆 chip；解释与修改分离（popover 只解释）。  
- `RunCheckpoint`：inline banner（非 modal）处理 no-provider / pinned-invalid / runtime-fallback。  
- Permission：执行中卡片；超时 auto-deny 有独立 `permissionResolved: 'timeout'` 文案。  
- `reviewNotices`：auto_review 静默拒绝也要告诉用户「谁否了」。

### 1.6 会话与数据面

- SQLite WAL，`messages.content` JSON，任务表、usage 统计。  
- Pause / resume / rewind checkpoint / archive / split dual session。  
- 导入 Claude Code `.jsonl`。  
- Context accounting（真实 token 快照 vs 字符估算分层）。

### 1.7 工程纪律（值得抄流程，不必抄栈）

- 大量 **stream / tool / stop / phase** 单测（`sse-stream`、`stream-stop-and-error-honesty`、`message-list-virtual` 等）。  
- 已知缺陷写在 handover「已知局限」里（thinking 展开 stopScroll、bash 历史默认展开等）。  
- 产品思考与实现成对文档，方便长期运营迭代。

---

## 2. Grok App 现状快照（对照用）

### 2.1 架构取向

| 层 | 实现 |
|----|------|
| 外壳 | Tauri + React |
| Agent | Grok Build CLI / ACP |
| 会话 FSM | **Host 权威** `session_fsm.rs`：idle / connecting / ready / streaming / awaiting_permission / disconnected |
| 消息 | 前端 `ChatMessage`；journal 落盘（`journal_throttle` ≥500ms 或段落边界） |
| 聊天 UI | `lobe-chat/*`：ConversationThread / Thinking / AgentActivity / MarkdownChat |
| 任务侧栏 | `sessionTasks.ts` 从 tool_step **派生** AgentTask 列表 |

### 2.2 刻意的 Codex 风格（不是漏做，是产品选择）

`AgentActivity.tsx` 注释写得很清楚：

- 只显示**当前仍在跑**的最新工具一行  
- 多工具互相**替换**同一行  
- **历史 tool_step 不进 transcript**（`ConversationThread` 直接 `return null`）  
- 内容恢复后工具行消失，减少 chrome  

优点：界面干净、像终端「当前动作」。  
代价：用户回看对话**无法重建决策链**；侧栏 Tasks 也只是「最近 N 条」，不是 transcript 叙事。

### 2.3 Grok 已领先或至少不弱的点

1. **思考与正文交错**（`segments: thought | content`）：比 CodePilot「thinking 整块挂在工具组」更接近真实 stream 顺序；多 phase 有 `plan.phaseLabel`。  
2. **Host FSM + 错误码投影**：`AgentErrorCode` + ErrorDeck 比纯前端 phase 更利于崩溃恢复叙事。  
3. **Journal 节流**：中途写盘不炸盘。  
4. **Send queue**：忙时排队（`useSendQueue`）。  
5. **Fork / Rewind / 会话搜索 / 导出 / Pin / Changes 面板 / PlanReview**：产品面并不单薄。  
6. **思考完成默认折叠 + 用户偏好**（`thinkingPref`）：社区反馈向。  
7. **Smooth stream**（rAF 自适应追赶）对 bursty token 友好。  
8. **Context compact 横幅**（含 tokens 前后与摘要 details）。  
9. **附件 / 路径卡 / ResourceViewer / 会话变更 diff** 与工程工作流绑定更深。

---

## 3. 分域问题清单（以 CodePilot 标准审查 Grok）

严重度：

- **P0**：用户会误判系统状态、丢失关键事实、无法复盘错误  
- **P1**：长会话 / 长工具链明显难受  
- **P2**：体验精致度 / 运营成熟度差距  
- **P3**：锦上添花

### 3.1 会话处理（Session / Stream Lifecycle）

| ID | 问题 | 证据 / 表现 | 严重度 | CodePilot 做法 | 建议方向 |
|----|------|-------------|--------|----------------|----------|
| S1 | **流态与 UI 生命周期耦合过重** | 逻辑集中在巨大 `App.tsx` + 当前会话 state；缺少「会话级 StreamSnapshot 单例」 | P1 | `stream-session-manager` 按 sessionId 持有 snapshot，视图只订阅 | 抽 `SessionStreamStore`（Map\<sessionId, snapshot\>），切会话不撕流；回到会话 hydrate UI |
| S2 | **客户端 / Host 状态可能漂移时缺少统一 reconcile 层** | 前端 `SessionState` 依赖事件；无类似 `runtimeStatusToPhase` 的 pure 对账表 | P1 | `stream-phase-reconcile` + mount 时纠正 stuck active | 定义 Host state ↔ UI gate 真值表；打开会话时强制 reconcile；Stop 路径保证 composer 解锁 |
| S3 | **Stop / 中断诚实性不足** | 未见「interrupt 后无条件 force-abort 超时」的对称设计 | P1 | 2s force-abort 防 #578 | 增加 stop watchdog；超时后本地 force-complete + 明确 terminal reason |
| S4 | **长静默无双档 idle 策略** | 有 `stream_stall`，但产品层「等待首 token vs 中途卡死」叙事未必分层 | P2 | PRE 10min / POST 5.5min | 首 token 前后不同超时与不同文案（「排队中」vs「疑似卡死，可停止」） |
| S5 | **tool-only / thinking-only 回合落盘边界** | assistant 可能空 content；工具是独立 marker 行；历史又不显示工具 | P0 | `buildFinalMessageContent` 保证 tool-only 也有助手消息 | 回合结束至少落一条可渲染的「本回合摘要」或保证 tool 历史可见 |
| S6 | **会话切换时用户失去「还在跑」的连续感** | 依赖全局 busy / 权限 toast，但非 snapshot 级恢复 | P1 | 切走仍跑、切回接 snapshot | 侧栏会话条显示 streaming badge；切回自动贴底并恢复 live 区 |
| S7 | **权限等待态跨会话提示有，但缺少统一 runtime_status 文案** | i18n 有「另一会话需要权限」 | P2 | waiting_permission phase + PermissionPrompt | 侧栏 + 顶栏同一套状态词：running / needs permission / error |

### 3.2 聊天展示（Transcript 叙事）

| ID | 问题 | 证据 / 表现 | 严重度 | CodePilot 做法 | 建议方向 |
|----|------|-------------|--------|----------------|----------|
| C1 | **历史工具调用在 transcript 中不可见** | `isToolStepMessage` → `return null` | **P0** | 工具组内嵌在 assistant 消息 | 至少提供「Turn 活动摘要」折叠块：工具名列表 + 成功/失败计数；完整详情可进侧栏 |
| C2 | **并发 / 多工具只显示最新 running** | `pickRunningTurnTool` 单行替换 | P1 | 列表 + 归组 | 直播可仍一行；结束后落「本回合工具时间线」 |
| C3 | **错误工具在 transcript 无红标叙事** | `isError` 在 tool 行上，但行被隐藏 | P0 | StatusDot error | 失败工具必须在主对话留下可见痕迹（哪怕一行） |
| C4 | **回合结束缺少 terminal reason 芯片** | 用户 Stop / agent_exit / stall 信息分散 | P1 | `TerminalReasonChip` | 统一 end-of-turn marker（用户停止 / 权限拒绝 / 超时 / 错误码） |
| C5 | **长会话列表性能** | 有 `VirtualList` 工具，ConversationThread 仍 map 全量 | P2 | message-list-virtual | 超 N 条启用虚拟列表；测量 sticky 兼容 |
| C6 | **空态 / 问候场景单薄** | 简单 startTitle/hint | P3 | NewChatWelcome / 上下文问候 | 非优先 |
| C7 | **消息操作密度** | 有 copy / fork / rewind / export | — | 类似 | 已达标；保持克制 |

### 3.3 思考 / 推理展示（Thinking）

| ID | 问题 | 证据 / 表现 | 严重度 | CodePilot 做法 | 建议方向 |
|----|------|-------------|--------|----------------|----------|
| T1 | **折叠态只有「思考中 / 想了 Ns」无内容摘要** | `Thinking.tsx` 无 bold/heading 提取 | P1 | ThinkingRow summary | 折叠标题 = 首个 `**…**` / `#` / 前 40 字 |
| T2 | **思考与工具的「时间线关系」弱** | 工具不在正文，用户看不到「思考→读文件→再思考」 | P1 | Thinking 作为工具组第一行 | 若保持 Codex 极简，至少在侧栏 Tasks 关联 phase；或 transcript 插入轻量时间线 |
| T3 | **多 phase 有标签，但无「中间推理」fallback** | 无 intermediate text（工具间散文）模型 | P2 | CodePilot 也承认未做，需分段 text | 中期：text 分段绑定 tool 边界 |
| T4 | **展开思考触发 stick 跳动** | 有 stick-to-bottom；未见 expand 时 stopScroll | P2 | expand → `stopScroll()` | 展开 thinking 时脱离 stick；提供 BackBottom |
| T5 | **思考持久化路径依赖 journal 字段** | segments/thoughtPhases 存在 | — | JSON block | 回归测：重开会话后 multi-phase 是否完整 |

### 3.4 工具调用（Tools）

| ID | 问题 | 证据 / 表现 | 严重度 | CodePilot 做法 | 建议方向 |
|----|------|-------------|--------|----------------|----------|
| U1 | **无工具类型注册表 / 差异化渲染** | 统一一行 title | P1 | ToolRegistry | 对 bash/read/edit/search/subagent 做 summary + icon 映射（侧栏与未来 transcript 共用） |
| U2 | **无上下文归组** | 连续 10 次 Read 若可见会刷屏；但现在历史全藏，问题变形为「不可见」 | P1 | ≥3 context tools 归组 | 先做「可见」，再做归组 |
| U3 | **无 bash/命令输出滚窗** | detail 可能有片段，主 UI 不展示流式输出 | P1 | 最后 5 行 rolling | 长命令工具展开面板； tail 输出 |
| U4 | **tool result 媒体块未一等公民化** | 有附件系统，但非 tool_result.media 管线 | P2 | MediaBlock + MediaPreview | 统一 tool 产物 → 内联预览 → 落盘 |
| U5 | **侧栏 Tasks 与 transcript 双源叙事** | Tasks 从 messages 派生，但主对话不显示 | P1 | 单一 ToolActionsGroup | 明确产品规则：主对话摘要 + 侧栏详情 **同源** |
| U6 | **写文件后缺少回合级 DiffSummary** | Changes 面板有会话变更，但聊天内无「本回合改了 N 个文件」 | P2 | DiffSummary 挂 MessageItem | 助手消息底部「Modified N files」折叠条，点击打开 Changes |
| U7 | **权限 UI 与工具行未形成同一视觉语言** | PlanReview / permission 分模块 | P2 | PermissionPrompt 与 trust layer 同族 token | 统一 status-muted banner 语言 |

### 3.5 内容展示（Markdown / 流式正文 / 产物）

| ID | 问题 | 证据 / 表现 | 严重度 | CodePilot 做法 | 建议方向 |
|----|------|-------------|--------|----------------|----------|
| D1 | **首屏无「智能缓冲」** | smooth stream 解决节奏，不解决前几个字抽搐 | P2 | 40 词 / 2.5s 缓冲 + 结构化旁路 | 对纯文本 delta 加 soft buffer；代码围栏旁路 |
| D2 | **缺结构化产物 fence 管线** | 无 show-widget / image-gen-request 类协议 | P2 | WidgetRenderer 等 | 按产品需要再引；不必照搬生成式 UI |
| D3 | **Markdown 插件深度** | MarkdownChat 已较完整 | P3 | Streamdown cjk/math/mermaid + Shiki worker | 长代码块 worker 高亮可评估 |
| D4 | **流式未闭合 fence 处理** | 有 softCloseMarkdown | — | 类似 | 保持；加测试 |
| D5 | **错误正文友好化** | `formatTurnErrorBody` / ErrorDeck | — | error-classifier 16 类 | 已不错；可对齐「可操作建议」密度 |

### 3.6 横切：数据模型与工程

| ID | 问题 | 严重度 | 建议 |
|----|------|--------|------|
| X1 | `App.tsx` ~10k 行承载过多会话事件 | P1 | 按 CodePilot 切：`stream store` / `message reducer` / `permission broker` / 视图 |
| X2 | 消息模型「tool 作为 role」vs「tool 作为 assistant block」混用 | P1 | 中期收敛：对外 UI view-model 统一 `Turn = { segments, tools[], terminal }` |
| X3 | 压缩 / 回放时工具信息如何进入模型上下文 | P2 | 学 normalizer：摘要工具而非丢弃或散文化 |
| X4 | 流式与持久化一致性测试偏少（相对 CodePilot） | P1 | 补：tool-only 落库、stop honesty、切会话再入、is_error 展示 |

---

## 4. 根因归纳（不是表面缺组件）

### 根因 A — 产品策略：Codex 极简直播 vs 可审计 transcript

Grok 选择了 **「历史不堆工具」**。在短问答场景极佳；在 **Agent 连续读改跑 30s+** 场景，用户复盘只能依赖记忆与侧栏。  
CodePilot 的选择是 **「工具是正文的一部分」**，并用归组控制噪音。

→ 不是二选一，可以是：

```
直播：Codex 一行（保持）
结束：折叠「本回合活动」摘要（CodePilot 归组的简化版）
详情：侧栏 Tasks / Changes（已有）
```

### 根因 B — 数据模型：扁平 marker vs 结构化 blocks

Grok：

```
user
assistant (text + segments)
tool_step (hidden)
tool_step (hidden)
assistant (more text)
```

CodePilot：

```
assistant content = [
  thinking, tool_use, tool_result, text, tool_use, tool_result, text
]
```

后者天然支持配对、错误态、媒体、压缩摘要、历史一致渲染。

### 根因 C — 流控制中心缺失

CodePilot 把「流」提成**跨组件服务**；Grok 把「流」当作 **App 事件管道**。  
运营级稳定性问题（停不掉、假 streaming、切会话丢状态）通常出在 C，而不是 UI 皮肤。

### 根因 D — 信任层碎片化

Grok 有 ErrorDeck、权限、Plan、Doctor、connStatus…  
CodePilot 用 **同一套 status token + RunCheckpoint 分级**把「该不该打扰用户」产品化。  
Grok 缺的是 **编排原则**，不是缺第 N 个 toast。

---

## 5. 能力对照总表

| 能力 | CodePilot | Grok App | 差距 |
|------|-----------|----------|------|
| 切会话保活流 | ✅ 单例 snapshot | ⚠️ 进程在、UI 重建弱 | 中 |
| phase / runtime 对账 | ✅ | ⚠️ Host FSM 有，UI 对账弱 | 中 |
| Stop force-abort | ✅ | ⚠️ 需核验对称性 | 中 |
| 思考流式展示 | ✅ | ✅ 更强（交错） | Grok+ |
| 思考折叠摘要 | ✅ | ❌ 仅时长 | 高 |
| 思考持久化 | ✅ blocks | ✅ segments/journal | 平 |
| 直播工具 | ✅ 列表 | ✅ 单行 | 策略不同 |
| 历史工具 | ✅ | ❌ 隐藏 | **高** |
| 工具错误可见 | ✅ | ❌（隐藏后） | **高** |
| 上下文归组 | ✅ | ❌ | 中 |
| Bash 输出滚窗 | ✅ | ❌ | 中 |
| Diff 回合摘要 | ✅ | ⚠️ Changes 面板另路 | 中 |
| 首屏文本缓冲 | ✅ | ❌（有 smooth） | 低 |
| 结束原因芯片 | ✅ | ⚠️ 分散 | 中 |
| 发送前 checkpoint | ✅ | ⚠️ 部分 | 中 |
| 权限超时文案 | ✅ | ⚠️ | 低 |
| 消息虚拟列表 | ✅ | ⚠️ 组件有未全接 | 低 |
| 结构化 widget | ✅ | ❌ | 按需 |
| SQLite 消息 | ✅ | journal 文件 | 架构不同 |
| 文档化产品决策 | ✅ 极强 | ⚠️ 有 wiki/plan | 中 |
| 交错 thought/content | ⚠️ 偏弱 | ✅ | Grok+ |
| 工作区 Changes | ⚠️ Preview 事件 | ✅ 强 | Grok+ |
| Host 权威 FSM | ⚠️ 更偏 Node 路由 | ✅ Rust | Grok+ |

---

## 6. 推荐演进路线（按投入产出）

### Phase 0 — 诚实性（1–2 周，P0）

1. **失败工具必须在主对话留痕**（即使成功工具仍隐藏）。  
2. **回合结束 marker**：用户停止 / 超时 / 权限拒绝 / 错误码。  
3. **Stop watchdog**：中断无响应则 force-complete + 解锁 composer。  
4. **tool-only 回合**：保证有可渲染的 assistant 或 activity 摘要。  
5. 单测：stop honesty、error tool visible、reopen session thinking 完整。

### Phase 1 — 可回放的回合摘要（2–3 周，P0/P1）

1. 每轮结束生成 **TurnActivity** view-model：`tools[]` 含 name/status/summary/isError。  
2. Transcript 渲染可折叠 **「活动 · N 步」**（默认折叠；有 error 时默认展开）。  
3. 与侧栏 Tasks **同源**（禁止两套解析逻辑）。  
4. 折叠 thinking 标题摘要（bold/heading/截断）。

### Phase 2 — 流基础设施（2–4 周，P1）

1. 抽出 `SessionStreamStore`（或 Rust 侧 session projection 扩展）：  
   `phase, text, thinking, liveTool, permission, terminalReason, startedAt`。  
2. 视图只订阅；支持切会话再入。  
3. 双档 idle + 文案。  
4. 文本 emit 节流 + 纯文本首屏 soft buffer。

### Phase 3 — 工具深度（按需，P1/P2）

1. ToolRegistry（bash/read/edit/search/subagent）。  
2. 上下文归组。  
3. bash tail 输出。  
4. 回合 DiffSummary → 打开 Changes。  
5. Permission / Checkpoint 视觉语言统一。

### Phase 4 — 运营级打磨（P2）

1. 虚拟列表。  
2. 压缩 normalizer（防伪工具 few-shot）。  
3. Rate limit / quota 横幅（若官方账号模型需要）。  
4. 把关键决策写成 `docs/insights/*` 对，避免「下个 agent 推翻上个 agent」。

---

## 7. 明确不建议照搬的部分

| CodePilot 能力 | 不建议直接抄的原因 |
|----------------|-------------------|
| 生成式 Widget / 批量出图 | 产品重心不同；复杂度极高 |
| Electron + Next API 全栈 | Grok 已是 Tauri Host；应学模式不换壳 |
| SQLite 全量迁 | journal + Host 已可用；除非要复杂查询/跨端 |
| 过重的 RunCockpit 常态 UI | 他们自己也在减负；Grok 宜继续极简 |
| 历史 bash 默认全展开 | 他们已知占空间；Grok 应默认折叠 |

---

## 8. 若只做三件事（决策摘要）

1. **让「失败」与「回合结束」在主对话里诚实可见**（P0）。  
2. **每轮结束留下可折叠活动摘要**（解决隐藏 tool_step 的复盘空洞，P0）。  
3. **流状态从 App 巨型组件中抽出 session-scoped store + stop/phase 对账**（P1，后面所有 UX 的底座）。

思考交错与 Changes 面板是 Grok 的优势，应保留；不要为了学 CodePilot 把 transcript 做成满屏工具日志——**用归组 + 默认折叠守住干净**。

---

## 9. 参考路径（研究副本）

```
CodePilot-study/
  ARCHITECTURE.md
  docs/insights/tool-call-ux.md
  docs/research/tool-call-ux-competitive-analysis.md
  docs/handover/tool-call-ux.md
  docs/handover/chat-run-checkpoint.md
  docs/insights/chat-composer-redesign.md
  src/lib/stream-session-manager.ts
  src/lib/stream-phase-reconcile.ts
  src/lib/message-normalizer.ts
  src/hooks/useSSEStream.ts
  src/components/chat/{MessageItem,StreamingMessage,MessageList,RunCheckpoint}.tsx
  src/components/ai-elements/{tool-actions-group,reasoning,tool}.tsx

Grok App/
  src/lib/session.ts
  src/lib/sessionTasks.ts
  src/components/lobe-chat/{ConversationThread,AgentActivity,Thinking,MarkdownChat}.tsx
  src/hooks/useSmoothStream.ts
  src-tauri/src/{session_fsm,journal_throttle,session_manager}.rs
  src/App.tsx
```

---

## 10. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-25 | 初版：基于 CodePilot 最新 main 浅克隆 + Grok App main@503d4f8 静态代码审查 |
