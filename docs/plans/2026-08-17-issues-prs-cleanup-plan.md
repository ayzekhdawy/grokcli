# Issues / PRs 清理与持续合并方案

> **日期：** 2026-08-17  
> **基线：** `origin/main` = **v0.2.20** (`4be09f1a`)  
> **本地：** `main` 落后 origin **25** 个提交，工作区干净。执行前先 `git pull --ff-only`。  
> **对齐：** [maintain.md](../llm-wiki/maintain.md) · [release.md](../llm-wiki/release.md) · [dialogs.md](../llm-wiki/dialogs.md)

---

## 0. 一句话结论

| 维度 | 现状 | 动作 |
|------|------|------|
| **库存** | 19 个 OPEN Issue + 13 个 OPEN PR（GitHub 合计 32） | 按下面 5 个桶分流，不要一把合 |
| **贡献者资料 Issue** | #637 #638 #639 #640 #642 #643 #649 | **本方案不管**（官网征集，不进工程队列） |
| **已有对应 PR 的 Issue** | 9 个真实问题已被社区 PR 覆盖 | 优先审 PR，用 `Fixes #N` 关 Issue |
| **可审后快合** | #645 #668 #663 #657，以及审过 Host 的 #660 #658 #656 #669 | 先批准 fork CI，再按波次 squash |
| **必须你拍板** | #655 #661 #664 #648 #652，以及无 PR 的 #666 #651 #650 | 见 §4，不拍板不进 main |
| **禁止** | 把 13 个 PR 串行硬合 | `AppWorkbench.tsx` 被 7 个 PR 同时改；`CHANGELOG.md` 被 8 个 PR 同时改 |

**执行原则：** 小而准的社区修复优先合；大功能 / 三合一 / Draft 先拆或等拍板；没有 PR 的 bug 我们自己修；直到可执行队列清空。

---

## 1. 当前库存（2026-08-17 拉单）

### 1.1 全部 OPEN Issue（19）

| # | 标题 | 作者 | 对应 PR | 桶 |
|---|------|------|---------|----|
| **670** | 长回合出现「工作中」叠「工作了」，Send 卡住 | oykb58246 | **#669** | A 审后合（Host） |
| **667** | 展开「工作中」叠字 + 漏 ANSI | oykb58246 | **#668** | A 审后合 |
| **666** | iOS 伴侣 / 远程控制桌面 | evan188199-tech | 无 | D 拍板（建议关 / 指 Remote IM） |
| **662** | 输入框上方始终显示工作区芯片 | ynjmxn | **#663** | A 审后合 |
| **659** | 额度用尽显示成网络错误 | ynjmxn | **#660** | A 审后合（Host） |
| **654** | 点桌面通知不回前台 / 不打开会话 | ynjmxn | **#658** | A 审后合（平台） |
| **653** | Skills 页仍列出 Claude/Cursor | ynjmxn | **#656** | A 审后合（共享模式注意） |
| **651** | 75Hz 外接屏聊天滑动掉帧 | NoahDeng-byte | 无 | C 我们修 / 或降级 P2 |
| **650** | Windows 任务栏图标小一号 | enlivatech | 无（#665 已当重复关掉） | C 我们修（小） |
| **649** | 贡献者信息：zYHao | Sixmin | — | **忽略** |
| **647** | Windows 超长回复/粘贴改 txt 卡片 | sutongwuyanzu | **#648** | B 拍板 |
| **644** | `/rc` `/review-` 选不中 review-commit | apple-ouyang | **#645** | A 审后合 |
| **643** | 做大做强，再创辉煌！ | sutongwuyanzu | — | **忽略** |
| **642** | 贡献者信息：falser101 | falser101 | — | **忽略** |
| **640** | 官网贡献者资料 | 1parado | — | **忽略** |
| **639** | 柱哥我来了 | yuhaouno | — | **忽略** |
| **638** | Dmao233 | Dmao233 | — | **忽略** |
| **637** | 贡献者信息：Yy-702 | Yy-702 | — | **忽略** |
| **636** | 侧栏浏览器 Design Mode | Yy-702 | **#655**（夹带 Kanban+Spaces） | B 拍板：只收 Design Mode / 全收 / 拆 |

