# Grok App 代码质量全盘整改 — 规格 + 执行 Goal

> **文档性质**：整改规格（单一事实来源）+ 可复制启动 Goal + 机器验收闸门  
> **诊断来源**：2026-08-01 全库 code-review 诊断（对照 `docs/plans/2026-07-26-开源诊断与整改交接.md`）  
> **执行方式**：**一个 Goal 跑完全程**；Wave / Work Package 由 Agent **自动续接**，禁止「做完一阶段就停下来等用户」  
> **完成铁律**：**`python3 scripts/check-code-quality-gates.py --mode final` 必须 PASS**，否则 **禁止** 宣称整改完成、禁止写 `FINAL: PASS`  
> **行为铁律**：**不改变已开发产品功能语义**；重构以搬迁/拆分为主，禁止顺手改交互、默认值、协议

---

## 0. 给执行 Agent 的总控（先读完再动代码）

### 0.1 你的任务是什么

在 **不破坏现有产品行为** 的前提下，完成架构级代码质量整改，使仓库从「God Component + 巨型 commands/CSS」变为可维护结构，并用 **机器闸门** 证明达标。

### 0.2 你必须自动续接

| 规则 | 说明 |
|------|------|
| **禁止阶段停顿** | 完成 WP-A1 后 **立刻** 开始 WP-A2，不要输出「请用户确认是否继续」 |
| **禁止假完成** | Wave A 绿了不够；必须一路做到 `final` 绿 |
| **中断恢复** | 若会话中断：读 `docs/plans/CODE-QUALITY-PROGRESS.md`，从第一个 `PENDING` WP 继续，**不要重做已 PASS 的 WP** |
| **进度账本** | 每完成一个 WP：更新 `CODE-QUALITY-PROGRESS.md`（状态 / metrics / 证据） |
| **提交纪律** | 每个 WP **至少一个** 逻辑清晰的 git commit（message 带 WP id，如 `refactor(wp-b1): extract ThemeProvider`） |
| **发现新问题** | 记入 Progress「Blockers / 新增发现」，**不**擅自扩大为产品功能开发 |

### 0.3 必读材料（按顺序）

1. 本文全文  
2. `docs/plans/CODE-QUALITY-PROGRESS.md`  
3. `AGENTS.md` + `docs/llm-wiki/`（i18n / dialogs / settings-ia）  
4. `scripts/check-code-quality-gates.py`（闸门定义即验收合同）  
5. 动手前对将改文件 `git blame`/通读相关域，**禁止盲删**

### 0.4 全局质量闸（每个 WP 结束都要跑）

```bash
pnpm typecheck
pnpm test
cd src-tauri && cargo test
# 当前 Wave 对应 mode：
python3 scripts/check-code-quality-gates.py --mode wave-a   # 完成 A 后
python3 scripts/check-code-quality-gates.py --mode wave-b   # 完成 B 后
python3 scripts/check-code-quality-gates.py --mode wave-c   # 完成 C 后
python3 scripts/check-code-quality-gates.py --mode final    # 全部完成时 — 唯一放行
```

**任一命令非零退出 → 当前 WP 未完成，禁止进入下一 WP（可在同 WP 内继续修）。**

Rust 相关 WP 额外：`cargo clippy --all-targets -- -D warnings` 在 CI 接入后不得引入新失败（允许先修存量使 clippy 可过，或分批 `allow` 仅限历史债且须在 Completion 文档列出）。

### 0.5 硬约束（红线）

1. **功能语义冻结**：发消息、续会话、权限/AskUser、设置项读写、Provider、Remote IM、Mirror、Voice 的用户可见行为不得故意改变。  
2. **禁止** `window.confirm` / `alert` / `prompt`。  
3. **禁止** 用户文案硬编码；走 `src/i18n/messages.ts` + `zh-tw.ts`。  
4. **禁止** 提交 secrets、`auth.json`、本地 agent home。  
5. **禁止** force-push、`git reset --hard` 丢别人的 WIP。  
6. **禁止** 为了过闸而造假：空实现、删测试、把阈值改松（改闸门脚本阈值 = 作弊 = 失败）。  
7. **禁止** 大爆炸重写 ACP / 换状态库全家桶（若引入 zustand/jotai 等，仅限新提取域且须说明；默认优先 React context + hooks，降低行为漂移）。  
8. **公开 API 稳定**：`api.sessionSend` 等导出名字、Rust `#[tauri::command]` 名、事件名尽量不变；内部搬家可以。  
9. **单文件再增胖**：整改期间 `App.tsx` 行数 **只降不升**（相对 WP 开始时）；新功能代码不得塞回 App。

