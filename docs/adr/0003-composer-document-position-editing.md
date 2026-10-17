# ADR 0003 — composer 编辑以 ProseMirror 文档位置为唯一坐标空间，Markdown 退回持久化格式

- 状态：已采纳
- 日期：2026-09-24

> **适用范围（ADR 0004）**：本决策只适用于 **Markdown 档** 的输入框编辑器。上游的
> 自研 contenteditable 仍是默认档并保持原样；两档由设置项「输入框编辑器」切换。

## 背景

ADR 0002 选定 ProseMirror（TipTap）作编辑内核后，composer 里同时存在**三套坐标**：

1. **存储空间**（Markdown 源码 + `[[file:…]]` token）——draft、journal、发给 CLI 的形态；
2. **编辑器文本空间**（`editorTextOffsetForDocPos` / `docPosForEditorTextOffset` 手搓的「可见文本」扁平长度）；
3. **DOM 文本空间**（`getStoredTextBeforeCaret` 手写 walk 出来的光标前缀）。

第三个空间只用于「光标前有什么」，第一个用于落盘与插入，第二个用于把前者换算成后者。
`@` / slash 的插入因此走的是**字符串搜索**：序列化整篇 Markdown → `lastIndexOf` 搜
`@query` → 拼接 token → `setDraft` → 编辑器重新 parse 整篇 → 再用手搓空间摆光标
（`src/lib/composerMarkdown.ts` 的 `locateAtRangeInMarkdown` / `refCaretInEditorText`）。

这套做法已经稳定地生产 bug：

- **手工验收**：列表项在 Markdown 里多 `- ` 前缀，DOM 偏移套到
  Markdown 上短两个字符，插入替换掉正文最后一个字并留下 `@`。修法是「回到 Markdown
  里重搜」——把问题从空间错位改成了搜索。
- **`@query` 后紧邻已有 token**：边界判定失败，插入退化成追加到
  文末、光标跑到文末、`@query` 留成纯文本。
- 仍未修：同名 `@query` 在正文里出现两次时，`lastIndexOf` 只能猜「最后一个」。**光标
  位置在检测阶段就被丢掉了**，搜索法无从判断该替换哪一个。
- 同类代价：代码块语言栏只能用装饰器加属性，不能用 NodeView —— 因为我们的序列化是走
  DOM walk，NodeView 多出来的元素会被当成正文。

ADR 0002 的「影响」里其实已经预告过这个脆弱点（新增原子节点必须同步泛化
`collectSegments`，否则光标定位漂移）。

**TipTap 官方文档给出的实际模型**（本次查证）：

- 编辑器状态是 **ProseMirror 文档**：`editor.getJSON()` 是文档本体，`getHTML()` /
  `getText({ blockSeparator })` 都是导出；坐标是**文档位置**，配
  `doc.textBetween(from, to, separator)` / `doc.resolve(pos)` 使用。
- **Markdown 不是原生格式**，由第三方扩展 `tiptap-markdown` 提供双向转换
  （其自述："bidirectional conversion between markdown text and Tiptap's internal
  ProseMirror document format"）：`editor.storage.markdown.getMarkdown()` 导出、
  `commands.setContent(markdown)` 导入。
- 文档里不存在「扁平文本偏移」这种坐标空间 —— 那是我们自造的。

结论：**存 Markdown 没有错**（它是 CLI 的线格式，也是 journal 的持久化格式），**错的是
把 Markdown 当编辑面**。光标位置本来就一直在手边（`editor.state.selection.from`），
是我们把它设计成了 `requestComposerStoredCaret(at: number)` 这个扁平长度，才被迫做
两次换算。

## 决策

composer 的**编辑操作以 ProseMirror 文档位置为唯一坐标空间**；Markdown 只作为持久化与
线格式存在。

具体：

1. `@` / slash 的**检测**读文档而非 DOM，返回查询在文档中的位置区间 `{ from, to }`。
2. **插入**用一次 transaction 完成：把 `[from, to)` 替换成原子节点，随后把选区设到节点
   之后。原子、一步撤销、无解析往返、无坐标换算。
3. **光标请求**按位置表达（`setTextSelection` / `focus(pos)`），删除扁平文本偏移这一层。
4. Markdown 只在边界出现：内容变更时 `getMarkdown()` 落盘；外部值（草稿恢复、历史回填、
   发送后清空）用 `setContent()` 载入。

## 权衡

- **收益**：删掉 `locateAtRangeInMarkdown`、`refCaretInEditorText`、手搓文本空间与三处
  DOM walk；同名 `@query` 的消歧问题随之消失（不再需要猜）；插入变成原子操作，撤销/重做
  正确；将来给代码块加真正的 NodeView 不再有「元素被当成正文」的风险。
- **代价**：`@` / slash 的检测要改成读文档（IME、原子节点、块边界都要重测一遍）；插入
  路径要重写，`AppWorkbench` 里那段内联逻辑必须搬进领域模块（AGENTS.md 规则 7：App shell +
  AppWorkbench 行数只能减不能增）；现有测试是行为护栏但要迁移，其中一部分（针对字符串搜索
  的边界用例）会被更有针对性的位置断言替换。
- **不做**：不换编辑内核（ADR 0002 的结论不变）；不改 draft / journal / 发送的 Markdown
  格式（对 CLI 与历史的兼容性不受影响）；不改用户可见交互。

## 影响

- 改动集中在：`src/components/ComposerEditor.tsx`、`src/app/AppWorkbench.tsx` 的
  `applyAtFile` / `applySlashItem`、`src/components/ComposerAtPanel.tsx`、
  `src/lib/atFileQuery.ts`、`src/lib/composerMarkdown.ts`；新增领域模块承载插入路径。
- 待删（无人引用后）：`locateAtRangeInMarkdown`、`locateSlashRangeInMarkdown`、
  `refCaretInEditorText`、`docPosForEditorTextOffset`、`editorTextOffsetForDocPos`、
  `composerMarkdown.collectSegments`、`draftDoc.serializeEditorDomWalk` /
  `readStoredEditorText` / `getStoredTextBeforeCaret`（DOM walk 家族）。
- 保留：`draftDoc` 的 token 语法与 `[[file:…]]` ↔ `@路径` 转换（存储态不变）、
  `hydrateDisplayContent` 的历史回填、代码块语言栏装饰器。
- 落地按 4 步提交，每步单独跑 `tsc -b` / `eslint` / `vitest`：检测改读文档 → 插入改
  transaction → 光标改位置 → 删除不再使用的字符串搜索与手搓空间，并同步更新
  `docs/ACCEPTANCE-slash-composer.md` C 段的验收方法（C7/C9/C10/C14 不再以「文本偏移」描述）。
- 手工验收仍需覆盖列表 / 标题 / 引用 / 代码块内的 `@` 插入与 slash，以及 IME 组合输入。