### 1.2 全部 OPEN PR（13，全部来自 fork）

| PR | 作者 | 主题 | +/− | 关 Issue | CI | mergeable |
|----|------|------|-----|----------|----|-----------|
| **669** | oykb58246 | 过早「工作了」+ copy/retry | 224/15 | **#670** | 等批准 | MERGEABLE |
| **668** | oykb58246 | Working 叠字 + ANSI | 78/7 | **#667** | 等批准 | MERGEABLE |
| **664** | MaxxxDong | 草稿残留 + Shift+Enter + 引用注释（三合一） | 1868/111 | 无（#620 已在 0.2.20 关） | 等批准 | MERGEABLE |
| **663** | ynjmxn | 桌面始终显示工作区芯片 | 72/31 | **#662** | 等批准 | MERGEABLE |
| **661** | Yy-702 | 文件 tab 名 + 按项目隔离 + **CodeMirror 编辑器** | 1890/205 | 无 | **绿** | CLEAN |
| **660** | ynjmxn | 额度用尽诚实文案 | 357/50 | **#659** | 等批准 | MERGEABLE |
| **658** | ynjmxn | 通知点击回会话 | 377/23 | **#654** | 等批准 | MERGEABLE |
| **657** | Yy-702 | 搜索面板滚轮 + 键盘选择 | 604/8 | 无 | **绿** | CLEAN |
| **656** | ynjmxn | 关掉 Claude/Cursor skills 发现 | 761/2 | **#653** | 等批准 | MERGEABLE |
| **655** | Yy-702 | Design Mode + **Kanban** + **Spaces** | 5670/40 | 只覆盖 #636 的一部分 | **绿** | CLEAN |
| **652** | dundunge | session 中断恢复硬化 | 2052/804 | 无 | 等批准 + **Draft** | MERGEABLE |
| **648** | sutongwuyanzu | Windows 超长回复/粘贴 → txt 卡 | 452/1 | **#647** | 等批准 | MERGEABLE |
| **645** | apple-ouyang | slash `/rc` `/review-` | 179/22 | **#644** | 等批准 | MERGEABLE |

**CI 事实：** 除 Yy-702 的 #655 / #657 / #661 已跑绿外，其余 fork PR 的 `ci` 都是 `action_required`（首次贡献者工作流待仓库管理员批准）。**没批 CI 就不能按 maintain.md 合。**

### 1.3 热文件（禁止并行硬合）

| 文件 | 同时改它的 PR |
|------|----------------|
| `CHANGELOG.md` | 8：664 663 661 660 658 656 655 645 |
| `src/app/AppWorkbench.tsx` | 7：664 663 661 658 657 655 652 |
| `src-tauri/src/session_manager/events.rs` | 3：669 660 652 |
| `src/components/lobe-chat/ConversationThread.tsx` | 3：669 664 648 |
| `src/lib/session.ts` | 3：669 668 660 |

合入顺序必须 **一次一个**，合完让后续 PR rebase。不要开 integrate 大杂烩分支（2026-07-27 那次已经证明会炸）。

---

## 2. PR ↔ Issue 对照

```text
#670  ←  #669   长回合双轨 / Send 卡死
#667  ←  #668   Working 叠字 + ANSI
#662  ←  #663   工作区芯片
#659  ←  #660   额度用尽误报网络
#654  ←  #658   通知点击
#653  ←  #656   Skills 仍列 Claude/Cursor
#647  ←  #648   Windows 超长 txt 卡
#644  ←  #645   slash review-commit
#636  ←  #655   只覆盖 Design Mode；Kanban/Spaces 是加塞

无 Issue 的 PR：
#664  草稿残留（#620 残余）+ Shift+Enter + 引用注释功能
#661  侧栏文件 tab / 按项目隔离 / CodeMirror
#657  ⌘K 搜索滚轮 + 键盘
#652  Draft：session 中断硬化

无 PR 的 Issue：
#666  iOS 伴侣
#651  75Hz 掉帧
#650  Windows 图标留白
```

