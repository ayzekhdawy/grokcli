<!-- /autoplan restore point: /Users/ronglecat/.gstack/projects/grok-app/main-autoplan-restore-20260721-184846.md -->
# Grok App · Autoplan 实施规格（可编码版）

> **状态：** `/autoplan` **APPROVED**（2026-07-21 · 用户选 A 批准 as-is）  
> **模式：** SELECTIVE EXPANSION（锁住 P0 不砍，体验与边界补全可 cherry-pick）  
> **源文档：** [`项目需求.md`](./项目需求.md) · [`P0-能力矩阵.md`](./P0-能力矩阵.md) · [`design-tokens.md`](./design-tokens.md) · [`参考图.png`](./参考图.png)  
> **硬约束（用户）：** 核心功能不删减 · 优化体验 · 清晰边界 · 为落实代码做好准备

---

## 0. 工作材料（Phase 0）

| 项 | 结论 |
|----|------|
| 仓库状态 | 仅 `docs/`，无应用代码、无 git remote/commits |
| UI scope | **是**（三栏壳、Onboarding、权限条、主题） |
| DX scope | **是**（开发者桌面工具；CLI 探测/安装、Doctor、导入配置） |
| 本地可复用 | `desktop-app/grok-go`（Tauri2+React19+Vite）、本机 `grok 0.2.106`、`~/.grok` |
| ACP 主路径 | `grok agent stdio`（JSON-RPC over stdio） |
| 参考图 | 极深暗色三栏；左导航+Recents；中 Chat+Plan 卡；底栏模型/effort/权限 chip |

**Here's what I'm working with:** 本机 Grok Build 桌面指挥台（对标 Codex/Claude Desktop 的本地 Agent 壳）。UI 与 DX 均在范围内。已加载 CEO → Design → Eng → DX 全深度管线，中间问题按 6 原则自动决策；前提与 User Challenge 给人拍板。

---

## 1. 产品定位（不变）

**Grok App = 本机 Grok Build 的桌面指挥台。**

| 产品 | 边界 |
|------|------|
| **Grok App** | 项目 / 会话 / 对话 / 权限 / 模型 / 中转账号 / Doctor |
| **grok-go** | 本地中转网关；本 App **只导入配置**，不内嵌网关 UI |
| **agent-connect** | IM 桥；**本产品不做** |
| **Grok Build CLI** | 真正干活的运行时；App 通过 ACP 驱动，**不内嵌** |

品牌：MIT · **非 xAI 官方** · 姐妹项目 grok-go · 作者 X cgnot996。

---

## 2. 锁定前提（D1–D7 + 工程前提）

| ID | 前提 | 若错的代价 |
|----|------|------------|
| P1 | 日用价值 = 可视化会话 + 权限 + 多项目隔离，而非「又一个 Chat UI」 | 做成薄聊天窗，CLI 用户无迁移动机 |
| P2 | ACP `grok agent stdio` 是主循环；`grok -p` 仅诊断/脚本 | 会话状态与工具流做不稳 |
| P3 | 不内嵌 CLI；启动探测 / 引导下载 / 手动路径 | 包体积与版本地狱 |
| P4 | 默认 `session_data_mode=independent`（`~/.grok-app`）；`shared` 可选且强提示 | 污染 CLI 历史或用户丢会话 |
| P5 | 欢迎页三入口并列：官方 / 中转 / 导入 grok-go | 中转用户流失 |
| P6 | 写文件/执行命令默认需审批（D7）；全局 YOLO 非默认 | 信任崩盘 |
| P7 | 首发 macOS arm+x64 + Windows x64；Linux 后置 | 首发面过大 |
| P8 | 技术栈 Tauri 2 + React + TS（对齐 grok-go） | 与姐妹项目分叉维护成本 |

> **前提门：** 见对话中 D1 确认。通过后写入本节「已确认」。

---

## 3. 范围冻结

### 3.1 P0 核心（**禁止删减**）

与能力矩阵 A–K + 剧本 M 对齐（约 80 检查点，全部 PASS 才可宣称日用就绪）：

- 壳：无边框圆角、mac 交通灯 / Win 自绘、三栏、明暗主题全覆盖、中英 UI  
- 运行时：探测 / 引导装 CLI / 手动路径 / 版本不匹配提示 / **不内嵌**  
- Onboarding：三入口、Keychain、Ping、跳过可先进壳  
- 项目：添加、信任、最近、移除、路径异常  
- 会话模式：独立默认 / 共通可选 / 禁止混读 / shared 并发锁  
- 会话 CRUD + 搜索 + 虚拟列表  
- 对话：ACP 流式、思考/工具折叠、Stop、@ 文件、图片、拖拽分流、错误四分类、重附着  
- 控制条：模型、effort、权限三态（once / session / deny）  
- 进程：每会话一进程、上限 3、闲置 30min 回收、流式落盘节流  
- Doctor + 设置分区 + 关于（MIT/非官方）  
- 分发：mac arm/x64 + Win x64 包 + 首次打开文档  

