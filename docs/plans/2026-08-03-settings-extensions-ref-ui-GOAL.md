# Goal 规格 — 设置 → 扩展页对标改造（合并市场 · 推荐 ChatCut · 内置 openai/plugins）

> **文档性质**：施工单一事实来源（Spec）+ 可复制启动 Goal + 完整验收合同  
> **状态**：待人类确认后开分支实施  
> **分支（确认后）**：`feat/settings-extensions-ref-ui`  
> **对标素材**：`/Users/ronglecat/Downloads/插件对标/`（4 张 CleanShot）  
> **产品默认（已拍板）**：无「应用」Tab；无独立「市场」Tab；市场并入插件页；内置 openai/plugins；ChatCut `#codex` 进顶部推荐；删项目条

---

## 0. 决策锁定（不得擅自改）

| ID | 决策 | 默认 |
|----|------|------|
| D1 | 去掉「市场」Tab | 目录并入 **插件** 页 |
| D2 | 暂不要「应用」Tab | 本期不出现 `apps` |
| D3 | 内置 marketplace | `https://github.com/openai/plugins`（ensure add，幂等，失败 soft-fail） |
| D4 | 推荐安装 | `https://github.com/ChatCut-Inc/agent-plugin#codex`，顶部 **推荐** 分组，**不自动安装** |
| D5 | 删项目条 | 去掉 `ext-toolbar`：项目 / 路径 / 打开 agent-home / 刷新 |
| D6 | 壳层 | **选项卡以上**（section 标题「扩展」+ `ext.lead`）维持原样式 |
| D7 | 内容层 | **选项卡及以下** 对齐参考图布局语言；主列表不复用旧 `ext-item` 按钮墙 |
| D8 | 可安装默认源 | **A**：默认筛选 openai/plugins；其它源可在「全部」看到 |
| D9 | MCP Tab 数量 | **A**：用户服务器 + 来自插件 合计 |
| D10 | 推荐内容 | **A**：仅 ChatCut 一条（可扩展常量，本期不堆 Featured） |
| D11 | 深链兼容 | `#/settings/extensions/market` → **plugins**（不白屏） |

---

## 1. Outcome（完成时必须为真）

用户在 **设置 → 扩展** 看到：

1. Tab：**插件 · MCP · 技能 · Agents · Hooks**（带数量；无市场、无应用）。  
2. **无**项目 scope 工具条。  
3. **插件**页自上而下：**推荐（ChatCut）→ 已安装 → 可安装（openai/plugins 目录）→ 高级安装（折叠）**。  
4. 首次进入插件页会 **ensure** openai/plugins 源；ChatCut 为可选安装，源带 `#codex`。  
5. **MCP / 技能** 主列表布局对齐参考图（分区 / 开关 / 搜索同行）。  
6. i18n、settingsCatalog、llm-wiki 与实现一致；自动化检查绿。

---

## 2. 参考图 → 实现映射

| 文件 | 用途 | 本期映射 |
|------|------|----------|
| `09.40.15` 插件列表 | 扁平行：图标+名+描述+开关/展开 | **已安装** + 推荐行交互 |
| `09.40.53` MCP | 服务器(开关+齿轮) / 来自插件(只读) + 添加 | **MCP Tab** |
| `09.41.08` 技能 | 密列表 + 来源徽标 + 开关 | **技能 Tab** |
| `09.39.20` 大市场 | 已安装条+分类双列 | **不 1:1 复刻**；能力并入插件页「可安装」；推荐≈精简 Featured |

管理台共用壳（参考 09.40.x）：

```
[插件 n] MCP n  技能 n  Agents  Hooks     [🔍 搜索…]
```

- 选中：实心胶囊 + 文案 + 数字  
- 未选：纯文字 + 数字  
- 搜索与 Tab **同一行右侧**；placeholder 随 Tab 变  

**数量口径**

| Tab | n |
|-----|---|
| 插件 | 已安装插件数（`pluginsList`） |
| MCP | 用户服务器数 + 来自插件数（D9-A） |
| 技能 | 当前技能列表长度 |
| Agents / Hooks | 可选显示条数；无则仅文案 |

