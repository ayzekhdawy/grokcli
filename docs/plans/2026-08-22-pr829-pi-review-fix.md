# PR #829 / Issue #828 — pi 审核补录记录

背景：分支 `codex/clippy-deny-all-legs` 清除 Linux(~18)/Windows(~31)/macOS(3) 三条 CI 腿的全部
cargo clippy 残余警告，并把 `.github/workflows/ci.yml` 的 clippy 从 `-W` 翻成 `-D warnings`。
本地与 PR #829 的 CI 四个 job 均已全绿。PR 已按 repo owner 指示先行转正；
当时 AGENTS.md §8 要求的强制 `pi -p` 审核因 pi 服务故障（503）未完成。该强制规则已废止，本项不再补录。

## 探测日志

- 2026-08-22 09:54 前后（主会话内）：连续 13+ 次 503，含最小连通性探测。
- 2026-08-22 10:35 pi 仍不可用

## 结论

强制 pi 审核规则已废止，不再补跑。
