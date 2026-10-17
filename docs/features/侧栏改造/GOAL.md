# Goal 提示词 — 右侧侧栏改造（Codex 式 Side Workbench）

> 将下方 Goal 贴给新会话执行 Agent。  
> **硬规则：当前 Phase 验收未全部通过前，禁止进入下一 Phase，禁止宣称 Goal 完成。**  
> 规格：`PLAN.md` · 实施：`IMPLEMENTATION.md` · 需求：`request.md` · 截图：`image*.png`  
> 分支：`feature/sidebar-refactor`

---

## 使用方式

1. **整包启动**（推荐）：复制 **§ 总 Goal（编排）** 整段。  
2. **单 Phase 精执行**：复制对应 **§ Phase N 可复制 Goal**。  
3. **断点续跑**：`继续侧栏改造 Goal，已完成 Phase 0–K 验收，从 Phase K+1 起；先读 docs/features/侧栏改造/{PLAN,IMPLEMENTATION,GOAL,PROGRESS}.md`。  
4. 每 Phase 结束：更新 `PROGRESS.md`，列出证据（命令输出摘要 + 手动对照截图步骤）。

---

## Icon 指认（执行中禁止再错）

| 代号 | 形态 | 中文 |
|------|------|------|
| `open-with` | 方框斜箭头 + ▾ pill | 使用指定应用打开 |
| `env` | 三条横线带旋钮 `··\|·` | 环境（环境信息下拉） |
| `side` | 圆角竖分栏 | 显示/隐藏侧边栏 |
| `expand` | 四角外扩 | 侧栏扩展（借 chat） |
| `dock-btm` | 底边横线方框 | **不做** |

主窗口右上：

- **收起**：`open-with` · `env` · `side`  
- **打开**：`open-with` · `env`（`side`/`expand` 只在侧栏顶栏）

---

## 总 Goal（编排 · 可复制）

```text
/goal 在 Grok App 分支 feature/sidebar-refactor 上，按 docs/features/侧栏改造/ 的 PLAN.md + IMPLEMENTATION.md + 截图，将右侧改造成 Codex 式 Side Workbench：共用 Tab 条、空态/+ 选择器、主窗口右上仅 open-with/env/side（收起）且打开后 side/expand 在侧栏顶栏；完成 Phase 0→6 且每 Phase 验收通过后才进入下一 Phase；全量验收通过前不得宣称完成。

验证：
1. 每 Phase 开始前通读 PLAN.md、IMPLEMENTATION.md 对应章节与相关 image*.png。
2. 每 Phase 结束后运行：pnpm typecheck；相关 vitest（pnpm test，或至少改动模块的测试）；有意义时 pnpm lint。
3. 按本文件该 Phase「验收清单」逐项人工点选，对照截图布局（icon 顺序/开闭两态/禁止自造）。
4. 将结果写入 docs/features/侧栏改造/PROGRESS.md（Phase、改动文件、命令结果、手动证据）。
5. 未勾选完当前 Phase 验收项 → 不得开始下一 Phase，不得写「全部完成」。

约束：
1. 布局 100% 按截图复刻；仅去掉 dock-btm 与侧边聊天；禁止自造顶栏 icon 海。
2. open-with ≠ env：pill 是「使用指定应用打开」；··|· 是环境信息。禁止对调。
3. 全类型 tab 共用侧栏顶栏；Plan 仅过程创建；侧边聊天不做。
4. 终端：用户 $SHELL login shell，带入 rc（oh-my-zsh 等）；不造终端配置 UI。
5. 环境信息 P3 先展示+跳转；不做完整 git 写操作。
6. 用户文案全部 i18n（中英至少）；禁止 window.confirm/alert/prompt。
7. 遵守 Agents.md：不向 App.tsx 堆新大块 feature state；优先 src/components|hooks|lib|providers。
8. 不 force-push；不提交 secrets；不做无关重构。
9. 左会话列表不在范围。

边界：
- 可写：docs/features/侧栏改造/**、src/components/**（SideWorkbench/resource-viewer/相关）、src/hooks/**、src/lib/**（resourceTabs/layout/side*）、src/providers/**、src/i18n/**、src/styles/**、src/app/AppWorkbench.tsx（接线）、src-tauri 中终端/浏览器内核必需部分、相关测试。
- 禁止：无关产品线、替换整个设置体系、引入第二套 Agent 运行时、恢复顶栏 icon 海。

迭代策略：
- 严格 Phase 顺序 0→6；一次只做一个 Phase。
- 每完成可运行增量：对照截图自检 → typecheck/test → 更新 PROGRESS。
- 失败：先读日志/截图差，再改一处，重验；同一问题连失败 3 次仍无新证据则 Pause。
- 规格歧义：以 PLAN.md + 截图为准；不足先补文档再写码。

完成条件：
- Phase 0–6 验收清单全部勾选且 PROGRESS 有证据。
- 主窗口收起/打开两态右上角与 PLAN 一致。
- 文件/浏览器/终端/审阅/plan 行为符合 PLAN；Chat 带上下文打开可用。
- pnpm typecheck 通过；相关测试通过。

暂停条件：
- 需要产品拍板且 PLAN 未写死的交互。
- 终端/PTY/Chrome 内核下载依赖系统权限或外网不可用：交付可编译降级路径并 Pause 写明缺口。
- 发现密钥/token 可能进日志：立即停并修复。

开始：确认分支 feature/sidebar-refactor；读 PLAN/IMPLEMENTATION/GOAL；从 Phase 0 实施；汇报当前 Phase 与验收状态。
```