---

## 3. 插件页信息架构（合并市场）

```
选项卡以上：现有 Settings 壳 + ext.lead（不动）
────────────────────────────────────────────
Tab 行 + 搜索
────────────────────────────────────────────
【推荐】 id=settings-anchor-ext-plugins-recommended
  · ChatCut — 安装 | 已装则开关 + 可展开

【已安装】 id=settings-anchor-ext-plugins
  · 扁平列表；主操作=开关；chevron 展开=更新/校验/详情/卸载

【可安装】 id=settings-anchor-ext-plugins-catalog
  · ensure openai/plugins 后的 available 列表
  · 默认源=openai；芯片：openai | 全部 |（其它已配置源）
  · 已安装项：标「已安装」或隐藏（实现选一，wiki 写明；推荐标已安装不重复装）

【高级】折叠
  · 路径 / git / owner/repo[#subdir] 安装（复用现 API）
```

### 3.1 ChatCut 推荐常量

| 字段 | 值 |
|------|-----|
| stable id | `chatcut-codex` |
| displayName | ChatCut（i18n） |
| description | 短描述 i18n（对齐 chatcut fixture 语义） |
| installSource | `https://github.com/ChatCut-Inc/agent-plugin#codex` |
| installed match | name ∈ {`codex`,`chatcut`}（大小写不敏感）**或** source/path 含 `ChatCut-Inc/agent-plugin` |
| 未安装 UI | 主按钮「安装」→ GlassModal 确认（第三方权限文案）→ `pluginInstall` + trust |
| 已安装 UI | 开关 enable/disable；展开可卸载/更新 |
| 禁止 | 自动安装、静默 `--trust` 无确认 |

### 3.2 openai/plugins ensure

**触发**：进入插件 Tab（或插件页内「刷新目录」），Tauri + CLI 可用时。

```
1. marketplaceList()
2. 若无匹配 openai/plugins 源 → marketplaceAdd("https://github.com/openai/plugins")
   匹配规则：url/path/name 规范化后包含 github.com/openai/plugins 或 name 等价 openai/plugins
3. （可选）marketplaceUpdate(该源名) — 失败不阻断列表
4. marketplaceAvailable() / loadMarketplaceCatalog(force?)
5. 默认 marketFilter = openai 源实际 name；无则 __all__ + soft 提示
```

- **不删除** 用户已有 xAI / claude 等源  
- add 失败：soft-fail 文案 + 仍展示已有目录  
- 使用现有 `marketplaceCatalogCache` TTL；安装成功后 invalidate 或 remove 单行  

### 3.3 安装源与命名

- CLI：`grok plugin install <SOURCE> --trust` 支持 `#subdir`  
- 若 `plugin_name_from_install_source` 对 `#codex` URL 解析错误 → **本期修复**（strip `#fragment` 后再取 repo leaf；enable 名以 install 返回 / list 为准）  
- 合格安装 source 构造复用 `marketplaceQualifiedInstallSource`  

---

## 4. MCP / 技能 / Agents / Hooks

### MCP（对齐 09.40.53）

```
服务器                    [+ 添加服务器]
┌  name              ⚙  toggle ┐
└─────────────────────────────┘

来自插件
┌  name（只读）              ┐
└────────────────────────────┘
```

- 用户服务器：开关 + 齿轮（诊断 / 授权 / 删除 / 编辑）  
- 来自插件：无独立开关；点击可跳插件详情（可选）  
- 分流：用 plugin provides / inspect / vendor 等现有字段；无字段时「来自插件」可空，不得伪造  

### 技能（对齐 09.41.08）

- 行：图标 + 名 + 描述 + 来源徽标 + 开关  
- 编辑等进次要操作 / 点行  

### Agents / Hooks

- 业务逻辑可暂留 `ExtensionsBuildExtras` / `ExtensionsHooksPanel`  
- 外壳、间距、列表密度跟新 `ext2` / `ext-ref` 体系  
- **禁止**再从扩展 Tab 进入独立 market mode 作为一级 Tab  

---

## 5. 施工工作包（WP）— 严格顺序

