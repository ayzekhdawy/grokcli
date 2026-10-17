# 设计文档：Agent 发送侧会话分叉

> **状态**：已拍板（待实现）  
> **日期**：2026-08-20  
> **方案**：A — 助手气泡「从这里分叉」+ 按用户回合截断 + 子会话 `session/fork` 后 rewind，失败再 bootstrap  
> **不是**：同会话内 ChatGPT 式 ◀ ▶ 兄弟答案树；不是按助手 `message id` 精确切 journal

---

## 1. 问题

当前「从这里分叉」挂在**用户气泡**上，截断键是 `through_user_prompt_index`。产品语义像「从这条问题另开一条线」，而用户要的是：**看到 Agent 回复之后，以这条回复为 HEAD 另开一条线**（入口在助手气泡）。

另外，部分分叉如果勾选 CLI `--fork-session`，子会话 `session/fork` 会带上**父会话的全部 Agent 记忆**，包括 journal 里已经丢掉的后续追问。画面截断、模型记得全量 — 这是撒谎。本设计要求 **Agent 记忆对齐截断后的 transcript**。

journal 截到「该用户回合结束」（用户问题 + 该回复的思考/工具）时，和现在从对应用户气泡分叉的切点**相同**。本期真正的产品差是入口位置；真正的正确性差是子会话 trim。

## 2. 目标 / 非目标

| 必须 | 不做 |
|------|------|
| 「从这里分叉」只出现在已完成的助手气泡 | 同会话兄弟答案 / ◀ ▶ |
| 新会话复制到该回复**所在用户回合结束**；之后的追问不复制；原会话不动 | 按单条 assistant `message id` 切到 tool_step 之前 |
| 有 agent id 时：子会话 `session/fork`，立刻对**子** `x.ai/rewind/execute` | rewind / 停轮父会话 |
| rewind 失败或未公布 rewind：丢掉新 agent id，`session/new` + journal bootstrap | 留下「画面截断、模型记得全量」的子会话 |
| 用户气泡只留编辑 / 回退 | 往 `App.tsx` 加新 `useState` / 大块功能 |
| 侧栏整段分叉行为不变（含 CLI 勾选） | 改 local session API、Remote IM 绑定 |
| 新文案走 `createT` / `t()`，15 locale 锁步 `en` | 系统 `confirm` / 透明菜单 |

## 3. 产品行为

三种动作保持正交：

| 动作 | 作用对象 | 会话 | 破坏性 |
|------|----------|------|--------|
| **Rewind** | 用户气泡 | 本会话 | 是，丢掉该回合之后 |
| **Regenerate** | 最后一条助手 | 本会话 | 是，重答最后一轮 |
| **Fork from here** | 助手气泡 | **新**侧栏会话 | 否，原会话不变 |

### 3.1 入口

- **助手气泡**（非 streaming、会话空闲 `canRewindSession`、能反推所属用户回合）：显示「从这里分叉」。
- **用户气泡**：移除 fork；保留复制、深链、最后一条编辑、回退。
- **侧栏「分叉会话」**：整段复制，无截断。对话框仍显示「分叉 CLI Agent 会话」勾选。
- **streaming / 工具 / 权限门 / connecting**：按钮 disabled，沿用现有 busy 文案。
- 找不到所属用户回合：不显示。错误条本期不加 fork（只成功助手气泡）。

### 3.2 截断

从助手消息 *A* 分叉：

1. `userPromptIndexContaining(messages, A.id)` → 所属 0-based 用户回合 *i*。
2. journal 复制 `truncate_through_user_prompt(..., i)`：含该用户问题、该回合助手回复、思考/工具行，直到下一个 **prompt** 用户（interjection 不算 prompt）。
3. 打开新会话，composer 空，用户发一条不同的跟进。

### 3.3 对话框

部分分叉（有 `throughUserPromptIndex`）：

- 文案仍用 `session.forkConfirmPartial`。
- **不展示** CLI `--fork-session` 勾选。源有 agent id 则**自动** `forkAgentSession=true`；没有则只复制 journal。
- restore-code / worktree 勾选保留，默认关，行为与现在相同。

整段分叉：现有勾选与默认不变。

### 3.4 标题 / 血缘

标题仍是 `Fork of {name}`（已有去重前缀）。侧栏不做树。Duplicate 仍是无截断、无 restore-code 的整段复制。

## 4. 架构

```
助手气泡 「从这里分叉」
  → userPromptIndexContaining(assistantId)
  → 确认对话框（部分：无 CLI 勾选；有 agent id 则自动 fork）
  → Host session_fork(source, through=i, fork_agent=…)
       journal 截到回合 i 结束
       若 fork_agent：子 meta.agentSessionId = 父 id
                     forkAgentSession = true
                     forkRewindPromptIndex = i
  → UI 打开子会话 → session_connect
       pending fork → 强制 cold spawn
       ACP session/fork → 新 child agent id（父不动）
       若 forkRewindPromptIndex = Some(i)：
         rewind_execute_for(child_sid, i, restoreFiles=false)
         Ok  → 绑定 child id，needs_history_bootstrap=false
         Err → 同一进程 session/new，丢掉 fork 出的 id，
               needs_history_bootstrap=true
       清掉一次性 forkAgentSession + forkRewindPromptIndex
```

