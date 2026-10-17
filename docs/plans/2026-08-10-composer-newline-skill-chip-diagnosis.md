# 2026-08-10 · Composer 换行/空行 + Skill 转标签诊断与修复方案

> 状态：**已实现 + 自检 + 独立 review**（见 goal scratch evidence）  
> 来源：用户反馈「要修复的内容输入框」  
> 相关历史：v0.2.1 曾修过「发送后气泡丢换行/空行」（`serializeDom` 改 `innerText`），但 **skill 转 chip 的索引契约**与 **二次序列化路径**仍有缺口

---

## 1. 问题陈述（原话对齐）

| ID | 现象 | 严重度 |
|----|------|--------|
| **A** | 用户编辑内容含换行/空行时，**发送后**空行与部分换行被压缩，气泡/历史与输入不一致 | 高 |
| **B** | skills 被使用并 **转换成标签（chip）** 时，转换过程也会把换行/空行去掉 | 极高 |

目标：输入框所见 ≈ 发送后用户气泡 ≈ 重载历史；skill 转 chip 只替换 `/query` token，**绝不改写**其余正文的换行结构。

---

## 2. 数据流（端到端）

```
┌─ ComposerEditor (contenteditable) ─────────────────────────┐
│  DOM: text nodes + <br> + [data-skill] chips               │
│  serializeDom() → stored draft: "…[[skill:name]]…"         │
└───────────────────────────┬─────────────────────────────────┘
                            │ setDraft / getDraft
                            ▼
┌─ draftDoc ──────────────────────────────────────────────────┐
│  parseStoredContent / applySkillAtSlash / serializeForAgent │
│  storedDisplay (气泡/journal) vs agentBody (/name + text)   │
└───────────────────────────┬─────────────────────────────────┘
                            │ session_send(text, display_text)
                            ▼
┌─ Host turn.rs ──────────────────────────────────────────────┐
│  text.trim() → agent                                        │
│  display_text.trim() → journal user row                     │
│  (+ attachments 时 append_journal_attachment_refs)          │
└───────────────────────────┬─────────────────────────────────┘
                            │ session_messages / index_changed
                            ▼
┌─ mapStoredMessages + ConversationThread ────────────────────┐
│  hydrateDisplayContent → parseStoredContent → UserPlainOrSkills │
│  CSS: white-space: pre-wrap                                 │
└─────────────────────────────────────────────────────────────┘
```

**关键约定**

- **存储/气泡**：`[[skill:name]]` tokens（display form）
- **发给 agent**：`serializeForAgent` → 技能提到首行 `/a /b`，正文接在后面
- **CSS**：composer `div.composer__input` 与 `.user-msg-body` 均为 `pre-wrap`（显示层本身不折叠空行）

---

## 3. 根因诊断（带代码证据）

### 3.1 【主因 B】Skill 转 chip 使用了「DOM 纯文本坐标」去改「stored draft」

**活 slash 轮询**（`AppWorkbench` rAF）用：

```ts
// src/lib/draftDoc.ts — detectSlashQueryFromEditor
const raw = readPlainEditorText(el);  // ← innerText，不把 chip 还原成 [[skill:…]]
const candidates = [
  raw,
  raw.replace(/\n+/g, "\n"),   // 折叠连续空行
  raw.replace(/\n/g, ""),      // 去掉全部换行
  raw.split("\n").filter(Boolean).pop() ?? raw,  // 仅最后非空行
];
// 返回的 start/end 是 **candidate 字符串** 上的下标
```

**落库草稿**是 `serializeDom` 产出的 stored form（chip → `[[skill:name]]`）。

**应用替换**却是：

```ts
// AppWorkbench applySlashItem
setDraft((d) => applySkillAtSlash(d, q.start, q.end, item.name));
// applySkillAtSlash = slice(0,start) + "[[skill:name]] " + slice(end)
```

当 draft 里 **已有 skill chip** 时，DOM 纯文本长度 ≠ draft 长度，下标错位，会把中间正文（含 `\n\n`）切坏。

**复现算术（已本地演算）**

