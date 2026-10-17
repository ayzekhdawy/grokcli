# Agent 进程已结束 / 已取消 — `config.toml` 重复键排障与自修复

> **文档类型：** 用户排障指南 + 工程自修复方案  
> **关联现象：** 会话中大量「已取消」「Agent 进程已结束」  
> **Support 样本：** `grok-app-support-20260811-054802`（Windows / App 0.2.11）  
> **状态：** 根因已确认；用户侧可热修；**程序侧自愈已落地**（见 §4.8）

---

## 1. 现象

- 会话时间线里反复出现 **「已取消」**、**「Agent 进程已结束」**
- 用户发消息后几乎没有正常助手回复，或刚启动就结束
- 往往 **所有会话** 都失败，与具体聊天内容无关

界面上可能类似：

```
○ 已取消
○ 已取消
…
○ Agent 进程已结束
（用户气泡）
○ Agent 进程已结束
```

---

## 2. 根因（给支持 / 开发）

### 2.1 一句话

**独立模式**下 Agent 的 `GROK_HOME` 指向 App 的 `agent-home`。  
其中的 `config.toml` 出现 **TOML 重复键** → Grok Build 启动解析失败 → 进程秒退（EOF）→ App 记为 `AGENT_CRASHED` /「进程已结束」。

这通常 **不是** 项目目录损坏，也 **多半不是** 登录失效（账号类失败会有另一类网络/配额日志）。

### 2.2 关键路径（Windows 独立模式）

```text
%AppData%\Roaming\grokapp\grok-app\data\agent-home\config.toml
```

（Support 包内 `doctor.json` / 日志也会打印完整路径。）

### 2.3 日志特征

在 `logs/app.log.YYYY-MM-DD` 中搜索：

| 关键词 | 含义 |
|--------|------|
| `config toml has syntax errors` | CLI 拒绝配置 |
| `TOML parse error` / `duplicate key` | 重复键或其它 TOML 语法错误 |
| `Agent stream closed (EOF)` | Agent 子进程已退出 |
| `code="AGENT_CRASHED"` / `session_open_fail` | App 侧会话打开失败 |
| `acp: spawn home=…\agent-home` | 正在用独立 agent-home 拉起进程 |

典型片段（脱敏示意）：

```text
ERROR config toml has syntax errors: TOML parse error at line 8, column 1: duplicate key
  file=…\agent-home\config.toml
WARN  acp ← initialize … error: Agent stream closed (EOF)
WARN  session_open_fail … code="AGENT_CRASHED"
```

> 说明：tracing 日志里的 `file=…\config.toml` 是 **日志字段（文件路径）**，不一定表示重复的键名就叫 `file`。真正重复的往往是 `yolo`、`permission_mode` 等配置键。

### 2.4 程序侧已知写坏机制

App 在 spawn / prewarm 前会级联 sync 多个模块写入同一 `config.toml`，例如：

- `agent_prefs` → `[ui] permission_mode` / `yolo`
- `agent_subagents` → `[subagents] enabled`
- `agent_memory` → `[memory] enabled`
- `agent_todo_gate` / `agent_auto_wake` / … → 顶层 bool 等

**高危 bug（`agent_prefs` 本地 upsert）：** 用 **`starts_with(key)`** 匹配键名，而不是精确相等。

若曾存在前缀相近键（例如 `yolo_mode`），再写 `yolo` 时可能：

1. 把 `yolo_mode = …` **误改成** `yolo = true`
2. 原来的 `yolo = …` **仍保留**

→ 同一 `[ui]` 表内出现 **两个 `yolo`** → CLI `duplicate key` → 进程退出。

复现形态（示意，行号随顶层键数量略有偏移）：

```toml
todo_gate_enabled = false
todo_gate_max_fires_per_prompt = 3
subagent_worktree_snapshot_enabled = false
auto_wake_enabled = false
two_pass_compaction_enabled = false
[ui]
permission_mode = "always-approve"
yolo = true          # ← 误伤 yolo_mode 后写出的
yolo = true          # ← 原 yolo 行仍在 → duplicate
```

**其它风险：**

| 风险 | 结果 |
|------|------|
| 表头写成 `[ui] # 注释` 而匹配要求精确 `[ui]` | 再 append 一个 `[ui]`，表内键重复 |
| `providers` 等处对 `[models]` 也用 `starts_with(key)` | 同类误匹配 |
| 多模块无文件锁并发 RMW | 可能丢更新（较少直接制造 duplicate，但增加不确定性） |

