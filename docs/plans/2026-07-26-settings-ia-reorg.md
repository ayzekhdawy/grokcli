# 设置页信息架构整理 — 现状报告与改造计划

> **状态**：实现中（决策已锁定；P0–P2 主路径已落地）  
> **日期**：2026-07-26  
> **决策**：(1) 一级 9 项保持 (2) 扩展 5 tab 接受 (3) Inspect 留 Runtime 紧凑摘要 + 链扩展 (4) hash `#/settings/{section}/{tab}` (5) P0 可先修  
> **原则**：**只动展示与导航，不改坏任何设置的读写/保存/副作用**  
> **目标读者**：排期 / 实现 / 验收  

---

## 0. 一句话

设置页已经从「几项偏好」长成「个人偏好 + 账户/提供商 + 扩展生态 + CLI 运行时 + Remote IM」的大盘，但 **IA 仍是扁平一级菜单 + 超长纵向堆叠**，导致：

1. 信息层次不清  
2. CLI / 扩展出现内容与菜单双重重复  
3. 搜索只能滤一级菜单，不能落到具体项或 tab  
4. 后续加设置没有强制可搜登记  

本计划先 **归类去重 + 页内 tab + 可搜目录**，不改 Host `settings_get/set` 字段语义，不改各面板业务 API。

---

## 1. 现状结构（代码事实）

### 1.1 壳与路由

| 项 | 现状 |
|----|------|
| 主组件 | `src/components/SettingsPage.tsx`（~2712 行，巨石） |
| 路由 | Hash：`#/settings/:section`（`App.tsx`） |
| 一级导航 | 左栏 `NAV[]`，两组：`personal` / `system` |
| 手机 | 索引 → 详情 drill-down（`phoneLayout`） |
| 搜索 | 左栏 filter **一级 section**（`keywordKeys` 匹配 label + 若干 i18n key） |
| 深链 tab | **无**（仅 section id；Account 内 tab 是本地 state） |

### 1.2 一级导航清单（`SettingsSectionId`）

| id | 中文标签 | 组 | 内容形态 |
|----|----------|----|----------|
| `general` | 常规 | personal | **超长页**：Composer / 权限 / Agent 开关 / 语言会话等 4 大块 |
| `appearance` | 外观 | personal | 主题 / 皮肤 / 壁纸（单页，尚可） |
| `account` | 账户 | personal | **已有 tab**：官方账户 \| 自定义提供商 |
| `archived` | 已归档会话 | personal | 列表 + 多选恢复/删除 |
| `extensions` | 扩展 | system | **超长页**：Plugins → Skills → MCP → Hooks → Marketplace |
| `runtime` | CLI / 运行时 | system | CLI 路径 / ACP / 并发 / 空闲 / stall / Doctor + **嵌套** Inspect + Managed Setup |
| `remote_im` | 远程 IM | system | 自有二级布局（`RemoteImLayout`） |
| `shortcuts` | 键盘 | system | 快捷键表 |
| `about` | 关于 | system | 版本 + 应用更新 |

**已确认缺陷：双 CLI 菜单**

`NAV` 中 `runtime` 被登记了两次：

1. 完整条目（含 `keywordKeys`）  
2. 残缺重复行：`{ id: "runtime", … }`（无 `keywordKeys`）  

效果：左栏 **「CLI / 运行时」出现两遍**。`remote_im` 条目缺少 `keywordKeys`，搜索时对 `...n.keywordKeys` 存在潜在运行时风险。

### 1.3 各页设置项清单（功能级，非字段级）

#### A. 常规 `general`（一块长滚动）

| 子块 | 设置项 | 持久化/副作用 |
|------|--------|----------------|
| 对话偏好 | 偏好作用域 global/project/session | `composerPrefsScope` |
| | 可用模型列表（只读展示） | — |
| 权限 | 权限策略 Select | `permissionPolicy` |
| | 沙箱 profile | `sandboxProfile` |
| | `PermissionRulesPanel`（规则列表） | CLI / agent-home 规则 |
| Agent | max turns / preferred agent / memory / subagents / plan / disable web / use leader | 各 `AppSettings` 字段 |
| 常规 | 语言 | `locale` |
| | 会话数据模式 independent/shared | `sessionDataMode` |
| | shared 时 CLI 会话导入 | 导入副作用 |
| | Keychain 存 API Key | `storeApiKeysInKeychain` |
| | 清除工作区 memory | `memoryClear` 命令 |
| | 启动恢复上次会话 | `reopenLastSession` |
| | 打开目标 Finder/编辑器 | `defaultOpenTarget` |

