## 结论：**通过（无 blocker）**

审查对象：未提交的 4 条发布前 WARNING 修复。`pi -p`，工具仅 `read`/`bash`。

`pnpm typecheck`：通过。  
`pnpm test`：505 files 全绿。  
`cargo test wecom` / `auto_add_project_path` / `remote_im`：全绿。

### 核对表

| # | 检查项 | 结果 | 证据 |
|---|--------|------|------|
| 1 | WeCom webhook ±300s 新鲜度，过期 401 | ✅ | `wecom_timestamp_fresh` + `wecom_callback_authorized`；GET/POST 均 401 |
| 2 | 过期 / 未来 / 边界单测 | ✅ | ±300 含边界；301 拒绝；非法 timestamp 拒绝 |
| 3 | loopback advisory 不标 error | ✅ | `set_instance_advisory` 保持 configured；UI 映射 i18n hint |
| 4 | 15 locale 锁步 | ✅ | `wecomLoopbackAllowExternal` 15/15；zh「公网回调需开启 allow_external」 |
| 5 | 相对 home 深度 ≥2 | ✅ | Linux `/home/name/projects`、Windows `C:\Users\name\Documents` 拒绝；无 home 拒绝 |
| 6 | 主题快照 cap 400 | ✅ | `1 + listed > 400` 返回 null，跳过 getBoundingClientRect 扫描 |
| 7 | CHANGELOG 中英成对 | ✅ | Unreleased Fixed 各 4 条 |
| 8 | App.tsx / confirm/alert | ✅ | 未改 App.tsx |

无 blocker，该项可标完成。