### 2.5 Support 样本时间线（摘要）

| 日期 | 现象 |
|------|------|
| 08-08 | 下午首次出现 `duplicate key` + prewarm `AGENT_CRASHED` |
| 08-09 | 同 cascade sync 后 initialize 仍 ok（配置当时仍合法） |
| 08-10～08-11 | 大量 spawn 均在 initialize 失败；用户界面「已取消 / 进程已结束」 |

---

## 3. 用户排障指南（可直接转发）

以下章节可整段复制发给用户。

---

### 【Grok App】Agent 一直「已取消 / 进程已结束」自助排查

#### 3.1 现象

- 会话里出现大量 **「已取消」**、**「Agent 进程已结束」**
- 发消息后几乎没有正常回复，或刚开始就结束
- 与具体聊天内容无关，**多个会话**都可能如此

#### 3.2 原因说明（通俗）

App 独立模式会把 Agent 配置写到本机：

```text
%AppData%\Roaming\grokapp\grok-app\data\agent-home\config.toml
```

该文件里出现了 **TOML 重复键**（同一配置段里同一个名字写了两次）。  
Grok Build Agent 启动时必须读取这个文件；解析失败就会立刻退出，App 就会显示「进程已结束」。

这通常 **不是** 你的项目文件坏了，也 **多半不是** 登录失效。

#### 3.3 确认路径（Windows）

1. **完全退出** Grok App（含托盘图标）。
2. `Win + R`，粘贴并回车：

```text
%AppData%\Roaming\grokapp\grok-app\data\agent-home
```

3. 应能看到 `config.toml`（以及可能的 `auth.json` 等）。

若文件夹不存在，请向支持说明安装渠道（安装包 / 便携版）及是否改过数据目录。

#### 3.4 安全操作：备份 → 验证 → 修复

##### 步骤 A：备份（必做）

在同一文件夹中复制 `config.toml`，例如改名为：

```text
config.toml.bak-YYYYMMDD
```

##### 步骤 B：快速验证是不是这个文件的问题（推荐先做）

1. 将 `config.toml` **暂时改名**为 `config.toml.broken`。
2. **不要**手写复杂配置。可以：
   - 先不建新文件（让 App 下次再写），或
   - 新建一个最小文件：

```toml
# temporary minimal config — App will re-fill safe keys on next launch
```

3. 重新打开 Grok App，**新建会话**，发一句「你好」。
4. **能正常回复** → 确认就是 `config.toml` 损坏，进入步骤 C 或 D。  
5. **仍然秒挂** → 重新导出 support 包并反馈（可能还有 CLI / 权限等问题）。

##### 步骤 C：精细修复（想保留自定义模型 / MCP / 中继）

用记事本或 VS Code 打开备份的 `config.toml.broken`（或 `.bak`），检查：

**1）同一段内是否有重复键**

常见坏例：

```toml
[ui]
permission_mode = "always-approve"
yolo = true
yolo = true          # ← 删掉多余的一行
```

或：

```toml
[ui]
yolo_mode = false    # 若不需要可删；不要与 yolo 混成两个 yolo
yolo = true
```

**2）是否有两个同名表**

例如两个 `[ui]`、两个 `[subagents]`、两个 `[memory]`。  
应合并为各一个表，每个键只保留一份（一般保留你确认正确、较新的那份）。

**3）表头尽量不要写成**

```toml
[ui] # 任何注释
```

请改成：

```toml
# 注释单独一行
[ui]
```

**4）可选：用 Python 校验（Windows 若已安装 Python 3.11+）**

在 PowerShell 中：

```powershell
python -c "import tomllib; p=r'$env:APPDATA\Roaming\grokapp\grok-app\data\agent-home\config.toml'; tomllib.loads(open(p, encoding='utf-8').read()); print('OK')"
```

打印 `OK` 表示语法合法。

5. 将修好的内容保存为正式的 `config.toml`，再启动 App 测试。

##### 步骤 D：几乎没配过自定义模型 / MCP 时

1. 备份后 **删除** `config.toml`。
2. 启动 App，让程序按当前设置重新写入安全默认项。
3. 若之后需要自定义 Provider，到设置里重新添加  
   （密钥不会出现在 support 包中，support 已脱敏）。

#### 3.5 不要做的事