### 0.6 暂停条件（唯一允许停下来问人的情况）

- 发现 **安全漏洞利用链** 需要产品策略选择（例如默认暴露面）且规格未写清  
- 继续改会导致 **用户数据损坏** 且无迁移方案  
- 外部环境缺失导致无法跑 `cargo test` / `pnpm test`（工具链坏了）  
- **不要**因为「Wave 做完了」暂停；**不要**因为「改动很大想让用户看一眼」暂停

---

## 1. 问题基线（整改对象）

| 热点 | 基线（2026-08-01） | 终态闸门（final） |
|------|-------------------|-------------------|
| `src/App.tsx` | ~24843 行 / useState ~318 / useEffect ~111 | **≤6000 行 / useState ≤100 / useEffect ≤50** |
| `src/styles/app.css` | ~30585 行 | 最大单 CSS（非 tailwind）**≤10000**；域 CSS 文件 **≥6** |
| `src-tauri/src/commands.rs` | ~11622 行 / 253 commands | **`commands/` 目录**；facade ≤800；单模块 ≤2000 |
| `session_manager.rs` | ~7691 行 | **`session_manager/` 目录**；facade ≤2500 |
| `src/lib/api.ts` | ~4947 行 | **`api/` ≥4 模块**；facade ≤600 |
| `SettingsPage` props | ~180 | **≤40** |
| 死代码 | `chat/ConversationThread` 无引用；`SlashPalette` 无引用 | **删除或接线** |
| CI | 无 clippy/fmt/eslint/质量闸 | **全有** |
| Excel HTML | `dangerouslySetInnerHTML` 未消毒 | **安全** |
| 定时器 | setTimeout 77 / clearTimeout 17 | **clear ≥ 50% set** |
| ≥1000 行文件数 | ~53 | **≤45** |

诊断细节见会话内 code-review 报告；7/26 文档中 **已修复** 的 SEC-01/02/03/10 等 **不要重做**，除非回归。

---

## 2. 成功定义（Outcome）

**Outcome（一句话）**  
Grok App 在 **行为不变** 的前提下完成结构整改：前端编排可分域维护、Host 命令与 session 核心可分模块导航、样式与 API 可按域打开；并且 **`check-code-quality-gates.py --mode final` PASS** + 标准测试全绿 + 完成交接文档。

**Done 的唯一法律**  
同时满足：

1. `python3 scripts/check-code-quality-gates.py --mode final` → exit 0  
2. `pnpm typecheck && pnpm test` → exit 0  
3. `cd src-tauri && cargo test` → exit 0  
4. `docs/plans/CODE-QUALITY-PROGRESS.md` 含 `FINAL: PASS`  
5. `docs/plans/CODE-QUALITY-COMPLETION.md` 存在且含冒烟矩阵与残留债清单  

缺一则 **未完成**。

---

## 3. Work Package 详规（按顺序自动执行）

> 每个 WP：**目标 / 步骤 / 验收 / 禁止**。验收不过不准进下一个。

---

### Wave A — 止损与工程闸门

#### WP-A0 · Bootstrap

**目标**：账本与基线就绪。  

**步骤**：

1. 填写 `CODE-QUALITY-PROGRESS.md` 的 Started / 当前 WP。  
2. 运行并记录：  
   `python3 scripts/check-code-quality-gates.py --mode baseline --json`  
   （baseline 应 PASS；若 `NO_WINDOW_DIALOGS` 失败则先修。）  
3. 把 metrics 追加到 Progress 表。  

**验收**：Progress 已更新；baseline 模式 PASS。  

---

#### WP-A1 · 死代码清理

**目标**：消灭双轨/孤儿组件歧义。  

**步骤**：

1. `src/components/chat/ConversationThread.tsx`：确认零引用后 **删除**（或整个空 `chat/` 目录）。现行线程保持 `lobe-chat`。  
2. `SlashPalette.tsx`：二选一（优先 **接线** 到 App 的 slash UI，删掉 App 内重复大段；若接线风险过高则 **删除组件** 并在 Completion 记「仍内联」——但闸门要求「无孤儿」，删除即可过闸）。  
3. 全库搜 `chat/ConversationThread`、`SlashPalette` 确保无断引用。  

