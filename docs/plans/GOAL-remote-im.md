# Goal 提示词 — 远程 IM 可视化配置 × Grok Build

> 将下方 **「可复制 Goal」** 整段贴给执行 Agent（Grok Build / Claude 等），用于**持续迭代**直至 Phase 验收通过。  
> 规格来源：`docs/llm-wiki/remote-im.md`（功能设计单一事实来源）。

---

## 可复制 Goal

```text
# Goal: Grok App 远程 IM（设置 GUI + Bridge + 仅 Grok Build）

## Outcome
在 Grok App「设置 → 远程 IM」中提供与现有 Settings 同风格的可视化配置：一级设置侧栏进入后，二级侧栏列出全部 IM 渠道，右侧展示绑定表单与 ACL/项目/诊断；用户无需 CLI、无需手写 TOML。Bridge 本机进程将各渠道消息接入 Grok Build ACP；控制语义：/p 选项目后新会话，/r 恢复 App 历史会话。全渠道字段与 cc-connect 已有 options 对齐（见 docs/llm-wiki/remote-im.md §6）。

## Spec（必读）
- 主规格：docs/llm-wiki/remote-im.md（全文）
- UI 规则：docs/llm-wiki/i18n.md · dialogs.md · icons.md
- 设置页风格：src/components/SettingsPage.tsx · src/styles/app.css（.settings-page__*）
- 产品：仅 Grok Build；项目仅 App 信任目录；禁止任意 /dir 路径

## 分期（按顺序做，做完一轮再开下一 Phase）

### Phase 0 — 骨架
- SettingsSectionId 增加 remote_im；一级 nav + 路由 #/settings/remote_im
- RemoteImLayout：rim-sidebar（Bridge 总览 + 全渠道列表灰/绿态）+ rim-panel
- 全渠道侧栏项齐全（feishu/lark/dingtalk/wecom/weixin/wps-xiezuo/weibo/qq/qqbot/telegram/slack/discord/matrix/line/wps-agentspace 等，与规格一致）
- i18n 中英 keys（settings.remoteIm.*）
- 未实现渠道：右侧 comingSoon，不可提交凭证
- 无 window.confirm；密钥相关预留 secrets API 接口形状

### Phase 1 — 飞书 MVP（标杆）
- 飞书/Lark：扫码 Tab + 粘贴 Tab GUI（对齐 feishu setup/bind 能力，不要求用户跑终端）
- §6.1 全部 GUI 字段可编辑保存
- ACL + 项目范围（all_trusted | whitelist chips）
- Bridge 启停（Attached）+ 状态灯 + 测试连接
- 保存后长连接；/p /r 卡片或降级文本；mode=new|resume；agentSession 对接 App sessions_index
- Doctor 结构化报告入口

### Phase 2 — 国内
- 钉钉：粘贴 client_id/secret + §6.2 字段
- 企微：WS 模式完整表单；Webhook 模式表单 + 公网说明 Callout
- 微信个人：扫码主路径 + token 粘贴 + 强制文本菜单 presenter

### Phase 3 — 海外
- Telegram / Slack / Discord / Matrix 按 §6 字段 GUI 化并接通 Bridge

### Phase 4 — 长尾
- QQ OneBot / QQ 官方 / 微博 / WPS / LINE（LINE 强提示公网）
- 消息与桌面会话时间线增强（按规格 P2/P3）

### Phase 5 — 打磨
- 钉钉扫码二期（若官方能力可用）
- Detached 常驻、速率限制、崩溃恢复、从 agent-connect 配置迁移

## Constraints
1. 不引入第二套 Agent 运行时；只 spawn/连接 Grok Build ACP。
2. 配置主路径禁止依赖用户执行 shell 命令；Doctor 可附「复制调试命令」。
3. 所有用户文案走 createT(locale)；新增 keys 中英齐全。
4. 对话框用 setAppDialog / GlassModal，禁止 window.confirm/alert/prompt。
5. 密钥不进 git、不进明文日志；默认遮罩。
6. 复用 settings 视觉 token；二级侧栏 + 右侧表单，不要用纯网格替代主导航。
7. 表单优先 schema 驱动（channelSchemas），避免每渠道复制一整页死 JSX。
8. 不扩大范围到完整 IM 聊天 UI 或 cc-connect 全量 /shell /cron（除非规格明确打开）。
9. 修改规格字段时先更新 docs/llm-wiki/remote-im.md 再改代码。

## Verification（每 Phase 结束自检）
- [ ] pnpm / 类型检查通过（项目既有脚本）
- [ ] 设置 → 远程 IM 可进入；侧栏渠道完整
- [ ] Phase1+：飞书可在 GUI 完成绑定并出现连接状态（真机或 mock）
- [ ] 无硬编码中文/英文用户串（抽检新增 UI）
- [ ] 无 window.confirm
- [ ] remote-im.md 与实现字段一致
- [ ] 手动：选项目 → IM 说话新会话；/r → 恢复会话（Phase1+）

## Boundaries
- 可改：src/components（RemoteIm*、SettingsPage）、src/i18n、src/lib/remoteIm、src-tauri remote_im、docs/llm-wiki/remote-im.md、相关样式
- Bridge：**Rust 进程内**（`src-tauri/src/remote_im`）；禁止再 spawn 外部 agent-connect / Node remote-bridge
- 不要：无关重构、替换整个设置体系、提交 secrets、force-push

## Iteration policy
- 一次只推进一个 Phase；Phase 验收勾选完成后再开下一 Phase。
- 遇规格歧义：以 docs/llm-wiki/remote-im.md 为准；不足则先补文档再写码。
- 渠道 SDK 差异：可降级文本菜单，但配置 GUI 字段仍按 §6 暴露（disabled 亦可）。
- 每完成一个可运行增量：简短说明改动文件 + 如何点选验证。
- 阻塞（缺真机凭证/扫码环境）：用 mock Bridge 保证 GUI 可演示，并记录 TODO。

## Completion evidence
- 当前 Phase 的 Verification 清单全部勾选
- 关键路径列表 + 设置页截图或操作步骤说明
- 若有 Bridge：status 接口或日志证明连接意图正确

## Pause / block
- 需要产品拍板的开放问题（后台常驻默认、远程改模型等）：写入 docs 待决，不擅自实现
- 外部开放平台扫码 API 不可用：粘贴路径必须可用，扫码标为降级
- 安全：发现密钥可能泄漏到日志 → 立即停并修复 redact

开始时：先读 docs/llm-wiki/remote-im.md 与现有 SettingsPage，从 Phase 0 起实现；汇报当前 Phase 与下一步。
```

---

## 使用方式

1. 新会话粘贴整段 **可复制 Goal**。  
2. 若中断，下一轮加一句：`继续 Goal 远程 IM，当前已完成 Phase X，从 Phase X+1 接着做。`  
3. 规格变更只改 `docs/llm-wiki/remote-im.md`，再让 Agent 重读 Goal。