**没有「已经在 main 里修完、只是 Issue 没关」的配对。** 0.2.20 已关的相关项：

- #620 新建会话草稿未清 → `f389bec2` 已合。#664 第 1 刀是它的**残余**（前缀/首行碎片仍会回来），不是重复开单。
- #665 Windows 图标 → 当作 #650 的重复关掉了，#650 仍开着，**还没有 PR**。

---

## 3. 分流：审后可合 / 要拍板 / 我们自己修

### 桶 A — 审过后可以直接 squash（建议默认合）

按 maintain.md：「小修复、根因清楚、有测试 → CI 绿后 squash」。

| 顺序 | PR | 为什么能合 | 审的时候盯什么 |
|------|----|------------|----------------|
| A1 | **#645** | 只动 `filterSlashItems`；测试覆盖 `/rc` `/review-`；不碰 Host | 确认 `/go`→goal、`/aih`→aihot 仍在 |
| A2 | **#668** | +78，虚拟列表 + `stripAnsi` 补漏 `[39m` | Copilot 要 fast-path：可合后跟，不挡 |
| A3 | **#663** | 复用已有 `ComposerProjectMenu`，解开 `welcomeSession && activeProject` | 手机布局仍走 sheet；文案「默认工作区」替换「通用」 |
| A4 | **#657** | CI 已绿；⌘K 列表现在 `overflow:hidden` 滚不动（同类 #543） | 确认没偷偷依赖 #655 的 Spaces（作者第二提交已删） |

下面四个也建议合，但属于 **Host / 权限 / 平台**，maintain.md 要求对照真实 CLI 再核一眼：

| 顺序 | PR | 为什么能合 | 必须核 |
|------|----|------------|--------|
| A5 | **#660** | 额度用尽被当成 15 次重试的网络错误，是真 P1 | Copilot 已回：拆成 `QUOTA_EXCEEDED` vs `RATE_LIMITED`。核：裸 429 仍重试；`free-usage-exhausted` 立刻停 |
| A6 | **#658** | 通知点了没反应是真 P1；加 `tauri-winrt-notification` | Copilot 已修：只在主窗口订阅。核：Windows toast 点击回会话；macOS 打包 UN；`tauri dev` osascript **故意不能**深链 |
| A7 | **#656** | Settings Skills 与 CLI `compat.*.skills=false` 不一致 | **共享 `~/.grok` 不得改 config.toml**（作者声称只藏 UI）。必须读 diff 确认 |
| A8 | **#669** | 长回合双轨 + Send 卡死，P0 体感 | Copilot：**折叠 sibling 可能把 content 段复制两遍**。合前要么作者改，要么我们本地补一刀 |

### 桶 B — 有问题，必须你拍板（默认不合）

