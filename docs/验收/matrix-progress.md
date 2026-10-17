# P0 矩阵进度表（H 行对齐修订 · 2026-07-21）

ID 定义以 `docs/P0-能力矩阵.md` 为准。

## H 权限与控制条（对齐矩阵定义）

| ID | 能力（矩阵原文） | 状态 | 证据 |
|----|------------------|------|------|
| **H01** | 模型选择 | PARTIAL | 底栏 chip 显示模型；切换 UI 有，ACP set_config 未全接 |
| **H02** | Reasoning effort | PARTIAL | 底栏 effort 选择；不支持时未做静默失败探测 |
| **H03** | 权限审批默认 | PASS | 默认 Ask；`PermissionPolicy::default()` + chip 默认 ask |
| **H04** | Allow once | PASS | 权限条 + `pick_option_id(allow_once)` / UI map |
| **H05** | Allow for session | **PASS** | `may_auto_allow`: Ask + session cache + in-project → true；`resolve_permission` 写 cache；`ask_with_session_cache_auto_allows_in_project` / `h05_ask_plus_session_cache_auto_then_outside_blocked` |
| **H06** | Deny | PASS | 权限条 Deny + optionId reject_once |
| **H07** | 不默认 Always 全局 | PASS | 默认 Ask；Always 仅设置深层 + 二次确认 |

## 其它关键（摘要）

| ID | 状态 | 证据 |
|----|------|------|
| A01 | PASS | decorations:false |
| A04–A07 | PASS | 三栏/tokens/主题 |
| G01/G02 | PASS | 真 ACP 默认 + M01_OK 流 |
| G05 | PASS | session/cancel + stop |
| B01 | PASS | cli_probe |

## 截图

`docs/验收/02-workbench-structural.png` … `06-light-structural.png`（shipped CSS）。

## 未完成

H01/H02 全量 ACP 模型/effort 下发；E03–E06 shared；F 虚拟列表；Agent 侧 request_permission 触发（CLI 可能 always-approve）；Win 实测。