`session_fork` 的外部参数仍是 `through_user_prompt_index`。UI 从助手反推 *i*，Host 不按 assistant id 切。

## 5. 数据

### 5.1 `SessionMeta`（`src-tauri/src/store.rs`）

新增一次性字段：

```rust
/// After ACP session/fork on next connect, rewind the CHILD to this
/// 0-based user prompt index (`restoreFiles=false`). Partial forks only.
/// Cleared after the connect attempt (success, rewind fail, or fork fallthrough).
#[serde(default, skip_serializing_if = "Option::is_none")]
pub fork_rewind_prompt_index: Option<u32>,
```

`fork_agent_session` 语义不变。清一次性标志时两个一起清（扩展 `clear_session_fork_agent_session`，或改名为 `clear_session_fork_oneshots` 并保留旧名包装）。

### 5.2 `store::fork_session`

| 条件 | 子 meta |
|------|---------|
| `through=Some(i)` 且 `fork_agent` 且源有 agent id | 复制 agent id；`fork_agent_session=true`；`fork_rewind_prompt_index=Some(i)` |
| `through=None` 且 `fork_agent` 且源有 agent id | 复制 agent id；`fork_agent_session=true`；**不写** rewind index |
| 无 agent id 或 `fork_agent=false` | 不设 agent id；两个 flag 都关 |

journal 截断仍走 `truncate_through_user_prompt`。消息 id 仍 remap。

### 5.3 前端纯函数（`src/lib/session.ts`）

```ts
/** 0-based user-prompt index of the turn that contains `messageId`, or -1. */
export function userPromptIndexContaining(
  messages: ChatMessage[],
  messageId: string,
): number;
```

规则：扫 journal；每条 `isTurnPromptMessage` 把计数 +1；命中 `messageId` 时返回当前计数（该行自己是 prompt 则为自身 index；助手/工具/interjection 则为最近一条 prompt）。没有任何 prompt 就命中 → `-1`。

`userPromptIndexOf` 保持「只匹配用户 prompt id」，给 rewind 用。

## 6. Connect / rewind

改 `src-tauri/src/session_manager/connect.rs`，在 `initialize_and_open_session` 返回之后、绑定 live meta 之前（或刚绑定之后、第一次 `session/prompt` 之前）。

成功 `session/fork` 时 ACP 现返回 `(child_sid, resumed=true)`，因此**不会**自动 bootstrap。部分分叉必须再 rewind 子会话，否则记忆是全量父上下文。

| 步骤 | 结果 |
|------|------|
| fork Ok + `forkRewindPromptIndex=Some(i)` + rewind Ok | 绑定 `child_sid`；`needs_history_bootstrap=false` |
| fork Ok + rewind 失败 / 未公布 rewind | **禁止**继续用 `child_sid`。对已 initialize 的 client 再 `session/new`；绑定新空 id；`needs_history_bootstrap=true` |
| fork 失败（现有 fallthrough `session/new`） | 不复用父 id；有 journal 则 bootstrap；仍清 oneshot |
| 整段分叉（无 rewind index） | 现有路径：fork 成功 = 全量父上下文，正确 |

`rewind_execute_for(child_sid, i, restore_files=false)`。禁止 `restoreFiles=true`（工作区还原走独立 worktree 勾选）。RPC 必须带**子** session id，不能用父 id。

父会话：不 rewind、不停轮、不 `session/cancel`。源若 busy，UI 根本不让点分叉。

Oneshot 无论 fork/rewind 成败都要清，避免下次 connect 再 trim。

## 7. 前端改动范围

| 文件 | 改动 |
|------|------|
| `ConversationThread.tsx` | `onForkFromUserMessage` → `onForkFromAssistantMessage`；按钮从用户 actions 挪到助手 actions（非 streaming 才渲染） |
| `AppWorkbench.tsx` | handler 用 `userPromptIndexContaining`；部分分叉自动 `forkCliSession`；对话框在 `throughUserPromptIndex != null` 时隐藏 CLI 勾选。不新增 `useState` |
| `useAppDialogs.ts` | 仅当现有 `ForkConfirmState` 需要标记「部分 / 自动 CLI」时改；能从 `throughUserPromptIndex != null` 推导则不改 |
| `src/lib/sessionFork.ts` | 成功 toast：rewind 成功走现有 `forkOkCli*`；bootstrap 回退走新 key（见 §8） |
| `src/lib/api/session.ts` | `sessionFork` 参数不变（Host 自己写 rewind index） |

遵守 App.tsx growth freeze：新逻辑进 `session.ts` / `sessionFork.ts` / ConversationThread / Host。

## 8. 错误处理与 toast

