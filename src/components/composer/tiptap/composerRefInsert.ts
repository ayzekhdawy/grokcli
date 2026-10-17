/**
 * 把 `@query` 区间替换成内联引用 chip（ADR 0003）。
 *
 * 坐标全部是 ProseMirror 文档位置：插入是**一次 transaction**，无 Markdown
 * 解析往返、无手工 splice、无文本偏移换算。选区随后由 transaction 自己落到
 * chip 之后，编辑器的 `onUpdate` 再把新 Markdown 上报给 draft。
 */

import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { composerLeafText } from "@/lib/composerQuery";
import type { RefKind } from "@/lib/composerRefToken";


export type ComposerRefInsert = {
  /** 目标区间（`@query` 的文档位置）；null / 失效时退回到当前选区。 */
  from: number | null;
  to: number | null;
  kind: RefKind;
  value: string;
};

/** 编辑器里紧跟 `to` 的字符是否已是非空白的正文（决定是否要补一个分隔空格）。 */
function nextCharIsTight(editor: Editor, to: number): boolean {
  const $to = editor.state.doc.resolve(to);
  if (!$to.parent.isTextblock) return false;
  const next = $to.parent.textBetween(
    $to.parentOffset,
    Math.min($to.parentOffset + 1, $to.parent.content.size),
    undefined,
    composerLeafText,
  );
  return next === "" || !/^\s/.test(next);
}

/**
 * 在 `[from, to)` 处插入引用 chip，选区落到 chip 之后。
 *
 * `@query` 后面通常已经跟着空格，再补一个会在正文与发给 CLI 的 prompt 里留下
 * 双空格，所以只在紧跟非空白正文时才补分隔空格（与旧 `insertAtTokenAsRef` 一致）。
 * 区间非法（文档在检测后变化、面板由别处触发）时退回到当前选区，避免误删正文。
 */
export function insertRefAtomInto(
  editor: Editor,
  insert: ComposerRefInsert,
): boolean {
  if (editor.isDestroyed) return false;
  const size = editor.state.doc.content.size;
  let from = insert.from;
  let to = insert.to;
  if (
    from == null ||
    to == null ||
    !(from >= 0 && to >= from && to <= size)
  ) {
    from = Math.min(editor.state.selection.from, size);
    to = from;
  }
  const node = editor.schema.nodes.refToken.create({
    kind: insert.kind,
    value: insert.value,
  });
  const needsSpace = nextCharIsTight(editor, to);
  const tr = editor.state.tr.replaceWith(
    from,
    to,
    needsSpace ? [node, editor.schema.text(" ")] : node,
  );
  const caret = from + node.nodeSize + (needsSpace ? 1 : 0);
  tr.setSelection(TextSelection.near(tr.doc.resolve(caret), 1));
  editor.view.dispatch(tr);
  return true;
}

/** 删除文档里的 `[from, to)`（回退附件时清掉 `@query` 那段）。 */
export function removeRangeInto(
  editor: Editor,
  from: number,
  to: number,
): boolean {
  if (editor.isDestroyed) return false;
  const size = editor.state.doc.content.size;
  if (!(from >= 0 && to > from && to <= size)) return false;
  editor.view.dispatch(editor.state.tr.delete(from, to));
  return true;
}
