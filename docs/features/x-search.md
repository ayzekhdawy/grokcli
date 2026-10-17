# 设计选择：**只服务 Agent 党**，但做出一个别人抄不像的特色

不选「也服务运营党」。运营党要的是排期、多号矩阵、自动互动——那是 Buffer / 社媒中台赛道，和 GrokGo 的本地网关基因打架，一做就平庸。

---

## 与众不同的产品特色（一句话）

> **GrokGo 不帮你「玩 X」，只帮 Agent「用 X 当可验证证据」——搜得到、存得住、引得出、回得像人、默认不代发。**

市面常见两极：

| 类型 | 做什么 | 缺什么 |
|------|--------|--------|
| 通用 AI / OpenRouter | 聊天里「好像搜过」 | 无稳定 tool、无引用链、无本地证据 |
| 社媒运营工具 | 发帖排期、矩阵 | 进不了 Codex/CC 的 tool loop |
| 裸 `x_search` | 搜一次吐一段字 | 下一轮 Agent 失忆、乱编、乱降级 web_search |

**GrokGo 卡的是第三极：Agent 工作流里的「X 证据层（Evidence Layer）」。**

产品记忆点可以叫：

### **X Evidence Rail（X 证据轨）**

一条强制轨：

```text
搜 → 结构化落证 →（可选）本地再分析 → 凡结论必带 x.com 引用
                                      → 回复只出草稿 + 原帖锚点
```

Agent 被 agents-guide **禁止**用 web_search / 瞎编帖子 URL 顶替；人始终在环上点发送。

这和「又多一个 MCP search」完全不是一个品类。

---

## 设计原则（决定工具长什么样）

1. **证据优先于内容**：返回值永远能指向 `https://x.com/i/status/...`，没有 URL 的结果降级为 `unverified`。  
2. **本地是系统真相**：落库在 `~/.grok-go/x-evidence/`（或 sqlite），CDN/上游 raw 可丢，证据 ID 不丢。  
3. **写路径默认关闭**：任何「发到 X」的能力不进默认 MCP 目录；草稿可以。  
4. **少工具、强合约**：6 个以内主工具，参数稳，agents-guide 写死何时用哪个。  
5. **为 tool loop 设计，不为仪表盘设计**：输出 JSON + 短 markdown，给模型吃，不给运营看报表。

---

## MCP 工具清单（Agent 党 · Evidence Rail）

> 命名统一 `x_*`；是否落库以「能否被下一轮 Agent 复用」为准。

### 0. 总览

| 工具 | 作用 | 落库 | 默认启用 |
|------|------|:----:|:--------:|
| `x_search` | 实时搜 X，写入证据 | ✅ | ✅ |
| `x_get` | 按 url/id 取单帖（补全/校验） | ✅ | ✅ |
| `x_evidence_list` | 列本机证据（按 query/session/tag） | 只读库 | ✅ |
| `x_evidence_get` | 取单条/一批证据全文 | 只读库 | ✅ |
| `x_analyze` | 只基于已落库证据做分析 | 可选写「分析快照」 | ✅ |
| `x_draft_reply` | 基于证据生成回复草稿 | ✅ 草稿 | ✅ |
| `x_quote_pack` | 把证据打成可粘贴引用包 | 可选 | ✅ |
| `x_publish_reply` | 真发送（若有一天） | 审计日志 | ❌ 默认关 |

下面是详细合约。

---

### 1. `x_search` — 搜并落证（主入口）

**用途**：唯一「从 X 拉新信息」的入口。

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `query` | string | ✅ | 关键词 / `from:user` / 话题（透传上游能力，不假装支持官方全语法） |
| `limit` | number | | 默认 10，上限 25（防上下文炸） |
| `freshness` | enum | | `any` \| `day` \| `week`（能映射就映射，不能就进 prompt 约束） |
| `session_tag` | string | | 默认当前 agent session id；用于证据分桶 |
| `dedupe` | bool | | 默认 true：同 status id 不重复占库 |

**返回（强制 envelope）**

**落库**：✅ 每条 → evidence row（见下节 schema）  
**特色**：搜完不是「一段散文」，是 **可 ID 引用的证据集**。Agent 下一轮必须说 `evidence_ids`，不能只复述模糊记忆。

---

### 2. `x_get` — 单帖校验 / 补全

**用途**：用户丢链接、或分析前要「钉死原文」。

| 参数 | 必填 | 说明 |
|------|:----:|------|
| `url` 或 `status_id` | ✅ 二选一 | |
| `session_tag` | | 写入同一证据桶 |

