/**
 * `[[file:…]]` / `[[dir:…]]` 内联引用 token 的 ProseMirror 原子节点。
 *
 * 存储态是 {@link refTokenText} 产出的纯文本 token（与 `[[skill:…]]` 同族），
 * 编辑器内由 markdown-it inline 规则反解析为原子节点，序列化时原样写回；
 * 发送给 CLI 时才在 `serializeForAgent` 转成 `@路径`。
 *
 * 视觉复用聊天侧既有的文件引用样式（`.file-path-card`），保证同一条引用在
 * 输入中与发送后长得一样。
 */

import { InputRule, Node, mergeAttributes } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { openExternalHttpUrl } from "@/lib/externalLinkPref";
import {
  isExternalHttpUrl,
  matchRefTokenAt,
  matchTypedUrl,
  refDisplayLabel,
  refTokenText,
  type RefKind,
} from "@/lib/composerRefToken";

/**
 * chip 图标的 path 数据。
 *
 * ProseMirror NodeView 只能用 DOM 构造，取不到 `@tabler/icons-react` 的
 * 组件字符串形式（`react-dom/server` 只用于测试，不进渲染包）。这里沿用
 * `SkillChip` 的既有做法内联 path，几何与 `FilePathCard` 用的 Tabler 图标
 * 一致——改图标时要同时改这两处。
 */
const ICON_PATHS: Record<RefKind, string[]> = {
  file: [
    "M14 3v4a1 1 0 0 0 1 1h4",
    "M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z",
    "M9 9l1 0",
    "M9 13l6 0",
    "M9 17l6 0",
  ],
  dir: ["M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2"],
  url: ["M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6", "M11 13l9 -9", "M15 4h5v5"],
};

/** prosemirror-markdown 序列化 state 的最小结构接口。 */
type MarkdownWriter = {
  write: (text: string) => void;
};

/** markdown-it inline state 的最小结构接口。 */
type MarkdownItInlineState = {
  src: string;
  pos: number;
  push: (type: string, tag: string, nesting: number) => {
    markup?: string;
    attrSet: (name: string, value: string) => unknown;
  };
};

/** markdown-it 实例的最小结构接口。 */
type MarkdownItLike = {
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

/** 节点名，供 `editorTokenLength` 与 DOM 序列化识别。 */
export const REF_TOKEN_NODE = "refToken";

/** 在 markdown-it 中注册 `[[file:…]]` inline 规则与 HTML 渲染。 */
export function installRefMarkdownRule(md: MarkdownItLike): void {
  md.inline.ruler.before("escape", "grok_ref_token", (state, silent) => {
    const hit = matchRefTokenAt(state.src, state.pos);
    if (!hit) return false;
    if (silent) return true;
    const token = state.push("grok_ref_token", "span", 0);
    token.markup = state.src.slice(state.pos, state.pos + hit.length);
    token.attrSet("kind", hit.kind);
    token.attrSet("value", hit.value);
    state.pos += hit.length;
    return true;
  });
  md.renderer.rules.grok_ref_token = (tokens, idx) => {
    const t = tokens[idx] as TokenLike;
    const kind = t.attrGet("kind") ?? "file";
    const value = t.attrGet("value") ?? "";
    // 属性值需要转义，否则路径里的引号会把 HTML 写坏。
    const safe = value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<span data-ref-token="${kind}" data-ref-value="${safe}"></span>`;
  };
}

/**
 * 该节点在编辑器文本空间 / 存储空间里的 token 文本；不是引用 token 时返回
 * `null`。两个空间逐字符等价。
 */
export function refTokenStoredText(node: ProseMirrorNode): string | null {
  if (node.type.name !== REF_TOKEN_NODE) return null;
  const kind = String(node.attrs.kind ?? "file") as RefKind;
  return refTokenText(kind, String(node.attrs.value ?? ""));
}

function refIconSvg(kind: RefKind): string {
  const paths = ICON_PATHS[kind].map((d) => `<path d="${d}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

/**
 * URL chip 的打开方式：编辑态下**普通点击只定位光标**——点进去改字
 * 是这个区域最常见的手势，直接跳浏览器会很烦人。用 ⌘/Ctrl + 点击显式打开。
 *
 * 只有 http(s) 会被打开：`isExternalHttpUrl` 拒绝 `javascript:` / `data:` 等，
 * 非 http(s) 的 chip 干脆不挂这个监听。
 */
function addUrlOpenAffordance(dom: HTMLElement, url: string): void {
  if (!isExternalHttpUrl(url)) return;
  dom.addEventListener("click", (event) => {
    if (!event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    openExternalHttpUrl(url);
  });
}

export const RefTokenNode = Node.create({
  name: REF_TOKEN_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      kind: {
        default: "file",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-ref-token") ?? "file",
      },
      value: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-ref-value") ?? "",
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-ref-token]" }];
  },

  /**
   * 敲下一个空白时，把光标前刚写完的 http(s) 链接就地变成 URL chip。
   * 用 `matchTypedUrl` 的同一套边界规则，保证「输入」与「粘贴」判定一致。
   */
  addInputRules() {
    return [
      new InputRule({
        find: /(?:^|\s)(\S+)\s$/,
        handler: ({ state, range, match }) => {
          const hit = matchTypedUrl(match[0] ?? "");
          if (!hit) return null;
          const start = range.from + hit.start;
          const urlEnd = start + hit.url.length;
          // The triggering space is not in the document yet; handleTextInput
          // swallows it when this rule matches. Put that space back after the chip.
          const tr = state.tr.replaceWith(
            start,
            urlEnd,
            this.type.create({ kind: "url", value: hit.url }),
          );
          tr.insertText(" ", tr.mapping.map(range.to));
          return;
        },
      }),
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-ref-token": String(node.attrs.kind ?? "file"),
        "data-ref-value": String(node.attrs.value ?? ""),
      }),
    ];
  },

  // 原子 chip：DOM NodeView 复用聊天里的文件引用视觉（图标 + 文件名）。
  addNodeView() {
    return ({ node }) => {
      const kind = String(node.attrs.kind ?? "file") as RefKind;
      const value = String(node.attrs.value ?? "");
      const wrap = document.createElement("span");
      wrap.className =
        "file-path-card file-path-card--editor" +
        (kind === "dir" ? " file-path-card--dir" : "") +
        (kind === "url" ? " file-path-card--url" : "");
      wrap.setAttribute("data-ref-token", kind);
      wrap.setAttribute("data-ref-value", value);
      // 悬停给出完整路径：chip 上只显示短标签。
      wrap.title = value;

      const main = document.createElement("span");
      main.className = "file-path-card__main";
      const icon = document.createElement("span");
      icon.className = "file-path-card__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = refIconSvg(kind);
      const meta = document.createElement("span");
      meta.className = "file-path-card__meta";
      const name = document.createElement("span");
      name.className = "file-path-card__name";
      name.textContent = refDisplayLabel(kind, value);
      meta.appendChild(name);
      main.appendChild(icon);
      main.appendChild(meta);
      wrap.appendChild(main);
      if (kind === "url") {
        addUrlOpenAffordance(wrap, value);
      }
      return { dom: wrap };
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize: (state: MarkdownWriter, node: ProseMirrorNode) => {
          const kind = String(node.attrs.kind ?? "file") as RefKind;
          state.write(refTokenText(kind, String(node.attrs.value ?? "")));
        },
        parse: {
          setup: (markdownit: MarkdownItLike) => {
            installRefMarkdownRule(markdownit);
          },
        },
      },
    };
  },
});
