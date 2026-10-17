## 结论：**通过（无 blocker）**

审查对象：未提交的 official-aux X/Imagine 注入修复（相对 HEAD 工作树）。`pi -p`，工具仅 `read`/`bash`。

### 核对表

| # | 检查项 | 结果 | 证据 |
|---|--------|------|------|
| 1 | 打包后 official-aux MCP 一定注入 | ✅ | `OFFICIAL_AUX_MCP_SCRIPT = include_str!("../../scripts/official-aux-mcp.mjs")` 编译期嵌入；`mcp_server_acp_entry_reason()` 先 `ensure_official_aux_home()` 再 `write_official_aux_mcp_script(&home)`，`command = node + agent-home-official/official-aux-mcp.mjs`，不依赖仓库路径；`ensure_official_aux_home()` 也补写脚本；注入失败时带 `reason` 打 warn 日志（不再是静默 count=0）。脚本存在且含 `x_keyword_search` |
| 2 | solo inject 关掉 ChatCut config.toml auto-load | ✅ | `apply_inject_mcp_enabled_in_toml()`：solo 时所有非 `official-aux` server 写 `enabled = false`；挂载点齐全——ACP spawn prep（`acp_client.rs:1383`）、`settings_set` 开关翻转、providers activate/remove/set_default 均调 `sync_user_mcp_for_official_aux_inject` |
| 3 | 预热进程带 official-aux `--rules` | ✅ | connect.rs:1587 prewarm `extra_rules: merge_extra_rules(None)` → 含 `inject_session_rules()`；warm-reuse gate 按 policy/effort/sandbox/route 匹配，prewarm 与正式会话规则同源，复用不丢指引；`extra_rules_spawn_flags` 输出顶层 `--rules <TEXT>`（acp_client.rs:1459） |
| 4 | 规则禁止 search_tool/ChatCut 搜 X | ✅ | 规则改为 "Immediately use_tool tool_name=\"official-aux__x_keyword_search\""，"Do NOT call search_tool"、"Never call chatcut__* / search_stock_media"、Imagine deny reason 也删掉了 "search_tool query … first" 的旧指引；测试断言不再含 "Immediately search_tool query" |
| 5 | 共享模式不误改 `~/.grok` | ✅ | `sync_user_mcp_for_official_aux_inject` 首行 `if session_data_mode == "shared" { return Ok(()) }`；写的是 `agent_config_toml()` = `agent_home_dir()/config.toml`（独立模式路径）；空文件直接跳过不创建内容 |
| 6 | 测试覆盖 | ✅（有缺口，见备注） | 新增 `official_aux_rules_route_x_to_aux_not_chatcut`、`official_aux_mcp_script_is_embedded`、`solo_inject_disables_user_mcp_but_keeps_official_aux`（含关→恢复往返）；实跑 `cargo test --lib -- official_aux solo_inject`：21 passed, 0 failed |
| 7 | 密钥 / config.toml 未提交 | ✅ | `git status` 仅 8 个源码/文档文件；diff 无 auth.json、config.toml、API key |

### 非 blocker 备注

1. **`sync_user_mcp_for_official_aux_inject` 本身无直接单测**（碰真实 FS），只测了纯函数 `apply_inject_mcp_enabled_in_toml`。共享模式早退、空 config 跳过这两条分支靠代码审查确认，建议后续补 temp-home 级测试。
2. **warm-reuse gate 不比较 `extra_rules`**：prewarm 进程被复用时不会带上会话级 `meta.extra_rules`（用户自定义 rules）。这是本次改动之前就存在的行为，非本修复引入。
3. **solo 关闭后的恢复语义**依赖 `is_enabled` 缺省 true（default-on prefs）——若用户曾在 App 外手动 `enabled = false` 且 prefs 无记录，开关一次 inject 会把它翻回 true。与既有 `sync_mcp_enabled_to_agent_config` 语义一致，可接受。
4. 共享模式下 custom 主路由仍可能从 `~/.grok/config.toml` auto-load ChatCut（设计上不改写 `~/.grok`），目前靠 `--rules` 文本约束兜底——符合 wiki 既定边界，仅提示知晓。

无 blocker，该项可标完成。