---

## Phase 0 — 壳 + 主窗口 chrome

### 验收清单（必须全部通过）

- [ ] 侧栏收起：主窗口右上 **仅** `open-with` · `env` · `side`（无 dock-btm，无 Tasks/Dashboard/文件等堆叠）
- [ ] 侧栏打开：主窗口右上 **仅** `open-with` · `env`；`side` 与 `expand` 在 **侧栏顶栏右侧**
- [ ] `side` 与 `⌥⌘B` 可显隐侧栏；tooltip 含显示/隐藏侧边栏语义
- [ ] 侧栏 min-width ≥ 400px
- [ ] `expand` 可借用 chat 区，再点还原
- [ ] 无 tab 时空态为垂直列表：文件、浏览器、终端；（git 时）审阅；**无**侧边聊天、**无** Plan
- [ ] `+` 与空态选择同源；选一项后出现对应类型 tab（文件/浏览器/终端/审阅至少可创建占位或真内容）
- [ ] 多 tab 时 `+` 在 tab 区右侧而非侧栏最右角；控制钮贴右
- [ ] tab 过多可横向滚动；被挡端有渐变（或可演示的等价实现，需在 PROGRESS 说明）
- [ ] 新增 UI 文案走 i18n
- [ ] `pnpm typecheck` 通过

### Phase 0 可复制 Goal

```text
/goal 完成侧栏改造 Phase 0：主窗口右上 chrome 按 PLAN 开/关两态（open-with、env、side；无 dock-btm）；侧栏壳含共用 Tab 条、+、expand、side、空态选择器（文件/浏览器/终端/git 时审阅）、min 400、⌥⌘B；未通过本 Phase 验收清单前不得进入 Phase 1。

验证：对照 docs/features/侧栏改造/PLAN.md §1 与 image-1/2/3/8；手动开/关侧栏看右上角；空态与 + 菜单；pnpm typecheck；写 PROGRESS.md Phase 0。
约束：icon 指认不得对调；禁止顶栏 icon 海；禁止侧边聊天与 Plan 入口；不扩写文件预览/终端真 PTY（可占位 tab）。
边界：SideWorkbench 壳、AppWorkbench 接线、i18n、样式、layout 状态；不碰无关模块。
迭代策略：先 chrome 两态，再空态/+ /tab 条；每步对照截图；验收全勾才停。
完成条件：GOAL.md Phase 0 验收清单全部勾选且 PROGRESS 有证据。
暂停条件：现有顶栏入口迁移策略需产品拍板时 Pause 并列出迁移表。
```

---

## Phase 1 — 文件工作台

### 验收清单