| 形式 | 示例 | `/foo` 起点 |
|------|------|-------------|
| draft | `[[skill:aihot]] hello\n\nworld\n/foo` | 29 |
| DOM plain（chip≈`⚒aihot`） | `⚒aihot hello\n\nworld\n/foo` | 20 |
| 用 DOM 下标切 draft | 得到 `[[skill:aihot]] hell[[skill:foo]] orld\n/foo` | **正文与空行被撕碎** |

即便没有已有 chip，若命中 `replace(/\n+/g,"\n")` / `replace(/\n/g,"")` / **last non-empty line** 候选，返回的 `start/end` 也是 **归一化串** 的坐标，直接 `slice` 原 draft 会：

- 把「仅最后一行」的 `start=0` 套到整段 draft 上 → **整段正文被 skill token 顶掉**
- 或在折叠空行后的坐标系里切片 → **表现为空行被压缩/正文错乱**

`ComposerEditor.emitSlash` 其实用的是 `serializeDom`（坐标与 draft 一致），但 rAF `detectSlashQueryFromEditor` **持续覆盖** `liveSlash` / `slashQuery`，发送转换时优先用到的是错误坐标源。

### 3.2 【主因 A 的一部分】发送路径里「会丢空白」的 trim / 附件回写

| 位置 | 行为 | 对用户可见气泡的影响 |
|------|------|----------------------|
| `turn.rs` `display_text.map(\|s\| s.trim())` | 去掉整段 **首尾** 空白（含首尾空行） | 重载后首尾空行没了；**中间**空行应保留 |
| `append_journal_attachment_refs` | `content.lines()` + 去掉 trailing blank，再拼 `@path` | **仅带附件时**再砍尾部空行；`lines()` 也不保留「是否以 `\n` 结尾」 |
| `parseAttachmentsFromContent` | 解析时丢掉正文尾部空行 | 重载映射时尾部空行再丢一层 |
| `serializeForAgent` | `textParts.join("").replace(/^\s+/,"").replace(/\s+$/,"")` | **只影响 agent 正文**；skills 提到首行。若某处误把 agent 文本当气泡，会像「skill 后空行没了」 |

乐观 UI 用的是 `storedDisplay = draft`（未走 agent 序列化），所以：

- **若发送当下气泡就已压缩** → 问题更可能在 **draft 在发送前已被破坏**（3.1 skill 转换，或 `serializeDom`/重绘环）
- **若仅重载/换会话后压缩** → 优先查 journal `trim` + 附件回写 + `mapStoredMessages` 路径

### 3.3 【次因 A】contenteditable 序列化曾丢换行（已部分修复）

历史根因（v0.2.1）：纯 BR walk **忽略 WebKit 的 DIV 换行** → 已改为 clone + skill token + `innerText`。

仍需警惕的残余：

1. **Enter 路径**：优先 `insertText("\n")`（pre-wrap 文本节点内真换行），失败才 `insertLineBreak`。两种结构混用时，round-trip 依赖 `innerText` 一致性。
2. **外部 setDraft 重绘**：`renderSegmentsInto` → `appendTextWithBreaks`（按 `\n` 插 `<br>`）。若 draft 字符串已坏，重绘只是固化错误。
3. **`commitFromDom` 在 chip 检测后 `placeCaretAtEnd`**：会打断光标，但不直接折叠换行。

### 3.4 已排除 / 低嫌疑

| 项 | 结论 |
|----|------|
| 气泡 CSS 折叠 | `.user-msg-body` / bubble 已是 `pre-wrap`，**不是**主因 |
| `titleSeed` / queue preview 的 `replace(/\n/g," ")` | 只用于标题/队列预览，**不进**气泡正文 |
| `serializeForAgent` 的 skill 前置 | 故意的 agent 协议；气泡应继续用 display form |

---

## 4. 分场景「谁在压缩」

| 用户操作 | 最可能坏点 | 可见结果 |
|----------|------------|----------|
| 纯文本多空行 → 发送，**立刻**看气泡 | draft 在输入阶段已被 `serializeDom`/错误 setDraft 弄坏；或实际没坏而误判 | 中间空行没了 |
| 纯文本多空行 → 发送，**重开会话** | `trim` + 附件 `@path` 回写 | 首尾空行没了；带附件时尾部空行没了 |
| 先 `/skill` 转 chip，再写多段正文 | 一般 OK（无已有 chip 时坐标常对齐） | — |
| **已有 chip** 或 **正文多行后再转 skill** | **3.1 坐标错位** | 空行消失、字被截断、正文前半被 skill 吃掉 |
| 多 skill 连续插入 | 每次转换都可能错位，累积损坏 | 极差体验 |

