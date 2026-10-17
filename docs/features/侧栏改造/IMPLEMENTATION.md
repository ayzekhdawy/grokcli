# 右侧侧栏改造 — 实施方案

> 规格：`PLAN.md` · 需求：`request.md` · 执行 Goal：`GOAL.md`  
> 分支：`feature/sidebar-refactor`  
> 规则：**未达当前 Phase 验收标准前不得进入下一 Phase，也不得宣称 Goal 完成。**

---

## 1. 背景与目标

### 现状问题

- 主窗口顶栏堆叠大量 icon，各自拨 `ResourceViewer` 的 `SideMode`（files / changes / plan / url…）。
- 浏览器、文件、变更、链接状态纠缠，缺少统一「侧栏工作台」抽象。

### 目标

对齐 Codex：**右侧 = Side Workbench（多类型共用 Tab 条）**。

- 主窗口右上只保留：`open-with` · `env` · `side`（收起时）；打开后 `side`/`expand` 在侧栏顶栏。
- 空态 / `+` 同源选择器（文件 / 浏览器 / 终端 / 条件审阅；无侧边聊天）。
- 带上下文打开；Plan 仅过程创建。

### 非目标

- 左侧会话列表改造  
- 侧边聊天  
- 底部面板（`dock-btm`）  
- 环境信息内完整 git 写操作（P3 只展示+跳转）  
- App 内自造终端主题 / oh-my-zsh 配置 UI  

---

## 2. 必读材料（执行前）

| 路径 | 用途 |
|------|------|
| `docs/features/侧栏改造/PLAN.md` | 布局与 icon 指认（已校正） |
| `docs/features/侧栏改造/request.md` | 原始需求 |
| `docs/features/侧栏改造/image*.png` | 视觉唯一真相 |
| `docs/llm-wiki/i18n.md` | 文案 |
| `docs/llm-wiki/dialogs.md` | 禁止 window.confirm 等 |
| `docs/llm-wiki/settings-ia.md` | 新设置项注册 |
| `Agents.md` | App.tsx 增长冻结等 |

### 关键现有代码（改造锚点）

| 区域 | 路径 |
|------|------|
| 主工作台 / 右栏开关 | `src/app/AppWorkbench.tsx`（aside 布局、顶栏 chrome） |
| 资源面板 | `src/components/resource-viewer/*`、`src/lib/resourceTabs.ts` |
| 内嵌浏览器 | `src/components/EmbeddedBrowser.tsx`、`HtmlBrowser.tsx` |
| 变更 / plan | `ResourceChangesList`、`PlanReviewPanel`、`SideMode` |
| 布局 | `src/lib/layout*`（aside 宽、collapsed） |
| i18n | `src/i18n/messages/*/workspace.ts`、`chat.ts` 等 |

**约束**：`Agents.md` — 不在 `App.tsx` 堆新 feature state；新状态进 `src/providers/` · `src/hooks/` · `src/components/` · `src/lib/`。

---

## 3. 目标架构

```
App chrome (chat 标题行右)
  OpenWithMenu          // open-with pill：使用指定应用打开
  EnvInfoMenu           // env icon：环境信息（image-7）
  SideToggle            // side：仅侧栏收起时出现在主窗口

SideWorkbench (右侧)
  SideTabBar            // tabs + plus + expand + side（打开时）
  SidePicker            // 空态 / + 同源
  SideTabRouter
    FilesWorkspace      // 共享树 + 多 file tab
    BrowserTab
    TerminalTab         // login shell
    ReviewTab
    PlanTab             // 临时，内部 create only
```

### 建议数据模型（示意）

```ts
type SideTabKind = "file" | "browser" | "terminal" | "review" | "plan";

type SideTab =
  | { id: string; kind: "file"; path: string; name: string }
  | { id: string; kind: "browser"; url?: string; title?: string }
  | { id: string; kind: "terminal"; sessionId: string; title?: string }
  | { id: string; kind: "review" }
  | { id: string; kind: "plan"; planRef?: string };

type SideWorkbenchState = {
  visible: boolean;       // 侧栏显隐
  expanded: boolean;      // expand 借 chat 区
  tabs: SideTab[];
  activeId: string | null;
  treeVisible: boolean;   // 文件树
  // files 共享树 root = 当前 project cwd
};
```

### 主窗口 chrome 可见性（硬规则）

| 侧栏 | 主窗口右上 |
|------|------------|
| 收起 | `open-with` · `env` · `side` |
| 打开 | `open-with` · `env` |

| 侧栏 | 侧栏顶栏右 |
|------|------------|
| 打开 | `expand` · `side`（`dock-btm` 不实现） |

---

## 4. Phase 实施细则

### Phase 0 — 壳 + 主窗口 chrome

**做：**

