# 延后能力开发计划（#151–#160 未全量进 main）

> **For Claude / 实施 Agent：** 按 Task 顺序落地；用户审核通过后再动手。  
> **Goal：** 把 0.1.9 集成时**有意延后**的安全与体验 hardening 有序合回 `main`，避免再开互相冲突的巨型 PR 批。  
> **Architecture：** 每条能力独立切片 PR，从最新 `main` 开分支；共享脚手架（CI / build.rs）先合、业务后合；不重复注入 Windows MANIFEST。  
> **Tech Stack：** Tauri 2 · React · Rust · 现有 `remote_im` / `mirror` / `errorDeck` / `fs_browser`  
> **对照基线：** `main` @ v0.1.9（`f151064` 一带）；历史来源 PR **#151–#160**（已关，内容仅作 diff 参考）  
> **#165 档 C：** 已于 2026-07-27 squash-merge 进 `main`（`84e8809`）。无 Secrets 时仍走 GitHub 档 B 路径；真·静默更新需配置密钥（见 `docs/desktop-auto-update.md`）。

---

## 0. 背景与原则

### 0.1 为何延后（不是「不重要」）

| 原因 | 说明 |
|------|------|
| 冲突 | #151–#160 相对 main 全 CONFLICTING，整包硬合成本高 |
| 批内重复 | 多 PR 抢 `build.rs` / manifest / CI，曾导致 Win CVT1100 |
| 发版切片 | 0.1.9 优先用户 P0（#161/#162）与可安全切片项 |

### 0.2 已在 main 的相关能力（勿重复做）

- Windows `CREATE_NO_WINDOW` / `open_http_url`（rundll32）  
- secrets 原子写、`allow-from` 启用校验、LINE 8081 + 签名 + lastError  
- L08 **档 B**：About 下载本机安装包  
- CLI import 仅 shared、effort 放宽、CLI `GROK_CLI_REQUIRE_CHECKSUM`  

### 0.3 工作原则

1. **一 PR 一主题**，命名 `feat/harden-<slice>`  
2. 从 `origin/main` 拉分支；参考旧 PR 用 `gh pr diff <n>`，**不要** checkout 旧 tip 硬 rebase  
3. 禁止再加 `/MANIFESTINPUT` 第二份 Windows manifest  
4. i18n en + zh（+ zh-tw 同 key）；无 `window.confirm`  
5. 每切片：`pnpm typecheck && pnpm test` + 相关 `cargo test`  
6. CHANGELOG 写 `[Unreleased]`；用户可见行为补 `docs/llm-wiki` 或 `docs/features`  
7. 合入后关/评论关联的 closed PR（「landed via #xxx」）

### 0.4 建议发版映射

| 切片 | 建议版本 | 优先级 |
|------|----------|--------|
| S1 path_scope + CSP | 0.2.0 | P0 安全 |
| S2 resource workbench | 0.2.0（依赖 S1） | P0 安全/体验 |
| S3 mirror RO + token | 0.2.0 | P0 安全 |
| S4 error deck 补全 | 0.1.10 或 0.2.0 | P1 |
| S5 day-use 文档 | 随 S3/S4 | P2 |
| ~~#165 档 C~~ | **已合 main**；密钥就位后下一正式版生效 | 完成 |

---

## 1. 能力清单与验收

### S1 — path_scope + CSP + media 收紧（来源 #151）

**用户价值：** 资源区 / `media://` / 绝对路径读写只能碰信任根，降低任意读盘风险。

**范围：**

| 项 | 说明 |
|----|------|
| 新增 | `src-tauri/src/path_scope.rs`：信任项目根 + app data + temp + 显式 grant |
| 改 | `fs_browser.rs`、`media_protocol.rs`、`store.rs`（项目增删时 `refresh`） |
| 改 | `tauri.conf.json`：CSP / asset protocol scope 收紧（对照 #151 diff，**勿**回到 `**` 过宽） |
| 测 | 路径越权拒绝；信任项目内可读；grant 后可再开 |

**非目标：** 完整资源编辑器 UX（归 S2）。

**参考：** `gh pr diff 151`（忽略 `build.rs` manifest / 盲目 `cargo test --lib` 脚手架）

**验收：**