> 每 WP：**目标 / 步骤 / 验收 / 禁止**。上一个未绿不得进下一个。  
> 进度账本：`docs/plans/2026-08-03-settings-extensions-ref-ui-PROGRESS.md`（实施时创建并更新）。

### WP-0 — 分支与基线

**目标**：干净工作分支 + 基线命令可跑。

**步骤**

1. `git checkout main && git pull`（或当前集成主干）  
2. `git checkout -b feat/settings-extensions-ref-ui`  
3. 记录基线：`pnpm typecheck`、`pnpm test`（至少跑 settingsCatalog / pluginMarketplace 相关）  

**验收**

- [ ] 分支存在且基于最新主干  
- [ ] 基线 typecheck 通过（或记录已有红灯与本改造无关）  

**禁止**：在 WP-0 改产品代码。

---

### WP-1 — IA：去市场 Tab + 深链兼容

**目标**：扩展 Tab 仅五档；`market` 深链落到 plugins。

**步骤**

1. `src/lib/settingsCatalog/nav.ts`：去掉 `market` tab  
2. `types.ts`：`SettingsTabId` 可暂留 `market` **或** 在 `resolveTab`/`parseSettingsHash` 中把 `market`→`plugins`（二选一，须单测覆盖）  
3. `entries/extensions.ts`：`ext.market` 条目 `tab: "plugins"`，`anchorId` → `settings-anchor-ext-plugins-catalog`，keywords 保留 marketplace  
4. `ExtensionsPanel` / `ExtensionsSection`：Tab 列表去掉 market；`ExtensionsTabId` 去掉 market 或映射  
5. 所有 `onTabChange("market")` / 文案「去市场」→ 页内锚点或停留 plugins  
6. 更新 `docs/llm-wiki/settings-ia.md` 表  

**验收**

- [ ] UI 无「市场」Tab  
- [ ] `#/settings/extensions/market` 打开插件页  
- [ ] `pnpm exec vitest run src/lib/settingsCatalog.test.ts` PASS  
- [ ] 搜索「marketplace / 市场」仍能命中并跳到插件页目录锚点  

**禁止**：本 WP 不做大改列表视觉。

---

### WP-2 — 删除项目条 + 新 Tab 条（数量 + 同行搜索）

**目标**：红框消失；Tab 条接近参考管理台。

**步骤**

1. 删除 `ext-toolbar` 整块 UI（scope / agent-home / refresh）  
2. `projectPath` 仅作数据 cwd，不展示  
3. 新 Tab 条：`ext-ref-tabs`（选中胶囊 / 未选文字 / 数量）  
4. 同行搜索框：plugins/mcp/skills 有 placeholder；agents/hooks 可隐藏或本地滤  
5. 新样式进 **独立** CSS（建议 `src/styles/extensions-ref.css` 并在入口 import），**不要**继续堆旧 `ext-item__actions` 为主路径  

**验收**

- [ ] 设置→扩展：无「项目」「打开 agent-home」工具条  
- [ ] Tab 显示数量（至少插件/技能/MCP 在数据加载后正确）  
- [ ] 搜索框与 Tab 同行（桌面宽度 ≥ 设置内容区正常宽度下）  
- [ ] 截图对比 Image #1：红框区域不存在  

**禁止**：恢复任何项目 scope 展示条。

---

### WP-3 — 推荐 + ensure openai + 目录并入插件页

**目标**：插件页三分区数据链路打通。

**步骤**

1. 新增 `src/lib/pluginRecommended.ts`（或等价）：  
   - `CHATCUT_CODEX_INSTALL_SOURCE`  
   - `isChatCutInstalled(plugins)`  
   - `OPENAI_PLUGINS_MARKETPLACE_URL` / `isOpenaiPluginsSource(source)`  
   - `ensureOpenaiPluginsMarketplace(...)` 纯逻辑 + 调用侧  