**验收**：

- `python3 scripts/check-code-quality-gates.py --mode wave-a` 中 `DEAD_CHAT_THREAD`、`ORPHAN_SLASH_PALETTE` 相关在 A 全完成后最终要绿（可与 A 内其他 WP 一起绿）。  
- typecheck + test 绿。  

**禁止**：重写 lobe-chat 渲染逻辑。  

---

#### WP-A2 · Office HTML / xlsx 风险

**目标**：消除 Excel 预览 XSS 面。  

**步骤**：

1. `OfficeDocumentPreview.tsx`：对 `sheet_to_html` 结果 **消毒** 后再 `dangerouslySetInnerHTML`，或改为不走 raw HTML 的表格渲染。  
2. 若保留 `xlsx`：在 Completion 文档写明残留 CVE 与缓解；更优：替换为维护中的 fork / 其他解析库（若替换成本过高可留依赖但 **必须** HTML 安全）。  

**验收**：`OFFICE_HTML_SAFE` 在 wave-a 绿。  

---

#### WP-A3 · ESLint + CI 闸门

**目标**：防止质量回潮。  

**步骤**：

1. 增加根目录 `eslint.config.js`（或 mjs）：最小规则集即可（推荐：禁止 `window.confirm/alert/prompt`、`no-unused` 与项目现状兼容；**不要**一次开到无法通过）。  
2. `package.json` 增加 `"lint": "eslint src --max-warnings 0"`（若初置必须允许 warnings，须在 wave-a 内把 **新增文件** 清洁；存量可用逐步收紧，但 final 前 lint 脚本应可在 CI 跑通——若存量太大，CI 可先 `eslint` 关键路径，须在 Completion 写明）。  
3. 修改 `.github/workflows/ci.yml`：  
   - `cargo fmt --check`  
   - `cargo clippy`（至少 `--all-targets`；warnings 策略：优先零新增，终态尽量 `-D warnings` 或与仓库可过的等价物）  
   - `python3 scripts/check-code-quality-gates.py --mode wave-a`（CI 在 final 落地前可先跑 wave-a；**final 合并本整改分支前**改为 `final` 或增加 job）  
4. 保证本地 `pnpm typecheck && pnpm test` 仍绿。  

**验收**：`CI_CLIPPY`、`CI_FMT`、`GATE_SCRIPT_IN_CI`、`ESLINT_PRESENT` PASS。  

---

#### WP-A4 · App 增胖冻结

**目标**：后续只减不增。  

**步骤**：

1. 在 `AGENTS.md` 或 `docs/llm-wiki/maintain.md` 增加一条：**新功能不得向 `App.tsx` 新增 useState；必须进入域模块**。  
2. Progress 注明 freeze 基线行数。  

**验收**：文档已写；`APP_NO_GROW` 逻辑满足。  

**Wave A 总验收**：

```bash
python3 scripts/check-code-quality-gates.py --mode wave-a
pnpm typecheck && pnpm test
cd src-tauri && cargo test
```

全绿 → Progress 标记 Wave A PASS → **立即**进入 Wave B（无需用户）。

---

### Wave B — 前端编排拆解（最大杠杆）

> 原则：**垂直切片**。一次搬一个域；搬完编译测试绿再搬下一个。  
> 优先 **搬 state + effects + handlers**，App 只留组合。

#### WP-B1 · Theme / Skin / Wallpaper Provider

**目标**：主题相关 useState/effect 离开 App。  

**步骤**：

1. 新建 `src/providers/ThemeProvider.tsx` 或 `src/hooks/useThemeShell.ts`（闸门认这些路径）。  
2. 迁入：themePreference、systemTheme、schedule、skin、wallpaper*、相关 localStorage 同步。  
3. App 仅消费 context/hook。  

**验收**：typecheck/test 绿；主题切换/壁纸相关行为手动推理无回归；文件存在以满足 `THEME_PROVIDER`。  

---

#### WP-B2 · Composer 域

**目标**：slash / @ / draft / attachments / model·effort·policy 控件状态外移。  