| PR / Issue | 问题 | 建议默认 | 备选 |
|------------|------|----------|------|
| **#655** / #636 | +5670，三功能捆一块。Issue 只要 Browser **Design Mode**。Kanban / Spaces 是新产品面，还改 `store.rs`、侧栏、palette、路由 `#/kanban` | **请作者拆**：先合 Design Mode；Kanban/Spaces 另开 PR + 设计说明 | 全收（产品愿意一次吃三块） / 全关等设计 |
| **#661** | +1890，无 Issue。文件 tab 名 + 按项目隔离是合理小修；但又加了 **12 个 CodeMirror 包** 当侧栏编辑器 | **请作者拆**：tab 名 / 占位 chip / 项目隔离可合；CodeMirror 另议 | 全收（接受新编辑器栈） |
| **#664** | +1868，三件事：① #620 残余草稿 ② Shift+Enter 首击无行 ③ **引用注释芯片（新功能）**。违反「一 PR 一关注点」 | **只要 ①②**；③ 另开 feature PR | 全收 / 只要 ① |
| **#648** / #647 | Windows-only：≥8000 字助手气泡改预览+txt 卡；粘贴同样变附件。mac/Linux 不动。会改「长回答长什么样」 | **产品是否接受「长回答变成文件卡」** | 合 / 关（继续靠 0.2.20 的 4096px 限高） |
| **#652** | **Draft**，+2052/−804，重写 session_manager 中断路径。无 Issue，无 CI，作者本机连 `link.exe` 都没有 | **保持 Draft，不进本轮**。作者标 Ready + CI 绿后再专项审 | 现在就审 / 关掉让作者重来 |
| **#666** | 要做 iOS 伴侣 App。仓库已有 **远程控制 IM + 手机镜像**（`docs/llm-wiki/remote-im.md`），首版明确非目标含「完整 IM 聊天室 / 公网多租户」 | **关闭并指向现有 Remote IM / 镜像**，标 `enhancement` `priority:p2` | 留着当远期愿景，不加进工程队列 |

### 桶 C — 无 PR，我们自己修（或降级）

| Issue | 建议 | 体量 |
|-------|------|------|
| **#650** | Windows `icon.ico` 去 mac 网格留白后重生成。改 `scripts/generate-icons.sh`，不要动 mac 母版 | 小，半日 |
| **#651** | 75Hz 外接屏虚拟列表掉帧。先对照 `useChatMessageVirtualizer` / rAF。若只是 75Hz+混刷新率，可标 P2 等有 repro 机器再动 | 中，需要你那台外接屏才能验收 |

### 桶 D — 本方案明确不管

#637 #638 #639 #640 #642 #643 #649（贡献者展示资料）。不要关、不要标、不要进 CHANGELOG。官网另做。

---

## 4. 拍板结果（2026-08-17 已锁）

| # | 决定 | 执行含义 |
|---|------|----------|
| **#655** | **拆** | 只收 Design Mode 关 #636；Kanban / Spaces 请作者另开 PR |
| **#661** | **拆** | tab 名 / 占位 chip / 项目隔离可合；CodeMirror 12 包另议 |
| **#664** | **只要 ①②** | 残余草稿 + Shift+Enter 可合；引用注释芯片另开 |
| **#648** | **合** | Windows ≥8000 字预览 + txt 卡，mac/Linux 不动 |
| **#652** | **本轮跳过** | 保持 Draft，Ready + CI 后再专项审 |
| **#666** | **关** | 指向设置 → 远程控制 / 手机镜像 |
| **#651** | **P2，不挡 0.2.21** | 标 `bug` `priority:p2` `platform:macos`，有 75Hz 机器再修 |

---

## 5. 可持续执行循环（直到队列清空）

每天 / 每个 agent 会话只做 **一轮**，做完更新本文件底部进度表。不要一次吞 13 个 PR。

```text
LOOP:
  0. git fetch --prune && git checkout main && git pull --ff-only
  1. gh pr list / gh issue list 刷新（本文件会过期）
  2. 批准仍停在 action_required 的 fork CI
  3. 取「桶 A 里 CI 已绿、且与刚合入文件冲突最小」的下一个 PR
  4. 按 §6 审：typecheck / 相关 vitest / 关键 diff / i18n / 无 window.confirm / 无改 App.tsx 新 state
  5. squash-merge，body 保留 Fixes #N
  6. 感谢作者；确认 Issue 自动关
  7. 让仍 OPEN 且碰了热文件的 PR 的作者 rebase（或我们 comment @）
  8. 更新本文件进度表
  9. 桶 A 空了 → 停，等 §4 拍板 或 去做桶 C
 10. 一小波 P0/P1 落地后，按 release.md 切 0.2.21
```

