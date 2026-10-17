# Grok Desktop 对照分析报告

| 字段 | 值 |
|------|-----|
| 分析对象 | [fanghui-li/Grok-Desktop](https://github.com/fanghui-li/Grok-Desktop)（本地克隆：`/tmp/Grok-Desktop`，v0.1.2） |
| 对照主体 | 本仓库 **Grok App**（Tauri 2 + React，`~/.grok-app`） |
| 日期 | 2026-07-22 |
| 目的 | 资源面板升级、快捷打开、服务商/中转接入（含 CPA / sub2api 类）、赞助商挂名模式 |

---

## 1. 对方项目速览

### 1.1 定位

**Grok Desktop** = Electron 桌面壳 + 本地 Host，驱动 **Grok Build agent**（`grok agent stdio` / ACP）。  
营销话术：「操作体验对齐 Codex」·「官方登录 + 自定义中转」·「多项目会话」。

| 维度 | Grok Desktop | 我们 Grok App |
|------|--------------|---------------|
| 壳层 | **Electron 35** + 原生 TS Renderer（无 React） | **Tauri 2** + React + Vite |
| Host 语言 | Node/TS（Main 与 Host 同进程模块） | Rust（`src-tauri`） |
| 数据目录 | `~/.grok-desktop`（`GROK_HOME` 指向此目录） | `~/.grok-app`（`GROK_APP_HOME` 可覆盖） |
| 与 CLI 关系 | **隔离** CLI `~/.grok`，避免互相覆盖 | 默认独立；可共享/导入 CLI auth |
| 内置 agent | 可打包 `agent-bin/` → `resources/agent/` | **不内嵌** CLI（产品 D4：引导安装） |
| 协议 | **ACP** JSON-RPC over stdio（`grok agent stdio`） | **同左** — 双方都不是自研 agent 大脑 |
| License | Apache-2.0 | 本仓自定 / MIT 社区客户端定位 |

### 1.2 仓库结构（关键）

```
src/main/          Electron 主进程 + IPC 分发
src/host/          Desktop Host（providers / files / editors / acp / projects…）
src/renderer/      UI（side-pane / settings-page / plugins-page / main.ts）
src/shared/        IPC 类型、i18n、theme
docs/              架构与协议、CLI↔Desktop 能力矩阵
```

### 1.3 与 Codex 对齐的产品表面

三栏：左项目/会话 · 中对话 · **右可展开侧栏（分类轨 + 文件预览）**。  
设置：**账户与提供商双 Tab**（官方 OAuth / 自定义中转）。  
输入区：权限 chip、模型 chip、Plan/Goal chip、`@` 文件、`/` 命令。

---

## 2. 资源面板（Side Pane）——对方实现解剖

### 2.1 信息架构

对方不是「单一文件列表」，而是 **Codex 式右侧工作台**：

```
aside#side-pane
├── side-pane-main
│   ├── side-cat-view[files]     ← 主路径：多标签 + 预览 + 菜单树
│   │   └── side-files-split
│   │       ├── 左：tabs 行 + 面包屑 + ⋯菜单 + 预览体
│   │       └── 右：筛选 + file-tree（可收起）
│   ├── side-cat-view[browser]   ← 占位说明（agent 工具）
│   ├── side-cat-view[terminal]  ← 占位 + cwd 展示
│   ├── side-cat-view[agents]    ← 子代理树（实时）
│   └── side-cat-view[plan]      ← plan.md 编辑/批准（不进分类轨）
└── nav.side-cat-rail            ← 竖向分类轨：文件 / 子代理 / 浏览器 / 终端
```

实现文件：`src/renderer/side-pane.ts`（~1200 行）+ `index.html` 结构。

### 2.2 多标签（FileTab）

```ts
type FileTab = {
  id: string;
  path: string; absPath: string;
  content: string; draft: string;   // 可编辑缓冲
  language: string; line?: number;
  dirty: boolean; truncated: boolean;
  binary: boolean; isDirectory: boolean;
};
```

能力清单：

| 能力 | 说明 |
|------|------|
| 多 Tab 打开 | 点击树节点 / 对话中路径 → `openFile`；同路径复用 Tab |
| 关闭 / 切换 | Tab 条 + ✕；关闭后激活相邻 |
| 脏标记 | `draft !== content` → dirty 样式 |
| Markdown | `.md` → 安全 HTML 预览（`renderMarkdownToSafeHtml`） |
| 代码 | highlight.js + 行号 gutter；`contenteditable` 编辑 |
| 保存 | 写回磁盘（非 md 文本） |
| ⋯ 菜单 | 在编辑器打开 / 复制路径 / 复制内容 / 保存 / 资源管理器显示 |
| 焦点模式 | 聊天区隐藏，侧栏全宽 + 底部悬浮输入（对齐 Codex 文件沉浸） |
| 持久化 | `localStorage`：展开状态、宽度、当前分类 |

### 2.3 菜单树（File Tree）

- 懒加载目录：`treeCache` + `expandedDirs`
- 筛选框 + 刷新；可与 `fs.watch` 联动防抖刷新
- 布局：**预览在左、树在右**（与常见 IDE「树左预览右」相反，明确对齐 Codex）
- 树列可折叠（`btn-tree-toggle`）

### 2.4 与我们 `ResourceViewer` 的差距

| 维度 | Grok Desktop | 我们（现状） |
|------|--------------|--------------|
| 布局 | 分栏：预览 ∥ 树同时可见 | **互斥**：`tree` / `preview` 栈式切换（点开再返回） |
| 多标签 | ✅ 完整 Tab 条 | ❌ 单文件预览 |
| 分类轨 | 文件 / 子代理 / 浏览器 / 终端 | ❌ 仅文件资源 |
| 代码高亮编辑 | highlight + 可编辑 + 保存 | 文本预览为主 |
| 媒体 | 偏代码/MD | **更强**：图/音/视/PDF + asset protocol |
| 对话路径点击 | 侧栏打开对应文件 | 部分链路有，未形成完整「路径→Tab」产品面 |
| 外部打开 | 编辑器探测 + openInEditor | `path_reveal` 有；**无**编辑器探测/「在 Cursor 打开」 |
| Plan/Agents | 侧栏一等公民 | Plan/Goal 未做侧栏分类 |
| 焦点模式 | 有 | 无 |

**结论：** 对方「资源面板」= 多分类工作台 + **文件多标签 IDE 预览**。  
我们已有较好的多媒体预览，但缺 **多标签 + 分栏树 + 分类轨 + 外部编辑器快捷打开**。

---

## 3. 快捷打开（已安装应用探测）

### 3.1 对方实现：`editors.ts`

启动/设置时调用 `system.listEditors` → `detectEditors()`：

**候选应用（硬编码白名单）：**

| id | 产品 | 探测方式 |
|----|------|----------|
| `code` | VS Code | `which/where` + 常见安装路径 |
| `cursor` | Cursor | 同上 |
| `codium` | VSCodium | 同上 |
| `windsurf` | Windsurf | 同上 |

解析顺序：PATH 命令名 → `pathHints` 绝对路径存在性。

配置项：`defaultOpenTarget` = `explorer` | `code` | `cursor` | …（写在 Desktop settings）。

使用点：

1. **侧栏 ⋯ → 在编辑器中打开** → `system.openInEditor { path, line?, editor? }`
2. **设置 → 常规** 下拉「默认打开位置」
3. **斜杠/命令** 等打开目标
4. 遗留值 `editor`：优先 Cursor → VS Code → 第一个探测到的

实现打开：`spawn(cmd, ["-g", "path:line"])` 等（见 `changes.ts` `openInEditor`）。

### 3.2 我们缺什么

| 项 | 状态 |
|----|------|
| 启动扫描已装编辑器 | ❌ |
| 设置里选择默认打开目标 | ❌ |
| 会话内快捷「用 Cursor/VS Code 打开文件」 | ❌ |
| Finder/资源管理器 Reveal | ✅ `path_reveal` / `project_reveal` |

**借鉴建议（Tauri 侧）：**

```
// 伪接口
list_detected_editors() -> Vec<{ id, label, command, available }>
open_in_editor(path, line?, editor_id?)
// 启动时缓存到 AppState；设置页 + ResourceViewer ⋯菜单共用
```

macOS 可额外探测 `/Applications/*.app` + `open -a`；Windows 沿用对方 pathHints 思路。  
会话维度：记住「本会话默认编辑器」，允许覆盖全局 `defaultOpenTarget`。

---

## 4. 外部服务商 / Base URL / API Key —— 核心机制

> **重要结论：** 仓库内 **没有** 写死「CPA」「sub2api」字符串。  
> 它们走的是 **通用 OpenAI 兼容中转** 模型；CPA / sub2api / OneAPI / NewAPI / grok-go 只要暴露 `base_url` + `api_key`（及可选 `/v1/models`）即可接入。

### 4.1 配置真源：Desktop `GROK_HOME/config.toml`

路径：`~/.grok-desktop/config.toml`（由 `GROK_HOME` 环境变量指定）。

写入形态（由 `src/host/providers.ts` 管理）：

```toml
[models]
default = "my-relay"

[model.my-relay]
model = "grok-4.5"                    # 请求体里的 model 字段
base_url = "https://xxx.example.com/v1"
name = "我的中转"
api_key = "sk-..."
api_backend = "chat_completions"      # | responses | messages
```

要点：

1. **有 `base_url` 的段 = 自定义提供商**；必须自带 `api_key`，**不回落 OAuth**。
2. 列表 API 只回传 `hasApiKey: boolean`，**不明文回显** Key。
3. 空 Key 提交 = 保留原 Key（编辑友好）。
4. `api_backend` 兼容 Chat Completions / Responses / Anthropic Messages（agent 侧消费）。
5. 段 id 含 `.` 时用引号表头，避免 TOML 嵌套误解析。

### 4.2 环境隔离：如何让 Agent 读到中转

```ts
// host.ts constructor
this.env = {
  ...process.env,
  GROK_HOME: desktopGrokHome,  // ~/.grok-desktop
  // COMPAT_DISABLED_ENV、GROK_MEMORY …
};
// spawn agent / grok login 一律带此 env
```

链路：

```
用户 UI 保存提供商
  → providers.upsert 写 ~/.grok-desktop/config.toml
  → 新对话 spawn: env.GROK_HOME=~/.grok-desktop
  → Grok agent 读 config.toml 的 [model.*] + [models].default
  → 请求打到用户的 base_url（CPA/sub2api/…）
```

官方登录：`GROK_HOME=~/.grok-desktop grok login …` 写 **Desktop 自己的** `auth.json`，与 CLI `~/.grok` 分离。

### 4.3 UI 能力（设置 → 账户与提供商 → 自定义）

| 能力 | 实现 |
|------|------|
| 多提供商列表 | 卡片：名称、默认标记、Ping 延迟、启用/编辑/删除 |
| 表单字段 | 名称、Base URL、协议、API Key、配置段 id、请求 model |
| 拉模型列表 | `GET {base}/models` + Bearer；下拉选择 |
| 连通 Ping | 同端点；401/403 仍算「可达」（测网络） |
| Base64 解 Key | 部分中转「伪装」Key 时一键还原 |
| 设为默认 | 写 `[models].default` + desktop settings |
| 打开 config.toml | 一键用系统打开文件 |
| 对话中切换 | 模型 chip 展示 config 中的 display name |

IPC 方法：`providers.list|upsert|remove|setDefault|listRemoteModels|ping`。

### 4.4 CPA / sub2api 在实践中怎么填

| 字段 | 典型填法 |
|------|----------|
| Base URL | `https://<你的域名>/v1`（sub2api/OneAPI 常以 `/v1` 结尾） |
| API Key | 面板发放的 `sk-...` 或令牌 |
| Protocol | 多数用 **OpenAI Chat Completions**；若网关只走 Anthropic 则选 Messages |
| Request model | 网关侧模型 id（可先「拉取模型」） |
| 配置段 id | 本地唯一 slug（如 `cpa-main`、`sub2api-work`） |

对方 **不** 需要为每个中转品牌写适配器——**OpenAI 兼容契约即接入层**。

### 4.5 我们的中转现状与断层

我们已有：

| 能力 | 位置 | 完备度 |
|------|------|--------|
| `SecretsFile.relay_base_url` / `relay_api_key` | `store.rs` | 单中转槽位 |
| Onboarding prompt 填 base + key + Ping | `App.tsx` | 简陋（`window.prompt`） |
| `provider_ping` | `commands.rs` | 测 relay `/models` |
| 导入 grok-go config | `import_grok_go_config` | 读常见路径 |
| 账户 channel 展示 `relay` | `account.md` / AccountPanel | 展示层 |
| **多提供商** | — | ❌ |
| **写 CLI/agent 可读的 config.toml** | — | ❌ 关键断层 |
| **spawn agent 时注入 GROK_HOME / 同步中转** | `acp_client.rs` | ❌ 仅扩 PATH |
| 设置页完整提供商管理 | Settings | ❌ Account 偏官方会员 |
| 拉模型列表 / 多 backend | — | ❌ |

**产品需求文档已写明**（`docs/项目需求.md`）：中转用户是目标用户；P0 含「自定义 OpenAI 兼容中转 + Ping + 导入」。  
但工程上 **secrets 存了却未成为 agent 的真配置源**——用户填了 CPA/sub2api，Agent 仍可能只吃 `~/.grok` 官方登录或空配置。

---

## 5. 全量差异对照表

### 5.1 架构与运行时

| 点 | Grok Desktop | Grok App | 谁更合适我们 |
|----|--------------|----------|--------------|
| 壳 | Electron | Tauri | **保持 Tauri**（包体/内存/安全模型已选） |
| Host | TS 同进程 | Rust | 保持 Rust；可移植对方 **API 形状** |
| Agent 打包 | 可内置 | 不内置 | 保持不内置；可做路径探测引导 |
| 数据隔离 | 强制 Desktop GROK_HOME | independent/shared | 中转配置应写入 **App 可控、agent 可读** 的 profile |
| 单实例 | 有 | 需核对 | 对方 D+ 可借鉴 |
| 能力矩阵文档 | `cli-desktop-capability-matrix.md` | `P0-能力矩阵.md` | 两边都好；可互链 |

### 5.2 资源与工作台

| 点 | Desktop | App | 借鉴优先级 |
|----|---------|-----|------------|
| 右栏分栏预览+树 | ✅ | 栈式 | **P0 升级** |
| 多标签 | ✅ | ❌ | **P0** |
| 分类轨（文件/agents/…） | ✅ | ❌ | P1（先文件） |
| 多媒体预览 | 弱 | **强** | 我们优势，保留 |
| 文件可编辑保存 | ✅ | 弱 | P1 |
| 对话路径 → 打开 | ✅ | 部分 | P0 |
| 焦点模式 | ✅ | ❌ | P2 |

### 5.3 快捷打开

| 点 | Desktop | App | 借鉴优先级 |
|----|---------|-----|------------|
| 探测 VS Code/Cursor/… | ✅ | ❌ | **P0** |
| 设置默认打开目标 | ✅ | ❌ | **P0** |
| 侧栏/会话内打开 | ✅ | Reveal only | **P0** |
| 带行号跳转 | ✅ | ❌ | P1 |

### 5.4 账户与服务商

| 点 | Desktop | App | 借鉴优先级 |
|----|---------|-----|------------|
| 官方 OAuth 双通道隔离 | Desktop auth.json | 共享 CLI `~/.grok` + App secrets | 我们官方路径更贴 CLI；中转需补齐 |
| 多自定义提供商 | ✅ config.toml | 单 relay 槽 | **P0** |
| 图形化 CRUD + Ping + 拉模型 | ✅ | 半成品 | **P0** |
| Base64 Key 工具 | ✅ | ❌ | P1（中转生态友好） |
| 协议 backend 三选一 | ✅ | ❌ | P1 |
| 模型 chip 跟 config | ✅ | 硬编码 `grokCatalog` | P0（中转模型 id 必须可扩展） |
| SuperGrok 额度/热力图 | 弱/无 | **我们更强** | 官方侧优势，保留 |
| 赞助商挂名位 | 无 | 无 | **新需求**（见 §7） |

### 5.5 我们明显领先的点

1. **官方账户体系**：membership、SuperGrok 额度、heatmap、call logs（`account.md`）。  
2. **媒体资源预览**：图片查看器、音视频、PDF。  
3. **权限 UX 更细**：Ask / once / session / Deny 产品模型。  
4. **i18n / design-tokens / 验收基建** 更成体系。  
5. **Tauri 包体与安全边界** 更利于长期桌面产品。

---

## 6. 值得借鉴清单（按落地顺序）

### P0 —— 直接提升日用与中转转化

1. **提供商一等公民（多中转）**  
   - UI：设置 →「账户」拆 **官方 | 自定义提供商** 双 Tab。  
   - 存储：推荐写 **Agent 可读** 配置（对齐 Grok：`[model.*]` + `base_url`/`api_key`），而不是仅 App 私有 secrets。  
   - 行为：Ping、拉模型、设默认、删除后清理幽灵 model id。  
   - 启动/会话：spawn agent 时 `GROK_HOME` 或显式把 App profile 同步到 CLI 可读位置。

2. **资源面板升级到「分栏 + 多标签」**  
   - 左预览 / 右树（或可配置方向）。  
   - 多 Tab；对话路径点击打开 Tab。  
   - 保留我们的多媒体 kind 分支。

3. **已安装编辑器探测 + 快捷打开**  
   - `list_detected_editors` + `open_in_editor`。  
   - 设置默认目标；侧栏 ⋯ 菜单与输入区快捷入口。

### P1 —— 对齐 Codex 体验与中转友好

4. 侧栏分类轨骨架（文件 / 子代理 / Plan 入口）。  
5. Base64 Key 解码、api_backend 协议选择。  
6. 从对话路径带行号打开外部编辑器。  
7. 模型菜单合并：官方 catalog + 自定义提供商 models。

### P2 —— 差异化与商业

8. 赞助商挂名 / 推荐中转入口（见 §7）。  
9. 文件焦点沉浸模式。  
10. 内嵌浏览器/终端仍非首版（双方都弱，可继续不做）。

---

## 7. 服务商接入模式 × 吸引赞助商付费挂名

### 7.1 目标

让 **中转服务商 / CPA 渠道 / sub2api 部署商** 愿意付费获得：

- 设置页「推荐提供商」位  
- 关于页 / 启动欢迎「由 xxx 赞助」  
- 一键填充 Base URL 模板（用户仍自己填 Key）  
- 可选：默认模型列表预设、文档外链  

同时保持：**开源可信、不锁死、不明文窃 Key、用户可完全自定义**。

### 7.2 推荐架构：三层提供商模型

```
┌─────────────────────────────────────────────────────────┐
│ L1 官方通道（Official）                                   │
│   grok login / official key · 额度/热力图 · 不混中转 Key   │
├─────────────────────────────────────────────────────────┤
│ L2 用户自定义（User Providers）—— 核心能力                 │
│   任意 base_url + key · 多配置 · Ping · 拉模型 · 默认      │
│   兼容：CPA / sub2api / OneAPI / grok-go / 自建网关        │
├─────────────────────────────────────────────────────────┤
│ L3 赞助/目录提供商（Sponsored Catalog）—— 商业层          │
│   远程 manifest（签名/HTTPS）或打包内静态目录               │
│   仅「模板 + 品牌」；Key 永远用户自填；可一键「添加为自定义」 │
└─────────────────────────────────────────────────────────┘
```

### 7.3 赞助商 Manifest 草案

```jsonc
// https://cdn.example.com/grok-app/providers.v1.json
{
  "version": 1,
  "updatedAt": "2026-07-22",
  "sponsors": [
    {
      "id": "sponsor-acme",
      "tier": "gold",                 // gold | silver | community
      "displayName": "Acme API",
      "tagline": { "zh-CN": "稳定 Grok 中转", "en-US": "Reliable Grok relay" },
      "logoUrl": "https://…/logo.svg",
      "homepage": "https://acme.example",
      "docsUrl": "https://acme.example/docs",
      "baseUrlTemplate": "https://api.acme.example/v1",
      "apiBackend": "chat_completions",
      "suggestedModels": ["grok-4.5", "grok-3"],
      "utm": "utm_source=grok-app&utm_medium=sponsor",
      "badge": "推荐",
      "activeFrom": "2026-07-01",
      "activeTo": "2026-12-31"
    }
  ]
}
```

产品规则：

| 规则 | 说明 |
|------|------|
| 不代持 Key | App 从不替赞助商存用户 Key 到赞助商服务器 |
| 一键添加 = 复制到 L2 | 用户仍可改 URL/删掉 |
| 可关闭推荐 | 设置「显示赞助商推荐」开关，默认开；尊重用户 |
| 失效自动降级 | 过期/拉取失败 → 隐藏卡片，不影响 L1/L2 |
| 审计 | 赞助位变更可写 changelog；开源用户可审 manifest URL |

### 7.4 变现档位（示意）

| 档位 | 权益 | 适合 |
|------|------|------|
| **Community** | 目录列表一行 + 外链 | 小站长 / 自建 sub2api |
| **Silver** | 设置页卡片 + logo + 一键模板 | 中型中转 |
| **Gold** | 欢迎页挂名 + 设置置顶 + 季度更新位 | CPA 渠道主 / 大站 |

对 CPA：挂名的是 **渠道品牌 + 注册/充值链接**，不是劫持请求。  
对 sub2api：挂名的是 **「兼容 sub2api 的部署模板」**（Base URL 形态说明），降低用户配置成本。

### 7.5 与 Grok Desktop 的差异化打法

| Desktop | 我们可做的「多一步」 |
|---------|---------------------|
| 纯通用中转表单 | 通用表单 **+** 赞助目录 + 官方账户深集成 |
| 无商业位 | 透明赞助位（开源可信） |
| 弱官方额度 | SuperGrok 额度/热力图继续做深 → **官方用户不流失** |
| 单 Desktop profile | App 可同时服务「官方重度」与「中转重度」两群人 |

### 7.6 工程落地最小切片（建议迭代）

**迭代 A（必须）：L2 用户自定义可用**

- [ ] `providers` 模块：读写 agent 可读 config（或同步策略写清）  
- [ ] 设置双 Tab UI  
- [ ] Ping + 拉模型 + 设默认  
- [ ] spawn 时保证 agent 读到配置  
- [ ] 模型 chip 列出自定义 model id  

**迭代 B：资源面板 + 快捷打开**

- [ ] ResourceViewer 分栏 + 多 Tab  
- [ ] editors 探测 + open_in_editor  
- [ ] ⋯ 菜单：Reveal / 编辑器打开 / 复制路径  

**迭代 C：L3 赞助**

- [ ] manifest 拉取 + 缓存  
- [ ] 设置页赞助卡片 → 一键创建 L2 草稿  
- [ ] 关于页 / 欢迎页 Gold 挂名  
- [ ] 开关 + 过期处理  

---

## 8. 配置写入策略建议（避免再出现「存了 Key 但 Agent 不用」）

推荐 **方案 A（对齐 Desktop，改动清晰）**：

1. App 独立 profile 目录，例如 `~/.grok-app/agent-home/`（或复用 `~/.grok-app`）。  
2. 启动 agent 时设置 `GROK_HOME=<agent-home>`（与 CLI 默认隔离，符合 D2 independent）。  
3. 提供商 CRUD 直接维护该目录下 `config.toml` 的 `[model.*]`。  
4. 官方登录：对该 profile 跑 `grok login`，或可选「链接本机 CLI auth」导入。  

备选 **方案 B**：继续用 `~/.grok`，中转写入用户 CLI config——实现快，但污染 CLI、与「独立会话」叙事冲突。

**不推荐：** 仅存在 App secrets 却不写 config、不改 env——即当前最大缺口。

---

## 9. 风险与合规

| 风险 | 缓解 |
|------|------|
| 赞助商被理解为「官方推荐 xAI」 | UI 标明「社区赞助 / 第三方中转」；关于页写非官方 |
| Key 泄露 | 日志 redact；UI 仅 hasKey；密钥存系统安全存储或 agent-home 权限收紧 |
| 恶意 manifest | HTTPS + 可选签名；默认官方 CDN；用户可关 |
| 中转合规 | 不替用户处理上游 ToS；文档提示自担风险 |
| 与 Desktop 功能撞车 | 差异化：Tauri + 官方账户深 + 赞助透明 + 多媒体资源 |

---

## 10. 总结

1. **Grok Desktop** 是成熟的 Electron 版「Codex 形 Grok 壳」：侧栏多标签资源台、编辑器探测、**多自定义提供商写 config.toml + GROK_HOME 隔离** 是其最完整的三块能力。  
2. **CPA / sub2api** 并未特判，而是吃 **OpenAI 兼容 base_url + api_key**；我们要做的是同一契约的 **一等公民 UI + 真正喂给 Agent**。  
3. 我们已在官方账户、媒体预览、权限与工程规范上领先；**中转闭环与资源多标签/快捷打开** 是当前最大体验落差。  
4. 商业上：在 L2 通用接入之上叠加 **L3 赞助目录/挂名**，可在不牺牲开源信任的前提下吸引中转赞助商付费；前提是 L2 必须先「真能连上、能切换、能日用」。

---

## 附录 A：对方关键文件索引

| 主题 | 路径 |
|------|------|
| 提供商读写 | `src/host/providers.ts` |
| 编辑器探测 | `src/host/editors.ts` |
| 侧栏 UI | `src/renderer/side-pane.ts` |
| 设置/提供商表单 | `src/renderer/settings-page.ts` |
| GROK_HOME 注入 | `src/host/host.ts`（constructor `this.env`） |
| 路径约定 | `src/host/paths.ts` |
| 能力矩阵 | `docs/cli-desktop-capability-matrix.md` |
| 架构 | `docs/架构与协议.md` |

## 附录 B：我们关键文件索引

| 主题 | 路径 |
|------|------|
| 资源面板 | `src/components/ResourceViewer.tsx` |
| FS 后端 | `src-tauri/src/fs_browser.rs` |
| Secrets / 单中转 | `src-tauri/src/store.rs` `SecretsFile` |
| Ping / 导入 | `src-tauri/src/commands.rs` |
| Agent spawn | `src-tauri/src/acp_client.rs` |
| 账户产品规则 | `docs/llm-wiki/account.md` |
| 需求中转章节 | `docs/项目需求.md` §3 C 账户 |

## 附录 C：参考截图（上游仓库）

上游 `docs/images/`：`home.png` · `workspace.png` · `providers.png` · `plan.png` · `plugins.png`  
（分析时已从 GitHub 克隆获取，未改本仓资源。）
