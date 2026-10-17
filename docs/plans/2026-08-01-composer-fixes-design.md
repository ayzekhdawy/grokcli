# 2026-08-01 Composer / 会话优化点设计

> 来源：`docs/8月1日优化点.md`  
> 分支 / worktree：`feat/aug1-composer-fixes`（from `main`）

## 背景

四项问题：

1. **输入框内变更 chip 占位** — 会话文件变动（`+a −d` / N files）与仓库脏状态（N 个变更）挤在 composer 底栏工具区。
2. **缺少 `@` 项目文件引用** — 需要与斜杠面板一致的浮层，支持当前项目目录模糊匹配。
3. **启动极卡** — Vite/Babel 对 `src/App.tsx`（~875KB / 24k 行）codegen 降级（500KB 上限）。
4. **历史会话用户附件不渲染** — 打开历史只见文本，图片/文件卡片丢失。

---

## 1. 变更 chip 上移到 context bar

### 现状

- `sessionChangesSummary` / `gitDirtySummary` 渲染在 composer 底栏（与模型、权限 chip 同行）。
- `composer__context-bar` 仅在「欢迎/新建会话 + 已绑定项目 + 非手机布局」时展示项目/分支菜单。

### 目标

- 两个变更 chip **移出**输入框底栏。
- **复用** `composer__context-bar` 容器（与项目选择同一行）。
- 容器在「无项目菜单且无 chip」时 **整行隐藏**（与截图批注一致）。

### 行为

| 场景 | context-bar |
|------|-------------|
| 新建会话 + 有项目 | 项目 + 分支 + 变更 chip（有则显示） |
| 已有会话 + 有项目 | 仅变更 chip（有则显示）；无项目选择（会话已绑定） |
| 无 chip 且非 welcome 项目行 | 隐藏整行 |
| 无活跃项目 | 无 git 脏 chip；会话 changes 仍可显示（会话级） |

点击行为保持：打开 Resources → Changes 面板（或 toast 路径）。

### 实现要点

- 抽出 `ComposerContextBar`（或在 App 内调整条件 + 移动 JSX）。
- 显示条件：

```ts
const showContextBar =
  !phoneLayout &&
  (
    (welcomeSession && activeProject) ||
    sessionChangesSummary ||
    gitDirtySummary
  );
```

- chip 使用 `composer__context-item` 风格或保留现有 `chip--changes` / `chip--git-dirty` 但放在 bar 内（CSS 微调对齐）。

---

## 2. `@` 文件选择面板

### 交互（对齐 slash）

| 项 | 行为 |
|----|------|
| 触发 | 光标前 `@` 在行首或空白后（非邮箱 `user@host`） |
| 查询 | `@` 后连续非空白字符；contenteditable rAF 轮询（同 slash） |
| 面板 | 复用 `menu-panel composer-plus` 视觉；浮在 composer 上方 |
| 数据 | `projectCodebaseSearch({ mode: "name", query })`；空 query 时列出最近文件 |
| 匹配 | Host 路径/文件名 contains；前端可再按 basename 模糊排序 |
| 键盘 | ↑↓ 选择，Enter 确认，Esc 关闭（签名 dismiss 同 slash） |
| 选中 | 吃掉 `@query` token；将文件加入 **attachments**（与 + 上传一致），发送时仍走 `buildAgentPrompt` 的 `@path` |
| 无项目 | 空态：提示先绑定项目 |
| 与 slash 互斥 | 同时只开一个；`/` 优先于 `@`（若冲突） |

### 模块

- `src/lib/atFileQuery.ts` — `detectAtQuery` / `detectAtQueryFromEditor` / 模糊排序
- `src/components/ComposerAtPanel.tsx` — 列表 UI
- Host：`project_codebase_search` 在 `mode=name` + 空 query 时 walk 列出文件（mtime 降序），不再 soft_fail `empty_query`
- i18n：`composer.at.*` keys

### 不做（YAGNI）

- `@folder/` 目录浏览二级页
- 跨项目索引
- 嵌入式 `@path` 内联 chip（v1 用附件条即可）

---

## 3. 启动卡顿

### 根因

- `App.tsx` ~875KB → `@babel/generator` deoptimise（日志可见）。
- 全量同步 import 重面板（Settings / ResourceViewer / Extensions…）。

### 策略

1. **转译**：Vite 换 `@vitejs/plugin-react-swc`（避开 Babel 500KB 上限，显著加速 dev transform；消除 App.tsx deopt 日志）。
2. **顺带**：把 journal → ChatMessage 映射抽到 `src/lib/mapStoredMessages.ts`，减小 App 重复逻辑（也服务 #4）。

完整拆分 24k 行 App / React.lazy 重面板不在本次硬性范围；SWC 是启动卡顿的主因修复。

---

## 4. 历史会话用户附件

### 根因（已确认）

`session_manager::send_message` 落盘用户消息时：

```rust
attachments: None,  // 永远为空
```

- 发给 agent 的 `text` 含 `buildAgentPrompt` 的 `@/abs/path` 行。
- Journal 的 `display_text` 是用户气泡原文（**不含**附件路径）。
- 重载时 `parseAttachmentsFromContent(content)` 从正文拆不出 `@path`，`m.attachments` 又为 null → UI 只剩文本。

### 修复

| 层 | 改动 |
|----|------|
| Host `session_send` | 增加可选 `attachments: Vec<MessageAttachmentStored>` |
| `send_message` | 写入 user journal 行的 `attachments` 字段 |
| FE `api.sessionSend` | 透传 attachments |
| FE `executeSend` / edit-resend | 传入 `att` |
| 映射 | `openSession` 已 merge；**同步修复** `session://index_changed` 映射路径（当前丢 attachments） |
| 测试 | Rust unit 或 FE 映射测试：stored attachments 在 reload 后出现 |

### 兼容

- 旧 journal 无 attachments：仍尝试 `parseAttachmentsFromContent`（若 agent 侧文本曾含 `@path` 可恢复）。
- 新写入双保险：structured attachments + agent text 仍带 `@path`。

---

## 验收

1. 有会话变更 / 仓库脏文件时，chip 在输入框**上方** context 行；输入框内无此 chip；全空时该行消失。
2. 绑定项目后输入 `@pack` 出现模糊列表；Enter 加入附件条；发送后 agent 收到 `@path`；重开会话用户气泡上方有卡片。
3. `npm run dev:ui` 启动不再出现 App.tsx Babel 500KB deopt 警告；首屏交互明显更顺。
4. 带图/文件发送 → 杀进程重开 → 历史会话附件正常。

## 风险

- SWC 与 Fast Refresh 边界 case：全量回归 `npm test` + typecheck。
- path_scope：`@` 搜索仅 trusted project（与 codebase search 一致）。
- 空 query 列目录：walk 有 cap（与现 search 一致），大仓库只展示前 N 个 mtime 文件。
