# Grok App 会话 / 聊天 / 思考 / 工具展示 — 改造计划（重审执行版）

> **状态**：已完整实施（主工作区 grok-app · 2026-07-26）
> **依据**：[CodePilot 审查](../research/codepilot-session-chat-audit.md) · 本文件初版 · 最新 `main` 合入对照 · 工作树已修缺陷  
> **工作树**：`desktop-app/grok-app-wt`（`wt/latest-main`）  
> **原则**：学 CodePilot 的**模式**，不换栈；保留 Codex **直播单行工具** + Host FSM + journal + Lobe chat

---

## 0. 总目标（不变）

在现有架构上补齐三块体验：

| # | 目标 | 用户感受 |
|---|------|----------|
| 1 | **回合诚实收口** | 失败看得见、结束原因清楚、Stop 不假死 |
| 2 | **可回放的回合活动** | 历史不是「只有散文」，能复盘 Agent 干了啥 |
| 3 | **会话级 live 投影** | 切会话不断线感、状态可对账 |

一句话：**跑的时候干净，停下来能复盘，异常时不猜。**

---

## 1. 边界（硬约束）

### 1.1 必须保留

- Host 权威 `session_fsm`；前端只投影  
- Journal（`messages.json`）+ 节流；**不**迁 SQLite 消息全库  
- ACP / Grok Build；不接 Claude Agent SDK 直连  
- **直播**仍只显示一行 live tool（Codex 极简）  
- Lobe chat 视觉壳；i18n / 应用内 dialog  
- 新逻辑进 `src/lib/*` + 小组件，禁止继续堆 `App.tsx`

### 1.2 明确不做

| 不做 | 原因 |
|------|------|
| Electron / Next 换栈 | 已有 Tauri |
| SQLite 消息大迁移 | 与 resume/journal 冲突、成本高 |
| 历史成功工具逐条堆满屏 | 违背干净 transcript |
| 生成式 Widget / 批量出图 | 非主线 |
| RunCockpit 常态三 chip | 噪音；「有问题才提示」 |

### 1.3 从 CodePilot 攫取的模式 → 落点

| CodePilot 模式 | Grok 落点 |
|----------------|-----------|
| 回合活动 view-model | `TurnActivity` ← `tool_step` / `sessionTasks` 同源 |
| 失败可见 | transcript 错误行 + 摘要默认展开 |
| terminal reason | `EndOfTurnChip` 统一 cancel/stall/error |
| Stream snapshot | `SessionLiveStore`（投影，非第二 FSM） |
| interrupt force-abort | Stop 门闩 ≤2s |
| Thinking 摘要标签 | `extractThinkingSummary`（**已做**） |
| 相邻 thought 合并 / 假 phase | `compactMessageSegments` + Host 非空 body 才分相（**已做**） |
| Tool 注册表 + 上下文归组 | `toolDisplay` + TurnActivity 展开体内 |
| Diff 回合条 | 连 Changes 面板 |
| soft buffer | Markdown 纯文本路径 |
| pure reconcile | `sessionPhase.ts` + 单测 |

---

## 2. 现状盘点（重审）

### 2.1 最新 main 已有（与计划弱重叠）

| 能力 | 状态 | 与计划关系 |
|------|------|------------|
| `AgentTasksPanel` 侧栏任务 | ✅ 已有 | **可复用数据源**；不替代主对话摘要 |
| sessionTasks / tool_step 派生 | ✅ 已有 | B1 同源基础 |
| stream_stall / journal throttle | ✅ 已有 | A3 可在其上加门闩 |
| fork / rewind / changes / plan | ✅ 已有 | D1 Diff 条可挂 Changes |
| send queue / error deck | ✅ 已有 | 保持 |

### 2.2 工作树已落地（本次会话）

