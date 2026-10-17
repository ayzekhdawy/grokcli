/**
 * @vitest-environment jsdom
 *
 * 回归：文件引用 chip 之后 Shift+Enter 换行，再敲块标记必须照常生效
 * （`1. ` / `- ` 起列表，```` ` 起代码块，`> ` / `# ` / `---` 同理）。
 *
 * ProseMirror 的列表输入规则是**锚在段落开头**的（`^\s*([-+*])\s$`），而
 * Shift+Enter 只是一个硬换行（`hardBreak` 叶子节点，在规则眼里是 `￼`），
 * 光标仍在同一段里，于是「换行后敲标记」永远匹配不上、列表起不来。
 *
 * 本应用 Enter 被绑成发送，所以除了 Shift+Enter 没有别的换行手势——列表在句中
 * 就彻底起不了（先插文件引用再写清单是常见路径）。这里把 `￼` 之后的标记
 * 也认成列表起点：删掉硬换行与标记、在那里裂块、再把新块包进列表。
 */
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { buildComposerExtensions } from "@/components/composer/tiptap/composerExtensions";

let editor: Editor | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
  host?.remove();
  host = null;
});

function makeEditor(): Editor {
  host = document.createElement("div");
  document.body.appendChild(host);
  return new Editor({
    element: host,
    extensions: buildComposerExtensions({ showPlaceholderWhenEditable: false }),
    content: "",
    editable: true,
  });
}

/** 逐字模拟真实键盘输入（输入规则挂在 `handleTextInput` 上）。 */
function typeText(view: EditorView, text: string): void {
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (f) =>
      f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}

/** 文档顶层块类型序列，便于断言结构。 */
function blockTypes(ed: Editor): string[] {
  const names: string[] = [];
  ed.state.doc.forEach((node) => names.push(node.type.name));
  return names;
}

/** tiptap-markdown 运行时挂在 storage 上的序列化结果。 */
function markdownOf(ed: Editor): string {
  const raw = (ed.storage as { markdown?: { getMarkdown?: () => unknown } })
    .markdown?.getMarkdown?.();
  return typeof raw === "string" ? raw : "";
}

/** 首个文本块末尾（`看 [[file:…]]` + 硬换行之后）。 */
function endOfFirstBlock(ed: Editor): number {
  return 1 + (ed.state.doc.firstChild?.content.size ?? 0);
}

describe("引用 chip 之后 Shift+Enter，块标记照常生效", () => {
  it("`1. ` 起有序列表，数字带进 start", () => {
    // Arrange —— 句中：正文 + 引用 chip + 硬换行，光标在换行之后
    editor = makeEditor();
    editor.commands.insertContent([
      { type: "text", text: "看 " },
      { type: "refToken", attrs: { kind: "file", value: "src/app/main.ts" } },
      { type: "hardBreak" },
    ]);
    editor.commands.setTextSelection(endOfFirstBlock(editor));

    // Act
    typeText(editor.view, "1. ");

    // Assert —— 引用 chip 留在原段落；列表是独立块（末尾那个空段落与在空文档里
    // 敲 `1. ` 时 StarterKit 规则留下的形状一致，序列化不会输出它）
    expect(blockTypes(editor)).toEqual([
      "paragraph",
      "orderedList",
      "paragraph",
    ]);
    const list = editor.state.doc.child(1);
    expect(list.attrs.start).toBe(1);
    // 光标在列表项里：接着敲的字进这一项，而不是掉到列表外
    typeText(editor.view, "第一项");
    const markdown = markdownOf(editor);
    expect(markdown).toContain("1. 第一项");
    expect(markdown).toContain("看 [[file:src/app/main.ts]]");
  });

  it("`- ` 起无序列表", () => {
    editor = makeEditor();
    editor.commands.insertContent([
      { type: "text", text: "看 " },
      { type: "refToken", attrs: { kind: "file", value: "src/app/main.ts" } },
      { type: "hardBreak" },
    ]);
    editor.commands.setTextSelection(endOfFirstBlock(editor));

    typeText(editor.view, "- ");

    expect(blockTypes(editor)).toEqual(["paragraph", "bulletList", "paragraph"]);
    typeText(editor.view, "第一项");
    expect(markdownOf(editor)).toContain("- 第一项");
  });

  it("普通文本行内（无换行）敲标记不起列表，只当正文", () => {
    // Arrange —— 句中的 `1. ` 不是列表起点，别把正文吃成列表
    editor = makeEditor();
    editor.commands.insertContent([
      { type: "text", text: "看 " },
      { type: "refToken", attrs: { kind: "file", value: "src/app/main.ts" } },
      { type: "text", text: " 这里" },
    ]);
    editor.commands.setTextSelection(endOfFirstBlock(editor));

    // Act
    typeText(editor.view, "1. ");

    // Assert
    expect(blockTypes(editor)).toEqual(["paragraph"]);
  });

  it("`2. ` 带出 start 2", () => {
    editor = makeEditor();
    editor.commands.insertContent([
      { type: "text", text: "看 " },
      { type: "refToken", attrs: { kind: "file", value: "src/app/main.ts" } },
      { type: "hardBreak" },
    ]);
    editor.commands.setTextSelection(endOfFirstBlock(editor));

    typeText(editor.view, "2. ");

    expect(editor.state.doc.child(1).attrs.start).toBe(2);
  });

  it("换行后先写了字，行中的标记不起列表", () => {
    // Arrange —— 列表标记必须**开**这一行：`说明1. ` 是正文
    editor = makeEditor();
    editor.commands.insertContent([
      { type: "text", text: "看 " },
      { type: "hardBreak" },
    ]);
    editor.commands.setTextSelection(endOfFirstBlock(editor));
    typeText(editor.view, "说明");

    // Act
    typeText(editor.view, "1. ");

    // Assert
    expect(blockTypes(editor)).toEqual(["paragraph"]);
    expect(editor.state.doc.textContent).toBe("看 说明1. ");
  });

  it("连按两次 Shift+Enter 后起列表，只剩最后一个空行被吃掉", () => {
    editor = makeEditor();
    editor.commands.insertContent([
      { type: "text", text: "看 " },
      { type: "hardBreak" },
      { type: "hardBreak" },
    ]);
    editor.commands.setTextSelection(endOfFirstBlock(editor));

    typeText(editor.view, "- ");

    expect(blockTypes(editor)).toEqual(["paragraph", "bulletList", "paragraph"]);
  });

  it("换行后接普通文字仍然只是换行（不误伤）", () => {
    editor = makeEditor();
    editor.commands.insertContent([
      { type: "text", text: "看 " },
      { type: "hardBreak" },
    ]);
    editor.commands.setTextSelection(endOfFirstBlock(editor));

    typeText(editor.view, "普通文本");

    expect(blockTypes(editor)).toEqual(["paragraph"]);
    expect(editor.state.doc.textContent).toBe("看 普通文本");
  });
});