2. 单测：匹配 URL 变体（`.git`、大小写、shorthand）；ChatCut 已装判定  
3. 插件 Tab mount：ensure openai → load catalog  
4. UI 分区：推荐 / 已安装（可先旧行样式）/ 可安装 / 高级折叠  
5. 推荐安装：GlassModal 确认 → `pluginInstall` → refresh  
6. 目录安装：复用 `marketplaceQualifiedInstallSource` + 现确认流  
7. 修复 `#subdir` 安装后 enable 命名（若需要）  
8. 更新 `docs/llm-wiki/plugins-marketplace.md`、`chatcut.md` 安装入口说明  

**验收**

- [ ] 冷启动（无 openai 源）：进入插件页后 `grok plugin marketplace list` 出现 openai/plugins（或 soft 错误可感知）  
- [ ] 推荐区可见 ChatCut；本机已装 codex 时为已安装态  
- [ ] 未装环境可点安装（确认后 CLI install；失败有行内/Modal 错误）  
- [ ] 可安装列表非空（网络/CLI 允许时）或诚实空态  
- [ ] 相关 vitest PASS  
- [ ] 无独立市场 Tab  

**禁止**：自动安装 ChatCut；删除用户其它 marketplace 源。

---

### WP-4 — 插件 / MCP / 技能列表视觉对齐参考

**目标**：主列表「看起来像参考图」，不是旧运维墙。

**步骤**

1. **已安装插件行**：图标区 + 标题 + 副文案 + 右侧 toggle；复杂项 chevron；展开区收纳次要操作  
2. **MCP**：双分组容器 + 行内 toggle/齿轮；添加服务器入口在分组标题右  
3. **技能**：高密度行 + 来源徽标 + toggle  
4. 主列表 **禁止** 默认展示「禁用/更新/校验/详情/卸载」五按钮横排  
5. 对照三张图自检间距/字号/分割线（浅色主题下也要可读；跟随现有 token，不硬编码 ChatGPT 纯黑）  

**验收**

- [ ] 并排截图：插件/MCP/技能 与 `09.40.15` / `09.40.53` / `09.41.08` 结构同构  
- [ ] 次要操作仍可达（展开或菜单或详情）  
- [ ] 浅色/深色均无文字裁切、开关不可点  

**禁止**：自创第三套卡片风格；复用旧 `ext-item` 按钮墙作为默认主 UI。

---

### WP-5 — Agents/Hooks 壳统一 + 文案 i18n + 收尾文档

**目标**：全扩展页一套语言；文档与搜索完整。

**步骤**

1. Agents/Hooks 容器 class 对齐 ext-ref  
2. en / zh / zh-tw 全量新 keys（推荐、可安装、服务器、来自插件、搜索 placeholder、ensure 失败等）  
3. 删除或改写指向「市场 Tab」的文案（`ext.plugins.browseOfficial`、`installHint` 等）  
4. `settings-ia.md` / `plugins-marketplace.md` / 本 PROGRESS 写 FINAL  
5. 可选：写 `docs/plans/2026-08-03-settings-extensions-ref-ui-COMPLETION.md`（变更摘要 + 验收勾选结果）  

**验收**

- [ ] 无用户可见硬编码中英串（抽检新增 UI）  
- [ ] 无 `window.confirm/alert/prompt`  
- [ ] wiki 与 Tab 表一致  
- [ ] typecheck + 相关 test 全绿  

---

### WP-6 — 全量回归与完成证据

**目标**：Completion 清单可对外交付。

**步骤**

1. 跑 §7 自动化 + §8 手动矩阵  
2. 填 PROGRESS `FINAL: PASS` 或列出残留债  
3. 准备 PR 说明（中英可选）  

**验收**：§7 + §8 全部 PASS 或「已知债」写入 COMPLETION 且无 P0 债。

---

## 6. 文件边界

### 允许修改

