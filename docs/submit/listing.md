# Grok App 开源申报稿

可直接粘贴到「发布开源内容」表单。封面文件：`docs/submit/grok-app-cover-4x3.png`（2048×1536，4:3 PNG）。

## 表单字段

| 字段 | 建议填写 |
|------|----------|
| **名称** | Grok App |
| **类型** | 工具 |
| **一句话介绍** | Grok 的非官方桌面端 |
| **一句话介绍（备选）** | 本机 Grok Build 的桌面指挥台 |
| **介绍封面** | 上传 `grok-app-cover-4x3.png` |

仓库：https://github.com/RongleCat/grok-app  
许可证：MIT  
当前版本：0.2.24  
平台：macOS（ARM / Intel）· Windows x64 · Linux x64

---

# 详细说明（从此行起到文末，整段复制进表单）

# Grok App

**Grok App 不是 xAI 官方产品。** 它把本机 [Grok Build](https://x.ai) CLI（`grok agent stdio`）收成桌面工作台：多项目会话、权限条、媒体预览、定时任务、账号与中转。

- 仓库：https://github.com/RongleCat/grok-app
- 许可证：MIT · 跨平台 · Tauri 2 + React
- 当前版本：0.2.24

## 它解决什么

终端里跑 `grok` 已经很强，日常还缺一块指挥台：多项目、多会话、权限确认、富媒体、定时任务、多语言界面。Grok App 补的是这一层，**不替代 CLI，也不自研一套模型后端**。

## 安装

从 [GitHub Releases](https://github.com/RongleCat/grok-app/releases) 下载对应平台安装包（预编译包**不需要** Node / pnpm / Rust）：

| 平台 | 文件 |
|------|------|
| macOS Apple Silicon | `Grok_*_aarch64.dmg` |
| macOS Intel | `Grok_*_x64.dmg` |
| Windows x64 | `*-setup.exe` 安装版，或 `*-portable.zip` 绿色版 |
| Linux x64 | AppImage / `.deb` / `.rpm` |

校验：Release 附带 `SHA256SUMS`。

```bash
# macOS / Linux
shasum -a 256 -c SHA256SUMS --ignore-missing
```

macOS（v0.2.19 起已 Developer ID 签名 + 公证）：把 App 拖进「应用程序」即可。若仍被 Gatekeeper 拦截：

```bash
xattr -cr /Applications/Grok.app
open /Applications/Grok.app
```

Windows 未签名社区包可能被 SmartScreen 拦截：点「更多信息 → 仍要运行」，并对照 `SHA256SUMS`。

## 使用示例

真 Agent 能力依赖本机已安装并可登录的 **Grok Build CLI**（常见路径 `~/.grok/bin/grok`；Windows 为 `%USERPROFILE%\.grok\bin\grok.exe`）。没有 CLI 时，首次启动的 Setup 向导可一键安装。

1. 启动 App → Setup 向导确认 CLI。
2. （可选）登录官方账号 / 填 API Key / 配置自定义中转；均可跳过。
3. **添加项目** → 选择并信任文件夹。
4. **连接 Agent** → Ready 后发消息。权限条默认 **Ask**（每次确认）；无人值守再开 **YOLO**。
5. 日常：切项目 / 会话、预览图视频 PDF、在资源窗编辑文件、看 Changes、用斜杠调 Skills / MCP、在对话里用自然语言创建定时任务。

流程：安装 App → 准备 grok CLI → 信任项目目录 → 连接 Agent → Ask 或 YOLO 发消息。

开发联调（无 CLI）可用：`GROK_APP_ACP=mock pnpm dev`

## 能做什么

- **真 Build 会话**：默认 `grok agent stdio`（ACP），Host 独占会话状态机。
- **项目与会话**：多项目信任目录、归档 / 分叉 / 回退；可导入本机 CLI 会话。
- **权限**：默认 Ask；Allow once / session / Deny；YOLO；可按项目设默认阶梯。
- **媒体与文件**：图 / 视频 / PDF / Office / 代码预览；资源窗可编辑保存文本。
- **自动化**：已安排任务列表；对话里自然语言创建（不把 JSON 甩到界面上）。
- **账号与额度**：多账号、官方登录、SuperGrok 额度热力图；自定义中转走独立 `GROK_HOME`，避免污染 `~/.grok`。
- **扩展**：斜杠面板、Skills、MCP / Plugins。
- **i18n**：15 种界面语言（含简中 / 繁中 / 英 / 日 / 俄等）。

## 能力边界（请先读）

- **非官方**。不代表 xAI，也不附带官方额度。没有可用的 Grok Build CLI / 登录态时，不能当完整 Agent 用。
- **不内置模型**。对话、工具、推理强度都走本机 `grok` CLI（或你配置的自定义中转）。App 是 Host / 工作台。
- **账号可选**。CLI 已登录即可干活；App 内登录只为额度、多账号、官方能力。
- **默认 shared 模式**与终端共用 `~/.grok`。shared 模式**不会**改写 `~/.grok` 的 `config.toml`。要让 App 写 agent 配置（自定义提供商、隐私、workflows），请用 **independent** 模式（`~/.grok-app/agent-home`）。
- **权限默认 Ask**。YOLO / 完全访问是显式选择，不是开箱无人值守。
- **密钥**：优先系统钥匙串；否则 `secrets.json`（权限 `0600`）。不要把 `auth.json`、API Key 提交进仓库。
- **Linux**：部分 Wayland（尤其 Hyprland + AMD）上 AppImage 可能黑屏，优先 `.deb` / `.rpm`。Ubuntu 24.04+ 若内核限制用户命名空间，默认沙箱可能直接退出，需关沙箱或放开 `userns`。
- **预编译包**开箱即用；从源码构建才需要 Node 22+、pnpm 9、Rust stable。

## 链接

- 仓库：https://github.com/RongleCat/grok-app
- 发行版：https://github.com/RongleCat/grok-app/releases
- 贡献：https://github.com/RongleCat/grok-app/blob/main/CONTRIBUTING.md
- 安全披露：https://github.com/RongleCat/grok-app/blob/main/SECURITY.md
