# ADR 0004 — composer 编辑器双实现并存：内置（上游）为默认，Markdown（TipTap）为可选

- 状态：已采纳
- 日期：2026-09-28
- 关联：ADR 0002（编辑器内核）、ADR 0003（文档位置编辑）

## 背景

ADR 0002 决定 composer 采用 ProseMirror/TipTap，并据此交付了行内引用、列表、代码块语言栏与
Markdown 所见即所得（ADR 0003）。**这套迁移只存在于本 fork**：上游
`RongleCat/grok-app` 的 composer 至今是自研 contenteditable —— 纯文本 + `<br>` + 不可编辑的
skill / plugin chip，没有列表、代码块与行内文件引用；上游近期对它的改动只有一条 Windows IME
兜底（`7677ae4f`，12 行，围绕 ZWSP 填充与 `flushAfterIme`）。

同期模型路由 PR（#1259）给出的教训是：**上游只接受不改变用户既有行为的改动**。而编辑器迁移恰恰是
全局替换 —— 直接提给上游等于把每个用户的输入体验换掉，评审成本与风险都高，也没有让作者对照两套
实现的机会。

因此本仓库改为：**两套编辑器并存，内置（上游）为默认，Markdown（TipTap）作为可选实现**。

## 决策

1. **上游 composer 保持原样**：`src/components/ComposerEditor.tsx` 逐字节不动（可 `git diff` 验证），
   供上游作者对照，也保证默认行为零变化。
2. **Markdown 实现独立**：组件、扩展、原子节点、事务插入、检测与几何模块全部落在
   `src/components/composer/tiptap/`，并落到 `src/components/composer/index.tsx` 分发器后面。
3. **唯一入口**：`src/components/composer/index.tsx` 是分发器 —— 消费方（薄岛、send / dictation 钩子、
   workbench）只依赖它。按 DOM 归属路由（元素由 Markdown 档编辑器托管就走新实现，否则走内置），
   模块级的光标请求按当前档位路由。
4. **开关**：`AppSettings.composerEditor`（`legacy` 默认 / `tiptap`），设置 → 界面，「输入框编辑器」，
   15 个 locale 同步；**不做迁移**，缺省即内置。
5. **段落模型分层**：`DraftSegment` 保持上游形态（text / skill / plugin / chat）；引用段是新增的
   `RefSegment`，只经 `*WithRefs` 系列 API 出现。基版本 API 把引用段降级为纯文本，因此内置编辑器
   永远不会收到它不认识的段。
6. **跨档降级**：切到内置档时，草稿里的引用 token 转成附件条目（`[[file:…]]` → 附件条），**单向有损**；
   URL 引用留在正文（它本来就是链接本身）。降级发生在 `ComposerDraftEditor` 的渲染前与落盘处。
7. **引用只从 journal 的显示态读回，不猜**：发送时 `session_send` 收 `display_text`
   （本应用写的 journal 因此落盘的就是 `[[file:…]]` 形态），读回来直接就是 token。
   不从正文里的 `@绝对路径` 反推引用 —— 那会把「用户真写了 `@/usr/bin/foo`」的普通
   叙述在**所有**会话里变成 chip，与用哪套编辑器无关。

8. **检测按档位分派**：`useComposerController` 保留上游的 DOM 轮询，但 Markdown 档托管输入框时整体
   让位 —— `@` / slash 改由编辑器按**文档位置**上报（`reportAtQuery` / `reportSlashQuery`），
   去重与 Escape 抑制规则与轮询版一致。

## 权衡

- **收益**：默认行为与上游逐项一致（评审与回归成本最低）；上游作者可直接 diff 对照两套实现；
  出问题时用户可一键回退；将来若上游采纳迁移，移除开关即可。
- **代价**：两套实现长期并存 —— composer 侧任何新功能要么只对 Markdown 档生效，要么写两遍；
  段落模型需要分层（基版本降级 + `*WithRefs` 超集）；必须维护分发与按档位的门控。
- **已知缺口（接受，不处理）**：上游那条 Windows IME 兜底针对的是自研 contenteditable 的 ZWSP
  填充与 `flushAfterIme`，Markdown 档不走这套机制（IME 交给 ProseMirror 原生处理，组合期不下发
  键盘路由），因此不是「少修了一个 bug」，而是**等价行为未在 Windows / WebView2 上验证过**。
  开发机为 macOS、无 Windows 环境，本仓库不再为验证这件事投入，此处记为**已知缺口并接受**；
  若使用者反馈 Windows 组合期异常，再按复现单独处理。

## 影响

- **新增**：`src/components/composer/`（分发器 + `editorPref.ts` + `demoteRefs.ts` + `tiptap/`）、
  `src/lib/composerAtApply.ts`（`@` 落刀的两条档位分支）、设置项与 15 个 locale 文案、本 ADR。
- **对上游文件的改动**（数字取自 `git diff upstream/main...HEAD --numstat`；均为接线，
  `ComposerEditor.tsx` 零改动）：
  - 挂载薄岛 `src/components/ComposerDraftEditor.tsx`（+27/−3）：改从分发器取组件，加渲染前的引用降级。
  - 透传：`src/app/WorkbenchComposerShell.tsx`（+17/−1，`onAtQueryChange` 与 memo 过的
    `onDemoteRefs`）、`src/app/WorkbenchComposerColumn.tsx`（+2）。
  - import 改指分发器：`src/hooks/useComposerSend.ts`、`src/hooks/useVoiceDictation.ts`（各 +1/−1）。
  - 聊天侧渲染行内引用（气泡 chip 与「重新编辑」回填）：`src/components/lobe-chat/MarkdownChat.tsx`、
    `ThreadUserBody.tsx`、`InlineUserEdit.tsx`，配套把气泡文案表下沉到 `src/lib/filePathCardPref.ts`
    供两处共用 —— 这段**属于本 Feature 的一部分**（引用在气泡里要渲染成 chip，否则输入框里是
    chip、发出去变字面量），不是顺带重构。
  - 按档位分支：`src/hooks/useComposerController.ts`（+169：DOM 轮询让位、两个上报函数、编辑器上报入口）、
    `src/app/AppWorkbench.tsx`（+18/−44，**净 −26**：`@` 落刀与 slash 分流都不在这里了）。
  - 设置项接线：`src/hooks/useAppSettingsPrefs.ts`（+18/−1）、`src/app/WorkbenchSettingsStage.tsx`
    （+11/−2）、`src/app/workbenchSettingsStageProps.ts`（+3）、`src/components/SettingsPage.tsx`（+4）、
    `src/components/settings/AppearanceSection.tsx`（+33）、`src/components/settings/types.ts`（+5）、
    `settingsCatalog` / i18n × 15。
- **文档**：`docs/ACCEPTANCE-slash-composer.md` 的 C 段按档位分栏；ADR 0002 与 ADR 0003 的适用范围
  限定为 Markdown 档（本 ADR 是它们的前提说明）。