### 3.2 P1（预留 UI 位，灰显「即将推出」）

L01–L10：fork/rewind/compact、导出 MD、MCP/Skills/Plugins、Plan/Goal 条、子代理面板、Diff、托盘、自动更新、Context chip、信任放宽档。

### 3.3 明确非目标（P2）

飞书/钉钉桥、内嵌完整终端、云端 multi-agent farm、`/share` 公网、Hooks 完整可视化、Linux 首发、默认 YOLO。

### 3.4 NOT in scope（本轮审核额外排除）

| 项 | 原因 |
|----|------|
| 把 grok-go 网关 UI 嵌进 App | 产品边界；导入配置即可 |
| `agent serve` 远程附着 | MVP 不做 |
| 首版自动更新通道 | P1；先可安装包 |
| 完整 Diff 编辑器 | P1；右栏可占位 |
| 企业 SSO / 团队协作 | 非目标用户 |

---

## 4. 实现路径（0C-bis，autoplan 自动选定）

| 方案 | 摘要 | 完整度 | 决策 |
|------|------|--------|------|
| A 最小空壳 | 仅窗口+三栏静态 UI | 3/10 | 拒：达不到日用 |
| **B 分层垂直切片（推荐）** | 壳 → Host ACP mock → 真 stdio → 账户/项目/会话 → 权限/Doctor | **9/10** | **采纳** |
| C 先复刻参考图全交互再接 Agent | UI 重、集成晚 | 6/10 | 拒：易半成品聊天窗 |

**RECOMMENDATION: B** — 与需求 §13 一致；每一切片可验收；核心不砍。

### 4.1 建议里程碑（编码顺序）

```text
M0  脚手架：Tauri2+React+tokens+无边框三栏+主题持久化
M1  Host 进程：spawn/kill mock ACP，前端状态机（连接中/就绪/断开）
M2  真 ACP：grok agent stdio，流式渲染，Stop，错误四分类
M3  项目+信任+会话独立存储（~/.grok-app）
M4  Onboarding 三入口 + Keychain + Provider Ping + 导入 grok-go/CLI
M5  权限审批条（once/session/deny）+ 模型/effort 控制条
M6  Doctor + 设置全分区 + i18n 错误文案
M7  性能：虚拟列表、落盘节流、并发上限、闲置回收
M8  打包 mac/Win + README 公证/SmartScreen + 剧本 M01–M08
```

---

## 5. 架构（编码契约）

### 5.1 系统图

```text
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React)                                           │
│  Onboarding | Workbench(三栏) | Settings | Doctor | Toasts  │
└───────────────────────────┬─────────────────────────────────┘
                            │ Tauri commands / events
┌───────────────────────────▼─────────────────────────────────┐
│  Host (Rust)                                                │
│  · session_manager (1 session → 1 child)                    │
│  · acp_client (JSON-RPC stdio)                              │
│  · secrets (Keychain / Credential Manager)                  │
│  · fs_probe (CLI path, project trust)                       │
│  · store (independent: ~/.grok-app | shared: ~/.grok)       │
│  · doctor                                                   │
└───────────┬─────────────────────────────┬───────────────────┘
            │ spawn                       │ read-only import
            ▼                             ▼
     grok agent stdio              grok-go config / ~/.grok
```

### 5.2 会话状态机

```text
            start/attach
  Idle ──────────────────► Connecting
  ▲                            │
  │ fail/timeout               │ handshake ok
  │                            ▼
  │                        Ready ◄──── reattach
  │                         │  ▲
  │              user msg   │  │ stream end / stop
  │                         ▼  │
  │                      Streaming
  │                         │
  │         crash/EOF       │ permission request
  │                         ▼
  └── Disconnected      AwaitingPermission ── allow/deny ──► Streaming/Ready
```

### 5.3 错误四分类（UI 文案互不混淆）

| Code | 触发 | 用户动作 |
|------|------|----------|
| `CLI_NOT_FOUND` | 二进制不存在/不可执行 | 引导安装 / 指定路径 / Doctor |
| `AUTH_FAILED` | 401 / 未登录 / Key 无效 | 重登 / 换 Key / 导入 |
| `NETWORK_PROVIDER` | DNS/超时/中转 5xx/模型 404 | 检查 base_url、Ping |
| `AGENT_CRASHED` | 进程死、协议崩 | 重新附着；保留 transcript |