1. 抽出 `SideWorkbench` 壳（可先包现有 `ResourceViewer` 或空壳）。
2. 主窗口右上：**拆除** Tasks / Dashboard / 文件等与 Codex 不符的 icon 堆叠（本阶段至少保证 chat 主路径右上只剩三控件；若某入口必须保留，Pause 写清迁移到 env/侧栏的计划，不得静默留在右上）。
3. 实现 `open-with` pill（可先接现有「用系统/编辑器打开」能力；下拉项可最小可用）。
4. 实现 `env` 按钮位（本阶段可只占位 + 空面板或「即将接入」结构骨架，完整五行在 P3）。
5. `side` + `⌥⌘B`：收起时主窗口切换；打开后 `side` 仅在侧栏顶栏。
6. 侧栏 min-width 400；`expand` 切换 `expanded`。
7. 空态 `SidePicker`：文件 / 浏览器 / 终端 / 审阅(git)；无侧边聊天、无 Plan。
8. 共用 `SideTabBar`：`+` 同源菜单；tab 溢出横向滚动 + 端侧渐变。
9. i18n 全量新增 keys（中/英至少）。

**验收：** 见 `GOAL.md` Phase 0。

---

### Phase 1 — 文件工作台

**做：**

1. 从选择器开「文件」→ 进入文件工作台（共享树状态唯一）。
2. 第 1 行：共用 tab 条（file 名 tab + `+` + expand/side）。
3. 第 2 行：breadcrumb + `tree` + `file-open`「打开」▾。
4. 树：文件夹折叠；点文件 → 新建/聚焦 `file` tab；预览区切换，树不复制。
5. 树 icon 关闭 → 预览全宽；再开入口在面包屑 / 角上 folder。
6. 复用 `resource-viewer` 预览/编辑/保存能力，接到 SideTab 模型。

**验收：** 见 GOAL Phase 1。

---

### Phase 2 — 浏览器 + 终端

**做：**

1. `browser` tab 多开；复用 `EmbeddedBrowser`。
2. Chat 链接 / 选择器 / `+` 均可开浏览器 tab。
3. `terminal` tab 多开；PTY；`$SHELL` **login + interactive**（如 `zsh -l -i`）；cwd=项目或 `~`；验证 oh-my-zsh 类配置可加载（路径/别名存在即可举证）。
4. 无 App 内主题配置页。

**验收：** 见 GOAL Phase 2。

---

### Phase 3 — 审阅 + 环境信息

**做：**

1. `ReviewTab` 对齐 image-4 内层工具条与双栏 diff/树。
2. 收敛现有 changes 散落入口到 review。
3. 非 git：选择器与 env 内不展示审阅相关可点入口。
4. `EnvInfoMenu` 完整五行展示；点「变更」等 → openWithContext。
5. 不做 checkout/push 等写操作（可展示状态文案）。

**验收：** 见 GOAL Phase 3。

---

### Phase 4 — Plan 临时 tab

**做：**

1. `kind: "plan"`；仅 plan 流程 API 创建。
2. `SidePicker` / `+` 无 Plan 项。
3. 对接现有 plan chrome / `PlanReviewPanel` 数据。
4. 可关闭；再次 plan 流程可再创建。

**验收：** 见 GOAL Phase 4。

---

### Phase 5 — 浏览器内核设置

**做：**

1. 设置项：默认系统内核 / 可下载 Chrome 内核。
2. 注册 `settingsCatalog` + i18n。
3. 打开浏览器 tab 走所选内核。

**验收：** 见 GOAL Phase 5。

---

### Phase 6 — 上下文打开收口 + 全局验收

**做：**

1. Chat 文件路径 → file tab。  
2. Chat 链接 → browser tab。  
3. Chat 更改记录 → review。  
4. 主窗口右上无遗留功能 icon 海。  
5. 全 Phase 回归清单。

**验收：** 见 GOAL Phase 6（总完成条件）。

---

## 5. 技术注意

1. **App.tsx 冻结**：新 state 放 domain 模块；`AppWorkbench` 只接线。  
2. **i18n**：`createT` / `t()`；中英 keys。  
3. **对话框**：无 `window.confirm/alert/prompt`。  
4. **ResourceViewer 迁移**：优先「壳包旧实现 → 逐步拆 SideMode」，避免大爆炸。  
5. **测试**：`resourceTabs` 纯逻辑扩测；新 tab 模型单测；UI 以手动对照截图为主。  
6. **命令**（以 `package.json` 为准）：

```bash
pnpm typecheck
pnpm test
pnpm lint   # 若环境允许
```

---

## 6. 进度记录（执行 Agent 维护）

在 `docs/features/侧栏改造/PROGRESS.md` 追加（若无则创建）：

```md
## YYYY-MM-DD
- Phase: N
- Done: …
- Evidence: typecheck / 手动步骤
- Next: …
```

---

## 7. 文件交付清单（文档）

| 文件 | 角色 |
|------|------|
| `request.md` | 原始需求 |
| `PLAN.md` | 产品布局定稿 |
| `IMPLEMENTATION.md` | 本实施方案 |
| `GOAL.md` | 可复制 Goal + 分 Phase 验收 |
| `PROGRESS.md` | 执行进度（Agent 写） |
| `image*.png` | 视觉验收对照 |
