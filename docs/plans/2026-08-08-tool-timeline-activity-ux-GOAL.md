# Goal 规格 — 工具/命令时间线：具体内容 + 二级展开 + 三态一致

> **文档性质**：施工单一事实来源（Spec）+ 可复制启动 Goal + 验收合同  
> **状态**：工作树已开，待新会话执行  
> **分支**：`feat/tool-timeline-activity-ux`  
> **工作树**：`~/.grok/worktrees/grok-app/tool-timeline-activity-ux`  
> **基线**：`main` @ `2f0665d`（`docs(providers): document bare integer context_window (#538)`）  
> **交接全文**：同目录 `2026-08-08-tool-timeline-activity-ux-HANDOFF.md`  
> **调研来源**：主仓会话调研 + pi 只读联审（未改产品代码）

---

## 0. 决策锁定（不得擅自改）

| ID | 决策 | 默认 |
|----|------|------|
| D1 | 不改产品代码以外的范围蔓延 | 只做工具/命令时间线数据 + 展示统一 |
| D2 | 单一数据真相 | `MessageToolSegment`（含 `input`）；不新增第三套活动模型 |
| D3 | 单一展示抽象 | Phase 内步与裸 `TimelineToolRow` **同一套**一级文案 + 二级展开 |
| D4 | 三态布局已存在，只修内容一致 | **进行中**：时间线穿插展开；**结束后 / 历史**：头部「工作了 …」折叠，展开内容同源 |
| D5 | 一级标签禁 stdout | 一级只显示类型 + 具体调用参数（命令/路径/query）；输出进二级 |
| D6 | 双发射点同修 | `events.rs` **与** `events_bg.rs` 的 `session://tool` 都带 `input` |
| D7 | 归并不降级 | `upsertToolInSegments` + `compactMessageSegments` 对 `input` 与 path/title 同策略保底 |
| D8 | 虚拟化兼容 | 步级展开用 max-height + 内部滚动（或仅非虚拟化列表），**禁止**动态行高破坏 VirtualList |
| D9 | i18n | 新文案走 `createT` / `src/i18n`；无硬编码中英文 |
| D10 | 死代码 | `TurnActivityBlock` 无引用 → 删除或薄封装；`turnActivity.ts` 留给任务面板，不硬并聊天主路径 |
| D11 | App.tsx 冻结 | 不向 `App.tsx` 加 state/大块逻辑（见 Agents.md） |
| D12 | 非目标 | 不改 journal 格式、不改 host-vision/X、不默认历史自动展开、不做任务面板重写 |

---

## 1. Outcome（完成时必须为真）

1. **进行中**：工具/命令行显示**具体内容**（如 `运行命令 · ls …`、`读取文件 · SKILL.md`），不再只剩「工具 / 运行命令」。  
2. **有输出/详情时**可**二级展开**查看 tail（失败 hint + detail 尾部），phase 内外行为一致。  
3. **本轮结束**折叠到「工作了 {duration}」；展开后步骤文案与进行中终态一致。  
4. **加载历史**同一折叠形态；一级标签与直播完成时一致（同源 `input`）。  
5. 自动化：相关 unit tests 绿；`npx tsc -b` 与 eslint 不因本改动新增失败。

---

## 2. 问题对照（截图）

- 进行中一长串只有「工具」「运行命令」+ 底部「工作中 Ns」→ 用户以为卡死。  
- 需要：收集并展示具体信息；多的二级展开；三态表现一致。

---

## 3. 根因（已验证，执行时勿再发散调研）

| ID | 根因 | 位置 |
|----|------|------|
| A | Live `session://tool` **不发 `input`**，journal 完成却写 `input:` | `events.rs` emit；`events_bg.rs` emit 同缺 |
| B | TS 管线无 input | `ToolEventPayload` / `HostToolEvent` / `applyToolEvent` |
| C | Phase 行忽略 `step.summary`，只剩 i18n(bucket)+inputLabel | `TimelinePhaseBlock` `StepMainText` |
| D | Phase 内无二级展开 | `GrokActivityStepRow` vs `TimelineToolRow` |
| E | 归并抹 input | `upsertToolInSegments`、`compactMessageSegments` |
| F | `TurnActivityBlock` 死代码 | 不参与主路径 |

**补充**：`extract_tool_ui_fields` 会把 command 放进 `detail`，但一级标签链优先 `input`，bash 缺 input 时直接 shortLabel，故 detail 救不了空标签。

---

## 4. 分阶段实现（顺序强制）

### P0 — 数据通透（优先合入）

1. Rust：`events.rs` + `events_bg.rs` emit 增加 `"input": input2`（必要时 raw 再兜底 `extract_tool_input`）。  
2. TS：`ToolEventPayload`、`HostToolEvent` 加 `input?: string | null`。  
3. `applyToolEvent`：所有 `toolSegmentFromFields` / `nextRow` 写入 `input` / `toolInput`。  
4. `upsertToolInSegments` + `compactMessageSegments`：`input: next || prev`。  
5. 测试：start 带 input → status-only tick **不抹**；label 含具体片段。

### P1 — 展示统一

1. 抽 `resolveToolPrimaryLabel` / `toolExpandBody` 到 `src/lib/toolDisplay.ts`（或现有展示模块）。  
2. `StepMainText` 与 `TimelineToolRow` 同源 fallback：  
   `hostTitle → summarizeToolDisplay.summary → i18n(bucket)+pathBase → i18n(bucket)`。  
3. `GrokActivityStepRow` 增加二级展开（复用 `lobe-timeline-tool__*` 样式与 a11y）。  
4. 块级「工作了 …」折叠逻辑保持；不改用户 auto-collapse 偏好语义。

