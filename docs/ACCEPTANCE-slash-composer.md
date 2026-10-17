# Acceptance · Slash / Skills / Goal / Doctor (Wave A)

Run after implementation. Every item is pass/fail.

## A. Doctor (fix)

| # | Check | How |
|---|--------|-----|
| D1 | Doctor modal is **not** a bare JSON `<pre>` | Open Doctor from Settings / sidebar / tray |
| D2 | Shows check rows with status ok/warn/fail | CLI found, auth, data root, backend |
| D3 | **Re-run** refreshes report | Click re-run; loading then new timestamp |
| D4 | **Copy** puts redacted report on clipboard | Paste elsewhere |
| D5 | Slash `/doctor` opens same modal | Type `/doctor` Enter in composer |
| D6 | i18n: all Doctor chrome via `t()` | Switch locale |

## B. Skills data

| # | Check | How |
|---|--------|-----|
| S1 | `skills_list` / inspect returns invocable skills | Host command or UI list non-empty when CLI present |
| S2 | Plus menu Skills section lists real skills (or empty state) | Open + menu |
| S3 | Skills filter by name/description | Type `/aih` → aihot-like skills; `/rc` and `/review-` highlight `review-commit` |

## C. Editor + inline references

**按档位验收（ADR 0004）**：输入框有两套实现，设置 → 界面 →「输入框编辑器」切换，
缺省是内置档。

- **内置档（默认）** = 上游自研 contenteditable（纯文本 + `<br>` + skill/plugin chip）。
  它没有列表 / 代码块 / 行内文件引用，因此下表中标「仅 Markdown 档」的行不适用；
  这些行在默认档的表现是上游行为本身（`@` / slash 选中的文件进下方附件条）。
- **Markdown 档** = TipTap / ProseMirror（ADR 0002/0003 的实现），下表全部适用。

| # | Check | How | 档位 |
|---|--------|-----|------|
| C1 | Composer root is a ProseMirror-managed `div.composer__input[contenteditable=true]`（不是 textarea，也不是自研 contenteditable） | Inspect DOM | 仅 Markdown 档（内置档的根是 `.composer-editor-wrap` 内的自研 contenteditable） |
| C2 | Selecting a skill inserts an **inline** chip at the caret | Type text, `/skill`, Enter mid-sentence | 两档 |
| C3 | Backspace deletes a whole chip, leaving the surrounding text intact | Caret after chip, Backspace | 两档 |
| C4 | IME Enter does not send | Chinese IME compose + Enter | 两档 |
| C5 | Enter sends while the palette is closed; Shift+Enter inserts a newline | | 两档 |
| C6 | **列表项内** Shift+Enter 新起一个同级列表项（Enter 被绑定为发送，这是列表里唯一可用的换行手势） | 输入 `1. ` 后 Shift+Enter | 仅 Markdown 档（内置档无列表；Shift+Enter 是软换行） |
| C7 | `@` 补全选中文件 → 文件名 chip **内联**落在光标处（不再进下方附件区）；目录同理，带文件夹图标 | 在句子中间输入 `@` 选文件 | 仅 Markdown 档（内置档选中文件进附件区） |
| C8 | 引用 chip 整块删除；悬停显示完整路径 | Backspace / hover | 仅 Markdown 档 |
| C9 | `@` 匹配到 0 个目标时补全面板自动关闭；`@` 后接空格即终止补全，普通 `@文本` 不被转换 | 输入 `@某人` / `@/goal` | 两档 |
| C10 | 粘贴或输入 http(s) 链接自动成为 URL chip；chip 显示「主机 + 路径」（去掉 query/hash）；普通点击只定位光标，⌘/Ctrl+点击才打开浏览器 | 粘贴链接；点击 chip | 仅 Markdown 档 |
| C11 | 非 http(s) 协议（`javascript:` / `data:` / `file:` / `mailto:` 等）不得成为 chip 或可点击链接 | 粘贴这些链接 | 两档（内置档不识别 URL，粘贴即纯文本） |
| C12 | 输入框内可创建的每一种 Markdown 结构，其渲染与聊天消息里的同一结构一致 | 列表 / 分割线 / 代码块 / 行内代码 / 标题 / 粗体斜体 | 仅 Markdown 档 |
| C13 | 发送后正文里的引用序列化为 `@绝对路径`；URL 即链接本身 | 观察 agent 收到的内容或日志 | 仅 Markdown 档（内置档的附件走 `buildAgentPrompt`） |
| C14 | 用户气泡里的引用用聊天侧同一套 chip 渲染；重新编辑已发送消息时引用回填成 chip | 发送后查看气泡 / 点编辑 | 两档（回填到内置档时引用降级成附件条 · ADR 0004） |

## D. Slash palette UX

| # | Check | How |
|---|--------|-----|
| P1 | `/` at start opens palette | |
| P2 | `hello /` (space before slash) opens palette | |
| P3 | `https://` mid-path does **not** open | type url-like without space rule |
| P4 | ↑↓ moves highlight; hover uses same style | |
| P5 | Esc closes palette | |
| P6 | Sections: commands then skills | |

## E. Modes & actions

| # | Check | How |
|---|--------|-----|
| M1 | `/goal` enables goal chip + goal placeholder | |
| M2 | Clear goal chip turns mode off | |
| M3 | Send with goal prefixes agent text with `/goal` | Observe network/log or journal |
| M4 | `/plan` sets plan mode (Access menu reflects) | |
| M5 | `/compact` confirm → sends `/compact` | |
| M6 | `/status` opens status modal | |
| M7 | `/mcp` opens MCP status modal | |
| M8 | Plan and Goal mutually exclusive | |

## F. History & send

| # | Check | How |
|---|--------|-----|
| H1 | User bubble shows skill chips for `[[skill:…]]` | Send with skill |
| H2 | Agent receives `/skill-name` form | Backend / inspect prompt |
| H3 | Edit last user message restores chips | |
| H4 | Attachments still work with chips | |

## G. Regression

| # | Check | How |
|---|--------|-----|
| R1 | `pnpm test` green | |
| R2 | `pnpm typecheck` green | |
| R3 | Existing composer send without slash still works | |