**步骤**：

1. 新建 `ComposerShell.tsx` 和/或 `useComposerController.ts`。  
2. 迁入 composer 状态机与面板开关；保留 `onSend` 与 session 的清晰边界。  
3. App 内联 slash UI 尽量变薄。  

**验收**：`COMPOSER_SHELL` 路径存在；发送/附件/斜杠关键路径逻辑不丢（辅以现有 lib 单测 + 代码审阅）。  

---

#### WP-B3 · Session runtime

**目标**：messages / liveMap / session snapshot / stop latch / send queue 协作外移。  

**步骤**：

1. 新建 `src/hooks/useSessionRuntime.ts`（或 `src/state/session/`）。  
2. 迁入与 Host 事件、session 列表焦点相关的核心状态。  
3. **不要**改变 `api.sessionSend` 契约。  

**验收**：session 单测仍绿；App 行数与 useState 明显下降。  

---

#### WP-B4 · Settings 去 props 瀑布

**目标**：SettingsPage 解构 props ≤80（B 闸）最终 ≤40（C/final）。  

**步骤**：

1. 引入 `SettingsContext` 或 `useSettingsModel()`，把「设置项值 + setter」从 App 下沉。  
2. `SettingsPage` 只接收 routing 级 props：`section` / `tab` / `onBack` / `locale` 等少量。  
3. 保持 `settingsCatalog` 为搜索登记 SoT（见 llm-wiki settings-ia）。  

**验收**：`settings_page_prop_count` 达波次阈值。  

---

#### WP-B5 · Dialog / Modal host

**目标**：session notes/rules/sysprompt/rewind/fork 等成堆 modal 状态离开 App 主路径。  

**步骤**：

1. `DialogHost` 或 `useAppDialogs`：集中 `appDialog` 与各业务 confirm。  
2. 继续只用 in-app dialog，禁止原生弹窗。  

**验收**：行为不变；App 更瘦。  

---

#### WP-B6 · CSS 域拆分（第一刀）

**目标**：≥4 个域 CSS 文件；最大 CSS ≤18000。  

**步骤**：

1. 在 `src/styles/` 增加例如：`chat.css` `composer.css` `sidebar.css` `settings.css` `modals.css` `phone.css`（名称需被闸门计数，见脚本 `style_domain_files`）。  
2. 从 `app.css` **剪切**对应块到域文件；在入口（`main.tsx` 或 `app.css` `@import`）装配。  
3. **禁止**改 class 名（避免视觉回归）；只搬规则。  
4. 新硬编码色优先改 token（有余力再做；final 不强制清零 734 hex）。  

**验收**：`STYLE_SPLIT_B` + `CSS_LARGEST_B`。  

**Wave B 总验收**：

```bash
python3 scripts/check-code-quality-gates.py --mode wave-b
pnpm typecheck && pnpm test
```

---

### Wave C — Host 与 API 边界

#### WP-C1 · `commands/` 目录化

**目标**：消灭 11k 行 `commands.rs` 单体。  

**步骤**：

1. 创建 `src-tauri/src/commands/mod.rs`，按前缀拆分：  
   `session.rs` `fs.rs` `git.rs` `account.rs` `providers.rs` `doctor.rs` `extensions.rs` …  
2. **胖 command**（>100 行）优先把业务逻辑下沉到已有 domain mod（`git_pr_hub`、`fs_browser`、`extensions`…），command 文件只做参数解包。  
3. `lib.rs` 的 `generate_handler!` 保持 command **符号名不变**（可 `commands::session_send` 路径变）。  
4. 删除或瘦身根部 `commands.rs`（若 Rust 模块路径改为目录，按惯例去掉旧文件）。  

**验收**：`COMMANDS_DIR` / `COMMANDS_FACADE` / `COMMANDS_MODULE_MAX`；`cargo test` 绿。  

---

#### WP-C2 · `session_manager/` 拆分

**目标**：facade 清晰，journal / turn / watchdog / media 分文件。  

**步骤**：

1. `src-tauri/src/session_manager/mod.rs` + 例如 `connect.rs` `turn.rs` `journal.rs` `watchdog.rs` `tools.rs`。  
2. 保持 `SessionManager` 对外方法签名稳定。  
3. 禁止夹带行为变更（stall 阈值、权限默认等）。  