### P2 — 三态一致 + 清理

1. 回归：live 终态 label == reload history label（同一 fixture）。  
2. weave/reorder 后 `input` 不丢。  
3. 处理 `TurnActivityBlock` 死代码（删或薄封装）。  
4. 必要时补 `docs/llm-wiki` 一句（若已有 activity 文档则更新；无则可不新建 wiki，避免范围膨胀）。

---

## 5. 验收合同

| # | 验收项 | 如何证明 |
|---|--------|----------|
| V1 | 进行中 bash/read/MCP 等显示具体一级标签 | 单测 fixture + 可选手动一轮工具调用 |
| V2 | status-only 更新不抹 input | `session.test.ts` |
| V3 | phase 内可展开 detail tail | 组件/逻辑测或手测 |
| V4 | 结束后折叠头展开内容 = 进行中终态 | 单测或 chatUx fixture |
| V5 | 历史重载一级标签一致 | journal `input:` 路径 + 单测 |
| V6 | `tsc` / 相关 vitest 绿 | CI 本地命令 |
| V7 | 无硬编码用户可见中英 | i18n 检查 |

---

## 6. 关键文件地图

| 层 | 路径 |
|----|------|
| Emit | `src-tauri/src/session_manager/events.rs` |
| Emit bg | `src-tauri/src/session_manager/events_bg.rs` |
| Identity/input | `src-tauri/src/session_manager/types.rs`（`extract_tool_input` 等） |
| 事件应用 | `src/lib/session.ts`（`applyToolEvent`、`upsertToolInSegments`、`compactMessageSegments`） |
| Host 监听 | `src/hooks/useSessionHostEvents.ts` |
| 展示投影 | `src/lib/grokActivitySteps.ts`、`src/lib/toolDisplay.ts`、`src/lib/timelinePhases.ts` |
| UI | `src/components/lobe-chat/TimelinePhaseBlock.tsx`、`TimelineToolRow.tsx`、`ConversationThread.tsx` |
| 历史映射 | `src/lib/mapStoredMessages.ts` |
| 测试 | `src/lib/session.test.ts`、`src/lib/grokActivitySteps.test.ts`、`src/lib/chatUxFixtures.test.ts` |

---

## 7. 可复制启动 Goal（贴进新会话）

以下整块复制到**工作树路径**下的新 agent 会话：

```text
/goal

## Outcome
在 grok-app 工作树完成「工具/命令时间线」整改：进行中显示具体工具内容（非空「工具/运行命令」），支持二级展开详情；本轮结束后与加载历史均折叠到头部「工作了 …」，展开内容与进行中终态一致。

## Workspace（必须）
- 路径：~/.grok/worktrees/grok-app/tool-timeline-activity-ux
- 分支：feat/tool-timeline-activity-ux（基于 main @ 2f0665d）
- 规格：docs/plans/2026-08-08-tool-timeline-activity-ux-GOAL.md
- 交接：docs/plans/2026-08-08-tool-timeline-activity-ux-HANDOFF.md
- 先读：Agents.md、上述 GOAL/HANDOFF；不要重新大范围调研，按 P0→P1→P2 实施

## Verification（全部通过才算完成）
1. P0：session://tool 双路径（events.rs + events_bg.rs）带 input；applyToolEvent 写入；upsert/compact 不抹 input；单测证明 status-only 不降级
2. P1：一级文案同源函数；GrokActivityStepRow 可二级展开；VirtualList 不因展开破版
3. P2：live 终态与 history reload 一级标签一致的对账测试；TurnActivityBlock 死代码处理
4. npx tsc -b 通过；相关 vitest 通过；无 App.tsx 膨胀；无硬编码 UI 文案

## Constraints
- 严格按 GOAL 决策表 D1–D12；禁止范围蔓延
- 一级标签禁止塞 stdout；detail 仅二级
- i18n via createT；对话框规范见 docs/llm-wiki/dialogs.md
- 不改 journal 格式、不改 host-vision/X、不重写任务面板 turnActivity
- 提交信息完整句子；小步可审 PR；不要 force-push main

## Boundaries
- 不改 Remote IM / 设置 IA / 壁纸等无关模块
- 不引入 window.confirm / 原生 select
- 不把 TurnActivityBlock 重新接入主时间线作为第二套 UI

## Iteration
- 先 P0 测绿再 P1；P1 测绿再 P2
- 若 identity 无 input：允许 bucket 标签回退，并在 HANDOFF 进度区记录
- 卡住 >30 分钟写清阻塞到 PROGRESS，不要瞎重构

## Completion evidence
- 本分支 commits 列表
- 改动文件摘要（对照 GOAL §4）
- 测试命令与结果
- 可选：一张进行中 / 结束后截图或文字复现步骤
- 更新 HANDOFF「进度」节为 Done 或列出 residual

## Pause / block
- main 上已有冲突大改同一文件 → 暂停并报告
- CLI/ACP 根本不发 rawInput → 记录为 known limitation，仍完成管道与 UI 统一
```

---

## 8. 新会话操作清单（人类）

```bash
# 1) 进入工作树
cd ~/.grok/worktrees/grok-app/tool-timeline-activity-ux
git status -sb   # 应在 feat/tool-timeline-activity-ux

# 2) 用桌面 App / CLI 打开该目录为项目 cwd，新建会话
# 3) 粘贴上文 §7 Goal 整块执行
```

移除工作树（全部合完后，可选）：

```bash
cd /Users/ronglecat/Documents/self/tools/desktop-app/grok-app
git worktree remove ~/.grok/worktrees/grok-app/tool-timeline-activity-ux
# 或保留分支仅删目录后 git worktree prune
```