**问题**：Composer + 权限 + Agent 能力开关 + 应用偏好混在一页，层次靠多个 `h2` 硬堆。

#### B. 外观 `appearance`

| 设置项 | 说明 |
|--------|------|
| 明暗主题 | `theme` |
| 皮肤 pack | skin |
| 壁纸上传/替换/清除/找壁纸 | wallpaper blob |
| 壁纸遮罩强度 | scrim |

**问题**：`keywordKeys` 只挂了 theme 相关，**皮肤/壁纸搜不到**。

#### C. 账户 `account`（tab 范本）

| Tab | 内容 |
|-----|------|
| 官方账户 | `AccountPanel`：登录/配额/热力图/多账户/导入对话 |
| 自定义提供商 | `ProvidersPanel`：relay、agent-home、激活 |

这是目前 **唯一成熟的页内 tab** 模式（`settings-account-tabs` + `settings-seg`）。

#### D. 扩展 `extensions`（最长之一）

纵向顺序（无顶层 tab）：

1. **Plugins**（安装、过滤 all/enabled/disabled、启用/禁用/更新/详情/卸载）  
2. **Skills**（列表 + 启用开关）  
3. **MCP**（列表 + 添加/移除/doctor/启用）  
4. **Hooks**（`ExtensionsBuildExtras`）  
5. **Marketplace**（源 + 可安装列表）  

**问题**：5 个生态面堆在一页；内部仅 Plugins 有 filter tab，整页仍极长。

#### E. CLI / 运行时 `runtime`

| 块 | 内容 | 与扩展关系 |
|----|------|------------|
| CLI 路径 + 版本/auth | 二进制定位 | 无重复 |
| ACP server + 连通性测试 | 远程 agent | 无重复 |
| maxConcurrentAgents / agentIdleMinutes / streamStallSeconds | 进程池 | 与 general 的 Agent **能力开关** 概念相邻但分属两页 |
| Doctor 按钮 | 诊断 | 扩展里 MCP 也有 doctor（不同入口） |
| **ProjectInspectPanel** | inspect JSON 摘要：plugins / skills / mcp / hooks **计数与样本** | **与扩展高度概念重合**（只读诊断 vs 可管理） |
| **ManagedSetupPanel** | `grok setup` 预览/安装 | 独特，但塞在 runtime 底部 |

#### F. Remote IM / 快捷键 / 关于 / 归档

结构相对清晰；Remote IM 已有自己的二级导航。搜索关键词覆盖不足（`remote_im` 缺 `keywordKeys`）。

### 1.4 重复与混淆矩阵

| 主题 | 出现位置 | 性质 | 用户感知 |
|------|----------|------|----------|
| Skills | Extensions 管理 + Runtime Inspect 摘要 | 管理 vs 只读 | 「两处都有 Skills」 |
| MCP | Extensions 管理 + Runtime Inspect 摘要 + MCP Doctor | 管理 / 只读 / 诊断 | 同上 |
| Plugins / Hooks | Extensions + Inspect 计数 | 管理 vs 只读 | 同上 |
| CLI 菜单 | `NAV` 重复两次 | **Bug** | 双 CLI 菜单 |
| Doctor | Runtime 全局 Doctor + Extensions MCP Doctor | 不同工具 | 名称撞车 |
| Agent 相关 | general「Agent」开关 vs runtime 进程池参数 | 能力 vs 运行时配额 | 不知去哪改 |
| CLI 会话导入 | general（shared 模式） | 会话数据 | 名字带 CLI 却不在 runtime |

### 1.5 搜索现状局限

| 能力 | 现状 |
|------|------|
| 滤一级菜单 | ✅ |
| 中英双语匹配 | ✅（`createT(locale)` + `createT("en")`） |
| 跳到具体设置行 | ❌ 只 `openSection` |
| 自动选中页内 tab | ❌ |
| 高亮目标块 | ❌ |
| 强制登记新设置 | ❌ 靠人记得补 `keywordKeys`，易漏 |
| remote_im / 皮肤 / 壁纸 / agent 开关等 | 部分 **未入 keyword 表** |

### 1.6 体量（组件行数，辅助判断「长」）

| 文件 | 约行数 |
|------|--------|
| SettingsPage.tsx | 2712 |
| ExtensionsPanel + BuildExtras | 1370 + 720 |
| Account + Providers | 590 + 758 |
| RemoteImLayout | 452 |
| ProjectInspect + ManagedSetup + PermissionRules | 444 + 283 + 281 |