- 不要删除整个 `%AppData%\Roaming\grokapp`（会丢掉会话索引等数据）
- 不要只靠删除 `auth.json`「碰运气」（与本次主因无关）
- 修改配置时请先退出 App，避免程序正在写入

#### 3.6 修好后如何确认

1. 发一条短消息，应进入正常思考/回复，而不是立刻「进程已结束」。
2. 若仍失败：设置中导出 **新的 support 包**，并注明「已按 config.toml 步骤处理」。

#### 3.7 回传支持时可用的附注模板

```text
- App 版本：0.2.11（或填写实际版本）
- 系统：Windows
- 现象：已取消 / Agent 进程已结束
- 已操作：备份并处理 agent-home\config.toml（改名验证 / 去重 / 删除重建）
- 结果：已恢复 / 仍失败（请附新 support 包）
```

---

## 4. 工程侧：自修复方案（不影响正常配置）

### 4.1 目标

| 目标 | 说明 |
|------|------|
| G1 | 合法、无重复键的 `config.toml`：**零写盘** |
| G2 | 明确 duplicate key / 可自动去重的坏文件：备份后修复并可再解析 |
| G3 | 无法安全修复的烂文件：不覆盖，打日志 + 可读错误 |
| G4 | **永不**在 shared 模式下改写用户 `~/.grok/config.toml` |
| G5 | 修掉会再次写坏文件的 upsert bug |

### 4.2 层 A — 根因修复（必须）

| 改动 | 说明 | 对正常配置 |
|------|------|------------|
| `agent_prefs` 改为精确键匹配 | 与 `agent_home_config::set_table_key` 一致；禁止 `starts_with("yolo")` 误伤 `yolo_mode` | 无副作用 |
| 表头匹配容忍尾注释 | `[ui]` 与 `[ui] # x` 视为同一表，避免二次 append | 无 |
| `providers` 等 `starts_with(key)` | 同类问题一并改掉 | 无 |
| 统一走 `agent_home_config` 写入口 | 减少多份 upsert 分叉 | 行为更一致 |
| 单测 | `yolo_mode` + 写 `yolo` 不得产生双 `yolo`；带注释表头不得双 `[ui]` | — |

### 4.3 层 B — 启动前自愈（推荐，仅动坏文件）

**挂载点：** independent 模式 spawn / prewarm **之前**（例如 `acp_client` 写盘 cascade 之后、真正 `Command::spawn` 之前，或 cascade 之前先 sanity）。

**函数语义（建议名）：** `ensure_agent_home_config_sane(session_data_mode) -> Result<HealReport, String>`

**写盘前置条件（全部满足）：**

1. `session_data_mode` 为 independent（shared → 直接跳过）
2. `agent-home/config.toml` 存在且非空
3. 严格解析失败 **或** 行级扫描发现「同 table 同 key ≥ 2 次」
4. 自愈输出能通过严格解析
5. 写盘前备份：`config.toml.bak-heal-<timestamp>`

**保守去重算法：**

1. 按行扫描，维护当前 table 作用域（顶层 / `[a.b]`）
2. 对每个 `(table, key)`：重复时 **只保留最后一次赋值行**（后写覆盖语义）
3. 不删除无关键、不重排无关 section、不改写 `api_key` / MCP command
4. 不去「根据 App 设置重生成整份模板」
5. 去重后仍无法解析 → **不覆盖**，返回错误摘要

**对正常配置的保证：**

```text
合法 TOML 且无重复键
  → 解析成功
  → HealReport { changed: false }
  → 不调用 fs::write
```

该路径可单测：给定合法 fixture，断言文件 mtime/内容不变。

### 4.4 层 C — 体验与可观测性（低成本）

| 项 | 建议 |
|----|------|
| 崩溃文案 | `AGENT_CRASHED` 且 stderr 含 `config toml` / `duplicate key` 时，系统消息说明「agent-home config.toml 损坏」，优于仅「进程已结束」 |
| Doctor | 增加 `agent_home_config_parse`：ok / duplicate_key / parse_error / missing |
| Support 包 | 可选附带 **脱敏后** 的 `config.toml`（复用现有 redaction），便于远端确认 |
| 日志 | heal 成功时 `INFO` 记录备份路径与去掉的重复键计数（不打印密钥） |

### 4.5 明确不做

- 一启动就按模板整文件重写（会冲掉用户 MCP / 自定义模型）
- 解析失败静默 `remove_file` 且无备份
- shared 模式改写 `~/.grok/config.toml`
- 用宽松解析「凑合跑」却把坏文件留在磁盘上