| ID | 内容 | 文件 |
|----|------|------|
| **T0-a** | 空 assistant 不再误开 thought phase | `session_manager.rs` |
| **T0-b** | `compactMessageSegments` 合并相邻 thought | `session.ts` |
| **T0-c** | legacy 重载不再「正文后 思考 2/3」 | `buildSegmentsFromLegacy` |
| **T0-d** | 去掉「思考 1/2/3」编号；摘要作折叠标题 | `thinkingSummary.ts` + `Thinking.tsx` + `ConversationThread` |

### 2.3 实施状态（当前）

A 诚实性、B TurnActivity、C LiveStore、D 打磨 — **已在主工作区落地**（含 T0）。

---

## 3. 改造方案总览

```
┌─────────────────────────────────────────────────────────────┐
│ Host (Rust)  session_fsm · tool · stall · stop · journal    │
└───────────────────────────┬─────────────────────────────────┘
                            │ events（权威）
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ SessionLiveStore + session reducers                         │
│  state / liveTool / terminalReason / streamingMessageId     │
│  applyToolEvent · applyStreamChunk · markers                │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
                ▼                             ▼
┌───────────────────────────┐   ┌─────────────────────────────┐
│ ConversationThread        │   │ AgentTasksPanel / Changes   │
│ · Thinking（摘要标签）    │   │ 同源 turnActivity / tasks   │
│ · LiveToolText（单行）    │   └─────────────────────────────┘
│ · TurnActivityBlock（新） │
│ · EndOfTurnChip（新）     │
│ · FailedToolRow（新）     │
└───────────────────────────┘
```

**产品规则（更新后 wiki 口径）**

| 场景 | 规则 |
|------|------|
| 直播工具 | 仅 running 一行，完成后消失 |
| 历史成功工具 | **不**逐条堆 transcript |
| 历史失败工具 | **必须**在主对话可见 |
| 回合结束 | 折叠「本回合活动 · N 步」；有 error 默认展开 |
| 思考标签 | 内容摘要 / 思考中… / 思考了 Ns；**禁止**思考 1/2/3 |
| 思考分段 | 仅正文后真实 resume 才新开块；相邻 thought 合并 |

---

## 4. 全部执行任务清单

状态：`done` · `todo` · `partial`

---

### Phase 0 — 思考卫生（前置债）

| ID | 任务 | 方案要点 | 状态 |
|----|------|----------|------|
| **T0.1** | Host：仅非空 assistant 切换 thought phase | `stream_last_was_assistant` 在 `text.trim()` 非空时才置 true | **done** |
| **T0.2** | 前端：相邻 thought 合并 | `compactMessageSegments`；`appendThought` 不在 thought 后因 `"new"` 再开块 | **done** |
| **T0.3** | Journal 重载：多 phase 不落在正文后 | `buildSegmentsFromLegacy` → 单 thought 块 + body | **done** |
| **T0.4** | 思考触发文案去编号、上摘要 | `extractThinkingSummary`；`Thinking` 优先 summary | **done** |
| **T0.5** | 单测 | session + thinkingSummary | **done** |
| **T0.6** | 提交工作树改动 / 开 PR | 尚未 commit | **done** |

---

### Phase A — 诚实性（P0）

#### 方案

> 用户最怕「挂了不知道、错了看不见、停不下来」。  
> 在 **不堆成功工具历史** 的前提下，让失败与终态成为主对话一等公民。