- [ ] 未信任绝对路径 `fs_read` / media 失败且文案可行动  
- [ ] 信任项目内读写 OK  
- [ ] `cargo test` path_scope + media 相关  
- [ ] 暗色/亮色资源预览不回归  

### S2 — 资源台 / 安全预览（来源 #160，依赖 S1）

**用户价值：** 项目内编辑文本、SVG 按图预览、用户打开过的绝对路径可再开/保存。

**范围：**

| 项 | 说明 |
|----|------|
| 改 | `ResourceViewer.tsx`、`OfficeDocumentPreview.tsx`（SheetJS 升级若未做则带上） |
| 改 | `fs_browser` / commands 与 path_scope grant 打通 |
| 测 | SVG 不当 HTML 注入；xlsx 不 `innerHTML` 执行脚本 |

**验收：**

- [ ] 项目文本文件可编辑保存  
- [ ] SVG 以 image 预览  
- [ ] grant 路径会话内可再开  

### S3 — 手机镜像只读默认 + token 轮换（来源 #152）

**用户价值：** 扫码镜像默认不能驱动本机 Agent；链接可作废重发。

**范围：**

| 项 | 说明 |
|----|------|
| 改 | `src-tauri/src/mirror/*`：默认 read-only；写操作拒绝 |
| 新 | `mirror_rotate_token`、`mirror_set_read_only`（commands + lib 注册） |
| 改 | `MirrorConnectPanel.tsx` + i18n：开关「允许手机发送」、重新生成链接 |
| 安全头 | 若 #152 有 Referrer-Policy 等且无冲突可一并带上 |

**验收：**

- [ ] 启动镜像默认只读（手机不能发会改状态的指令）  
- [ ] 打开「允许发送」后可双向  
- [ ] 轮换 token 后旧 QR 失效  
- [ ] 单测 / 手动：token gate  

### S4 — error deck 四类补全（来源 #155）

**用户价值：** CLI / 认证 / 网络 / 崩溃 分类清晰，主按钮指向正确设置页。

**范围：**

| 项 | 说明 |
|----|------|
| 改 | `src/lib/errorDeck.ts` + `errorDeck.test.ts`：自由文本归类  
| 改 | `src/lib/session.ts` 错误上抛路径对齐 deck  
| 文案 | `messages.ts` 网络类补充代理/地区线索（对齐开源诊断 NEW-07，若未做） |
| CLI | 确认 `GROK_CLI_REQUIRE_CHECKSUM` 路径与 UI 提示一致（部分已在 0.1.9） |

**验收：**

- [ ] 假 CLI 路径 → deck 推 Doctor，不推「重新登录」  
- [ ] 坏 key → auth deck  
- [ ] 断网/代理 → network deck 含代理提示  
- [ ] 单测覆盖四类  

### S5 — Windows day-use 验收文档（来源 #158 文档）

**用户价值：** 干净机验收剧本可复现。

**范围：** `docs/验收/windows-dayuse-acceptance.md`、`docs/features/windows-dayuse.md`；与 README SmartScreen 说明交叉链接。

**验收：** 文档步骤与 0.1.9+ 安装路径一致；不写过时端口/更新话术。

---

## 2. 实施任务（审核通过后按序执行）

### Task 1: S1 path_scope 模块 + 单测

**Files:**
- Create: `src-tauri/src/path_scope.rs`
- Modify: `src-tauri/src/lib.rs`（`mod path_scope`）
- Test: `path_scope` 内 `#[cfg(test)]`

**Steps:**
1. 从 #151 diff 提取 `path_scope` API：`refresh_from_store` / `is_allowed` / `grant` / `clear_grants`  
2. 写单测：信任根内 true、系统路径 false、grant 后 true  
3. `cargo test --lib path_scope`  
4. Commit: `feat(security): add path_scope allowlist`

### Task 2: S1 接到 fs_browser + media + CSP

**Files:**
- Modify: `src-tauri/src/fs_browser.rs`、`media_protocol.rs`、`store.rs`、`tauri.conf.json`  
- 项目增删/信任变更处调用 `path_scope::refresh_from_store`

**Steps:**
1. 绝对路径读写先过 `path_scope`  
2. `media://` 同源策略  
3. CSP 收紧后本地 dev/preview 冒烟  
4. Commit: `feat(security): gate fs and media behind path_scope`

### Task 3: S2 资源台预览