### 5.4 权限模型（澄清歧义）

参考图底栏有 `Always approve`；需求写 once/always/deny；矩阵 H05=session、H07=不默认全局 Always。

**编码定案（autoplan P5 显式）：**

| 档位 | 行为 | 默认？ |
|------|------|--------|
| Ask（默认） | 写文件/执行命令弹条 | **是** |
| Allow once | 仅本条 tool call | 否 |
| Allow for session | 本会话同类操作放行 | 否 |
| Deny | 拒绝并回传 Agent | 否 |
| Always approve（全局 YOLO） | 仅设置深层；二次确认；**非默认、非底栏默认 chip** | 否 |

底栏默认显示 `Ask` 或当前有效档；不得预选 `Always approve`。

### 5.5 会话数据模式

| 模式 | 根目录 | 导入配置 | 会话文件 |
|------|--------|----------|----------|
| independent（默认） | `~/.grok-app`（Win: `%APPDATA%\grok-app`） | 可拷贝账号/供应商 | 仅 App |
| shared | `~/.grok` 或 `GROK_HOME` | — | 与 CLI 共用 + 文件锁 |

**导入 ≠ 共通。** 切换模式强制 modal，不混读。

### 5.6 拖拽分流

| 输入 | 语义 |
|------|------|
| 图片文件 / 剪贴板图 | 附件上传（多模态） |
| 其他文件 / 目录 | 工作区路径引用（@ 路径） |
| 混合拖入 | 按条目分流；不可整批当一种 |

---

## 6. 信息架构（骨架不改）

```text
Shell（无边框 · data-theme dark|light · tokens）
├── Onboarding
│   ├── 欢迎 + 三入口并列
│   ├── CLI 探测 / 安装引导
│   └── 可「稍后配置」进壳
├── 工作台
│   ├── 左：New chat · 导航位（Sessions 等，P1 灰显）· Recents · 用户角
│   ├── 中：标题/连接状态 · 消息流 · 权限条 · 输入区 · 底栏 chips
│   └── 右：可折叠；P0 可空或简单文件列表；Diff/任务 P1
├── 设置：账户 · 模型 · 会话模式 · 外观语言 · Agent/Doctor · 关于
└── 全局：错误 Toast · 权限 Inbox（可选同权限条）
```

视觉：严格 [`design-tokens.md`](./design-tokens.md)。功能可裁，**token 名与三栏骨架不改**。

---

## 7. 体验优化（不增 P0 功能面，只补清晰度）

下列项为 **SELECTIVE EXPANSION 默认采纳（P1 完整度 + 边界清晰，CC 成本低）**：

| # | 优化 | 落点 | 原则 |
|---|------|------|------|
| E1 | 连接状态永远可见（连接中/就绪/断开/重试） | 中栏顶 / 状态点 | 零静默失败 |
| E2 | 未配置 Provider 时输入区 CTA 直达三入口之一 | 空状态 | 可行动 |
| E3 | 权限条：操作摘要 + 路径/命令预览 + 三按钮固定顺序 | 中栏 | 信任 |
| E4 | 错误四分类固定文案 key（i18n） | Host→UI | 可诊断 |
| E5 | 切换会话模式 modal：数据路径图示 + 不可混读声明 | 设置 | 边界 |
| E6 | 流式无 chunk > N 秒：「仍在运行 / 可能卡住」+ 取消 | 对话 | 稳定性 |
| E7 | P1 入口灰显「即将推出」，不藏不骗 | 左栏/右栏 | 预期管理 |
| E8 | 关于页：MIT + 非官方 + 版本 + grok-go 链接 | 设置 | 合规 |

**不采纳进 P0（进 TODOS）：** 实时协作、云同步、完整内嵌终端、Linux。

---

## 8. What already exists

| 子问题 | 已有 | 本 App 策略 |
|--------|------|-------------|
| Tauri2+React 壳 | grok-go | **模式复用**（窗口/打包脚本/插件），不复制业务 |
| 中转账号配置 | grok-go 配置目录 | **只读导入** |
| Agent 运行时 | `~/.grok/bin/grok` · `grok agent stdio` | **spawn 驱动** |
| CLI 会话存储 | `~/.grok` | independent 隔离；shared 可选 |
| ACP 协议 | Grok Build 内置 | Host 实现 client |
| 设计 tokens | 本仓库 design-tokens.md | 实现为 CSS vars |
| agent-connect | 外部 | 明确不做 |

