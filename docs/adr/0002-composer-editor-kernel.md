# ADR 0002 — 输入框编辑内核采用 ProseMirror（TipTap），不自研 contenteditable

- 状态：已采纳
- 日期：2026-09-23

> **适用范围（ADR 0004）**：本决策只适用于 **Markdown 档** 的输入框编辑器。上游的
> 自研 contenteditable 仍是默认档并保持原样；两档由设置项「输入框编辑器」切换。

## 背景

输入框需要渲染文件/目录引用 chip、URL chip、Agent Skills chip，以及有序/无序
列表、分割线、代码块、行内代码、粗体斜体、标题，并且引用必须**内联在正文中**
而不是落在扩展面板里。

历史上输入框是自研 contenteditable（旧 `ComposerEditor.tsx`，约 1800 行），
它后来被换成了 TipTap + markdown-it，并交付了
`[[skill:name]]` 原子节点与 Markdown 往返序列化（`src/components/composerSkillNode.ts`、
`src/lib/composerMarkdown.ts`）。本次重新评估「是否回退到自研内核再扩展」。

## 决策

保留 TipTap/ProseMirror，不回退。

## 权衡

- **旧内核没有富文本能力**：它是「纯文本 + `<br>` + 非可编辑 chip」模型
  （`docs/plans/2026-08-10-composer-newline-skill-chip-diagnosis.md:24` 记录了
  其 DOM 结构为 `text nodes + <br> + [data-skill] chips`）。列表、分割线、
  代码块、行内代码、粗斜体、标题全部为空。回退不是「延续既有能力再扩展」，
  而是从零造这些结构及其光标/退格/IME 交互。
- **回退不减少依赖**：`@tiptap/*` 与 `tiptap-markdown` 在本次迁移**之前**就是
  直接依赖（`src/components/MarkdownTiptapEditor.tsx` 等在用），
  `src/lib/viteManualChunks.ts:27` 已单列 `tiptap` vendor chunk。回退编辑内核
  不会移除该 chunk，只在 composer 组件层面少了代码。
- **迁移资产会作废**：`composerMarkdown.ts` 与 `composerSkillNode.ts` 都直接
  import `@tiptap/pm/model` 与 tiptap-markdown 的序列化钩子，与 ProseMirror
  position 强耦合，换内核后不可原样保留。
- 选中方案的代价：多一个较大的第三方内核（产物中单独的 `tiptap` chunk），
  以及对 ProseMirror schema/position 的依赖。这是为「列表/分割线/原子节点/
  Markdown 往返」这些能力付的价，自研要重付一遍且要自己维护 IME 与光标逻辑。

## 影响

- composer 的扩展注册集中在 `src/components/ComposerEditor.tsx` 的
  `useEditor` 配置；新增内联引用节点走 `composerSkillNode.ts` 的 Node +
  `addStorage().markdown` 范式。
- 新增原子节点时必须同步泛化 `src/lib/composerMarkdown.ts` 的 `collectSegments`
  （当前只识别 `skillToken` 一种 atom），否则 slash 检测与光标定位会漂移。
- 发送给 CLI 的始终是 Markdown 源码；存储态与发送态可以不同（引用以专用
  token 存储、发送时转 `@绝对路径`）。