### 4.6 建议落地顺序

1. ~~**根因 PR**：精确匹配 + 表头注释 + 单测~~ ✅
2. ~~**同 PR**：`ensure_agent_home_config_sane`（仅坏文件 dedupe + backup）~~ ✅
3. **产品（待办）**：崩溃文案 + Doctor 探针
4. **热修**：用户侧按本文 §3 处理现网已损坏文件（升级前）

### 4.7 验收清单（工程）

- [x] 合法 config：`ensure_sane_noops_on_valid_and_heals_dups` 断言无写盘
- [x] fixture：`yolo_mode` + `yolo` → 精确匹配不产生双 `yolo`（`set_table_key_exact_not_prefix` / `agent_prefs::does_not_prefix_match_yolo_mode`）
- [x] fixture：双 `[ui]` 各含 `yolo` → dedupe 后无重复键
- [x] shared 模式：heal 跳过；write helpers 拒绝 `~/.grok`
- [ ] 无法修复的半截引号文件：当前 heal **仅处理 duplicate assignment**；其它语法错误仍依赖用户手册修复
- [ ] UI/日志在 config 类崩溃时有可读归因（待产品文案）

### 4.8 已实现（代码）

| 能力 | 位置 |
|------|------|
| 精确键匹配 + 表头尾注释 | `src-tauri/src/agent_home_config.rs`（`assignment_key` / `parse_table_header` / `set_table_key`） |
| 写锁（cascade 防交错 RMW） | `with_config_write_lock` / `update_config_toml` |
| 去重自愈 + backup | `dedupe_assignment_keys` / `ensure_agent_home_config_sane` → `config.toml.bak-heal-<unix>` |
| spawn 前调用 | `src-tauri/src/acp_client.rs`（independent cascade 之后） |
| prefs / subagents / memory 统一写入口 | `agent_prefs` / `agent_subagents` / `agent_memory` |
| providers `[models]` 精确键 | `providers.rs`（`default` / `max_retries` 不再 `starts_with`） |
| MCP enabled upsert | `extensions::set_mcp_enabled_in_toml` → `set_table_bool` |

### 4.9 曾导致重复键 / 样式异常的行为清单

| 行为 | 症状 | 状态 |
|------|------|------|
| `agent_prefs` 用 `starts_with(key)` | `yolo` 误改 `yolo_mode` 并留下双 `yolo` | 已修 |
| 表头要求 `trimmed == "[ui]"` | `[ui] # 注释` 匹配失败 → 再 append 一个 `[ui]` | 已修 |
| `providers` `starts_with("default")` / `starts_with(key)` | 可能误匹配 `default_model`、`max_retries_*` | 已修 |
| `read_models_u32` 把 `[models.x]` 当 `[models]` | 读错作用域 | 已修（仅 root `[models]`） |
| 多模块无锁交错 read-modify-write | 丢更新 / 偶发怪异内容 | 已对 unified write 加锁 |
| 行式 upsert 统一转 `\n` | Windows 原 CRLF 被改成 LF | **预期**（TOML 合法；不制造重复键） |
| 连续 sync 多次写盘 | 合法文件幂等 upsert 不增键 | 精确匹配后安全 |
| `[[hooks]]` 数组表 | 元素间同名键合法 | heal **不**跨元素去重 |

---

## 5. 相关代码索引

| 区域 | 路径 |
|------|------|
| 统一写层 | `src-tauri/src/agent_home_config.rs` |
| 权限 upsert（starts_with 风险） | `src-tauri/src/agent_prefs.rs` |
| Subagents / Memory sync | `src-tauri/src/agent_subagents.rs`, `agent_memory.rs` |
| TodoGate 等顶层键 | `src-tauri/src/agent_todo_gate.rs` 等 |
| Spawn 前 cascade | `src-tauri/src/acp_client.rs` |
| Providers `[models]` upsert | `src-tauri/src/providers.rs` |
| 脱敏预览 | `src-tauri/src/agent_config_view.rs` |
| 错误码 | `src-tauri/src/error.rs`（`AGENT_CRASHED`） |

---

## 6. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-11 | 依据 support `20260811-054802` 与本地复现（`yolo_mode`/`starts_with` → 双 `yolo`）初稿 |
| 2026-08-11 | 落地精确匹配、表头注释、spawn 前 dedupe 自愈、写锁；排查 providers/MCP/prefs 写坏路径 |