**验收**：`SESSION_MANAGER_SPLIT` / `SESSION_MANAGER_FACADE`；`cargo test` 绿。  

---

#### WP-C3 · `api/` 域模块

**目标**：前端 IPC 层可导航。  

**步骤**：

1. `src/lib/api/session.ts` `fs.ts` `account.ts` `settings.ts` …  
2. `src/lib/api/index.ts` 或薄 `api.ts` re-export，**保持** `@/lib/api` 导入路径兼容（`package` 路径别名不改的前提下，保留 `src/lib/api.ts` 作 barrel 亦可，但 facade 行数 ≤600）。  
3. 统一走已有中心 `invoke()`；消灭新的 mirror 分支分叉风格。  

**验收**：`API_SPLIT` / `API_FACADE`；typecheck 绿。  

---

#### WP-C4 · App 压到 Wave C 线

**目标**：App.tsx ≤8000；useState ≤140；Settings props ≤40。  

**步骤**：从 B 的剩余状态继续外提（sidebar、search、voice 壳、phone layout 等），直到 metrics 达标。  

**验收**：wave-c 脚本 PASS。  

```bash
python3 scripts/check-code-quality-gates.py --mode wave-c
pnpm typecheck && pnpm test
cd src-tauri && cargo test
```

---

### Wave F — Final 收敛

#### WP-F1 · 终态 metrics

**目标**：所有 final 数值闸门。  

**步骤**：

1. App ≤6000 / useState ≤100 / useEffect ≤50。  
2. 定时器：为 setTimeout 补清理，或抽到带 dispose 的 hook，使 clearTimeout ≥ 50% setTimeout。  
3. CSS：域文件 ≥6；最大 ≤10000。  
4. ≥1000 行文件数 ≤45：继续拆仍超标的次热点（`ResourceViewer`、`SettingsPage`、`messages.ts` 可按域拆 key，**非必须拆完 i18n** 若已靠其他文件压到 45）。  
5. CI 中质量闸升级为 `--mode final`（或 release 分支保护）。  

**验收**：`python3 scripts/check-code-quality-gates.py --mode final` 在 Progress 写 PASS 前必须已能绿（差 PROGRESS_FILE / HANDOFF 两项时先做 F2）。  

---

#### WP-F2 · 交接与冒烟

**目标**：人类可审计的完成证明。  

**步骤**：

1. 写 `docs/plans/CODE-QUALITY-COMPLETION.md`（≥40 行），必须包含：  
   - 最终 metrics 表（脚本输出粘贴）  
   - 行为冒烟矩阵（见 §5）勾选结果  
   - 残留债（明确「未做」与风险）  
   - xlsx 处理说明  
   - 主要目录搬迁图  
2. Progress：`FINAL: PASS`（**仅当** final 闸门全绿后）  
3. 汇总 commit 列表或 PR 说明。  

**验收**：`PROGRESS_FILE` + `HANDOFF_NOTE` + 全 final PASS。  

---

## 4. 拆分纪律（防改崩）

### 4.1 前端

| 做 | 不做 |
|----|------|
| 先搬纯函数到 `lib/` 并靠单测锁行为 | 一边搬一边改产品文案/默认值 |
| Provider/hook 保持相同 localStorage key | 重命名存储 key 导致用户设置丢失 |
| 组件 props 先兼容再删 | 一次改 200 个调用点无中间绿 |
| CSS 只剪切选择器 | 重命名 class、改 specificity「顺便美化」 |

### 4.2 Rust

| 做 | 不做 |
|----|------|
| `pub use` 保持外部路径稳定 | 改 command 名导致前端全挂 |
| 单测跟着模块走 | 删测试充绿 |
| 胖逻辑下沉 domain | 在 command 里继续堆 400 行 |

### 4.3 回滚

- 每个 WP 独立 commit；坏了 `git revert` 该 WP。  
- 不要把 Wave B+C 揉成一个 50 文件混杂 commit。  

---

## 5. 行为冒烟矩阵（WP-F2 必填）

> Agent 在无 GUI 自动化时：**静态证明 + 推理审查 + 既有单测**；若环境可跑 `pnpm tauri`/应用，则实机勾选。  
> 每一行必须有：`PASS` / `PASS(static)` / `FAIL` + 证据。