**落库**：✅ upsert  
**特色**：专门打「幻觉帖」——没有稳定 url 的不配进 `x_analyze` / `x_draft_reply`。

---

### 3. `x_evidence_list` / `x_evidence_get` — 本地证据总线

这是 **和「只有 search 的产品」真正拉开差距** 的两刀。

**`x_evidence_list`**

| 参数 | 说明 |
|------|------|
| `session_tag` / `query_contains` / `author` / `since` / `until` / `limit` | 过滤 |
| `ids_only` | 默认 false；true 时只返回 id 列表省 token |

**`x_evidence_get`**

| 参数 | 说明 |
|------|------|
| `evidence_ids` | string[]，必填 |
| `include_raw` | 默认 false（raw 大、易污染上下文） |

**落库**：只读  
**特色**：Agent 长任务可以：

```text
回合1: x_search → 落下 20 条
回合5: x_evidence_list → 还在
回合6: x_analyze(evidence_ids=…) → 不重新搜、不丢引用
```

没有这两工具，`x_search` 永远是一次性烟花。

---

### 4. `x_analyze` — 只吃证据，不吃空气

| 参数 | 必填 | 说明 |
|------|:----:|------|
| `evidence_ids` | ✅ | **禁止空数组**；禁止「全库瞎扫」除非显式 `scope=session` |
| `lens` | | `consensus` \| `dispute` \| `timeline` \| `claims` \| `risk` \| `custom` |
| `question` | | `lens=custom` 时必填 |
| `max_items` | | 默认 30，超出要 Agent 先 list 再筛 |

**规则（写进 tool description + agents-guide）**

- 只能基于给定 evidence；缺证据就说缺，**禁止补搜幻想**  
- 输出每个 claim 必须带 `evidence_ids` / `urls`  
- 找不到支撑的观点标 `confidence: low` 或直接省略  

**落库**：可选写 `analysis_snapshot`（id + 结论 markdown + 引用 ids），便于「把上次分析接着做」。  
**特色**：分析工具绑定证据 ID，把 GrokGo 从「搜索插件」变成 **可审计推理轨**。

---

### 5. `x_draft_reply` — 人在环的回复（运营党最想要的那部分，用 Agent 方式给）

| 参数 | 必填 | 说明 |
|------|:----:|------|
| `evidence_id` 或 `url` | ✅ | 回哪条 |
| `goal` | ✅ | 澄清 / 反驳 / 共鸣 / 引流 / 客服… |
| `persona` | | 简短人设，默认空 |
| `tone` | | `neutral` \| `sharp` \| `warm` \| `professional` |
| `variants` | | 默认 3，上限 5 |
| `must_cite` | | 默认 true：草稿里保留原帖要点，不歪曲 |

**返回**

**落库**：✅ 草稿 + 关联 evidence_id（可 `/` 复查）  
**不落**：发送状态（因为根本不发）  
**特色**：满足「回复需求」里 **80% 真实价值**（想好怎么回），砍掉 **90% 封号风险**（自动发）。

---

### 6. `x_quote_pack` — 小而锋利的「可交付物」

Agent 党经常要的不是分析本身，而是 **能贴进 PRD / 日报 / 投资 memo 的引用块**。

| 参数 | 说明 |
|------|------|
| `evidence_ids` | 必填 |
| `format` | `markdown` \| `json` \| `footnote` |
| `title` | 可选 |

**输出示例（markdown）**

```markdown
## X 证据包 · 2026-07-30
1. @foo (链接) — 「原文摘录…」
2. @bar (链接) — 「…」
```

**落库**：可选把 pack 存成 `~/.grok-go/x-evidence/packs/*.md`（和媒体 artifacts 哲学一致：本地绝对路径可打开）  
**特色**：一键从「搜过」变成「可交付」，这是运营后台也不如 Agent 顺手的点。

---

### 7. `x_publish_reply` — 明确不作为主特色

| 参数 | 说明 |
|------|------|
| — | 仅当用户显式绑定 X、打开 experimental write、二次确认 |

**默认**：不出现在 `tools/list`  
**若做**：独立 scope、审计日志、速率限制——**永不作为卖点首页**。

特色靠 Evidence Rail，不靠自动刷回复。

---

## 本地数据（系统真相）

路径建议：`~/.grok-go/x-evidence.db` + 可选 `packs/`。

**evidence 表（核心字段）**

