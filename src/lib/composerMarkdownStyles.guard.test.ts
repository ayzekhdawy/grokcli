/**
 * 回归护栏：输入框的 Markdown 渲染必须与聊天消息（`.chat-md`）对齐。
 *
 * 修掉的两个既有缺陷：
 * 1. Tailwind preflight（`node_modules/tailwindcss/preflight.css` 的
 *    `ol, ul, menu { list-style: none }`）清掉了全站列表标记，之后无人恢复，
 *    聊天消息与输入框都没有项目符号，`.chat-md li::marker` 也成了死规则。
 * 2. 旧 contenteditable 时代的 `.composer__input b/strong/i/em/a { inherit
 *    !important }` 压制规则让粗体、斜体、删除线、链接在 Markdown 档里渲染成
 *    普通文本。ADR 0004 双实现并存后这条防御**只保留给内置档**（那块自研
 *    contenteditable 仍需防任意 HTML），选择器必须带 `:not(.ProseMirror)`。
 *
 * 这些是样式层不变量，组件测试断言不到；沿用仓库既有的 CSS guard 范式
 * （见 composerColumn.guard.test.ts）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = join(__dirname, "../styles");
const read = (name: string) => readFileSync(join(styles, name), "utf8");

const chatPart3 = read("chat.part3.css");
const modalsPart1 = read("modals.part1.css");
const composerPart6 = read("composer.part6.css");
const settingsPart6 = read("settings.part6.css");

/** 取出第一条匹配 `rules[0]` 的规则体，便于逐条断言声明。 */
function ruleBody(css: string, pattern: RegExp): string | undefined {
  return css.match(pattern)?.[1];
}