---

## 2. 问题诊断（产品视角）

1. **一级菜单过载但二级缺失**  
   Account 有 tab，Extensions/General/Runtime 没有 → 不一致。

2. **「管理面」与「诊断面」混装**  
   Extensions = 管理；Inspect = 诊断。同词不同权，应 visually 降级 Inspect（摘要 + 链到扩展），而不是两套长列表。

3. **语义相邻却物理分离**  
   Agent 功能开关（general）vs 进程池（runtime）应同属「Agent / Runtime」叙事，或用 tab 拆清。

4. **搜索是导航滤镜，不是设置索引**  
   用户期望「搜 MCP → 直接到 MCP 面板」；现状是「左栏只剩扩展，还得自己滚」。

5. **无全局登记规则**  
   新人加设置只改 UI，不改搜索目录 → 可搜性必然腐烂。

---

## 3. 改造目标

| 目标 | 验收信号 |
|------|----------|
| 层次清晰 | 每页首屏只见一类职责；页内 tab ≤ 4–5，默认落在最高频 |
| 去重不丢功能 | 无功能删除；Inspect 仍可看，但以链到扩展为主 |
| 修双 CLI | 左栏仅一个「CLI / 运行时」 |
| 搜索可跳转 | 搜任意已登记项 → 打开 section + tab + 滚动/高亮 |
| 后续可维护 | 新设置必须进 registry；文档写进 `docs/llm-wiki` |
| **不改坏设置** | 所有现有 `settingsSet` 字段、扩展 API、登录/提供商流程行为不变 |

### 3.1 明确非目标（本轮不做）

- 不改 `AppSettings` schema / Host 持久化路径  
- 不合并官方账户与自定义提供商的业务逻辑  
- 不重做 Remote IM 二级 IA  
- 不把 Automations 并进设置（仍独立视图）  
- 不做视觉大改版（沿用 `settings-card` / `settings-seg` / 现有 tab 样式）  

---

## 4. 目标信息架构（提案）

### 4.1 一级导航（建议保留 9 项，修重复）

```
个人
  · 常规          general
  · 外观          appearance
  · 账户          account
  · 已归档会话    archived

系统
  · 扩展          extensions
  · CLI / 运行时  runtime     ← 只保留一条
  · 远程 IM       remote_im
  · 键盘          shortcuts
  · 关于          about
```

> 不在本轮拆出「Agent」一级菜单：避免路由/深链破坏；用 **页内 tab** 解决长度。

### 4.2 页内 Tab 划分

#### 常规 `general`

| Tab id | 标题 | 包含 |
|--------|------|------|
| `composer` | 对话偏好 | prefsScope、可用模型只读 |
| `permissions` | 权限 | policy、sandbox、PermissionRulesPanel |
| `agent` | Agent | max turns、preferred agent、memory/subagents/plan/web/leader |
| `app` | 应用 | 语言、sessionDataMode、CLI 会话导入、keychain、memory 清除、reopen、openTarget |

#### 外观 `appearance`（可选 tab；若仍短可保持单页）

| Tab | 内容 |
|-----|------|
| `theme` | 明暗 + 皮肤 |
| `wallpaper` | 壁纸 + scrim |

或单页两个 card 即可（体量小，**可不强制 tab**）。

#### 账户 `account`（已有）

| Tab | 保持 |
|-----|------|
| `official` | AccountPanel |
| `providers` | ProvidersPanel |

路由增强建议：`#/settings/account/providers` 或 query `?tab=providers`（实现阶段二选一，优先 **hash 片段可分享**）。

#### 扩展 `extensions`

| Tab id | 标题 | 现有来源 |
|--------|------|----------|
| `plugins` | 插件 | ExtensionsPanel Plugins 块 |
| `skills` | Skills | Skills 块 |
| `mcp` | MCP | MCP 块 |
| `hooks` | Hooks | BuildExtras Hooks |
| `market` | 市场 | BuildExtras Marketplace |

顶栏 `settings-seg` 切换；**默认 `plugins`**。同一 refresh 逻辑保留（可一次拉数、tab 只控制显示）。

#### CLI / 运行时 `runtime`

| Tab id | 标题 | 包含 |
|--------|------|------|
| `cli` | CLI | 路径、版本、auth、更新（若有） |
| `connection` | 连接 | ACP server + test |
| `pool` | 进程与超时 | concurrent / idle / stall |
| `tools` | 诊断与安装 | Doctor、ProjectInspect（摘要）、ManagedSetup |