### 5.1 推荐波次（合入顺序）

**第 0 步（今天就能做，不改代码）**

- [ ] `git pull --ff-only origin main`
- [ ] 在 GitHub 批准这些 CI run（最新一条即可）：  
  #669 `32028879140` · #668 `32026834173` · #664 `32022948272` · #663 `32018560558` · #660 `32013235750` · #658 `32009833943` · #656 `32009518936` · #652 `32000694283` · #648 `31996938918` · #645 `31990314535`
- [ ] 给 12 个非贡献者 Issue 补标签（现在几乎都是裸的）：见 §7
- [ ] 在 #655 #661 #664 上评论：请按 §4 默认拆分（若你同意默认）

**第 1 波 — 前端小修复（冲突面小）**

1. squash **#645** → 关 #644  
2. squash **#668** → 关 #667  
3. squash **#663** → 关 #662  
4. squash **#657**（已绿）

合完后让 #664 / #658 / #661 / #655 rebase `AppWorkbench.tsx`。

**第 2 波 — Host / 平台（要对照 CLI）**

5. **#660** → 关 #659（先读 `acp_client.rs` / `errorDeck.ts` 确认 429 没被误杀）  
6. **#658** → 关 #654（看 `Cargo.toml` 新依赖只在 Windows toast 路径）  
7. **#656** → 关 #653（**盯死**共享模式不写 `~/.grok/config.toml`）  
8. **#669** → 关 #670（先处理 Copilot 双份 content；建议我们 checkout 跑 `src/lib/session.test.ts` + `streamLateToken.test.ts`）

**第 3 波 — 拍板之后**

按 §4 的答复执行，不要预演。典型路径：

- #648 若「合」→ 单独 squash，再让 #664 rebase `ConversationThread.tsx` / `ComposerEditor.tsx`
- #664 若「只要 ①②」→ 请作者重推或我们 cherry-pick 非 quote 文件
- #661 若「拆」→ 只收 tab/隔离 commit，编辑器另 PR
- #655 若「拆」→ 只要 Design Mode 相关文件（`browserDesignMode*` / `BrowserTab` / `BrowserDesignModePanel` / terminal.rs eval），不要 `KanbanBoardPage` / `SpaceSwitcher` / `projectSpaces*`

**第 4 波 — 我们自己的补丁**

- #650 Windows 图标：改 `scripts/generate-icons.sh` 给 ico 去边，重出 `src-tauri/icons/icon.ico`，不改 mac `.icns` 母版
- #651 有机器再开 `fix/chat-75hz-virtualizer`
- #666 按拍板关或留

**第 5 波 — 发版**

桶 A + 已拍板的 B + #650 进 Unreleased 后，按 [release.md](../llm-wiki/release.md) 切 **0.2.21**。  
发版前：`python3 scripts/update-contributors.py`（与贡献者资料 Issue 无关，这是 GitHub 提交头像）。

### 5.2 每个 PR 的固定审查清单（复制用）

```text
[ ] CI 绿（fork 已批准 workflow）
[ ] pnpm typecheck && 相关 vitest（作者写了哪些就跑哪些）
[ ] 有 Rust 时 cargo test --lib <模块> 或等 CI Rust 三端
[ ] 用户文案走 src/i18n/messages/{en,zh,zh-TW}，key 对齐
[ ] 无 window.confirm / prompt / alert
[ ] 无原生 <select> / 透明 .menu-panel
[ ] 无新 useState 进 App.tsx（AppWorkbench 可以，但看是否该下沉）
[ ] 共享 GROK_HOME 不改 ~/.grok
[ ] 无 secrets
[ ] 范围 = 描述；没有顺手重构
[ ] CHANGELOG Unreleased 有中英各一条（作者已写则保留，冲突时手搓）
```

### 5.3 合完后的固定收尾

