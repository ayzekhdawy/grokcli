/**
 * composer 输入框使用哪一套编辑器（ADR 0004）。
 *
 * 真值来自 `AppSettings.composerEditor`（设置 → 界面），读取处按缺省处理为
 * **内置编辑器**（legacy），不做一次性迁移。这里用模块级订阅而不是把它塞进
 * workbench 的状态：档位是全局的，而 AGENTS 规则 7 要求 AppWorkbench 只减不增。
 */

import {
  normalizeComposerEditor,
  type ComposerEditorId,
} from "@/lib/composerEditorPref";

let kind: ComposerEditorId = normalizeComposerEditor(undefined);
const listeners = new Set<() => void>();

/** 当前档位（缺省 = 内置编辑器）。 */
export function composerEditorKind(): ComposerEditorId {
  return kind;
}

/** 应用设置里的档位值（非法 / 缺省都会归一到内置）。 */
export function setComposerEditorKind(raw: unknown): void {
  const next = normalizeComposerEditor(raw);
  if (next === kind) return;
  kind = next;
  for (const fn of listeners) fn();
}

/** 订阅档位变化（分发器用 `useSyncExternalStore` 订阅它）。 */
export function subscribeComposerEditorKind(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