**Inspect 去重策略（关键）：**

- Inspect 保留为 **只读健康摘要**（计数 + 刷新 + 复制 JSON）  
- 文案明确：「详细管理请到 设置 → 扩展」并提供 `onOpenExtensions(tab)` 跳转  
- **不删除** inspect API；只缩短占用与认知冲突  

#### 其余

- `archived` / `shortcuts` / `about`：保持单页  
- `remote_im`：保持现有二级 IA  

---

## 5. 搜索与跳转设计

### 5.1 设置目录 Registry（单一事实源）

新建例如 `src/lib/settingsCatalog.ts`（纯数据 + 纯函数，易测）：

```ts
type SettingsEntry = {
  id: string;                    // 稳定 id，如 "agent.subagentsEnabled"
  section: SettingsSectionId;
  tab?: string;                  // 页内 tab id
  anchorId: string;              // DOM id，用于 scrollIntoView
  labelKey: MessageKey;          // 主文案
  descKeys?: MessageKey[];       // 描述/选项等参与搜索
  keywords?: string[];           // 可选英文 alias（mcp, cli…）
};
```

- `NAV` 的 `keywordKeys` **由 registry 聚合生成**，禁止手写两份。  
- 搜索匹配：`label + desc + keywords`，中英 `createT`。  
- 结果 UI：  
  - 左栏：仍可滤 section  
  - **增强**：下拉/内嵌「命中项」列表（设置名 + 所在路径「扩展 › MCP」）  

### 5.2 跳转协议

```
navigateSettings({ section, tab?, anchorId?, highlight?: true })
```

行为顺序：

1. `setSettingsSection(section)` + 更新 hash  
2. 若有 tab → 设置页内 tab state（必要时通过 props/context/hash）  
3. `requestAnimationFrame` / 短 delay 后 `document.getElementById(anchorId)?.scrollIntoView`  
4. 短暂 CSS 高亮（`is-search-hit`）  

Hash 建议（兼容旧链）：

| 旧 | 新（兼容） |
|----|------------|
| `#/settings/general` | 仍有效，默认 tab |
| — | `#/settings/extensions/mcp` |
| — | `#/settings/runtime/cli` |
| — | `#/settings/account/providers` |

解析：`section` 必填；第二段为 tab；未知 tab 回落默认 tab，**不白屏**。

### 5.3 搜索覆盖验收清单（抽测）

| 关键词（中/英） | 应到 |
|-----------------|------|
| MCP / 服务器 | extensions → mcp |
| skill / 技能 | extensions → skills |
| plugin / 插件 | extensions → plugins |
| hooks | extensions → hooks |
| CLI 路径 / cli path | runtime → cli |
| ACP | runtime → connection |
| 权限 / YOLO / always approve | general → permissions |
| 语言 / language | general → app |
| 壁纸 / wallpaper | appearance |
| 提供商 / provider | account → providers |
| 飞书 / remote | remote_im |
| doctor | runtime → tools（及可区分 MCP doctor） |

---

## 6. 全局规则（写入 `docs/llm-wiki` + Agents.md）

新增 **`docs/llm-wiki/settings-ia.md`**，并在 `Agents.md` 的 Read first 挂链。规则草案：

1. **所有用户可见设置**必须登记到 `settingsCatalog`（labelKey + section + tab + anchorId）。  
2. **禁止**只改 UI 不登记；PR 检查：新增 `settings-row` / 设置开关时 catalog 有对应 id。  
3. 文案走 `createT` / `messages.ts`（+ zh-TW），**禁止**硬编码中英。  
4. 确认类交互只用 in-app dialog（既有 dialogs 规则）。  
5. 新增「整块设置」优先：页内 tab > 新一级菜单；一级菜单只在跨产品域时扩展。  
6. 管理面 vs 诊断面：管理进 Extensions；诊断/安装工具进 Runtime，并互链。  
7. 测试：catalog 单测（id 唯一、section 合法、每个 entry 的 MessageKey 存在）；关键跳转 smoke。  

---

## 7. 实施分期（保证不改坏功能）

### Phase 0 — 止血（低风险，建议先做）

- [ ] 删除 `NAV` 重复的 `runtime` 条目  
- [ ] 为 `remote_im` 补 `keywordKeys`（或改为 registry 后自然修复）  
- [ ] 为 appearance 补 skin/wallpaper 关键词  
- [ ] **零行为变更**，仅修导航 bug 与可搜缺口  

### Phase 1 — Registry + 搜索跳转骨架