describe("换行后的其它块标记", () => {
  /** 铺「正文 + 引用 chip + 硬换行」，光标落在换行之后。 */
  function seedAfterBreak(): Editor {
    const ed = makeEditor();
    ed.commands.insertContent([
      { type: "text", text: "看 " },
      { type: "refToken", attrs: { kind: "file", value: "src/app/main.ts" } },
      { type: "hardBreak" },
    ]);
    ed.commands.setTextSelection(endOfFirstBlock(ed));
    return ed;
  }

  it("```` `` 起代码块（不带语言）", () => {
    editor = seedAfterBreak();
    typeText(editor.view, "``` ");
    expect(blockTypes(editor)).toContain("codeBlock");
    expect(markdownOf(editor)).toContain("```");
  });

  it("````ts `` 把语言带进代码块", () => {
    editor = seedAfterBreak();
    typeText(editor.view, "```ts ");
    const code = editor.state.doc.child(1);
    expect(code.type.name).toBe("codeBlock");
    expect(code.attrs.language).toBe("ts");
    expect(markdownOf(editor)).toContain("```ts");
  });

  it("`~~~ ` 同样起代码块", () => {
    editor = seedAfterBreak();
    typeText(editor.view, "~~~ ");
    expect(editor.state.doc.child(1).type.name).toBe("codeBlock");
  });

  it("`> ` 起引用块", () => {
    editor = seedAfterBreak();
    typeText(editor.view, "> ");
    expect(blockTypes(editor)).toContain("blockquote");
  });

  it("`## ` 起二级标题", () => {
    editor = seedAfterBreak();
    typeText(editor.view, "## ");
    const heading = editor.state.doc.child(1);
    expect(heading.type.name).toBe("heading");
    expect(heading.attrs.level).toBe(2);
  });

  it("`---` 起分割线，光标落在分割线之后的段落里", () => {
    editor = seedAfterBreak();
    typeText(editor.view, "---");
    expect(blockTypes(editor)).toEqual([
      "paragraph",
      "horizontalRule",
      "paragraph",
    ]);
    // 光标必须是真的文本选区、且在分割线**之后**：落在分割线上时下一次按键会把它
    // 替换掉，等于白敲
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    typeText(editor.view, "继续");
    const after = editor.state.doc.child(2);
    expect(after.textContent).toBe("继续");
  });

  it("换行后先写了字，行中的代码围栏不起代码块", () => {
    editor = seedAfterBreak();
    typeText(editor.view, "说明");
    typeText(editor.view, "``` ");
    expect(blockTypes(editor)).toEqual(["paragraph"]);
    expect(editor.state.doc.textContent).toBe("看 说明``` ");
  });
});