| ID | 任务 | 改造方案 | 触点 | 验收 | 状态 |
|----|------|----------|------|------|------|
| **A1** | 失败工具主对话可见 | `isToolStepMessage` 且 `isError`/failed → **不再 `return null`**；渲染轻量 `FailedToolRow`（红点 + 标题 + 可选 detail）；成功 tool_step 仍隐藏 | `ConversationThread` · `AgentActivity` · i18n | 失败刷新后仍见；8 次成功 Read 不堆行 | **done** |
| **A2** | 统一回合结束芯片 | 收敛 `turn_cancelled` / `stream_stall` / 部分 turn_error → `EndOfTurnChip`；`reason`: `user_stop` \| `agent_exit` \| `stall` \| `permission_denied` \| `error` | `session.ts` · `App.tsx` 事件 · `EndOfTurnChip.tsx` | Stop/stall/错误各一稳定文案、无双 banner | **done** |
| **A3** | Stop 门闩 | 用户 Stop 后 **T=2000ms** Host 未离开 busy → 前端 force 可发送 + EndOfTurn；核对 Host interrupt/kill 必达 | stop 路径 · 可选 `session://force_idle` | 人为挂起 interrupt 不锁死 composer；门闩单测 | **done** |
| **A4** | tool-only / 空助手回合 | 回合结束无正文但有 tool 活动 → 至少落 TurnActivity 或「完成 N 步」占位（不写假散文） | 回合完成路径 · 与 B2 可同 PR | 仅工具无正文的回合重开仍可见活动 | **done** |
| **A5** | 更新 wiki | `session-continuity.md`：失败例外 + EndOfTurn + 思考标签规则 | docs/llm-wiki | 与实现一致 | **done** |

**A 完成定义**：失败可复盘 · 结束原因统一 · Stop 可恢复 · wiki 已改。

---

### Phase B — 回合活动摘要（P0/P1）

#### 方案

> 直播保持 Codex 一行；**回合结束后**用折叠摘要回答「这轮干了啥」。  
> 数据与侧栏 `AgentTasksPanel` **同源**，禁止两套 `tool_step` 解析。

| ID | 任务 | 改造方案 | 触点 | 验收 | 状态 |
|----|------|----------|------|------|------|
| **B1** | `TurnActivity` view-model | `src/lib/turnActivity.ts`：按 last user 之后收集 tools；字段 id/name/kind/status/summary/isError；`modifiedPaths` 供 Diff；从 `sessionTasks` 抽取共享 collector | `turnActivity.ts` · 重构 `sessionTasks.ts` | 单测：归组阈值、errorCount、同源 | **done** |
| **B2** | `TurnActivityBlock` UI | 挂本回合末 assistant 下；默认折叠，**有 error 默认展开**；标题 `本回合活动 · {n} 步` / `· {e} 失败`；展开体工具列表；≥3 连续读类 → `Gathering context (N)`；**直播不替代** live 行（推荐回合结束后固化） | `lobe-chat/TurnActivityBlock.tsx` · `ConversationThread` | 多工具回合可见；成功不刷屏 | **done** |
| **B3** | 轻量 Tool 注册表 | `toolDisplay.ts`：kind → icon / shortLabel / summarize(path,detail,title)；覆盖 bash/read/edit/search/subagent/fallback | 摘要 + Tasks 面板共用 | 侧栏与摘要同标题逻辑 | **done** |
| **B4** | 思考摘要（产品完善） | 已实现 extract + 去编号；本项 = 回归与文案打磨（hover 时长、超长 ellipsis） | Thinking · CSS | 无「思考 N」；中英摘要可读 | **done** |
| **B5** | 对接 AgentTasksPanel | Panel 改为消费 `collectSessionTasks` / turnActivity 同一导出；删重复解析 | `AgentTasksPanel.tsx` | 改一处两边同步 | **done** |
| **B6** | wiki 活动规则 | session-continuity 写清直播/历史/失败/摘要四条 | docs | — | **done** |

**B 完成定义**：≥3 工具回合有折叠摘要；Tasks 与摘要同源；思考无编号。

---

### Phase C — 会话级 Live 投影（P1）

#### 方案

> 流从「当前视图副作用」变为 **按 sessionId 可订阅的投影**。  
> Host 仍是真相源；Store 只是 multi-session 缓存。