---

## 9. Error & Rescue Registry（摘要）

| 代码路径 | 失败 | 用户可见 | 日志 |
|----------|------|----------|------|
| `probe_cli` | 未找到 | CLI_NOT_FOUND + 安装引导 | path 列表，无 secret |
| `spawn_agent` | 启动失败 | AGENT_CRASHED 或 CLI_NOT_FOUND | exit/stderr 截断 |
| `acp_handshake` | 协议不兼容 | 版本不匹配升级提示 | 版本号 |
| `auth` | 401 | AUTH_FAILED | **redact key** |
| `provider_ping` | 超时/DNS | NETWORK_PROVIDER + 原因 | host only |
| `stream` | 中断 | 断开 + 重附着 | session_id |
| `permission` | 用户拒绝 | Agent 继续/结束可预期 | decision |
| `persist_transcript` | 写盘失败 | Toast + 内存仍可看 | path |
| `shared_lock` | 锁冲突 | 明确冲突提示，不写坏索引 | lock holder |
| `import_grok_go` | 路径/格式错 | 可行动错误 | 无 key 明文 |

---

## 10. Failure Modes Registry

| 模式 | RESCUED | TEST | USER SEES | 优先级 |
|------|---------|------|-----------|--------|
| 双会话写错 cwd | Y 隔离 | E2E M02 | 不串 | P0 |
| 每 token 写盘 | Y 节流 | M08 | 无风扇尖刺 | P0 |
| 密钥进日志 | Y redact | 单测 | 永不 | P0 |
| 模式切换混读 | Y 禁止 | M06 | modal | P0 |
| 鉴权标成 CLI 缺失 | Y 四分类 | M03 | 正确文案 | P0 |
| 第 4 活跃会话 | Y 限流 | 单测 | 提示排队 | P0 |
| 权限默认 YOLO | Y 默认 Ask | M07 | 审批条 | P0 |
| 主题漏组件 | Y tokens 清单 | M04 | 无漏白漏黑 | P0 |

---

## 11. Dream state delta

```text
CURRENT                    THIS PLAN (MVP)                 12-MONTH IDEAL
docs-only greenfield  →   日用指挥台：ACP+权限+三入口  →  可信本地 Agent IDE
                          独立会话默认                      + Diff/MCP/更新/托盘
                          姐妹 grok-go 导入                 + 生态插件市场
```

本计划把「能日用写代码」落地；12 月理想靠 P1 增量，架构不挡。

---

## 12. 安全与合规（编码必守）

1. Key 仅 Keychain / Credential Manager；日志强制 redact  
2. 项目首次信任确认  
3. 默认 Ask 权限；全局 Always 深层 + 二次确认  
4. 遥测默认关  
5. 关于页 MIT + 非官方  
6. 导入 grok-go **不反向写**对方配置  

---

## 13. 性能硬指标

| 项 | 指标 |
|----|------|
| 冷启动可输入 | mac ≤3s（已装 CLI+已登录） |
| 落盘 | ≥500ms 或段落边界；禁每 token 刷盘 |
| 活跃 Agent | ≤3；空闲 30min 回收 |
| 列表 | 虚拟滚动 100+ |
| 空闲内存 | 指导 <300MB（发版校准） |

---

## 14. 验收

以 [`P0-能力矩阵.md`](./P0-能力矩阵.md) 为准；剧本 M01–M08 必跑。  
**发布门槛：P0 全 PASS。**

---

## 15. 编码任务拆分（PR 友好）

| PR | 交付 | 验收钩子 |
|----|------|----------|
| PR1 | 空壳+tokens+三栏+主题 | A01–A07, A09 |
| PR2 | ACP mock + 状态机 + 流式假数据 | G01/G02/G05 骨架 |
| PR3 | 真 stdio + 错误四分类 + 重附着 | G01,G11,G12,B01–B05 |
| PR4 | 项目/信任/独立会话存储 | D*, E01,E04,F* |
| PR5 | Onboarding 三入口+密钥+导入 | C* |
| PR6 | 权限条+模型/effort | H* |
| PR7 | Doctor+设置+i18n | J*, A08 |
| PR8 | 性能与并发 | I*, F07 |
| PR9 | 打包与文档 | K*, M* |

---

*Autoplan 后续章节（CEO 双声部、Design/Eng/DX 评分、决策审计、最终门）将追加于本文件后部。*

---

## 16. /autoplan 审核总览

