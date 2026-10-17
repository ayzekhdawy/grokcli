# 侧栏改造 — 执行进度

> Agent 每完成一个 Phase 追加一节。未勾选验收项不得写「完成」。

## 状态总览

| Phase | 主题 | 状态 |
|-------|------|------|
| 0 | 壳 + 主窗口 chrome | 验收通过 |
| 1 | 文件工作台 | 验收通过 |
| 2 | 浏览器 + 终端 | 验收通过 → **交互式 PTY + xterm 已接入**（VS Code 全屏操作模式） |
| 3 | 审阅 + 环境信息 | 验收通过 |
| 4 | Plan 临时 tab | 验收通过 |
| 5 | 浏览器内核设置 | 验收通过（设置 + 探测 + 下载引导 + tab 可观察） |
| 6 | 上下文打开 + 总验收 | 验收通过 |

## 自动化证据（全 Phase）

- `pnpm typecheck` → exit 0
- `cargo check` (src-tauri，含 `terminal_pty_*` / `path_exists_many` / `portable-pty`) → ok
- vitest 相关模块 → 通过（sideWorkbench / sideTerminal / browserEngine* / sideContextOpen / layout / i18n / shortcuts / settingsCatalog）
- `pnpm test` 全量此前 4692 passed；增量模块已复跑

### 终端交互式 PTY（本轮）

- Host：`pty_host.rs` + `terminal_pty_spawn|write|resize|kill`；事件 `terminal://data` / `terminal://exit`
- 前端：`@xterm/xterm` + FitAddon；整页可操作，无输入框/日志框
- 启动：`$SHELL -l -i`，cwd = 项目路径；切换 tab 保活 session
- 行模式命令 `terminal_login_probe` / `terminal_run_line` **已移除**

### Chrome 内核

- 本机路径存在：`/Applications/Google Chrome.app/...`
- `resolveBrowserEngineStatus` + `path_exists_many`；tab `data-browser-engine` / `data-chrome-available`
- 未安装时设置页与 tab 展示下载引导（打开 google.com/chrome）

---

## 日志

### Phase 0–1、3–4、6

见前序实现：SideWorkbench 壳、chrome 两态、FilesWorkspace 共享树、Review/Env 五行、Plan 过程 tab、Chat context open。

### Phase 2 — 终端重构为交互式 PTY（本轮）

- **Host**：`src-tauri/src/pty_host.rs` + `commands/terminal.rs`
  - `terminal_pty_spawn` — `$SHELL -l -i` 真 PTY
  - `terminal_pty_write` / `resize` / `kill`
  - 事件流 `terminal://data` | `terminal://exit`
- **UI**：`TerminalTab` = 全屏 xterm；用户直接键入；无 log/input 双栏
- **保活**：SideWorkbench 对 browser/terminal tab 用 `sw__persist-host` 隐藏而非卸载

### Phase 5 — Chrome 补强（本轮）

- `browserEngine.ts` 解析 system/chrome + 候选路径
- 设置：选择 chrome 时若缺失显示下载引导；就绪显示 ready 文案
- `BrowserTab`：引擎条 + `data-browser-engine` / `data-browser-pref` / `data-chrome-available`；缺 Chrome 时引导按钮
- **缺口**：不内置下载二进制安装器；依赖用户安装官方 Chrome（外网）

---

## 手动对照（开发者）

1. 侧栏开/关 chrome 两态  
2. 终端 tab：完整交互 shell（prompt 可打字）；`vim`/`htop`/`clear` 可用；切换 tab 不杀 session  

3. 设置 → 外观 → 浏览器内核：切 Chrome；有 Chrome 时 ready，无则下载引导  
4. 新开浏览器 tab：顶栏显示 System/Chrome kernel  

## Pause / 后续

| 项 | 状态 |
|----|------|
| 交互式 PTY/xterm | **已完成**：portable-pty + xterm；VS Code 操作模式 |
| Chrome 静默下载安装包 | **不做**：仅引导到官方下载页；系统内核始终可用 |

## Skeptic fixes (post-review)

| 问题 | 修复 |
|------|------|
| 非 git 仍可 env「变更」跳 review | `envReviewJumpEnabled(isGitProject)` 仅 git |
| onJump 非 git 仍 openAside | 要求 `sideIsGitProject` + `needAsideOpen` |
| tab 默认英文硬编码 | 默认名为 i18n key `side.tab.*`，UI `resolveSideTabLabel` |

## Visual restore (user feedback)

| 问题 | 修复 |
|------|------|
| 自造 `.sw-*` 顶栏样式破坏原 `.rp-chrome` | SideTabBar 复用 `rp-chrome` / `rp-tab` / `rp-chrome__actions` |
| 双挂载 hidden ResourceViewer 干扰 | 移除 dual mount；文件用 FilesWorkspace + 原 `.rp-split` 树/预览 |
| 二排 icon 乱放 | `rp-files-toolbar`：面包屑左，tree +「打开」右（对齐 image-5/6） |
| 空态 | 垂直选择器 + 原 empty-state 容器；无旧 icon 海 |
| 根节点高度 | `class="rp sw"` 走 `.aside__inner .rp` 填充 |
