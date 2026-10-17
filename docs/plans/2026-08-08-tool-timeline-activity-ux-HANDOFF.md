# 交接 — 工具/命令时间线活动 UX

> **给新会话**：先读本文件 + `2026-08-08-tool-timeline-activity-ux-GOAL.md`，再按 P0→P1→P2 改代码。  
> **状态**：Done（P0–P2 已落地 · 相关 vitest / tsc 绿）  
> **日期**：2026-08-08  
> **联审**：pi 只读审查（同意根因 A–F，并指出 events_bg / compact 第二缺口）

---

## 1. 工作树与分支

| 项 | 值 |
|----|-----|
| 主仓 | `/Users/ronglecat/Documents/self/tools/desktop-app/grok-app` |
| 工作树 | `~/.grok/worktrees/grok-app/tool-timeline-activity-ux` |
| 分支 | `feat/tool-timeline-activity-ux` |
| 起点 | `main` @ `2f0665d` |
| 创建命令 | `git worktree add -b feat/tool-timeline-activity-ux ~/.grok/worktrees/grok-app/tool-timeline-activity-ux main` |

**注意**：主仓 `main` 上可能有其它未提交改动；本工作树与主仓工作区隔离，实施请**只在本工作树**进行。

---

## 2. 用户诉求（原话压缩）

1. 进行中工具/命令不能只有「工具」「运行命令」——要具体内容与进度，避免像卡死。  
2. 信息合理展示；内容多则**二级展开**。  
3. **三态一致**：  
   - **进行中**：按时间线正常穿插排列  
   - **一轮结束**：整理到**头部折叠**  
   - **加载历史**：与结束后相同头部折叠  
4. 若实现不一致 → **统一抽象**一次。  
5. 先调研不改 → 现已交执行。

---

## 3. 架构快照（实现者只需记住）

```
ACP ToolCall
  → session_manager (remember_tool_identity + extract_tool_input)
  → emit session://tool { title, kind, status, path, detail, ❌input 缺失 }
  → applyToolEvent → ChatMessage tool_step + assistant.segments[].tool
  → buildTimelineUnits (timelinePhases.ts)
  → TimelinePhaseBlock
       live: GrokActivitySteps 展开 + 「工作中 …」
       done: 「工作了 …」折叠 → 同 Steps
  → GrokActivityStepRow：一级文案无 input 时 = 仅 i18n(bucket)
```

历史：

```
journal tool_step|status|kind|title\ninput:…\ndetail\npath
  → mapStoredMessages / weaveToolsIntoAssistantSegments
  → 同上 TimelinePhaseBlock（有 input 时标签更好）
```

**布局三态已基本正确**；坏在 **live 丢 input** + **phase 行无二级展开** + **文案链与 TimelineToolRow 不完全同源**。

---

## 4. 根因清单（pi 已确认）

### A. Live emit 丢 input（双路径）

- `src-tauri/src/session_manager/events.rs`：`input2` 已 resolve，journal 写 `input:`，**emit 无 input**  
- `src-tauri/src/session_manager/events_bg.rs`：**同样**  
- `extract_tool_input`：`types.rs`，从 rawInput 取 target_file/command/query/url…

### B. 前端不吃 input

- `ToolEventPayload`（`session.ts`）  
- `HostToolEvent`（`useSessionHostEvents.ts`）  
- `applyToolEvent` 构造 segment 未传 `input`

### C. 一级文案

- `TimelinePhaseBlock` `StepMainText` tool：`hostTitle || tr(toolLabelKeyFor) + inputLabel|pathBase`  
- **不用** `step.summary`  
- zh：`chat.tool.bash`=运行命令，`chat.tool.generic`=工具

### D. 无步级展开

- `GrokActivityStepRow` 单行  
- `TimelineToolRow` 有 `toolExpandBody` / detailTail，但 **phase 内不用**

### E. 归并抹 input

- `upsertToolInSegments`：`...tool` 里 `input: undefined` 覆盖 prev  
- `compactMessageSegments`：**同款**，只修 upsert 不够

### F. 死代码