describe("composer markdown alignment", () => {
  it("只对内置档剥掉落进来的 rich HTML，Markdown 档不受影响", () => {
    // Arrange / Act —— 内置档仍是自研 contenteditable，落进来的任意 HTML 必须剥掉
    // 视觉样式（上游行为）；Markdown 档由 ProseMirror schema 约束，不需要这条防御，
    // 且它在那档有害：会把粗斜体/删除线/链接压成纯文本、把 chip 底色按掉。
    const rules =
      chatPart3.match(
        /\.composer__input[^{]*\{[^}]*font-weight:\s*inherit\s*!important[^}]*\}/g,
      ) ?? [];

    // Assert
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).toMatch(/:not\(\.ProseMirror\)/);
    }
    // font-style / text-decoration 也一并剥离，否则斜体与链接下划线仍会漏进来
    expect(chatPart3).toMatch(/font-style:\s*inherit\s*!important/);
    expect(chatPart3).toMatch(/text-decoration:\s*none\s*!important/);
  });

  it("restores list markers for chat, preview and composer from one rule set", () => {
    // Arrange / Act / Assert — 同一个 preflight 根因，三个作用域一次补齐
    expect(settingsPart6).toMatch(
      /\.chat-md ul,\s*\n\.md-body ul,\s*\n\.composer__input ul\s*\{\s*list-style:\s*disc/s,
    );
    expect(settingsPart6).toMatch(
      /\.chat-md ol,\s*\n\.md-body ol,\s*\n\.composer__input ol\s*\{\s*list-style:\s*decimal/s,
    );
    // 嵌套层级不能回落到浏览器默认（那会让子项和父项长得一样）
    expect(settingsPart6).toMatch(/ul ul[\s\S]{0,160}?list-style:\s*circle/);
    expect(settingsPart6).toMatch(/ol ol[\s\S]{0,160}?list-style:\s*lower-alpha/);
    expect(settingsPart6).toMatch(/ol ol ol[\s\S]{0,160}?list-style:\s*lower-roman/);
  });

  it("renders composer text emphasis the way chat does", () => {
    // Arrange / Act
    const strong = ruleBody(composerPart6, /\.composer__input strong\s*\{([\s\S]*?)\}/);
    const headings = ruleBody(
      composerPart6,
      /\.composer__input h1,\s*\n\.composer__input h2,\s*\n\.composer__input h3\s*\{([\s\S]*?)\}/,
    );

    // Assert — 聊天侧 strong/标题都是 600，不是浏览器默认的 bolder(700)
    expect(strong).toMatch(/font-weight:\s*600/);
    expect(headings).toMatch(/font-weight:\s*600/);
    // h2 与聊天侧一致（1.12em）
    expect(composerPart6).toMatch(
      /\.composer__input h2\s*\{\s*font-size:\s*1\.12em/s,
    );
  });

  it("renders composer links like .chat-md__link but keeps a text cursor", () => {
    // Arrange / Act
    const link = ruleBody(composerPart6, /\.composer__input a\s*\{([\s\S]*?)\}/);

    // Assert — 点击应定位光标，不该把鼠标变成手型或直接开浏览器
    expect(link).toMatch(/color:\s*var\(--accent\)/);
    expect(link).toMatch(/text-decoration:\s*none/);
    expect(link).toMatch(/cursor:\s*text/);
  });

  it("代码块有语言栏，且只显示语言（不带复制按钮）", () => {
    // Arrange / Act
    const lang = ruleBody(
      composerPart6,
      /\.composer__input pre\[data-language\]::before\s*\{([\s\S]*?)\}/,
    );

    // Assert —— 文案来自节点属性装饰器，不能写死；样式对齐聊天侧 .chat-code__lang
    expect(lang).toMatch(/content:\s*attr\(data-language\)/);
    expect(lang).toMatch(/text-transform:\s*lowercase/);
    expect(lang).toMatch(/color:\s*var\(--text-tertiary\)/);
    // 输入框不搬聊天侧的复制按钮
    expect(composerPart6).not.toMatch(/\.composer__input[^{]*__btn/);
  });

  it("renders composer code in the chat palette", () => {
    // Arrange / Act
    const pre = ruleBody(composerPart6, /\.composer__input pre\s*\{([\s\S]*?)\}/);
    const inline = ruleBody(composerPart6, /\.composer__input code\s*\{([\s\S]*?)\}/);
    const preCode = ruleBody(
      composerPart6,
      /\.composer__input pre code\s*\{([\s\S]*?)\}/,
    );

    // Assert — 代码块与聊天侧同一套底色/描边/圆角；行内代码底色必须是共享 token
    // （聊天侧曾用半透明浮层、输入框用近黑实心，两边观感不同）
    expect(pre).toMatch(/background:\s*var\(--bg-code\)/);
    expect(pre).toMatch(/border:\s*1px solid var\(--border-subtle\)/);
    expect(pre).toMatch(/border-radius:\s*10px/);
    expect(inline).toMatch(/background:\s*var\(--md-inline-code-bg/);
    expect(inline).toMatch(/border-radius:\s*6px/);
    // 代码块内的 code 不能叠上行内代码的底色/描边/圆角
    expect(preCode).toMatch(/background:\s*transparent/);
    expect(preCode).toMatch(/border:\s*0/);
    expect(preCode).toMatch(/border-radius:\s*0/);
    // 未定义的 token 不能再回到输入框的 Markdown 规则里
    expect(composerPart6).not.toMatch(/--bg-tertiary/);
  });

  it("keeps one shared inline-code background token for both surfaces", () => {
    // Arrange / Act — 聊天侧与输入框必须引用同一个定义，否则会各写一份字面量而漂移
    const lobeChat1 = readFileSync(
      join(__dirname, "../components/lobe-chat/lobe-chat.part1.css"),
      "utf8",
    );

    // Assert
    expect(lobeChat1).toMatch(/--chat-inline-code-bg:\s*var\(--md-inline-code-bg/);
    expect(composerPart6).toMatch(/var\(--md-inline-code-bg/);
  });

  it("内置档的 placeholder 仍是浮层，不会被正文顶掉", () => {
    // Arrange / Act —— 曾经的事故：给 TipTap 加 wrapper 规则时整块替换掉了上游的
    // `.composer-editor__placeholder`，placeholder 失去绝对定位，变成占一行的正文。
    const ph = ruleBody(modalsPart1, /\.composer-editor__placeholder\s*\{([\s\S]*?)\}/);

    // Assert
    expect(ph).toMatch(/position:\s*absolute/);
    expect(ph).toMatch(/pointer-events:\s*none/);
    expect(modalsPart1).toMatch(
      /\.composer-editor-wrap\s*>\s*\.composer__input\s*\{[\s\S]*?position:\s*relative/,
    );
  });

  it("引用 chip 两处共用一份外观：蓝底蓝字 + 圆角矩形", () => {
    // Arrange / Act —— 聊天消息与输入框共用 `.file-path-card`；输入框只允许补交互
    // 差异，不能再写一套自己的底色/字色（否则两处会各自漂移）。
    const chip = ruleBody(chatPart3, /\.file-path-card\s*\{([\s\S]*?)\}/);
    const editorBase = ruleBody(
      composerPart6,
      /\.composer__input \.file-path-card--editor\s*\{([\s\S]*?)\}/,
    );

    // Assert —— 底色/描边与字色是同一支蓝（字色即加底色前的那支蓝）
    expect(chip).toMatch(/border-radius:\s*6px/);
    expect(chip).toMatch(/background:\s*color-mix\(in srgb, var\(--chat-link/);
    expect(chip).toMatch(
      /border:\s*1px solid color-mix\(in srgb, var\(--chat-link/,
    );
    expect(chip).toMatch(/color:\s*var\(--chat-link, var\(--accent\)\)/);
    expect(editorBase).not.toMatch(/background:|color:|border-radius:/);
    // 点它=定位光标，悬停不该退回链接语义（下划线）；底色加深用同一蓝
    expect(composerPart6).toMatch(
      /\.file-path-card--editor:hover\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--chat-link/,
    );
    expect(composerPart6).toMatch(
      /\.file-path-card--editor \.file-path-card__main:hover[\s\S]{0,160}?text-decoration:\s*none/,
    );
  });

  it("keeps the composer divider visible on purpose", () => {
    // Arrange / Act
    const hr = ruleBody(composerPart6, /\.composer__input hr\s*\{([\s\S]*?)\}/);

    // Assert — 聊天侧故意 display:none，输入框必须让用户看见自己敲的 `---`；
    // 这是本 Issue 唯一一处有意的不对齐，别当 bug 改掉。
    expect(hr).toMatch(/border-top:\s*1px solid var\(--border-strong\)/);
    expect(hr).not.toMatch(/display:\s*none/);
  });
});