| 阶段 | 状态 | 摘要 |
|------|------|------|
| Phase 0 Intake | ✅ | UI+DX scope；restore point 已存 |
| Phase 1 CEO | ✅ | 前提 P1–P8 用户确认；双声部完成 |
| Phase 2 Design | ✅ | 综合 ~6.1/10；关键交互定案写入 §17 |
| Phase 3 Eng | ✅ | 架构方向对；CLI 信任/ACP 契约/权限 scope 必补 |
| Phase 3.5 DX | ✅ | 规格 DX ~7.2；缺错误文案与 README |
| Phase 4 Gate | ✅ | 用户批准 as-is（不砍矩阵；分层+契约） |

**硬约束遵守：** 能力矩阵 P0 **条目不删**。审核只补「可编码契约 / 体验定案 / 发布分层」，不砍核心功能面。

---

## 17. 体验与交互冻结（Design 采纳）

> 参考图 = **视觉北极星**，**不是**权限/Plan 政策。禁止像素级抄参考图底栏 `Always approve`。

### 17.1 信息架构定案

| 项 | 定案 |
|----|------|
| 左栏 P0 | New chat · **项目→会话** · Recents · Settings · 用户角 |
| P1 导航 | 收拢为「更多 / 即将推出」一组灰显，不并列 6 个假入口 |
| 右栏 P0 | **默认折叠**；展开可为简单文件列表或一句空状态 |
| 项目语境 | 中栏顶或左栏顶 **常驻当前项目名/路径**（可点切换） |
| 连接状态 | 中栏顶 **状态 pill**（色点 + 文案 + 动作），禁止仅色点 |
| Plan 卡 | **P0 不进 DOM**（L04）；P0 英雄时刻 = 工具步骤故事 + 审批 |

### 17.2 权限 UI 权威栈

1. **内联权限条**（打开时最高优先，sticky 在输入区上方）  
2. 底栏 chip 只显示 **当前生效策略**（默认文案 `Ask`）  
3. 全局 Always 仅设置深层 + 二次确认 + 持久警告条  

按钮固定顺序：`Allow once` · `Allow for session` · `Deny`  
预览：等宽字体，默认最多 6 行可展开。  
多请求：`1 of N` 单条堆叠，P0 不做独立 Inbox。

### 17.3 Allow for session 匹配键（安全）

```text
scope_key = tool_name + ":" + normalize(path_or_command_prefix)
```

- `fs.write` / 写文件：同 tool + 项目根下同一 path prefix  
- `shell` / 执行：同 tool + 命令可执行文件名（不含每次变化的参数）**或** 更严的 exact command（实现选严不选松，UI 展示 scope）  
- 项目外路径：**永不**被 session allow 覆盖，必须重新 Ask  
- Deny 后：工具行标 `Denied`，Agent 收拒绝结果，流默认继续（除非 Agent 结束）

### 17.4 输入区状态矩阵

| 状态 | 输入 | Send | Stop |
|------|------|------|------|
| 无 Provider | 替换为 CTA → Onboarding | 隐藏 | 隐藏 |
| 无项目 | 替换为「添加项目」 | 隐藏 | 隐藏 |
| Connecting | 禁用 | 禁用 | 隐藏 |
| Ready | 启用 | 启用 | 隐藏 |
| Streaming | 禁用（P0 不排队） | 禁用 | **启用** |
| AwaitingPermission | 禁用 | 禁用 | 可选启用（=取消当次） |
| Disconnected | 禁用 | 隐藏 | 隐藏；主按钮「重新附着」 |

### 17.5 错误呈现优先级

`Modal（破坏性/模式切换） > Banner（连接/鉴权） > Toast（成功/软提示） > 字段错误`

硬失败禁止仅 Toast。

### 17.6 流式滚动

仅当用户距底部 ≤ N px 时 stick；否则显示「跳到最新」。

### 17.7 空状态五件套（文案 EN+ZH 另表）

1. 未配置 Provider  
2. 无项目  
3. 无会话  
4. 会话无消息  
5. 搜索无结果  

每条：标题 / 正文 / 主按钮 / 次按钮。

### 17.8 跳过 Onboarding

持久非模态 **Setup checklist**（CLI · Provider · Project）直到第一次成功对话，不仅靠 placeholder。

### 17.9 三入口

保持并列；动态 **Recommended** 角标：检测到 grok-go → 导入；否则官方；高级用户点中转。

---

## 18. 工程契约补全（Eng 采纳，不砍功能）

### 18.1 Host 单一真相