```
src/components/ExtensionsPanel.tsx
src/components/ExtensionsBuildExtras.tsx
src/components/ExtensionsHooksPanel.tsx
src/components/settings/ExtensionsSection.tsx
src/lib/pluginRecommended.ts          # 新增
src/lib/pluginMarketplace.ts          # 仅必要时扩展纯函数
src/lib/marketplaceCatalogCache.ts    # 仅必要时
src/lib/settingsCatalog/**
src/lib/api/extensions.ts | memory.ts # 仅类型/薄封装必要时
src/i18n/messages/**/extensions*.ts
src/styles/extensions-ref.css         # 新增
src/styles/*                          # import 接入
src-tauri/src/commands/extensions_p2.rs  # 仅 #subdir 命名修复必要时
docs/llm-wiki/settings-ia.md
docs/llm-wiki/plugins-marketplace.md
docs/llm-wiki/chatcut.md              # 安装入口路径更新
docs/plans/2026-08-03-settings-extensions-ref-ui-*.md
相关 *.test.ts
```

### 禁止

- 改一级 Settings 导航九项结构（除扩展页内 tab）  
- 新增 `apps` Tab  
- 保留或恢复项目 scope 工具条  
- 自动安装任何插件  
- `window.confirm` / `alert` / `prompt`  
- 硬编码用户可见中英文  
- 大范围重构 `App.tsx` / 无关设置 section  
- 提交 secrets、`auth.json`、force-push  
- 放宽与本功能无关的 CI 阈值  

---

## 7. 自动化验收（机器）

在仓库根目录执行（以 `package.json` 实际脚本为准；若名称不同先读 package.json）：

```bash
# 类型
pnpm typecheck

# 单测（至少）
pnpm exec vitest run src/lib/settingsCatalog.test.ts
pnpm exec vitest run src/lib/pluginMarketplace.test.ts
pnpm exec vitest run src/lib/pluginMarketPro.test.ts
# 若新增 pluginRecommended.test.ts：
pnpm exec vitest run src/lib/pluginRecommended.test.ts

# 若改了 Rust 命名辅助
cd src-tauri && cargo test normalize_plugin_install 2>/dev/null; cargo test plugin_name_from_install; cd ..
```

**PASS 标准**

| 检查 | 标准 |
|------|------|
| typecheck | 退出码 0 |
| 上述 vitest | 退出码 0 |
| cargo 相关（若改） | 退出码 0 |
| settings IA | nav 无 market；market 深链→plugins 有测试 |
| i18n | 新增 key 在 en + zh（+ zh-tw 若项目要求同步）存在 |

---

## 8. 手动 / UI 验收矩阵（人类或带界面 Agent）

### 8.1 导航与壳

| ID | 步骤 | 期望 |
|----|------|------|
| M1 | 打开 设置→扩展 | 标题「扩展」+ lead 与改前同级样式；**无**项目条 |
| M2 | 看 Tab | 仅：插件、MCP、技能、Agents、Hooks；**无**市场、**无**应用 |
| M3 | 打开 `#/settings/extensions/market` | 落在插件 Tab，不白屏 |
| M4 | 设置搜索「市场」或 marketplace | 命中并进入插件页（目录锚点） |

### 8.2 插件页结构

| ID | 步骤 | 期望 |
|----|------|------|
| P1 | 插件 Tab | 自上而下可见：推荐、已安装、可安装（可滚动）、高级可折叠 |
| P2 | 推荐区 | 有 ChatCut；文案 i18n；未装显示安装，已装显示开关 |
| P3 | 已安装行 | 无默认五按钮墙；开关可用；展开后可达卸载/详情等 |
| P4 | 搜索插件 | 过滤推荐/已装/可安装（至少已装+可安装） |
| P5 | 高级安装 | 折叠；可填 path/git；支持说明 `#subdir` |

### 8.3 openai/plugins

| ID | 步骤 | 期望 |
|----|------|------|
| O1 | 临时移除 openai 源后进插件页（或新 profile） | ensure 后 list 含 openai/plugins，或 soft 错误明确 |
| O2 | 可安装默认筛选 | 默认偏向 openai 源 |
| O3 | 切换「全部」 | 可见其它源插件（若本机有） |
| O4 | 安装一条目录插件（可选，非破坏环境） | 确认 Modal → 成功后进已安装；可安装态更新 |

### 8.4 ChatCut

