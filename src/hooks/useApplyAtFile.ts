/**
 * `@` 面板落刀的接线层（ADR 0003 / ADR 0004）。
 *
 * 决策与两条档位分支（内置档进附件条 / Markdown 档插行内引用 chip）在
 * `src/lib/composerAtApply.ts`，那里是纯函数、可脱离 React 单测；这里只把
 * workbench 手上的 ref / setter 组合成它的上下文 —— 放成 hook 是为了让
 * AppWorkbench 不再堆一段只做转发的回调（AGENTS 规则 7）。
 */

import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import type { ComposerAtFileEntry } from "@/components/ComposerAtPanel";
import {
  composerEditorKind,
  insertComposerRefAtom,
  removeComposerQueryRange,
} from "@/components/composer";
import type { LiveTokenQuery } from "@/hooks/useComposerController";
import type { Attachment } from "@/lib/attachments";
import { applyAtFileToComposer } from "@/lib/composerAtApply";

export type ApplyAtFileDeps = {
  /** `@query` 的当前区间（Markdown 档为文档位置）。 */
  liveAtRef: MutableRefObject<LiveTokenQuery>;
  /** 关掉 `@` 面板状态（liveAt / 条目 / softFail）。 */
  clearAtState: () => void;
  /** 内置档：从草稿里删掉 `@query`（上游实现，按存储态下标）。 */
  removeAtTokenFromDraft: (
    draft: string,
    start: number,
    end: number,
  ) => string;
  /** 编辑器 DOM（Markdown 档命令式插入的入口）。 */
  editorRef: RefObject<HTMLDivElement | null>;
  setDraft: (next: string | ((prev: string) => string)) => void;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  /** 落刀后把光标交回输入框。 */
  focus: () => void;
};

export function useApplyAtFile(deps: ApplyAtFileDeps): (
  entry: ComposerAtFileEntry,
) => void {
  const {
    liveAtRef,
    clearAtState,
    removeAtTokenFromDraft,
    editorRef,
    setDraft,
    setAttachments,
    focus,
  } = deps;
  return useCallback(
    (entry: ComposerAtFileEntry) => {
      applyAtFileToComposer({
        entry,
        kind: composerEditorKind(),
        live: liveAtRef.current,
        editorEl: () => editorRef.current,
        clearAtState,
        removeAtTokenFromDraft,
        setDraft,
        setAttachments,
        insertRefAtom: insertComposerRefAtom,
        removeQueryRange: removeComposerQueryRange,
        focus,
      });
    },
    [
      liveAtRef,
      clearAtState,
      removeAtTokenFromDraft,
      editorRef,
      setDraft,
      setAttachments,
      focus,
    ],
  );
}