- [ ] 选择「文件」后进入文件工作台；共享 **一棵** 文件树
- [ ] 第 1 行 = 共用 tab 条；第 2 行 = breadcrumb + tree +「打开」▾（两行不合并）
- [ ] 点文件夹：折叠/展开；点文件：新建或聚焦 file tab；树不随 tab 复制
- [ ] 多文件 tab 切换只换预览区
- [ ] 树可用 icon 关闭；关闭后预览全宽；可再打开
- [ ] 文件 tab 与其它 kind 可同条顶栏混排（至少与浏览器占位/真 tab 之一）
- [ ] `pnpm typecheck` 通过；相关单测更新

### Phase 1 可复制 Goal

```text
/goal 完成侧栏改造 Phase 1：文件工作台对齐 image-5/6——共用 tab 条下两行 chrome、共享单树、多文件预览 tab、树可 icon 关闭；未通过验收不得进 Phase 2。

验证：对照 image-5/6；打开多文件切换预览；关树/开树；pnpm typecheck；PROGRESS Phase 1。
约束：禁止每个文件复制一套树容器；树开关不进主窗口顶栏。
边界：FilesWorkspace / resource-viewer 改造、resourceTabs、i18n。
迭代策略：先接树+单预览，再多 tab，再树折叠。
完成条件：Phase 1 验收清单全勾。
暂停条件：二进制/大文件预览既有限制可保留，须在 PROGRESS 注明。
```

---

## Phase 2 — 浏览器 + 终端

### 验收清单

- [ ] 浏览器 tab 可多开；`+`/选择器/（若已接）链接可打开
- [ ] 终端 tab 可多开
- [ ] 终端使用用户默认 `$SHELL`，login/interactive，cwd 合理（项目或 home）
- [ ] 能举证用户 shell 配置生效（如 zsh 下 `echo $SHELL`、常见别名/主题相关环境变量存在其一）
- [ ] 无自造终端主题配置 UI
- [ ] `pnpm typecheck` 通过

### Phase 2 可复制 Goal

```text
/goal 完成侧栏改造 Phase 2：浏览器与终端多 tab；终端为用户 $SHELL 的 login shell 并带入用户 rc；未通过验收不得进 Phase 3。

验证：多开浏览器与终端；终端内执行 echo $SHELL 与简单配置探测；pnpm typecheck；PROGRESS Phase 2。
约束：不造 oh-my-zsh 配置页；不限死单实例。
边界：EmbeddedBrowser、PTY/终端模块、tauri 如需、SideTab router。
迭代策略：先浏览器多实例，再 PTY；PTY 失败则 Pause 并保留占位+错误提示。
完成条件：Phase 2 验收清单全勾。
暂停条件：沙箱/权限无法 login shell 时 Pause 并写明平台限制与降级。
```

---

## Phase 3 — 审阅 + 环境信息

### 验收清单

- [ ] 审阅 tab 内层 UI 对齐 image-4 信息架构（范围下拉、统计、diff + 变更树）
- [ ] 非 git 项目：选择器无审阅；env 不提供审阅跳转
- [ ] git 项目：可选审阅；变更入口可打开/聚焦 review
- [ ] `env` 打开环境信息：标题 + 五行结构（变更/本地/分支/提交或推送/PR 检查）与 image-7 一致
- [ ] 点击变更等可带上下文打开侧栏 tab（展示向）；无强制实现 push/checkout
- [ ] 旧 changes 顶栏散落入口已收敛或移除（主窗口右上仍符合 PLAN）
- [ ] `pnpm typecheck` 通过

### Phase 3 可复制 Goal

```text
/goal 完成侧栏改造 Phase 3：ReviewTab 对齐 image-4；EnvInfoMenu 对齐 image-7（先展示+跳转）；git 门控审阅；收敛散落 changes 入口；未通过验收不得进 Phase 4。

验证：git/非 git 项目对照；env 五行；审阅范围切换与 diff；pnpm typecheck；PROGRESS Phase 3。
约束：不做完整 git 写操作；审阅内层工具条不与侧栏 expand/side 混成一行。
边界：ReviewTab、EnvInfoMenu、session changes、workspaceGit。
迭代策略：先 env 展示，再 review 壳，再接 diff 数据。
完成条件：Phase 3 验收清单全勾。
暂停条件：PR 检查 API 不可用时可展示「检查中/不可用」文案，须注明。
```

---

## Phase 4 — Plan 临时 tab