| ID | 路径 | 期望 |
|----|------|------|
| S1 | 新建会话 → 发送文本 → 流式回复 | 与改前一致 |
| S2 | 停止生成 / Stop | 状态回到可发送 |
| S3 | 权限弹窗允许/拒绝 | 无原生 dialog |
| S4 | AskUser 提交 | 正常 resume |
| S5 | 切换主题 / 皮肤 | 不闪退、偏好持久 |
| S6 | 设置页搜索跳转（settingsCatalog） | 深链仍可用 |
| S7 | 附件图片发送 | 卡片与 Host 路径仍通 |
| S8 | 历史会话恢复 | load/bootstrap 不丢消息 |
| S9 | Composer 模型/effort | 值写回设置 |
| S10 | 多会话切换 | liveMap 不串话（静态审 `sessionId` 传递） |

**FAIL 任一项 → 禁止 FINAL PASS**，回到对应 WP 修。

---

## 6. 机器闸门说明

脚本：`scripts/check-code-quality-gates.py`

| Mode | 含义 |
|------|------|
| `baseline` | 仓库可识别 + 无 window 原生弹窗 |
| `wave-a` | 死代码、CI、eslint、Office 安全、App 不增胖失控 |
| `wave-b` | App 第一刀 + Theme/Composer + Settings props + CSS 初裂 |
| `wave-c` | commands/session_manager/api 模块化 + App 第二刀 |
| `final` | 终态行数/钩子/CSS/文件数预算 + Progress/Completion 文档 |

```bash
python3 scripts/check-code-quality-gates.py --mode final
python3 scripts/check-code-quality-gates.py --mode final --json
```

**篡改阈值或删除失败断言 = 整改失败。** 若基线极端导致某阈值不可达，只能在 Completion 申请 **书面豁免** 并由人类改脚本——Agent 自行改松阈值无效。

---

## 7. 目录目标形态（完成后应接近）

```text
src/
  App.tsx                          # ≤6000，壳 + 组合
  providers/ThemeProvider.tsx
  hooks/useSessionRuntime.ts
  hooks/useComposerController.ts
  components/ComposerShell.tsx
  components/settings/…            # 可选再拆 SettingsPage
  lib/api/{index,session,fs,…}.ts
  styles/{app.css, chat.css, composer.css, sidebar.css, settings.css, modals.css, phone.css}
src-tauri/src/
  commands/{mod.rs, session.rs, fs.rs, git.rs, …}
  session_manager/{mod.rs, turn.rs, journal.rs, …}
```

---

## 8. 可复制启动 Goal（整段粘贴给执行 Agent）

