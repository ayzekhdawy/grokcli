/**
 * `@` 面板选中一项后的落刀（ADR 0003 / ADR 0004）。
 *
 * 两条档位分支放在这里，而不是留在 `AppWorkbench`：AGENTS 规则 7 要求
 * AppWorkbench 只减不增，且这段分支纯粹是「草稿 + 附件 + 编辑器」三种能力的组合，
 * 抽出来可以脱离 React 单测。
 *
 * - **内置档**：上游行为 —— 把 `@query` 从草稿里删掉，选中的文件进附件条；
 * - **Markdown 档**：把 `[from, to)` 换成行内引用 chip（文档位置坐标）；路径不可
 *   token 化时退回附件，但仍然要删掉 `@query`，否则它会以字面文本留在输入框里。
 */

import type { Attachment } from "@/lib/attachments";
import { mergeAttachments } from "@/lib/attachments";
import type { ComposerEditorId } from "@/lib/composerEditorPref";
import {
  isTokenizableRefValue,
  type RefKind,
} from "@/lib/composerRefToken";

/** `@` 面板的一个候选项（与 `ComposerAtPanel` 的条目形状一致）。 */
export type AtFileEntry = {
  path: string;
  name?: string;
  isDir?: boolean;
};

/** `@query` 的当前区间（Markdown 档为文档位置；内置档为存储态下标）。 */
export type AtQueryRange = {
  present: boolean;
  start: number;
  end: number;
};

/** 落刀所需的外部能力：全部由调用方注入，便于单测与保持 AppWorkbench 不膨胀。 */
export type ApplyAtFileContext = {
  entry: AtFileEntry;
  /** 当前档位。 */
  kind: ComposerEditorId;
  live: AtQueryRange;
  /** 取当前编辑器 DOM（Markdown 档命令式插入的入口）。 */
  editorEl: () => HTMLElement | null;
  /** 关掉 `@` 面板状态（liveAt / 条目 / softFail）。 */
  clearAtState: () => void;
  /** 内置档：从草稿里删掉 `@query`（上游实现，按存储态下标）。 */
  removeAtTokenFromDraft: (
    draft: string,
    start: number,
    end: number,
  ) => string;
  setDraft: (next: string | ((prev: string) => string)) => void;
  setAttachments: (
    next: (prev: Attachment[]) => Attachment[],
  ) => void;
  /** Markdown 档：把区间换成引用 chip / 删掉区间。 */
  insertRefAtom: (
    el: HTMLElement | null,
    insert: {
      from: number | null;
      to: number | null;
      kind: RefKind;
      value: string;
    },
  ) => boolean;
  removeQueryRange: (
    el: HTMLElement | null,
    range: { from: number; to: number },
  ) => boolean;
  focus: () => void;
};

/** 附件条目（文件名与附件卡片显示名一致）。 */
export function attachmentEntryOf(entry: AtFileEntry): Attachment {
  return {
    path: entry.path,
    name: entry.name || entry.path.split(/[/\\]/).pop() || entry.path,
    isDir: !!entry.isDir,
  };
}

export function applyAtFileToComposer(ctx: ApplyAtFileContext): void {
  const { entry, live } = ctx;
  const range = live.present ? { from: live.start, to: live.end } : null;
  ctx.clearAtState();

  // 内置档：上游行为 —— 删 `@query`、文件进附件条。
  if (ctx.kind !== "tiptap") {
    if (live.present) {
      ctx.setDraft((d) => ctx.removeAtTokenFromDraft(d, live.start, live.end));
    }
    ctx.setAttachments((prev) => mergeAttachments(prev, [attachmentEntryOf(entry)]));
    ctx.focus();
    return;
  }

  // Markdown 档：`live` 的 start/end 已是文档位置（ADR 0003）。
  if (!isTokenizableRefValue(entry.path)) {
    if (range) ctx.removeQueryRange(ctx.editorEl(), range);
    ctx.setAttachments((prev) => mergeAttachments(prev, [attachmentEntryOf(entry)]));
    ctx.focus();
    return;
  }
  const kind: RefKind = entry.isDir ? "dir" : "file";
  ctx.insertRefAtom(ctx.editorEl(), {
    from: range?.from ?? null,
    to: range?.to ?? null,
    kind,
    value: entry.path,
  });
}