- `TurnActivityBlock.tsx` 无引用  
- `turnActivity.ts` → 任务面板，勿强行并进聊天

### 其它

- bash：`extract_tool_ui_fields` 可把 command 放进 **detail**，但 `summarizeToolDisplay` 在缺 input 时对 bash 直接 shortLabel → 仍显示「运行命令」  
- VoiceOverlay 也走 `applyToolEvent`，修 apply 一并覆盖

---

## 5. 推荐统一抽象（执行时照此收敛）

**数据**：`MessageToolSegment.input` = 调用参数；`detail` = 进度/输出。  

**展示**：一套 `ToolStepRow` 语义（可抽函数而不必强行大重构组件）：

1. `resolveToolPrimaryLabel(seg, tr)`  
2. `toolExpandBody(seg)`（从 TimelineToolRow 上提）  
3. Phase 内外共用  

**外壳**：

- 进行中 / 结束 / 历史：继续 `TimelinePhaseBlock`（勿再发明 TurnActivity 第二轨）

---

## 6. 实施顺序与验收

见 GOAL §4 / §5。强制 **P0 → P1 → P2**。

最小闭环（P0）即可显著改善「像卡死」：用户立刻看到「运行命令 · …」。

---

## 7. 测试与命令

```bash
cd ~/.grok/worktrees/grok-app/tool-timeline-activity-ux

# 前端类型
npx tsc -b

# 聚焦测试（实施时按改动增补）
npx vitest run src/lib/session.test.ts src/lib/grokActivitySteps.test.ts src/lib/toolDisplay.test.ts src/lib/chatUxFixtures.test.ts

# Rust（若改 emit）
cargo test -p grok-app --lib extract_tool_input 2>/dev/null || cargo test extract_tool_input
# 或整包 check
cargo check
```

现有相关测试线索：

- `grokActivitySteps.test.ts`：有 input 时 `inputLabel` 含文件名/命令  
- `session.test.ts`：`parseToolStepContent` 读 `input:`  
- `chatUxFixtures.test.ts`：timeline + applyToolEvent

**应新增**：

1. `applyToolEvent` 带 input → 后续 status-only 仍保留 input  
2. compact/upsert 不抹 input  
3. （P2）同一 fixture：live 终态 primary label == journal reload

---

## 8. 进度（新会话维护）

| 阶段 | 状态 | 备注 |
|------|------|------|
| 调研 | Done | 主会话 + pi |
| 工作树 | Done | `feat/tool-timeline-activity-ux` |
| GOAL/HANDOFF | Done | 本目录 |
| P0 数据 | Done | 双路径 emit `input`；apply/upsert/compact 保底；status-only 单测 |
| P1 展示 | Done | `resolveToolPrimaryLabel` / `toolExpandBody` 同源；phase 二级展开；展开时退 VirtualList |
| P2 一致+清理 | Done | live vs journal 一级标签对账；删除死代码 `TurnActivityBlock` |
| PR | Pending | 分支就绪，待开 PR |

**Residual / 已知限制**：

- start 通知 sparse 且无 rawInput → 仍可能仅 bucket 标签（可接受回退；管道与 UI 统一已完成）  
- VirtualList：有步展开时整表退回非虚拟 map；父级持有 `expandedKeys` + `userToggledKeys`（remount 不抹；running→finished 在 !userToggled 时仍 autoCollapse）；expand body 用 max-height 内部滚动

---

## 9. 提交建议

- `fix(session): pass tool input on live session://tool events`  
- `fix(chat): preserve tool input across segment upsert/compact`  
- `feat(chat): unify tool step labels and expand body in activity rail`  
- `test(chat): tool timeline input and history parity`

小步、可审；中文或英文完整句子 commit 均可，与仓库近期风格一致即可。

---

## 10. 启动 Goal 短链

完整可复制块见：

`docs/plans/2026-08-08-tool-timeline-activity-ux-GOAL.md` → **§7**

人类操作：

```bash
cd ~/.grok/worktrees/grok-app/tool-timeline-activity-ux
# 打开新会话，粘贴 GOAL §7
```
