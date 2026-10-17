## 结论：**通过（无 blocker）**

审查对象：Windows CI `cargo clippy -D warnings` 因 `PtySession.pid` 未读而失败。`pi -p`，工具仅 `read`/`bash`。

### 核对表

| 检查项 | 结果 | 证据 |
|---|---|---|
| 字段 Unix-only | ✅ | `pty_host.rs` `#[cfg(unix)] pid` |
| spawn 赋值同步 cfg | ✅ | `let pid` + 结构体字面量均 `#[cfg(unix)]` |
| Unix SIGKILL 路径保留 | ✅ | `libc::kill` 进程组 + pid |
| Windows 仍走 ChildKiller | ✅ | `sess.killer.kill()` 在 cfg 外 |
| CHANGELOG 中英成对 | ✅ | Fixed / 中文 · 修复 |
| 未改 App.tsx / AppWorkbench | ✅ | diff 仅 pty_host + CHANGELOG |

无 blocker。Windows 孙进程清理是既有行为，非本改动引入。