**Files:**
- Modify: `src/components/ResourceViewer.tsx`、`OfficeDocumentPreview.tsx`、相关 commands  

**Steps:**
1. SVG 图片预览；表格无 innerHTML  
2. grant 路径与 S1 联调  
3. Commit: `feat(resource): trusted previews and path grants`

### Task 4: S3 镜像 hardening

**Files:**
- Modify: `src-tauri/src/mirror/mod.rs`、`http.rs`、`rpc.rs`、`ws.rs`  
- Modify: `src/components/MirrorConnectPanel.tsx`、`src/lib/api.ts`、i18n  

**Steps:**
1. 默认 read_only = true  
2. rotate_token 使旧 token 401  
3. UI 开关 + 重新生成  
4. Commit: `feat(mirror): read-only default and token rotate`

### Task 5: S4 error deck

**Files:**
- Modify: `src/lib/errorDeck.ts`、`errorDeck.test.ts`、`session.ts`、i18n  

**Steps:**
1. 补分类规则 + 单测  
2. 网络文案代理线索  
3. Commit: `fix(errors): complete four-class error deck`

### Task 6: S5 文档 + CHANGELOG + 发版准备

**Files:**
- Create/Update: `docs/features/*`、`docs/验收/*`  
- Modify: `CHANGELOG.md` Unreleased  
- 可选: 更新 `docs/P0-能力矩阵.md` 勾选  

**Steps:**
1. 写清验收步骤  
2. 准备 0.2.0 或 0.1.10 CHANGELOG 章节（审核定版本号）  
3. `pnpm typecheck && pnpm test` + `cargo test --lib`  

---

## 3. 依赖关系

```text
main (v0.1.9)
  ├─ S1 path_scope/CSP ─────────┬─► S2 resource workbench
  ├─ S3 mirror RO/token ────────┤
  ├─ S4 error deck ─────────────┼─► 集成测试 / 0.2.0 tag
  └─ S5 docs ───────────────────┘

#165 档 C updater ──► 已合 main（无密钥=档 B fallback）
```

S2 **硬依赖** S1。S3 / S4 可与 S1 **并行**（不同目录，注意 i18n 冲突时串行 rebase）。

---

## 4. 风险与禁止项

| 风险 | 缓解 |
|------|------|
| CSP 过严导致本地预览挂 | 先收紧再按白名单放行；dev 验证 |
| path_scope 误伤合法绝对路径 | 显式 grant + 用户打开文件对话框写入 grant |
| 镜像默认只读破坏老用户习惯 | 设置里明显开关 + CHANGELOG Notes |
| 再引入双 MANIFEST | **禁止** `build.rs` `/MANIFESTINPUT` |
| 巨型 PR 再现 | 每 Task 独立 PR，禁止 10 合 1 |

---

## 5. 审核清单（给你勾选）

请确认后实施 Agent 再动手：

- [ ] **S1** path_scope + CSP：同意作为 0.2.0 第一刀  
- [ ] **S2** 资源台：同意跟在 S1 后  
- [ ] **S3** 镜像 RO + token：同意默认只读  
- [ ] **S4** error deck：同意补全（版本号 ______）  
- [ ] **S5** day-use 文档：同意随 hardening 一起  
- [ ] 目标版本：☐ 0.1.10 只 S4  ☐ 0.2.0 打 S1–S5  ☐ 其他 ______  
- [x] **#165** 档 C：代码已合；真更新仍待 Secrets

---

## 6. 相关路径速查

| 路径 | 用途 |
|------|------|
| `docs/plans/2026-07-27-issues-prs-update-ship-plan.md` | 当时 ship / 更新分档 |
| `docs/plans/2026-07-26-开源诊断与整改交接.md` | NEW-06/07 签名与错误文案 |
| `docs/llm-wiki/release.md` | 发版 |
| `docs/llm-wiki/dialogs.md` / `i18n.md` | UI 规范 |
| 旧 PR | `gh pr diff 151` … `160`（只读参考） |

---

## 7. 修订

| 日期 | 说明 |
|------|------|
| 2026-07-27 | 初版：从 #151–#160 延后项整理；#165 另轨 |
| 2026-07-27 | #165 已合 main；计划待用户审核后实施 S1–S5 |
| 2026-07-27 | S1–S5 已实施并合入 main（#166 / `9e02fea`） |