| ID | 步骤 | 期望 |
|----|------|------|
| C1 | 已装 codex 的机器 | 推荐区=已安装，不出现误导性「安装」为主 CTA |
| C2 | 未装机器（或卸后） | 安装确认 → source 含 `#codex` 或等价；成功后 list 可见 |
| C3 | 取消确认 | 不安装 |

### 8.5 MCP / 技能

| ID | 步骤 | 期望 |
|----|------|------|
| K1 | MCP Tab | 有「服务器」「来自插件」分区（后者可空） |
| K2 | 服务器行 | 开关 + 齿轮入口；无主列表按钮墙 |
| K3 | 添加服务器 | 入口在分区标题侧 |
| K4 | 技能 Tab | 高密度列表 + 来源徽标 + 开关 |
| K5 | Tab 数量 | 与列表大致一致（加载后） |

### 8.6 Agents / Hooks / 回归

| ID | 步骤 | 期望 |
|----|------|------|
| A1 | Agents / Hooks 可进 | 功能不丢；样式不与插件页严重割裂 |
| A2 | 启用/禁用技能或插件 | 仍生效（与改前一致） |
| A3 | 浅色/深色 | 可读、对比度可接受 |
| A4 | 无原生 confirm | 卸载/安装均 App 内 Modal |

### 8.7 对标结构（非像素公证）

| ID | 对照 | 期望 |
|----|------|------|
| V1 | 09.40.15 | 插件：左信息右开关/展开，非运维按钮墙 |
| V2 | 09.40.53 | MCP：双分组 + 添加 |
| V3 | 09.41.08 | 技能：徽标+开关密列表 |
| V4 | 09.39.20 | 不要求分类双列 1:1；推荐+可安装覆盖「发现/安装」能力 |

---

## 9. 完成证据（Completion checklist）

全部勾选才允许宣称完成 / 提 PR：

- [ ] WP-0 … WP-6 均在 PROGRESS 标 DONE  
- [ ] §7 自动化全部 PASS  
- [ ] §8 矩阵 P0 项（M1–M4, P1–P3, O1–O2, C1, K1–K4, A4）全 PASS  
- [ ] 可选：§8 破坏性安装项（O4/C2）在可恢复环境验证或标注跳过原因  
- [ ] wiki：`settings-ia.md`、`plugins-marketplace.md` 已更新  
- [ ] 无 market Tab；无项目条；无 apps  
- [ ] COMPLETION 或 PR 描述含：改动摘要、验证命令输出摘要、已知债  

**P0 阻塞债定义**：无法打开扩展、丢插件列表、无法安装、深链白屏、市场 Tab 仍在、项目条仍在、硬编码大段 UI 文案、安装无确认直接 trust。

---

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| openai/plugins 与 Grok marketplace 格式不完全兼容 | soft-fail + 仍展示其它源；记录错误原文 |
| ensure add 每次进页太慢 | 先 list 判断；已存在则跳过；catalog cache 6h |
| ChatCut 已装名是 `codex` 不是 `chatcut` | 匹配 name+source 双条件 |
| ExtensionsPanel 过大难改 | WP 切片；可抽 `PluginsTabView` 子组件但不做无关大拆 |
| 视觉「不像」参考图 | WP-4 强制对照三图；禁止旧按钮墙主路径 |
| `#subdir` enable 名错 | 单测 + install 后以 list 名为准 |

---

## 11. 可复制启动 Goal（整段粘贴给执行 Agent）