### 验收清单

- [ ] plan 流程可自动创建 `plan` tab 并出现在共用顶栏
- [ ] 空态与 `+` **永远没有** Plan 项
- [ ] 用户可关闭 plan tab；再次 plan 流程可再出现
- [ ] 不破坏现有 plan 批准/驳回主路径（或等价迁移后可完成一次流程）
- [ ] `pnpm typecheck` 通过

### Phase 4 可复制 Goal

```text
/goal 完成侧栏改造 Phase 4：Plan 仅为过程创建的临时 SideTab；选择器不可建；对接现有 plan 流程；未通过验收不得进 Phase 5。

验证：触发 plan 模式出现 tab；确认 +/空态无 Plan；关闭后再触发；pnpm typecheck；PROGRESS Phase 4。
约束：禁止任何手建 Plan 入口。
边界：PlanTab、plan chrome 接线、SidePicker 过滤。
完成条件：Phase 4 验收清单全勾。
暂停条件：plan 协议变更需规格更新时先改文档。
```

---

## Phase 5 — 浏览器内核设置

### 验收清单

- [ ] 设置中可选：系统浏览器内核（默认）/ Chrome 内核（下载或引导）
- [ ] 项已进 settingsCatalog；i18n 齐全
- [ ] 新开浏览器 tab 使用当前选择（至少有可观察差异或设置被读取的日志/状态）
- [ ] `pnpm typecheck` 通过

### Phase 5 可复制 Goal

```text
/goal 完成侧栏改造 Phase 5：设置内浏览器内核选择（默认系统，可 Chrome）；注册 settings IA 与 i18n；浏览器 tab 读取选择；未通过验收不得进 Phase 6。

验证：设置页切换；开浏览器 tab；pnpm typecheck；PROGRESS Phase 5。
约束：遵循 settings-ia.md；无硬编码用户文案。
边界：settings 相关组件、catalog、浏览器后端。
完成条件：Phase 5 验收清单全勾。
暂停条件：Chrome 内核下载需外网/权限失败时保留系统内核可用并 Pause 写明。
```

---

## Phase 6 — 上下文打开 + 总验收

### 验收清单

- [ ] Chat 点文件路径 → 开侧栏 file tab（共享树）
- [ ] Chat 点链接 → browser tab
- [ ] Chat 点更改记录 → review（git）
- [ ] 主窗口右上两态仍符合 PLAN（无 icon 海回归）
- [ ] 侧边聊天仍不存在
- [ ] Plan 仍不可手建
- [ ] `pnpm typecheck` 通过；`pnpm test` 通过（或失败用例与本需求无关并已说明）
- [ ] PROGRESS 记录 Phase 0–6 完成证据

### Phase 6 可复制 Goal

```text
/goal 完成侧栏改造 Phase 6：Chat 文件/链接/更改带上下文打开对应 SideTab；全 Phase 回归；主窗口 chrome 无回归；全部验收通过后才可宣称侧栏改造 Goal 完成。

验证：三条上下文路径手动走通；回归 Phase 0–5 关键项；pnpm typecheck && pnpm test；PROGRESS 总结。
约束：不新开范围；不恢复顶栏 icon 海。
边界：Chat 点击处理、openWithContext、收口清理。
完成条件：Phase 6 清单 + 总 Goal 完成条件全部满足。
暂停条件：历史消息节点点击协议不明时 Pause 并列复现路径。
```

---

## 全局反模式（任一 Phase 发现即修复再继续）

1. 把 `open-with` 做成环境信息，或把 `env` 做成打开应用  
2. 侧栏打开时主窗口仍显示 `side`  
3. `expand` 出现在主窗口  
4. `+` 贴在侧栏最右侧代替贴 tab  
5. 空态网格大图标  
6. 每个文件 tab 复制一棵树  
7. 选择器出现侧边聊天或 Plan  
8. 用户可见硬编码中英文  

---

## 断点续跑模板

```text
继续 docs/features/侧栏改造/GOAL.md。
已完成 Phase __ 验收（见 PROGRESS.md）。
从 Phase __ 开始；未达验收标准前不结束、不跳 Phase。
先读 PLAN.md / IMPLEMENTATION.md / GOAL.md 与截图。
```
