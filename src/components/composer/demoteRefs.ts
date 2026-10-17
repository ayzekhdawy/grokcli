import type { Attachment } from "@/lib/attachments";
import { REF_TOKEN_RE } from "@/lib/composerRefToken";
import { mergeAttachments } from "@/lib/attachments";
import {
  parseStoredContentWithRefs,
  serializeStored,
  type AnyDraftSegment,
} from "@/lib/draftDoc";

/** 降级结果：内置编辑器可用的草稿文本 + 需要补进的附件。 */
export type DemotedComposerDraft = {
  /** 去掉引用段之后的存储态草稿（引用变成附件，不再留在正文里）。 */
  text: string;
  /** 原有附件 + 由引用转来的附件（按路径去重）。 */
  attachments: Attachment[];
  /** 转成了几条附件（= 正文里移走的文件 / 目录引用数）。 */
  converted: number;
};

/**
 * 把草稿里的内联引用降级成附件条目，供**内置编辑器**使用（ADR 0004）。
 *
 * 上游那份编辑器的段落投影假定每段都带 `text`，拿到引用段会直接抛错；跨档时
 * 因此要在边界处转一次。规则：
 *
 * - `file` / `dir` 引用 → 附件条目（保持原有附件的顺序，按路径去重）；
 * - `url` 引用 → **留在正文里**（它本来就以链接本身作为正文，转成附件没有意义，
 *   发送时的文本也不会因此改变）；
 * - 其余段落（正文 / skill / plugin / 已挂载聊天）原样保留存储态。
 *
 * 这是一次**单向有损**转换：切回 Markdown 编辑器不会把附件变回行内引用
 * （已在需求里确认接受）。
 */
export function demoteRefsForLegacyEditor(
  stored: string,
  attachments: readonly Attachment[] = [],
): DemotedComposerDraft {
  const segments = parseStoredContentWithRefs(stored);
  const kept: AnyDraftSegment[] = [];
  const fromRefs: Attachment[] = [];
  let sawRef = false;
  for (const s of segments) {
    if (s.type !== "ref") {
      kept.push(s);
      continue;
    }
    sawRef = true;
    if (s.kind === "url") {
      // URL 引用在正文里就是链接本身，保留为普通文本。
      kept.push({ type: "text", text: s.value });
      continue;
    }
    fromRefs.push({
      path: s.value,
      name: basenameOf(s.value),
      isDir: s.kind === "dir",
    });
  }
  // 只有 url 引用时 `fromRefs` 为空，但正文仍被改写过（token → 链接），
  // 因此「要不要重写」按「有没有见过引用段」判断，而不是按转出的附件数。
  if (!sawRef) {
    return {
      text: stored,
      attachments: [...attachments],
      converted: 0,
    };
  }
  return {
    text: serializeStored(kept),
    attachments: mergeAttachments([...attachments], fromRefs),
    converted: fromRefs.length,
  };
}

/** 路径末段（与附件卡片显示名一致）。 */
function basenameOf(path: string): string {
  const parts = path.split(/[/\\]/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}

/** 引用 token 的存在性判断（去掉 `g` 标志，避免与其它调用点共享 lastIndex）。 */
const REF_TOKEN_TEST_RE = new RegExp(REF_TOKEN_RE.source);

/**
 * 草稿里是否含行内引用段。渲染前的便宜前置判断：不含引用时不必全量解析，
 * 内置档每次按键都能直接跳过。
 */
export function hasRefSegments(stored: string): boolean {
  return REF_TOKEN_TEST_RE.test(stored);
}
