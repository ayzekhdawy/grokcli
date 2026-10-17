/**
 * `[[skill:name]]` / `[[plugin:name]]` token 的 ProseMirror 原子节点。
 *
 * 存储格式保持向后兼容：draft / 消息历史仍使用 `[[skill:name]]` 文本 token，
 * 编辑器内通过 markdown-it inline 规则反解析为原子节点，序列化时原样写回。
 */

import { Node, mergeAttributes } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { skillChipGlyphSvg } from "@/components/SkillChip";

/** prosemirror-markdown 序列化 state 的最小结构接口。 */
type MarkdownWriter = {
  write: (text: string) => void;
};

/** Skill / plugin 名称字符集（与 draftDoc 的 SKILL_NAME_RE 保持一致）。 */
export const SKILL_TOKEN_NAME = "[a-zA-Z0-9_.:-]+";

const SKILL_TOKEN_RE = new RegExp(
  `\\[\\[(skill|plugin):(${SKILL_TOKEN_NAME})\\]\\]`,
  "y",
);

/** markdown-it inline state 的最小结构接口（避免引入 markdown-it 直接依赖）。 */
type MarkdownItInlineState = {
  src: string;
  pos: number;
  push: (type: string, tag: string, nesting: number) => {
    markup?: string;
    attrSet: (name: string, value: string) => unknown;
  };
};

/** markdown-it 实例的最小结构接口（仅覆盖本规则需要的能力）。 */
export type MarkdownItLike = {
  inline: {
    ruler: {
      before: (
        after: string,
        ruleName: string,
        fn: (state: MarkdownItInlineState, silent: boolean) => boolean,
      ) => void;
    };
  };
  renderer: {
    rules: Record<string, (tokens: unknown[], idx: number) => string>;
  };
};

type TokenLike = {
  attrGet: (name: string) => string | null;
};

/** 在 markdown-it 中注册 `[[skill:name]]` inline 规则与 HTML 渲染。 */
export function installSkillMarkdownRule(md: MarkdownItLike): void {
  md.inline.ruler.before("escape", "grok_skill_token", (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x5b) return false;
    SKILL_TOKEN_RE.lastIndex = state.pos;
    const m = SKILL_TOKEN_RE.exec(state.src);
    if (!m || m.index !== state.pos) return false;
    if (silent) return true;
    const token = state.push("grok_skill_token", "span", 0);
    token.markup = m[0];
    token.attrSet("kind", m[1]!);
    token.attrSet("name", m[2]!);
    state.pos += m[0].length;
    return true;
  });
  md.renderer.rules.grok_skill_token = (tokens, idx) => {
    const t = tokens[idx] as TokenLike;
    const kind = t.attrGet("kind") === "plugin" ? "plugin" : "skill";
    const name = t.attrGet("name") ?? "";
    return `<span data-skill-token="${kind}:${name}"></span>`;
  };
}

/** Token 文本形式（存储 / 序列化坐标空间）。 */
export function skillTokenText(kind: string, name: string): string {
  return `[[${kind === "plugin" ? "plugin" : "skill"}:${name}]]`;
}

/**
 * 该节点在编辑器文本空间 / 存储空间里的 token 文本；不是 skill token 时返回
 * `null`。两个空间逐字符等价，因此这一个函数同时供 caret 换算与 DOM 序列化
 * 使用（由 `composerMarkdown` 汇总多种 atom 类型）。
 */
export function skillTokenStoredText(node: ProseMirrorNode): string | null {
  if (node.type.name !== "skillToken") return null;
  return skillTokenText(
    String(node.attrs.kind ?? "skill"),
    String(node.attrs.name ?? ""),
  );
}

export const SkillTokenNode = Node.create({
  name: "skillToken",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      kind: {
        default: "skill",
        parseHTML: (element: HTMLElement) =>
          (element.getAttribute("data-skill-token") ?? "").split(":")[0] ||
          "skill",
      },
      name: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          (element.getAttribute("data-skill-token") ?? "")
            .split(":")
            .slice(1)
            .join(":"),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-skill-token]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const kind = node.attrs.kind === "plugin" ? "plugin" : "skill";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-skill-token": `${kind}:${String(node.attrs.name ?? "")}`,
      }),
    ];
  },

  // 原子 chip：用 DOM NodeView 复用聊天中的 skill chip 视觉（含图标 SVG）。
  addNodeView() {
    return ({ node }) => {
      const kind = node.attrs.kind === "plugin" ? "plugin" : "skill";
      const name = String(node.attrs.name ?? "");
      const wrap = document.createElement("span");
      wrap.className =
        "skill-chip skill-chip--sm skill-chip--editor" +
        (kind === "plugin" ? " skill-chip--plugin" : "");
      wrap.setAttribute("data-skill-token", `${kind}:${name}`);
      // 保留 data-skill / data-plugin 属性，兼容旧的 DOM 序列化路径。
      wrap.dataset[kind] = name;
      const glyph = document.createElement("span");
      glyph.className = "skill-chip__glyph";
      glyph.setAttribute("aria-hidden", "true");
      glyph.innerHTML = skillChipGlyphSvg(name);
      const label = document.createElement("span");
      label.className = "skill-chip__name";
      label.textContent = name;
      wrap.appendChild(glyph);
      wrap.appendChild(label);
      return { dom: wrap };
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize: (state: MarkdownWriter, node: ProseMirrorNode) => {
          state.write(
            skillTokenText(
              String(node.attrs.kind ?? "skill"),
              String(node.attrs.name ?? ""),
            ),
          );
        },
        parse: {
          setup: (markdownit: MarkdownItLike) => {
            installSkillMarkdownRule(markdownit);
          },
        },
      },
    };
  },
});