---

## 5. 修复方案（分阶段，可验收）

### 原则

1. **单一坐标系**：所有对 draft 的 `slice` / `applySkillAtSlash` / `removeAtToken` **只允许** stored form（`serializeDom` / `getDraft()`）下标。  
2. **检测归一化不得回写**：`replace(/\n+/g,"\n")` 等只用于「能不能认出 slash」，**禁止**用归一化串的 index 去改 draft。  
3. **空白策略显式化**：  
   - 气泡/journal：**保留中间空行**；首尾是否 trim 单独定（建议 journal **仅 trim 行尾空格，不 trim 整段空行**，或文档化「首尾空行不保证」）。  
   - agent：可继续 trim 首尾空白（协议侧），但 **不得**反写覆盖 display。  
4. **测试锁行为**：有回归用例才算修完。

---

### Phase 0 — 记录与验收基线（本文）

- [x] 问题记入 `docs/plans/2026-08-10-composer-newline-skill-chip-diagnosis.md`
- [ ] 手工基线（实现前点一次，实现后对照）：

| # | 步骤 | 期望 |
|---|------|------|
| M1 | 输入 `a` + 空行 + `b` + 空行 + `c`，发送 | 气泡三行、两空行 |
| M2 | 重开该会话 | 同 M1 |
| M3 | 先输入多段+空行，末行 `/aih` 选 skill | chip 替换 `/aih`，**上文空行不动** |
| M4 | 再插第二个 skill | 同上，不撕正文 |
| M5 | skill + 空行 + 正文，发送并重载 | chip + 空行 + 正文 |
| M6 | 带图片附件 + 多空行正文，重载 | 正文空行 + 附件卡都在 |

---

### Phase 1 — 修 B（skill 转 chip 坐标）【优先】

**1.1 统一 slash range 来源**

- `detectSlashQueryFromEditor` **删除或降级**会改长度的 candidate（折叠空行 / 去换行 / 只取最后一行）用于 **index**。  
  - 可选：仅用它们判断 `query` 字符串是否匹配 skill，**start/end 始终在 raw stored 坐标系计算**。  
- 实现建议：

```ts
// 伪代码
const stored = serializeDom(el);           // 与 draft 同构
const q = detectSlashQuery(stored);        // 可 trim 尾部空白做匹配
if (!q) return null;
// end = 从 q.start 起匹配 /query 的真实终点（在 stored 上），不是 candidate.length
const end = q.start + 1 + q.query.length; // '/' + query；注意 fullwidth slash 已 normalize
return { start: q.start, query: q.query, end };
```

- rAF live slash 与 `ComposerEditor.emitSlash` **共用同一函数**，禁止两套坐标。  
- `applySkillAtSlash` / 清 `/query` 的 `slice` **只吃**上述 range。

**1.2 `readPlainEditorText` 职责收窄**

- 仅用于 slash **过滤展示**（IME 中间态），不参与 mutation index。  
- 或：plain 路径若必须用，先把 `[data-skill]` 换成 `[[skill:name]]` 再量长度（与 `serializeDom` 一致）。

**1.3 测试（`draftDoc.test.ts` + 可选 DOM 单测）**

| 用例 | 断言 |
|------|------|
| `applySkillAtSlash` 多行+空行 | 仅 `/query` 被换，`\n\n` 保留 |
| 已有 `[[skill:a]]` + 正文空行 + `/b` | 插入后两 chip，正文空行保留 |
| `detectSlashQuery` 尾部 `\n\n` | start 仍指向 `/`，end 不含误伤 body |
| 禁止：归一化 candidate 的 index 用于 slice 的回归（固定 fixture 字符串） |

**1.4 验收** = 手工 M3–M5 + 单测绿。

---

### Phase 2 — 修 A（发送/journal 空白保真）

**2.1 Journal 写入**

