# Composer 编辑改用 ProseMirror 文档位置 —— 进度与交接

**文档日期**：2026-09-24 · **决策**：`docs/adr/0003-composer-document-position-editing.md`

> 本条改造线现落在 **Markdown 档**（ADR 0004）：上游内置档保持原样，两档由设置项切换。

## 为什么改

查 TipTap 官方文档确认的实际模型：编辑器状态本体是 **ProseMirror 文档**（`editor.getJSON()` 是文档，`getHTML()` / `getText()` 是导出），坐标是**文档位置**（`editor.state.selection.from`，配 `doc.textBetween` / `resolve`）；**Markdown 不是原生格式**，由第三方 `tiptap-markdown` 提供导入导出（`storage.markdown.getMarkdown()` / `commands.setContent()`）。文档里不存在「扁平文本偏移」这种坐标空间。

结论：**存 Markdown 没错**（它是对 CLI 的线格式、journal 的持久化格式），**错在把 Markdown 当编辑面**。

改造前 composer 里同时存在三套坐标，`@` / slash 的插入靠**在 Markdown 字符串里搜索**定位：

```
序列化整篇 Markdown → lastIndexOf 搜 `@query` → 拼接 token → setDraft
→ 编辑器重新 parse 整篇 → 再用自造「编辑器文本空间」摆光标
```

已连续产出缺陷：

| 事故 | 机制 |
|---|---|
| 手工验收 | 列表项在 Markdown 里多 `- ` 前缀，DOM 偏移套到 Markdown 上短两个字符 → 替换掉正文末字并留下 `@` |
| 插入落点边界 | `@query` 后紧跟已有 token 时边界判定失败 → 退化成追加到文末、光标跑到文末、`@query` 留成纯文本 |
| 未修（本方向下消失） | 同名 `@query` 出现两次时只能猜「最后一个」——光标位置在检测阶段就被丢掉 |
| 代码块语言栏 | 只能用装饰器加属性、不能上 NodeView —— 因为序列化走 DOM walk，NodeView 多余元素会被当成正文 |

## 决策（ADR 0003）

composer 的**编辑操作以 ProseMirror 文档位置为唯一坐标空间**；Markdown 退回纯持久化 / 线格式。检测读文档、插入用一次 transaction、光标按位置表达；Markdown 只在边界出现（变更时 `getMarkdown()` 落盘，外部值用 `setContent()` 载入）。

## 进度

| 步骤 | 状态 | 说明 |
|---|---|---|
| ADR 0003 | ✅ | `docs/adr/0003-composer-document-position-editing.md` |
| 1. `@` 引用路径端到端 | ✅ | 见下 |
| 2. slash 路径同样处理 | ⏳ 未开始 | 目标：去掉 `locateSlashRangeInMarkdown` 与「为了定位而序列化整篇 Markdown」 |
| 3. 清掉手搓文本空间与 DOM walk | ⏳ 未开始 | `docPosForEditorTextOffset` / `editorTextOffsetForDocPos` / `composerMarkdown.collectSegments` / `draftDoc.serializeEditorDomWalk` 等，无调用方后删 |
| 4. 更新验收文档 C 段 | ⏳ 未开始 | `docs/ACCEPTANCE-slash-composer.md` 的 C7/C9/C10/C14 不再以「文本偏移」描述落点 |

### 第 1 步已落地内容

- **新增 `src/lib/composerQuery.ts`**：`queryRangeBeforeCaret(doc, caretPos, trigger) → { from, to, query }`，坐标为文档位置。`hardBreak` 记作换行（软换行后 `@` 仍触发），其余 leaf 用占位字符，保证字符串下标与 PM position 一对一。
- **新增 `src/components/composerRefInsert.ts`**：`insertRefAtomInto` 一次 `tr.replaceWith` 把 `[from,to)` 换成引用原子节点并把选区落到 chip 之后；`removeRangeInto` 用于「路径不可 token 化时删掉 `@query`、回退附件」。
- **检测链路改读文档**：`ComposerEditor` 在文档/选区变更时上报 `{from,to,query}`；`useComposerController` 去掉 rAF 的 DOM walk 分支。
- **删除**：`locateAtRangeInMarkdown`、`refCaretInEditorText`、`insertAtTokenAsRef` 与 `useComposerController` 里的 DOM 前缀路径。
- **`src/app/AppWorkbench.tsx` 13622 → 13603 行**（AGENTS.md 规则 7：只减不增）。

### 回归修复（过程中发现）