| ID | 任务 | 改造方案 | 触点 | 验收 | 状态 |
|----|------|----------|------|------|------|
| **C1** | `SessionLiveStore` | `Map<sessionId, Snapshot>`：state / streamingMessageId / liveTool / startedAt / terminalReason；事件 adapter 先写 store 再 render；切会话不 clear 其他 session | hooks 或 thin store · App 事件入口 | A 流式切 B 再回 A live 正确 | **done** |
| **C2** | pure 对账 `sessionPhase.ts` | 输入 Host SessionState + 本地门闩 + 最后事件时间 → composer 可否发 / quiet thinking / force idle；打开会话、visibility、Stop 超时调用 | lib + 单测 | stuck busy 用例绿 | **done** |
| **C3** | 侧栏 streaming 指示 | 非当前会话 `streaming \| awaiting_permission` 显示 busy/权限点 | 会话列表 · i18n · a11y | 他会话在跑可见 | **done** |
| **C4** | 从 App 抽事件族 | 按 PR 抽 tool/compact/marker/error/stall → store；**禁止**一次搬 10k 行 | App.tsx 减负 | 可量化行数下降 | **done** |

**C 完成定义**：切会话保真 · 对账可测 · 侧栏 busy · App 变薄。

---

### Phase D — 深度打磨（P1/P2，可裁）

| ID | 任务 | 改造方案 | 优先级 | 状态 |
|----|------|----------|--------|------|
| **D1** | 回合 Diff 条 | TurnActivity 下「修改了 N 个文件」→ 打开 ResourceViewer Changes | 高 | **done** |
| **D2** | 长任务 detail 尾部 | 摘要展开显示 `toolDetail` 最后 N 行（非全量 log） | 中 | **done** |
| **D3** | 纯文本 soft buffer | 首段约 40 词或 2.5s；代码围栏旁路 | 中 | **done** |
| **D4** | 双档静默文案 | 首 token 前/后不同 stall 提示 | 中 | **done** |
| **D5** | 长会话虚拟列表 | 接现有 VirtualList，测 stick | 中（有长会话数据再上） | deferred |
| **D6** | bootstrap normalizer | journal 回灌时工具摘要用 XML 风格标签，防 few-shot | 中 | deferred |
| **D7** | 发送前轻量 checkpoint | 仅阻塞态（无 CLI/无项目等）inline，非 modal；对齐 ErrorDeck | 中 | deferred |

---

## 5. PR 切片与依赖

```
T0.6 提交思考卫生 ──┐
                   ├──► A1 失败可见 ──► A2 EndOfTurn ──► A3 Stop 门闩
                   │                      │
                   │                      └──► A4 tool-only（可与 B2 合并）
                   │
                   └──► B1 view-model ──► B2 Block + B3 registry ──► B5 Panel 对齐
                                              │
                                              └──► D1 Diff 条

A/B 稳定后 ──► C1 Store ──► C2 对账 ──► C3 侧栏 ──► C4 抽 App

D2–D7 按需并行
```

| PR | 内容 | 可独立上线 |
|----|------|------------|
| **PR-0** | T0 思考卫生（已有 diff） | ✅ |
| **PR-1** | A1 失败工具可见 + i18n + wiki 补丁 | ✅ |
| **PR-2** | A2 EndOfTurnChip | ✅ |
| **PR-3** | A3 Stop 门闩 + 测 | ✅ |
| **PR-4** | B1+B2+B3 TurnActivity + 归组 | ✅ |
| **PR-5** | B5 Panel 同源 + B4 收尾 | ✅ |
| **PR-6** | C1–C3 LiveStore + 侧栏 | ✅ |
| **PR-7+** | D 系列 | 可选 |

---

## 6. 任务全表（扁平，便于排期）