- **Host 拥有会话 FSM**；前端仅为事件投影 + 查询  
- 模块：`SessionManager` · `AcpClient` · `PermissionBroker` · `AuthMaterial` · `Store` · `Doctor`  
- Kill 顺序：cancel RPC → SIGTERM → 超时 SIGKILL  
- App resume / 窗口 focus：reconcile 子进程真实状态  

### 18.2 ACP 依赖契约（编码前 spike）

| 项 | 要求 |
|----|------|
| 最小 CLI 版本 | 配置 `min_cli_version` / 协议版本；范围外硬失败 + 升级引导 |
| Handshake | 交换 version/capabilities；未知 method 降级不崩 |
| Framing | JSON-RPC over stdio；stderr 独立 tee；单帧大小上限 |
| 背压 | Host 合并 chunk（约 16–33ms）；有界缓冲；序号/gap 检测 |
| 取消 | Stop / 权限中 Stop 的明确语义 |
| Reattach | 分两种诚实 UX：`Resume if session id valid` vs `Restart agent + keep transcript` |
| CI | ACP stub 假进程 + golden fixtures；不依赖真账号 |

**M2 前必须完成真机 spike：** 工具流 + 权限 + Stop + 崩溃重附着。

### 18.3 CLI 下载信任链（Critical）

自动下载（B02）**fail-closed**：

1. URL 白名单（官方 release 源）  
2. HTTPS only  
3. 校验 **SHA-256**（及可用时的签名）  
4. 架构匹配（arm64/x64）  
5. 安装到 App 管理目录 + 限制 ACL；禁止「下载到 Downloads 直接执行」  
6. 失败清理半包；UI 展示 hash  
7. 手动安装路径与自动下载 **同级**  
8. 用户指定路径：canonicalize、regular file、exec bit、spawn 前 re-stat  

无校验实现 → **禁止开启自动下载**，仅引导官方安装说明。

### 18.4 Shared 模式（保留 P0，补全可实现定义）

- schema version 字段；不认识则只读提示升级  
- 锁文件 + 原子写；崩溃半写可检测  
- 多实例 / 与 CLI 并发：冲突则拒绝写并提示  
- 切换模式：清空内存缓存、强制关闭活跃 Agent、modal 确认路径图  
- 测试：并发写、崩溃恢复；否则 shared 可实现但标 **experimental 风险** 不得宣称 hardened  

### 18.5 流式落盘

≥500ms 或段落边界；App 退出 **flush**；写失败 Toast + 内存保留；禁每 token 同步写。

### 18.6 Tauri 最小权限

无 blanket shell/fs；危险操作经 Host command；capability allowlist 写入安全节。

### 18.7 Provider Ping

超时；可选拦截 link-local/metadata IP；导入后展示 base_url 再保存。

---

## 19. 发布分层（不删矩阵条目）

| 门槛 | 含义 | 矩阵 |
|------|------|------|
| **Dogfood** | 内部日用：单平台 mac arm 优先 | Launch-Core 子集 PASS |
| **公开日用就绪** | 对外宣称 | **A–K + M 全 P0 PASS**（原门槛，不降低） |

**Launch-Core（Dogfood 最小，仍保留全量实现 backlog）：**  
B01–B05, C 三入口+密钥, D 项目信任, E01/E04, F 基本会话, G 主路径, H 权限, J Doctor, A 壳暗色, M01/M03/M07  

Win / 亮色 / 全 i18n / shared / 全主题扫描 仍在 **公开门槛** 内，**不从矩阵删除**，可并行实现但不必阻塞 dogfood。

### 19.1 产品结果指标（与矩阵并列）

| 指标 | 目标（dogfood 起跟踪） |
|------|------------------------|
| 冷启动→首次成功工具调用（已配置） | ≤ 3–5 min 指导 |
| 崩溃后重附着成功率 | 记录并提升 |
| 审批误触（Deny 邻近） | UI 间距验收 |
| 错误四分类正确率（剧本 M03） | 100% |

---

## 20. DX 补全清单

1. Onboarding **状态机短路**（有 CLI+可导入 → 一键导入起步）  
2. **错误文案 Deck**（zh/en）：四分类 + 版本不匹配 + shared 锁 + 每类 problem/cause/primary/secondary  
3. Doctor 常显：App 版本 · CLI 版本 · **解析后路径+来源** · 数据根 · 最后错误码  
4. README：5 分钟暖路径 + Gatekeeper/SmartScreen  
5. 权限标签冻结：`Ask / Allow once / Allow for session / Deny`  
6. Toast 动作：Open Doctor / Reattach / Set CLI path  
7. Doctor 高级：Reset App data（双确认）  