```text
# Goal: Grok App 代码质量全盘整改（自动续接到 final 闸门）

## Outcome
在不改变已开发产品功能语义的前提下，按 docs/plans/2026-08-01-code-quality-remediation-GOAL.md 完成架构整改：拆解 App.tsx God Component、拆分 app.css / commands / session_manager / api、清除死代码、补齐 CI/ESLint/安全残留，使 python3 scripts/check-code-quality-gates.py --mode final 退出码为 0，并写出 docs/plans/CODE-QUALITY-COMPLETION.md。你必须自动跨 Wave/WP 连续执行直到 final PASS，禁止在阶段边界停下来等用户续接。

## Spec（必读，按序）
1. docs/plans/2026-08-01-code-quality-remediation-GOAL.md（唯一施工规格）
2. docs/plans/CODE-QUALITY-PROGRESS.md（进度账本；每 WP 更新）
3. scripts/check-code-quality-gates.py（验收合同；禁止改松阈值）
4. AGENTS.md + docs/llm-wiki/i18n.md + dialogs.md + settings-ia.md

## 执行策略
- 严格按 WP-A0→A1→…→F2 顺序；每 WP 结束跑 typecheck、test、对应 wave 闸门。
- 当前 WP 未绿禁止进入下一 WP；Wave 绿后立即下一 Wave。
- 会话中断恢复：读 CODE-QUALITY-PROGRESS.md，从第一个 PENDING WP 继续。
- 每 WP 至少一次 git commit，message 含 WP id。
- 行为冻结：不改默认值、协议、用户可见流程；只搬迁/拆分/消毒/闸门。
- 禁止 window.confirm/alert/prompt；文案走 i18n。
- 禁止为过闸删测试、空实现、放宽 scripts/check-code-quality-gates.py 阈值。

## Verification（分层）
1. 静态：闸门脚本 mode=wave-a|wave-b|wave-c|final
2. 单测：pnpm typecheck && pnpm test && (cd src-tauri && cargo test)
3. 行为：规格 §5 冒烟矩阵写入 CODE-QUALITY-COMPLETION.md
4. 终态法律：final 闸门 PASS + Progress 含「FINAL: PASS」+ Completion 文档≥40 行

## Constraints
- App.tsx 整改期间行数只降不升（相对各 WP 起点）。
- Tauri command 名与关键 api 导出保持兼容。
- 不扩大范围做新功能；新问题记 Progress，不展开产品开发。
- 不 force-push；不提交密钥。

## Boundaries
可改：src/App.tsx、src/components/**、src/hooks/**、src/providers/**、src/lib/api*、src/styles/**、src-tauri/src/commands*、session_manager*、.github/workflows/ci.yml、eslint 配置、docs/plans/CODE-QUALITY-*、AGENTS.md / llm-wiki/maintain 中与冻结相关的条款。
不要：重写 ACP 协议、替换整个 UI 框架、无关功能开发、改松验收脚本阈值。

## Iteration
- 小步垂直切片；红灯只修当前 WP。
- 遇拆分冲突：先保编译与测试，再继续搬。
- 自动续接直到 final；仅规格「暂停条件」可停。

## Completion（全部满足才允许结束）
- [ ] python3 scripts/check-code-quality-gates.py --mode final  → PASS
- [ ] pnpm typecheck && pnpm test → PASS
- [ ] cd src-tauri && cargo test → PASS
- [ ] docs/plans/CODE-QUALITY-PROGRESS.md 含 FINAL: PASS
- [ ] docs/plans/CODE-QUALITY-COMPLETION.md 已写（metrics + 冒烟 + 残留债）
- [ ] 未把闸门阈值改松

## Pause（仅这些情况可向用户提问并暂停）
- 安全策略需产品拍板且阻塞编译/数据安全
- 工具链无法运行测试
- 继续修改会导致不可逆数据丢失且无迁移方案

开始：读取规格与 Progress → 执行 WP-A0 → 连续推进至 Completion 清单全勾选。不要等待用户在 Wave 边界确认。
```

---

## 9. 人类侧使用方式

1. **新开 Agent 会话**，粘贴 §8 整段 Goal（或说：`执行 docs/plans/2026-08-01-code-quality-remediation-GOAL.md 的 Goal`）。  
2. **不要**在 Agent 做完 Wave A 后手动「下一步」——规格要求它自己继续；若它错误停顿，回复：  
   `按规格自动续接：读 CODE-QUALITY-PROGRESS.md，从第一个 PENDING WP 做到 final PASS，不要停。`  
3. **验收**：本地执行  
   `python3 scripts/check-code-quality-gates.py --mode final`  
   必须 PASS，再看 `CODE-QUALITY-COMPLETION.md`。  
4. **合并前**：确认 CI 已含 clippy/fmt/gates，且未把阈值改松（`git diff scripts/check-code-quality-gates.py`）。

---

## 10. 与旧文档关系

| 文档 | 关系 |
|------|------|
| `2026-07-26-开源诊断与整改交接.md` | 历史诊断与安全项；已修 SEC 勿重复；结构项被本文 **刷新基线与闸门** 覆盖 |
| 本次 code-review 会话报告 | 问题来源；以本文 WP 为施工顺序 |
| `GOAL-remote-im.md` | 无关产品 Goal；不要混进本整改 |

---

## 11. 风险与预期工期（供人类预期，不绑定 Agent 停顿）

| Wave | 风险 | 粗量级 |
|------|------|--------|
| A | 低 | 0.5–1.5 人日 |
| B | 中高（App 行为回归） | 3–7 人日 |
| C | 中（Rust 模块路径） | 2–4 人日 |
| F | 中（压指标） | 1–3 人日 |

Agent 应以 **闸门** 为完工标准，不以「大概够了」或「时间到了」为完工标准。

---

**文档版本**：2026-08-01  
**闸门脚本**：`scripts/check-code-quality-gates.py`  
**进度账本**：`docs/plans/CODE-QUALITY-PROGRESS.md`