```text
# Goal: Grok App 设置→扩展页对标改造（合并市场 · 推荐 ChatCut · 内置 openai/plugins）

## Outcome
按 docs/plans/2026-08-03-settings-extensions-ref-ui-GOAL.md 完成「设置 → 扩展」改造：去掉市场 Tab 与项目工具条；Tab 为 插件/MCP/技能/Agents/Hooks（带数量与同行搜索）；插件页含 推荐(ChatCut #codex 可选安装)、已安装、可安装(ensure https://github.com/openai/plugins)、高级安装；MCP/技能主列表布局对齐参考图；选项卡以上壳不变；i18n/catalog/wiki 同步；§7 自动化与 §8 P0 手动矩阵通过。

## Spec（必读，按序）
1. docs/plans/2026-08-03-settings-extensions-ref-ui-GOAL.md（唯一施工规格与验收合同）
2. docs/llm-wiki/settings-ia.md · plugins-marketplace.md · chatcut.md · i18n.md · dialogs.md
3. Agents.md（App.tsx 冻结、i18n、无 window.confirm）
4. 参考图目录：/Users/ronglecat/Downloads/插件对标/（09.40.15 插件 · 09.40.53 MCP · 09.41.08 技能 · 09.39.20 仅能力参考不 1:1）

## 决策锁定（禁止擅自改）
- 无应用 Tab；无市场 Tab；市场并入插件页
- 内置 ensure openai/plugins；不删用户其它源
- 推荐仅 ChatCut：https://github.com/ChatCut-Inc/agent-plugin#codex，不自动安装
- 删 ext-toolbar 项目条；projectPath 可作 cwd 但不展示
- 可安装默认源 openai；MCP 数量=用户服务器+来自插件
- #/settings/extensions/market → plugins

## 执行策略
1. 开分支 feat/settings-extensions-ref-ui
2. 严格 WP-0→WP-6；每 WP 结束更新 docs/plans/2026-08-03-settings-extensions-ref-ui-PROGRESS.md
3. 每 WP 至少一次 git commit，message 含 WP-id
4. 主列表新样式用独立 CSS（extensions-ref），禁止旧 ext-item 按钮墙作默认主 UI
5. 对话框仅 GlassModal/setAppDialog；文案 createT/i18n en+zh(+zh-tw)
6. 自动跨 WP 连续执行到 Completion；仅 Pause 条件可停

## Verification
1. pnpm typecheck
2. pnpm exec vitest run src/lib/settingsCatalog.test.ts src/lib/pluginMarketplace.test.ts src/lib/pluginMarketPro.test.ts 以及新增 pluginRecommended 测试
3. 若改 Rust：cargo test 相关 install/name 用例
4. 手动矩阵规格 §8 的 P0 项全部 PASS，并在 PROGRESS/COMPLETION 记录
5. 对照参考图结构自检 V1–V3

## Constraints
- 不扩大到应用 Tab、ChatGPT 全部分类商店、无关设置 section
- 不自动安装插件；安装必须确认
- 不恢复项目条；不保留市场一级 Tab
- 不改松无关 CI；不提交密钥；不 force-push
- App.tsx 不新增功能块（扩展逻辑留在 Extensions* / lib）

## Boundaries
可写：ExtensionsPanel/BuildExtras/HooksPanel、settings/ExtensionsSection、pluginRecommended、pluginMarketplace 纯函数、marketplaceCatalogCache、settingsCatalog、extensions i18n、extensions-ref 样式、extensions_p2 命名修复、上述 wiki 与 plans 文档、相关测试。
不要：App.tsx 堆状态、远程 IM、账户、外观大改、替换整个设置壳、删除用户 marketplace 源的清理逻辑。

## Iteration policy
- 一次一个 WP；红灯只修当前 WP
- 网络/CLI 导致 openai ensure 失败：soft-fail + 诚实空态，不假数据
- 视觉争议：以参考图结构为准，token 跟 App 主题
- 最多在同一 WP 内 3 轮「改→测」无进展则记录阻塞并 Pause

## Completion（全部满足才结束）
- [ ] 规格 §9 Completion checklist 全勾
- [ ] PROGRESS 含 FINAL: PASS
- [ ] 无 P0 债
- [ ] 变更文件列表 + 验证命令摘要已写

## Pause if
- CLI 无 plugin marketplace / install 能力且无法 soft-fail 讲清
- 产品要求恢复市场 Tab 或应用 Tab（与锁定决策冲突）
- 需要改公钥默认信任策略或静默安装
- 工具链无法跑 typecheck/test

开始：读本规格 → WP-0 建分支与 PROGRESS → 连续执行至 §9 完成。
```

---

## 12. 短版 `/goal`（中文，可直接复制）