**TTHW 目标：** 暖路径 ≤3 min；冷路径 ≤10 min。

---

## 21. CEO 双声部共识

```
CEO DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Premises valid?                   Partial Partial DISAGREE*
  2. Right problem to solve?           Partial No      DISAGREE*
  3. Scope calibration correct?        No      No      CONFIRMED gap
  4. Alternatives sufficiently explored? No    No      CONFIRMED gap
  5. Competitive/market risks covered? No      No      CONFIRMED gap
  6. 6-month trajectory sound?         Partial Partial DISAGREE*
═══════════════════════════════════════════════════════════════
* 战略层质疑「证据不足」；工程前提 P1–P8 用户已确认保留。
```

**采纳（不砍功能）：** 楔子叙事 + 竞争附录 + ACP 契约 + 信任链 + 发布分层 + 结果指标。  
**不采纳：** 删 shared / 删双平台 / 把桌面壳改成插件-only（与用户方向冲突 → User Challenge 见最终门）。

---

## 22. Design 评分卡

| 维度 | 分 |
|------|-----|
| Hierarchy | 6.0 → 补 §17 后目标 8+ |
| Interaction states | 5.5 → 矩阵冻结后 8+ |
| Journey | 6.5 |
| Specificity | 5.0 → 需 10 屏线框（TODO） |
| A11y | 5.5 → aria-live + 键盘图（TODO） |
| Desktop shell | 7.0 |
| Design system | 7.5 |

**Design Voices：** Claude full；Codex multi-phase 对齐 Critical 点（权限权威、状态矩阵、参考图政策）。

---

## 23. Eng 共识表

```
ENG DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Architecture sound?               Partial No*     PARTIAL
  2. Test coverage sufficient?         No      Partial CONFIRMED gap
  3. Performance risks addressed?      Partial Partial PARTIAL
  4. Security threats covered?         Partial No      CONFIRMED gap
  5. Error paths handled?              Partial Partial PARTIAL
  6. Deployment risk manageable?       Partial Partial PARTIAL
═══════════════════════════════════════════════════════════════
* Codex 在补契约前评为 No；§18 写入后应变 Partial→Yes 可编码。
```

---

## 24. DX 共识表

```
DX DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Getting started < 5 min?          Partial Partial PARTIAL
  2. Naming guessable?                 Yes     —       OK
  3. Error messages actionable?        Partial Partial PARTIAL
  4. Docs findable & complete?         No      No      CONFIRMED gap
  5. Upgrade path safe?                Partial Partial PARTIAL
  6. Dev env / Doctor friction-free?   Yes     Partial PARTIAL
═══════════════════════════════════════════════════════════════
Overall DX ~7.2 → 补 §20 后目标 ≥8.5
```

---

## 25. Cross-Phase Themes

| Theme | 出现阶段 | 处理 |
|-------|----------|------|
| **CLI 下载信任链** | CEO, Eng, DX, Codex | §18.3 必做 |
| **ACP 协议/生命周期契约** | CEO, Eng, Codex | §18.1–18.2 + spike |
| **权限 scope 语义** | Design, Eng, Codex | §17.3 |
| **P0 过大 vs 全量保留** | CEO×2 | §19 分层不删条 |
| **参考图 Always approve 误导** | Design, Codex | §17 政策 |
| **错误可行动文案** | DX, Eng, Codex | §20 文案 Deck |
| **shared 存储复杂度** | CEO, Eng | §18.4 可实现定义 |

---

## 26. Decision Audit Trail