| 字段 | 含义 |
|------|------|
| `evidence_id` | 稳定主键 |
| `status_id` / `url` | 外部锚点 |
| `author` / `text` / `created_at` | 内容 |
| `metrics_json` | 互动（有则存） |
| `query` / `session_tag` | 来源上下文 |
| `source` | `x_search` \| `x_get` \| `import` |
| `verified` | 是否有合法 x.com status url |
| `raw_ref` | 可选，大 raw 外置文件 |
| `fetched_at` | 抓取时间 |

**drafts / analysis_snapshots**：外键挂 `evidence_id`，形成：

```text
search ──► evidence ──► analyze
                │
                └──► draft_reply ──► (human sends on X)
                └──► quote_pack
```

这就是产品图，不是工具堆。

---

## agents-guide 硬规则（特色靠纪律，不靠口号）

```text
1. 需要 X 近况 → 只用 grok-go::x_search / x_get
2. 禁止 web_search / 浏览器 / 第三方 twitter API 顶替（除非 MCP /health 失败并声明）
3. 任何关于「某帖说了什么」的断言 → 必须带 url 或 evidence_id
4. 多轮任务先 x_evidence_list，再决定是否重新 search
5. x_analyze 不得在 evidence_ids 为空时调用
6. 回复需求 → x_draft_reply；禁止声称「已发送」
7. 图片仍走 Codex 原生；视频走既有 MCP；X 证据链独立
```

**纪律本身就是护城河**：客户端换了，guide + tool 合约还在。

---

## 为什么这套设计「与众不同」

| 维度 | 普通做法 | GrokGo Evidence Rail |
|------|----------|----------------------|
| 搜索 | 返回一段模型摘要 | 返回 **evidence_id + 强制 citation** |
| 记忆 | 靠上下文窗口 | **本机证据库跨回合** |
| 分析 | 自由发挥 | **只准吃已落证 ID** |
| 回复 | 自动发或纯文案 | **草稿 + 原帖锚点 + 风险标签** |
| 交付 | 聊完就没了 | **`x_quote_pack` 本地 markdown 产物** |
| 身份 | 纠结绑不绑 x.com | **先不绑也能完成 Agent 主路径**；绑 X 只为 write experimental |
| 竞品 | 像 NewAPI 或社媒工具 | **像「给 Agent 用的 X 证据总线」** |

一句话对外：

> **Codex / Claude Code 里，唯一把 X 搜索变成「可引用、可复查、可分析、可起草回复」闭环的本地轨。**

---

## 刻意不做的（保证特色不被稀释）

- 多账号 X 矩阵、定时发帖、点赞转发刷量  
- 漂亮运营看板（热力可以极简，不做完整 BI）  
- 全站爬虫、粉丝画像 CRM  
- 自动回复 bot  
- 用绑定 x.com 才能搜索（搜索继续走 Grok/xAI 能力）

---

## 落地优先级（仍然突出特色）

| 阶段 | 工具 | 特色是否成形 |
|------|------|----------------|
| **MVP** | `x_search` envelope 强化 + 落库 + `x_evidence_list/get` | ⭐ 证据轨成型 |
| **+1** | `x_analyze`（强制 ids）+ agents-guide 纪律 | ⭐⭐ 可审计分析 |
| **+2** | `x_draft_reply` + `x_quote_pack` | ⭐⭐⭐ 搜-证-析-稿-交付 闭环 |
| **以后** | `x_get` 补强、可选 X OAuth 只读、`x_publish_*` 默认关 | 不改变主叙事 |

MVP 其实 **不必先做回复**；只要「搜完有 ID、下轮还在、结论必须带链接」，特色已经立住。回复是锦上添花，不是灵魂。

---

## 产品叙事（你对外怎么讲）

- **不是**：「我们加了 X 搜索 MCP」  
- **而是**：「我们给 Agent 铺了一条 **X 证据轨**——它在本地记住帖子，逼模型引用，帮你起草回复，但绝不替你社死。」

若你只做一件视觉化的事：Overview 加一块 **Evidence** 小计数（今日新证 / 本周引用包），比再做一页运营图表更符合这个定位。

---

如果你下一步要进实现，我建议直接从 **`x_search` 返回强制 `evidence_ids` + sqlite 落库 + `x_evidence_list/get`** 开刀——这三个上线，产品特色就从 README 变成用户可感知的行为。需要的话我可以按你们现有 `mcp_tools_catalog` / `extract_x_search_result` 结构拆一版具体改动点。