- `display_text`：改为 **不** `trim()` 整段，或只 `trimEnd` 掉 contenteditable 常见的 **单个**尾部 `\n`（与 editor 空编辑器启发式对齐），**保留**用户有意的中间/多尾空行。  
- `text`（agent）可继续 `trim()`，但 **journal 不得回落成 agent text**（现有逻辑已优先 display，保持）。

**2.2 附件 dual-write**

- `append_journal_attachment_refs`：拼 `@path` 时不要无差别 `pop` 掉用户正文尾部空行；或 pop 后在「正文区」与「附件区」之间只插入 **固定一个** 分隔空行，并在 `parseAttachmentsFromContent` 对称处理。  
- 保证：`parseAttachmentsFromContent(append(...))` round-trip 后 **正文空行数**与发送前一致（附件行除外）。

**2.3 前端映射**

- `mapStoredMessageToChat` / `hydrateDisplayContent`：确认不引入 `\s+` 折叠。  
- `UserPlainOrSkills`：继续 `pre-wrap`；skill 段之间的 text 节点必须原样输出（已是）。

**2.4 测试**

- FE：`mapStoredMessages` fixture 含 `\n\n` + skill tokens + 可选 `@/path`。  
- Rust：`append_journal_attachment_refs` round-trip 保空行。

**2.5 验收** = 手工 M1–M2、M6。

---

### Phase 3 — 加固序列化 round-trip（防再回归）

1. 导出/单测 `serializeDom` 在 jsdom 或浏览器 fixture：  
   - 纯 `\n` 文本节点、连续 `<br><br>`、chip 夹在空行中间。  
2. 明确 **禁止** 再引入「为匹配 slash 而修改 draft 空白」的逻辑。  
3. 若仍见 WebKit 特例：考虑 stored draft 以 **segment 数组** 为 SoT（已有 `DraftSegment`），DOM 只是投影——工作量大，仅 Phase 1–2 不够时再上。

---

## 6. 建议实现顺序与风险

| 顺序 | 项 | 风险 | 回滚 |
|------|----|------|------|
| 1 | Phase 1 坐标统一 | 中：slash 识别回归（IME/尾部 br） | 单测 + 保留 trim **匹配** 但不改 index |
| 2 | Phase 2 journal/附件 | 低–中：旧 journal 兼容 | 只放宽保留，不改变 token 格式 |
| 3 | Phase 3 round-trip | 低 | 纯测 |

**不要做**

- 为修空行去改气泡 markdown 渲染（用户气泡不是 md）  
- 在 `serializeForAgent` 里「保留空行给 agent」却仍用 agent 串当气泡  
- 继续用 `last line only` 的 index 去 `setDraft`

---

## 7. 涉及文件清单

| 文件 | 角色 |
|------|------|
| `src/lib/draftDoc.ts` | `detectSlashQuery*` / `applySkillAtSlash` / `serializeForAgent` / `readPlainEditorText` |
| `src/components/ComposerEditor.tsx` | `serializeDom` / Enter / commitFromDom / emitSlash |
| `src/app/AppWorkbench.tsx` | live slash rAF、`applySlashItem`、`executeSend` / `send` |
| `src-tauri/src/session_manager/turn.rs` | `display_text` trim、journal 写入 |
| `src-tauri/src/session_manager/types.rs` | `append_journal_attachment_refs` |
| `src/lib/attachments.ts` | `parseAttachmentsFromContent` 尾部空行 |
| `src/lib/mapStoredMessages.ts` | 重载映射 |
| `src/components/lobe-chat/ConversationThread.tsx` | 气泡展示 |
| `src/lib/draftDoc.test.ts` 等 | 回归锁 |

---

## 8. 结论（一句话）

- **B（skill 转标签吞换行）**：根因是 **DOM 纯文本 / 折叠 candidate 的下标** 被用来改 **stored draft**，在已有 chip 或多行正文时会直接切片撕毁空行与正文。  
- **A（发送后压缩）**：一部分是 B 的前置损坏；其余是 **journal `trim` + 附件 `@path` 回写/解析丢尾部空行**；显示 CSS 与 v0.2.1 的 `innerText` 修复已覆盖「纯展示折叠」类问题。  

**先做 Phase 1，再做 Phase 2**；未统一坐标前改 CSS 或只改 trim 都治不好 B。