| # | Phase | Decision | Class | Principle | Rationale | Rejected |
|---|-------|----------|-------|-----------|-----------|----------|
| 1 | CEO | 模式 SELECTIVE EXPANSION | Mechanical | autoplan | 锁范围+体验补全 | EXPANSION/REDUCTION |
| 2 | CEO | 前提 P1–P8 | User gate | — | 用户选 A | B/C 改默认 |
| 3 | CEO | 实现路径 B 垂直切片 | Mechanical | P1+P5 | 可验收切片 | A 空壳 / C UI 先 |
| 4 | CEO | 不删 P0 矩阵条目 | Mechanical | 用户硬约束 | 核心不砍 | 双声部「砍 shared/Win」 |
| 5 | CEO | 增加发布分层 Dogfood/公开 | Mechanical | P3+P1 | 解决「全绿无人用」而不砍功能 | 删功能式缩 scope |
| 6 | CEO | 增加竞争/楔子/结果指标附录 | Mechanical | P1 | 补战略空洞 | 忽略市场风险 |
| 7 | Design | 右栏默认折叠 | Mechanical | P5 | 避免空心第三栏 | 默认展开空白 |
| 8 | Design | Streaming 禁用 Send | Mechanical | P5 | 减竞态 | P0 排队 |
| 9 | Design | 权限权威栈+Ask 默认 chip | Mechanical | P1+安全 | 对齐 D7 | 抄参考图 Always |
| 10 | Design | session allow scope_key | Mechanical | P5 显式 | 可实现安全 | 模糊「同类」 |
| 11 | Design | 项目作用域会话 IA | Mechanical | P1 | 多项目用户 | 纯 Recents |
| 12 | Eng | Host 拥有 FSM | Mechanical | P5 | 防双 SoT | FE 自管进程 |
| 13 | Eng | CLI 下载 fail-closed 校验 | Mechanical | P1 安全 | Critical | 无哈希下载 |
| 14 | Eng | ACP stub CI + spike | Mechanical | P1 | 协议风险 | 直接 PR3 碰运气 |
| 15 | Eng | shared 保留但锁+schema | Mechanical | 用户 P0 | 不删功能 | 直接砍 shared |
| 16 | DX | 错误文案 Deck P0 | Mechanical | P1 | 可行动 | 工程师即兴文案 |
| 17 | DX | Doctor 显式路径来源 | Mechanical | P5 | 可调试 | 只写「未找到」 |
| 18 | All | E1–E8 体验项进规格 | Mechanical | P1 | 低成本清晰度 | 推迟全部体验 |

---

## 27. 测试计划（摘要）

完整文件：`~/.gstack/projects/grok-app/ronglecat-main-test-plan-20260721.md`

| 层 | 覆盖 |
|----|------|
| Host unit | 错误分类、redact、路径探测、节流、会话上限、scope_key |
| ACP stub 集成 | handshake、stream、stop、permission×3、crash→reattach |
| Store | independent CRUD；shared 锁/崩溃（若启用） |
| Security | 密钥不进日志；下载 hash 失败拒绝执行 |
| E2E 手工 | M01–M08 + 矩阵证据字段 |

---

## 28. TODOS（自动登记）

见仓库 `docs/TODOS.md`。

---

## 29. 竞争与楔子（CEO 补录）

**楔子（叙事，不改功能清单）：**  
「Grok Build 本地任务控制面」— 中转/官方/grok-go 三路径 + 默认可视审批 + 多项目隔离 + Doctor 分诊。相对 CLI：可恢复、可审批、可诊断；相对通用 Chat：真 ACP 工具写代码。

**竞争注意：** 官方客户端若补齐桌面壳，差异化靠 中转体验 · grok-go 导入 · 透明权限 · MIT 可审计 · 多项目。  
**Kill 标准（可选跟踪）：** 若 3 个月 dogfood 无每周工具会话留存，暂停扩 P1，先修可靠性。

---

## 30. 编码前 DoD（Definition of Ready）

- [x] P0 能力矩阵存在且不删条  
- [x] 权限/输入/IA 交互冻结（§17）  
- [x] CLI 信任链 / ACP / Host 契约（§18）  
- [x] 发布分层（§19）  
- [ ] ACP 真机 spike 记录（PR2 前）  
- [ ] 错误文案 Deck 初稿（PR5–7）  
- [ ] README 暖路径（PR9）  
- [ ] 可选：10 屏线框（加速 UI PR）  

**建议开工顺序不变：** PR1 壳 → PR2 mock ACP → PR3 真 stdio（spike 通过后）→ …

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/autoplan` | 策略与范围 | 1 | issues_open | 战略证据弱；已用分层+契约消化；功能面不砍 |
| Codex Review | autoplan voices | 独立二审 | 1 | issues_found | CLI 信任/ACP/权限/shared 缺口 → 已写入 §18 |
| Eng Review | `/autoplan` | 架构与测试 | 1 | issues_open | 契约补全后可编码；测试计划见 artifact |
| Design Review | `/autoplan` | UI/UX | 1 | issues_open | §17 冻结关键歧义；线框仍 TODO |
| DX Review | `/autoplan` | 开发者体验 | 1 | issues_open | TTHW/文案/README 清单 §20 |

- **CROSS-MODEL:** CLI 信任链、ACP 契约、权限 scope、P0 过重叙事 — 多阶段独立命中  
- **UNRESOLVED:** 无（User Challenge 维持原方向：不砍 P0）  
- **VERDICT:** **APPROVED — 可按 PR1 开工**；公开日用仍要求矩阵全 PASS + §18 安全项落地  

---

*Autoplan 文档版本：2026-07-21 · APPROVED · 可编码*