- [ ] 引入 `settingsCatalog.ts`，把现有项迁入（先全量登记，UI 仍可旧布局）  
- [ ] `navigateSettings` 支持 section（暂可不 scroll）  
- [ ] 单测：catalog 完整性  
- [ ] **不改** 各 panel 保存逻辑  

### Phase 2 — 页内 Tab（按页拆，可独立 PR）

顺序建议：

1. **Extensions**（收益最大：Plugins/Skills/MCP/Hooks/Market）  
2. **General**（Composer / Permissions / Agent / App）  
3. **Runtime**（CLI / Connection / Pool / Tools）  
4. Account hash 同步 tab（official/providers）  
5. Appearance 视需要  

每页验收：

- 切换 tab 不丢未保存输入（本应用多为即时写入，注意受控 state）  
- 刷新/深链落到正确 tab  
- 原按钮/开关仍调用同一 handler  

### Phase 3 — Inspect 认知降噪

- [ ] Runtime Inspect 改为紧凑摘要 +「在扩展中管理」链接  
- [ ] 保留 copy JSON / open `.grok`  
- [ ] 文档更新 `docs/llm-wiki`  

### Phase 4 — 文档与门禁

- [ ] `settings-ia.md` + Agents.md 链接  
- [ ] CONTRIBUTING 或 maintain 中一句「新设置必登记」  
- [ ] 可选：简单 lint/test 断言 catalog 覆盖  

---

## 8. 风险与防回归

| 风险 | 缓解 |
|------|------|
| Tab 重构时漏挂 props/handler | 只搬 JSX 块，不改 handler 签名；每 PR 手测该页全部控件 |
| 深链破坏旧书签 | 仅 section 的 hash 永远有效 |
| 搜索跳转时 tab 未挂载导致 scroll 失败 | tab 切换后再 scroll；失败静默回落 section 顶部 |
| Phone 布局 | tab 条横向可滚动；drill-down 仍 section 级 |
| i18n 漏 key | catalog 单测检查 MessageKey |
| 双写 keywordKeys | 废弃手写 NAV keywords，只从 registry 生成 |
| 误改 settings 持久化 | **本计划禁止改** `settings_get/set` 字段含义；code review 盯 `api.settingsSet` |

### 回归检查表（每阶段）

- [ ] 改语言 / 主题 / 权限策略 → 重启仍在  
- [ ] 官方登录 / 退出 / 切换提供商 → 仍可用  
- [ ] 扩展：skill/mcp 开关、plugin enable  
- [ ] CLI 路径 blur 保存、ACP test、Doctor 打开  
- [ ] Remote IM 原二级路由  
- [ ] 手机宽度：索引/详情、返回  

---

## 9. 建议落地文件

| 动作 | 路径 |
|------|------|
| 新增 registry | `src/lib/settingsCatalog.ts` + `settingsCatalog.test.ts` |
| 壳改造 | `src/components/SettingsPage.tsx`（拆 tab state / 解析 hash） |
| 扩展 tab | `src/components/ExtensionsPanel.tsx`（+ 抽出的 section 组件可选） |
| 文档 | `docs/llm-wiki/settings-ia.md` |
| 挂链 | `Agents.md`、`docs/llm-wiki/README.md` |
| 样式 | 复用 `.settings-account-tabs` / `.settings-seg`，必要时抽 `.settings-page__tabs` |

---

## 10. 成功标准（Done）

1. 左栏 **只有一个** CLI / 运行时。  
2. 扩展 / 常规 / 运行时首屏不再「五屏长文」；靠 tab 分块。  
3. 搜「MCP」「壁纸」「权限」「ACP」等可 **直达** 对应块。  
4. 所有现有设置项行为与持久化与改前一致（抽样 + 关键路径手测）。  
5. `settings-ia.md` 生效：新设置 PR 必须带 catalog 条目。  

---

## 11. 下一步（等你拍板）

请确认或调整：

1. **一级菜单是否保持 9 项**（本方案），还是希望拆出独立「Agent」？  
2. **Extensions 五个 tab** 是否接受（plugins/skills/mcp/hooks/market）？  
3. **Inspect**：保留紧凑摘要 vs 完全移出 Runtime 仅放扩展底部？  
4. **Hash 形态**：`#/settings/extensions/mcp` vs query `?tab=`？  
5. 是否同意 **Phase 0 先修双 CLI**（可单独小 PR，零功能风险）？  

确认后按 Phase 0 → 1 → 2 开工；默认 **不改任何设置读写语义**。