**软换行回归**：`textBetween(..., ATOM_LEAF)` 把**所有** leaf 都换成占位字符，`hardBreak` 也中招 —— 段落内 Shift+Enter 软换行之后打 `@` 会因「前面不是空白」而不触发补全（旧的自造文本空间把 hardBreak 当换行，是可用的）。改用 `textBetween` 的函数形式（prosemirror-model 1.25 支持 `leafText?: (node) => string`）区分两者，规则单源在 `composerQuery.composerLeafText`，`composerRefInsert.nextCharIsTight` 共用。

## 代码评审与处理

分支跑了独立评审（正确性 / 被删测试是否有净丢失 / 约定 / 隐患），结论：

| 级别 | 问题 | 处理 |
|---|---|---|
| 严重 | 外部 `setContent` 后不重算区间：消费方存的文档位置在新文档上可能仍落在界内却指向别的正文，插入会删掉无关内容 | 重解析后补一次 `emitAt`，不依赖 `selectionUpdate` 的时机。**注**：jsdom 里 `setContent` 恰好也会触发一次上报，因此这条修复写不出会失败的测试，已在测试注释里写明是显式兜底 |
| 建议 | `@` 面板「失焦即关闭」丢失（Tab 移出后常驻） | `reportAtQuery` 重新用 `shouldProbeComposerLiveDom` 把关；新增 `useComposerController.atGate.test.ts`（3 例，去掉闸门即红） |
| 建议 | 整条接线无人守（旧 caret 测试删掉后只剩裸 Editor 单测） | 新增 `ComposerEditor.atWiring.test.tsx`（5 例：上报位置、普通段落/列表项插入、不可 token 化回退、重解析后按新文档重算） |
| 建议 | 单测里净丢失的断言 | 补回「已有空格不补第二个空格」「空文档不加前导空格」「U+00A0 终止 query」；「区间失效」「range 为 null」两条从「正文仍在」加固为断言**落点**与逐字正文 |
| 细节 | query 允许含 `@`（与 slash 对齐） | 补用例写明是有意行为 |
| 细节 | 测试里用了 `any` | 换 `unknown` + 收窄 |

## 测试与验证

- 合并前分支：`npx tsc -b`（0 错）、`npx eslint src --max-warnings 0`（0 错）、`npx vitest run`（**665 文件 / 7722 用例全绿**）。
- 新增测试：`src/lib/composerQuery.test.ts`（18 例：普通段落 / 列表项 / 标题 / 行首 / 前空白 / `user@host` 拒绝 / 空 query / 查询后紧跟原子节点 / 软换行两种 / U+00A0 终止 / query 含 `@` / slash / 无 trigger / 非文本块）、`src/components/composerRefInsert.test.ts`（10 例，含「已有 chip 之前插入」与两条落点断言）、`src/components/ComposerEditor.atWiring.test.tsx`（5 例）、`src/hooks/useComposerController.atGate.test.ts`（3 例）。
- 迁移：原 `src/components/ComposerEditor.caret.test.tsx` 的 5 个用例改为 `composerRefInsert.test.ts` 里的**位置**断言（不再断言自造文本空间的偏移）。
- 回归护栏验证方式：把 `composerLeafText` 退回「永远返回占位符」，新增的软换行两例会失败；`locateAtRangeInMarkdown` 的边界修复对应的场景由 `已有 chip 之前` 用例覆盖。

## 待办与风险

1. **手工验收未做**（本轮最需要人看的一件事）：列表 / 标题 / 引用 / 代码块内的 `@` 插入、IME 组合输入，需要在应用里过一遍。
2. **IME**：检测改为按文档变更计算后，组合输入期间 ProseMirror 文档滞后于 DOM，补全将在组合结束后才出现（旧实现读 DOM 是实时的）。是否为可感知的回归未能确证 —— 验收时重点看中文输入法下打 `@`。
3. **`AppWorkbench.applyAtFile` 这一段仍无测试**：接线测试覆盖到 `ComposerEditor` 这一侧（上报位置 → 插入 → 上报 Markdown），`applyAtFile` 里的分支（面板过滤、附件回退）仍只有手工验收。
4. **`queryRangeBeforeCaret` 的 `/` 分支目前只有测试调用** —— slash 路径的改造是第 2 步，属预期。
5. 第 2、3 步完成后，`docs/ACCEPTANCE-slash-composer.md` 的 C 段描述与 ADR 的「待删清单」需要同步勾掉。
