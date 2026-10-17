/**
 * Thin island: binds ComposerEditor to the external draft store so App need
 * not re-render on every keystroke.
 *
 * 这里也是**档位降级**的落点（ADR 0004）：内置档读不了行内引用段，因此在把草稿
 * 交给编辑器之前先转一次（渲染前用纯函数去段，效果里落盘 + 补附件）。
 */

import { memo, useCallback, useEffect, useMemo } from "react";
import {
  ComposerEditor,
  type ComposerEditorProps,
  useComposerEditorKind,
} from "@/components/composer";
import { demoteRefsForLegacyEditor, hasRefSegments } from "@/components/composer/demoteRefs";
import {
  useComposerDraft,
  useComposerDraftActions,
} from "@/hooks/useComposerDraft";
import type { Attachment } from "@/lib/attachments";

export type ComposerDraftEditorProps = Omit<
  ComposerEditorProps,
  "value" | "onChange"
> & {
  /** Optional side-effect after store update (e.g. exit prompt-history browse). */
  onDraftChange?: (draft: string) => void;
  /** 切到内置档时，草稿里的行内引用被降级成的附件条目（单向有损）。 */
  onDemoteRefs?: (converted: Attachment[]) => void;
};

export const ComposerDraftEditor = memo(function ComposerDraftEditor({
  onDraftChange,
  onDemoteRefs,
  ...rest
}: ComposerDraftEditorProps) {
  const draft = useComposerDraft();
  const { setDraft } = useComposerDraftActions();
  const legacy = useComposerEditorKind() === "legacy";

  // 渲染前就把引用段去掉：内置编辑器拿到引用段会直接抛错，不能等到 effect。
  const value = useMemo(() => {
    if (!legacy || !hasRefSegments(draft)) return draft;
    return demoteRefsForLegacyEditor(draft).text;
  }, [legacy, draft]);

  useEffect(() => {
    if (value === draft) return;
    const demoted = demoteRefsForLegacyEditor(draft);
    setDraft(demoted.text);
    if (demoted.converted > 0) onDemoteRefs?.(demoted.attachments);
  }, [value, draft, setDraft, onDemoteRefs]);

  const onChange = useCallback(
    (next: string) => {
      setDraft(next);
      onDraftChange?.(next);
    },
    [setDraft, onDraftChange],
  );
  return <ComposerEditor {...rest} value={value} onChange={onChange} />;
});