```text
/goal 按 docs/plans/2026-08-03-settings-extensions-ref-ui-GOAL.md 改造设置→扩展：去掉市场 Tab 与项目条；Tab=插件/MCP/技能/Agents/Hooks；插件页=推荐ChatCut(#codex可选安装)+已安装+可安装(ensure openai/plugins)+高级安装；MCP/技能列表对齐参考图；选项卡以上壳不变；完成 WP-0…WP-6 与规格 §7/§8/§9 验收。
验证：pnpm typecheck；vitest 跑 settingsCatalog、pluginMarketplace、pluginMarketPro 及新增 recommended 测试；必要时 cargo test；手动矩阵 §8 P0 全过；PROGRESS 写 FINAL: PASS。
约束：无应用Tab；无市场一级Tab；不自动安装；不删用户其它 marketplace 源；无 window.confirm；文案走 i18n；主列表禁止旧按钮墙默认 UI。
边界：仅改 Extensions*、pluginRecommended/marketplace/settingsCatalog、extensions i18n、extensions-ref 样式、必要 Rust 命名修复、wiki 与本 plans 文档及相关测试。
迭代策略：按 WP 顺序小步提交，每 WP 测通再进下一 WP；ensure 失败 soft-fail；最多同 WP 3 轮无进展则暂停记录。
完成条件：规格 §9 清单全勾且无 P0 债。
暂停条件：与锁定决策冲突的产品变更、无法运行检查、需静默安装/改信任策略时暂停。
```

---

## 13. Goal Draft (English-compatible)

```text
/goal Implement the Settings → Extensions redesign per docs/plans/2026-08-03-settings-extensions-ref-ui-GOAL.md: remove the Market tab and project toolbar; tabs = Plugins/MCP/Skills/Agents/Hooks; Plugins page = Recommended ChatCut (#codex opt-in install) + Installed + Installable (ensure https://github.com/openai/plugins) + Advanced install; MCP/Skills lists match reference layout; keep chrome above tabs unchanged; finish WP-0…WP-6 and pass §7/§8/§9 acceptance.
Verification: pnpm typecheck; vitest settingsCatalog, pluginMarketplace, pluginMarketPro, and new recommended tests; cargo tests if Rust touched; manual matrix §8 P0 all pass; PROGRESS records FINAL: PASS.
Constraints: no Apps tab; no top-level Market tab; never auto-install; do not remove other user marketplace sources; no window.confirm; all UI strings via i18n; no legacy multi-button row as default list UI.
Boundaries: only Extensions*, pluginRecommended/marketplace/settingsCatalog, extensions i18n, extensions-ref CSS, necessary Rust name fix, wiki + this plan docs, related tests.
Iteration policy: one WP at a time with commits; soft-fail ensure errors; max 3 fix cycles per WP then pause with evidence.
Stop when: §9 completion checklist is fully checked with no P0 debt.
Pause if: product direction conflicts with locked decisions, toolchain cannot run checks, or silent-install/trust-policy change is required.
```

---

## 14. 人类侧使用方式

1. **审阅本规格**，回复「确认施工」或列出要改的决策 ID。  
2. **确认后**新开 Agent 会话，粘贴 **§11 整段** 或 **§12 短版 `/goal`**。  
3. 执行中只看 `…-PROGRESS.md`；完成后看 §9 + 可选 COMPLETION。  
4. 合并前抽检：无市场 Tab、无项目条、推荐 ChatCut、openai ensure、浅色深色列表。  

---

## 15. 文档关系

| 文档 | 关系 |
|------|------|
| 本文件 | 施工 + Goal + 验收 **唯一规格** |
| `…-PROGRESS.md` | 实施进度账本（开写时创建） |
| `…-COMPLETION.md` | 完成后证据（可选但推荐） |
| `docs/llm-wiki/settings-ia.md` | Tab IA 对外说明（实现后必须同步） |
| `docs/llm-wiki/plugins-marketplace.md` | 市场并入插件页后的行为说明 |
| 对话中的分析报告 | 背景；**以本文件决策锁定为准** |

---

*默认细项：可安装默认 openai（D8-A）、MCP 计数含来自插件（D9-A）、推荐仅 ChatCut（D10-A）。若产品改口，先改 §0 再动代码。*