| 序号 | ID | 阶段 | 任务一句话 | 状态 |
|------|-----|------|------------|------|
| 1 | T0.1 | 0 | Host 非空 body 才分 thought phase | done |
| 2 | T0.2 | 0 | 合并相邻 thought 段 | done |
| 3 | T0.3 | 0 | legacy 重载不挂尾思考 | done |
| 4 | T0.4 | 0 | 思考标签摘要化，禁编号 | done |
| 5 | T0.5 | 0 | 相关单测 | done |
| 6 | T0.6 | 0 | 提交 / PR | **done** |
| 7 | A1 | A | 失败 tool 主对话可见 | **done** |
| 8 | A2 | A | EndOfTurnChip 统一终态 | **done** |
| 9 | A3 | A | Stop 2s 门闩 | **done** |
| 10 | A4 | A | tool-only 回合可回放 | **done** |
| 11 | A5 | A | 更新 session-continuity wiki | **done** |
| 12 | B1 | B | TurnActivity view-model 同源 | **done** |
| 13 | B2 | B | TurnActivityBlock 折叠 UI | **done** |
| 14 | B3 | B | toolDisplay 注册表 | **done** |
| 15 | B4 | B | 思考摘要体验收尾 | **done** |
| 16 | B5 | B | AgentTasksPanel 同源 | **done** |
| 17 | B6 | B | wiki 活动规则 | **done** |
| 18 | C1 | C | SessionLiveStore | **done** |
| 19 | C2 | C | sessionPhase 对账 | **done** |
| 20 | C3 | C | 侧栏他会话 busy | **done** |
| 21 | C4 | C | App 事件族抽离 | **done** |
| 22 | D1 | D | 回合 Diff 条 → Changes | **done** |
| 23 | D2 | D | 工具 detail 尾输出 | **done** |
| 24 | D3 | D | 纯文本 soft buffer | **done** |
| 25 | D4 | D | 双档 stall 文案 | **done** |
| 26 | D5 | D | 虚拟列表（可选，未阻塞验收） | deferred |
| 27 | D6 | D | bootstrap normalizer（可选） | deferred |
| 28 | D7 | D | 发送前 checkpoint（可选） | deferred |

**统计**：ship-gate done 25 · deferred 3（D5–D7 可选）· todo 0

---

## 7. 目标体验（改造完成后）

### 直播中

```
[用户]

● 定位主项目目录…          ← 思考摘要，非「思考 1」
我来在工作区搜索…
  Listing files in …       ← 仅一行 live tool
```

### 回合结束后

```
[用户]

● 梳理项目结构…            ← 摘要 / 或 思考了 4.2s
助手正文…

▸ 本回合活动 · 6 步 · 1 失败   ← 有 error 默认展开
    Gathering context (3)
    Edit session.ts
    ✕ run_terminal_command
▸ 修改了 2 个文件              ← D1

— 已停止 · 用户取消 —          ← A2
```

---

## 8. Ship gate（必须全过才能称「主链路完成」）

1. 失败工具主对话可见（刷新仍在）  
2. 连续成功 Read **不**堆历史行  
3. ≥3 工具回合有可折叠活动摘要  
4. Stop 后 2s 内可再发送  
5. 切会话再回，streaming/live tool 正确  
6. 思考行 **无**「思考 1/2/3」；有摘要或时长  
7. 相关单测 + 一轮真实 agent smoke  

---

## 9. 建议开工顺序

1. **PR-0** 提交 T0（思考卫生）— 已有代码  
2. **PR-1 A1** 失败可见 — 最小 P0 用户价值  
3. **PR-4 B1+B2** 活动摘要 — 复盘主矛盾  
4. **PR-2/3** 终态 + Stop  
5. **C** 流投影  
6. **D** 按需  

---

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-26 | 初版改造计划 |
| 2026-07-26 | **重审执行版**：补 main 对照、T0 已做项、完整任务表与方案、PR 依赖 |


## 修订记录（实施）

| 日期 | 说明 |
|------|------|
| 2026-07-26 | 工作树完整实施 T0–D；vitest 68 + tsc 0 |
| 2026-07-26 | 同步 worktree 实现至主工作区 grok-app；wire reconcile；更新任务状态 |
| 2026-07-26 | D5–D7 列为 deferred（不在 goal ship-gate）；B4 标 done |