| 情况 | 行为 |
|------|------|
| 会话 busy | 按钮 disabled；现有 `session.rewindBusy` / 等价文案 |
| 源不存在、无 Tauri | 现有 classified soft-fail |
| restore-code dirty / 无项目 / worktree 碰撞 | 现有 soft-fail；对话框可留着改勾选；journal 分叉在 bind 失败时仍可保留 |
| 子 `session/fork` 失败 | journal 已在；connect `session/new` + bootstrap |
| 子 rewind 失败 | 同上；父不变；**不**把 rewind 当硬失败删掉新会话 |
| 无所属用户回合 | 不显示按钮 |

Connect 时才知道 rewind vs bootstrap，`runForkSession` 里立刻 toast 无法区分。Host 在 trim 结束后发：

```text
session://fork_trimmed  { sessionId, outcome: "rewound" | "bootstrap" }
```

主窗口听一次，映射：

- `rewound` → 现有 `session.forkOkCli` / `session.forkOkRestoreCli`（若 restore-code 已成功；若已经用过通用 `forkOk`，这条可做成 no-op 以免双 toast — 实现时：**部分+自动 CLI 的即时 toast 改用中性 `session.forkOk`，等事件再升格或改写 bootstrap 说明**）。
- `bootstrap` → 新 key `session.forkOkBootstrap`：说明 Agent 上下文是复制过去的截断历史，不是原会话全量记忆。

推荐：部分分叉的即时 toast 只用 `session.forkOk`（已打开新会话）；若随后收到 `bootstrap` 再补一条诚实说明。`rewound` 可静默（模型已对齐，不必再解释）。整段分叉不发此事件。

## 9. i18n

`en` 为权威，15 个 locale 锁步。新 key（名称可微调，必须进全部 catalog）：

| key | en 意向 |
|-----|---------|
| `session.forkOkBootstrap` | Forked · agent context is the copied history (not the original’s later turns) |
| （可选）`session.forkCliHiddenPartialHint` | 部分分叉隐藏勾选时，不需要也能讲清「将自动裁剪 Agent 记忆」 |

`message.forkHere` 已存在，可继续用。不要写死任何语言的字符串。

## 10. 测试

1. **`src/lib/session.test.ts`**  
   `userPromptIndexContaining`：助手 → 所属回合；该用户自己；interjection 不进计数；无 parent → `-1`。现有 `forkMessages` / `truncateThroughUserPrompt` 回归。

2. **Host store**（`store.rs` 测或邻近测）  
   部分分叉写入 `fork_rewind_prompt_index`；整段分叉不写；journal 截到该回合结束；无 agent id 不写 fork flags。

3. **connect**（可测 helper 或带 fixture 的 ACP）  
   fork 成功后 rewind 的 session id 是**子** id、index 正确、`restoreFiles=false`；rewind 失败则 `session/new` + bootstrap；父 agent id 与父 journal 不变。

4. **UI**（ConversationThread 测或 RTL）  
   助手有 fork，用户没有；streaming 没有。

## 11. 文档

- `docs/llm-wiki/session-continuity.md` 增加小节 **Agent-side fork（部分分叉）**：入口在助手气泡；截断 = 所属用户回合结束；子会话 fork+rewind；失败 bootstrap；父不动。
- `CHANGELOG.md` `[Unreleased]` Added：中英各一条。
- 本文件留在 `docs/plans/` 作实现依据。

## 12. Key Decisions

1. **仍新建侧栏会话，不做同会话答案树。** 现有 fork 模型 + 侧栏身份不变；兄弟变体是另一套 transcript schema。
2. **截断按用户回合，不按 assistant message id。** 与 ACP rewind 的 `targetPromptIndex` 对齐；典型一回合一个助手气泡。tool_step 留在该回合内。
3. **诚实记忆：子 fork 后 rewind，失败 bootstrap。** 禁止部分分叉后直接使用未裁剪的 `session/fork` 结果。
4. **部分分叉隐藏 CLI 勾选、有 id 则自动 fork。** 用户已选择「永远对齐截断」；勾选只会让人以为可以保留全量记忆。
5. **rewind 失败不硬删新会话。** journal 已经是用户要的截断副本；bootstrap 是诚实降级。
6. **不往 App.tsx 堆状态。** 复用 `useAppDialogs` 的 fork 对话框。

## 13. 主要改动文件

- `src/lib/session.ts` / `session.test.ts`
- `src/lib/sessionFork.ts` / `sessionFork.test.ts`
- `src/lib/api/session.ts`（若 DTO 暴露新字段）
- `src/components/lobe-chat/ConversationThread.tsx`
- `src/app/AppWorkbench.tsx`（换 handler / 隐藏勾选，不加新 state）
- `src/i18n/messages/*/session.ts`（15 locale）
- `src-tauri/src/store.rs`
- `src-tauri/src/session_manager/connect.rs`
- `src-tauri/src/commands/session_p1.rs`（仅当 command 文档需要）
- `docs/llm-wiki/session-continuity.md`
- `CHANGELOG.md`

## 14. Open Questions

无。产品入口、截断粒度、Agent 记忆、失败降级、测试面均已在 2026-08-20 对话中拍板。