1. `gh pr comment <n> --body "谢谢，已进 main，随 0.2.21 发。"`  
2. 确认 linked Issue 已关；没关就 `gh issue close <n> --reason completed`  
3. `git fetch --prune`；远程 feature 分支若还在，按 maintain.md 删  
4. 在仍打开且碰了同一文件的 PR 下 `@作者 请 rebase main`  
5. 勾掉本文件进度表

---

## 6. 为什么不能「按号从小到大全合」

1. **#655 会把产品面撑变形。** Design Mode 合理；一次塞进 Kanban 看板 + Project Spaces + 新路由，后续每个侧栏 PR 都要跟着 rebase。
2. **#661 引入编辑器栈。** 12 个 `@codemirror/*` 不是小依赖。文件 tab 名可以先合，编辑器值得单独产品决定。
3. **#664 把两个 bug 和一个功能焊在一起。** 草稿/换行该合；引用注释会改 send 载荷（`[[quote]]` / `Quoted excerpt:`），要当功能审，不能当 bugfix 混进去。
4. **#652 是 Draft 还动 session_manager 核心。** 和 #669 / #660 抢 `events.rs`。先合两个小 Host 修复，Draft 以后再 rebase。
5. **#648 与 #664 抢 `ComposerEditor` / `ConversationThread`。** 先定 Windows 长文策略，再让 #664 rebase。

---

## 7. 立刻要打的标签（不改代码）

| Issue | 标签 |
|-------|------|
| #670 | `bug` `priority:p0` `area:session` |
| #667 | `bug` `priority:p1` `area:session` `platform:windows` |
| #666 | `enhancement` `priority:p2`（拍板后再关） |
| #662 | `enhancement` `priority:p2` `area:composer` |
| #659 | `bug` `priority:p1` `area:auth` |
| #654 | `bug` `priority:p1` |
| #653 | `bug` `priority:p2` |
| #651 | `bug` `priority:p2` `platform:macos` `area:session` |
| #650 | `bug` `priority:p2` `platform:windows` |
| #647 | `enhancement` `priority:p1` `platform:windows` |
| #644 | `bug` `priority:p2` `area:composer` |
| #636 | `enhancement` `priority:p2` |

---

## 8. 进度表（执行时改这里，不要另开文档）

| 项 | 状态 | 合入 / 关闭 | 备注 |
|----|------|-------------|------|
| 批准 fork CI | **已做** | 10 条 run 已 POST `/approve` | 等跑绿后再合 |
| 给 Issue 打标 | **已做** | | §7 |
| #645 / #644 | 待审 | | A1，CI 已批准 |
| #668 / #667 | 待审 | | A2 |
| #663 / #662 | 待审 | | A3 |
| #657 | 待审 | | A4，已绿 |
| #660 / #659 | 待审 | | A5 Host |
| #658 / #654 | 待审 | | A6 平台 |
| #656 / #653 | 待审 | | A7 共享模式 |
| #669 / #670 | 待审 | | A8 Copilot 双份 content |
| #655 / #636 | **已拍板：拆** | 已评论请作者拆 | 只收 Design Mode |
| #661 | **已拍板：拆** | 已评论 | 不要 CodeMirror |
| #664 | **已拍板：只要 ①②** | 已评论 | 引用芯片另开 |
| #648 / #647 | **已拍板：合** | 已评论 | 等 CI 绿 |
| #652 | 跳过 | | Draft |
| #650 | 待自己修 | | 图标脚本 |
| #651 | 已标 P2 | | 不挡 0.2.21 |
| #666 | **已关** | not planned | 指向 Remote IM / 镜像 |
| 贡献者资料 ×7 | 忽略 | | |
| 发 0.2.21 | 未开始 | | A+已拍板 B + #650 |

---

## 9. Agent 接手口令

下一会话只需说：

> 按 `docs/plans/2026-08-17-issues-prs-cleanup-plan.md` 执行第 N 波。拍板结果：…

不要重新盘点整个仓库，除非 `gh pr list --state open` 和本文件 §1.2 对不上。
