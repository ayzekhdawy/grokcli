# Session API 派活卡死排查与修复方案（2026-08-20）

外部报告：用户（Windows，最新版）用 Codex/CC 通过 local session API（`--session-send` / `POST /v1/sessions/{id}/turns`）给 Grok App 派活，**第一轮能跑通，干完一轮之后接口就死**；探活 `/v1/health` 与派活都超时；`grok-app.exe` 干活子进程堆积（两个同时挂着、CPU 近零）；对方日志里 **「idle recycle skipped: connect_lock busy」每 5 秒重复一次，持续五分多钟**。

排查素材：`/Users/ronglecat/Downloads/0820 问题排查/`（4 张 Codex 会话截图）。

## 一、症状 ↔ 代码对照

| 截图症状 | 代码位置 | 结论 |
|---|---|---|
| 「锁还被占着」每 5s 一条、持续 5 分钟+ | `process.rs::tick_idle_recycle` → `try_lock_connect(5s)` 失败即 warn `idle recycle skipped: connect_lock busy`（`CONNECT_LOCK_WATCHDOG_SECS=5`） | `connect_lock` 被某个 holder **长期占住不放** |
| 干完一轮后再派就死 | `session_api.rs::dispatch_turn` 每次派活都走 `mgr.connect(...)`（轮次结束后会话已 parked/background，需要重新 connect/promote） | 第二轮触发 connect，一旦 connect 卡住锁，之后所有派活全部排队等锁 |
| 派活超时 | `connect.rs::connect` 外层 90s wall-clock 超时**只放弃等待，不 `abort()` 被 spawn 的任务**（79–114 行）；该任务持有 `connect_lock` 直到 `connect_inner` 返回 | 若 `connect_inner` 里某个 await 永不返回，锁被**永久占用**；后续每个 `send_message` / `connect` 先等 90s 锁再失败（`POST /turns` 最坏 connect 90s + send 90s ≈ **180s**） |
| 探活 `/v1/health` 超时 | `get_health`（session_api.rs 800–804）只做 token 校验，**不碰 connect_lock**；axum server 独立 spawn | **不能用锁解释，待确认**。两种可能：① 探活客户端自身超时（CLI 侧 8s）导致误判；② wedged 握手在 async 上下文做了阻塞 IO 卡死 tokio worker（runtime 级问题，属另一根因）。刀 1 验收必须加「wedged 期间 health <1s 响应」断言把两者钉死 |
| 僵死 grok.exe 堆积（2 个，CPU≈0） | 每次重试派活 → 再次 cold spawn 子进程；上一个 wedged child 未必被清掉（`fail_stale_connecting` 只在 FSM 还处于 Connecting 且 acp 已绑到 slot 时才 kill，且用的是**无界** `acp.kill().await`） | 卡死的握手每重试一次可能多留一个僵尸 worker |
| 清掉多余 worker 后探活恢复 200，但 CLI 仍说 `app_not_running` | `session_api.rs::http_client` 超时 **8s**；而服务端 `POST /turns` 合法路径可以阻塞到 ~90s（connect wall-clock）。CLI 把**任何** HTTP 错误（含超时）都映射成 `AppNotRunning`（975–986 行） | CLI 「撒谎」实锤：**timeout ≠ app 没在跑**，但报文说的就是 app_not_running |

### 根因链（一句话）

**第二轮派活触发的 `connect_inner` 在 `connect_lock` 内出现无界 await（wedged 子进程握手 / 无界 `acp.kill()`），90s 超时只放弃 join 不 abort 任务，锁被永久占用 → 之后所有 connect/send 全部 90s 等锁失败，watchdog 每 5s 报 busy，重试还不断堆僵尸子进程；CLI 又把服务端慢/超时一律误报为 `app_not_running`。**

用户环境的诱因是 Windows 上 Grok App 未继承系统代理 → 子进程连不上上游，握手 wedge。这是**诱发条件**不是根因：任何一次子进程 wedge（网络、杀软拦 IO、CLI 自身 bug）都会把整个 Host 的会话通道锁死，这才是要修的。

### 已知放大器（次级问题）

1. `connect_lock` 临界区内的**无界** `acp.kill().await` / `client.kill().await`：`fail_stale_connecting`（connect.rs 156–158）、`stale_prewarm` 清理（connect.rs 758–760）、以及 connect_inner 内 **301 / 322 / 400 / 493 / 870** 五处（pending-fork 清理、unpark 冷启、leftover 清理、warm-reuse open 失败回退）。`ACP_KILL_TIMEOUT_SECS` 与 `kill_acp_bounded`（process.rs 961–968）已存在但这些点没用上；Windows 上 kill 僵死管道子进程本身就可能挂。`control.rs` 另有 11 处 `acp.kill().await` 需一并审计是否在锁内。（`free_parked_for_capacity` 已是 bounded，无需改。）
2. `queued`（HTTP 202）路径完全依赖**主窗口 webview** 的 `useSendQueue`（`src/app/AppWorkbench.tsx` `acceptExternal: !isSecondaryWindow`）消费 `session://send_queue` 事件。托盘常驻但主窗口没开 / webview 睡着时，外部 prompt **静默丢失**，外部调用方拿到 202 却永远等不到执行。
3. `routing_tests_p2.rs:442`（`diagnostic_runtime_reports_lock_busy_instead_of_hanging`）已有「锁 busy 时出占位符不挂死」的测试思路（注意它锁的是 `inner` 会话状态锁，不是 `connect_lock`），connect/send 主路径没有等价保护。

## 二、修复方案（按刀拆，每刀独立可验收）

### 刀 1（P0）：wall-clock 超时必须真正放锁

`connect.rs::connect`：

- 外层 90s 超时分支里 **`join.abort()`**，不再让 sibling 任务无限持锁。tokio `Mutex` guard 在任务 abort 时随栈 drop，锁即释放。
- 前提：审计 `connect_inner` 的 **abort 安全性**——中途 abort 不能留下半初始化的 live slot / 未 kill 的 child。做法：`connect_inner` 内 spawn 出的 child 在绑定进 slot 之前登记到一个 `pending_children`（或 scopeguard），abort 后由超时分支统一 `kill_acp_bounded` 清扫。注意 abort 在任意 await 点生效，mid-spawn 的 child 只有登记表能兜住（清扫与 abort 的竞态要有测试）。
- `fail_stale_connecting` 里 `acp.kill().await` → `kill_acp_bounded`。

验收：mock 一个永不回包的 ACP child（stall_tests 风格），触发 connect → 90s 超时后：锁可立即被下一个 `try_lock_connect(0)` 拿到；无残留 child 进程；**wedged 全程 `/v1/health` 保持 <1s 响应**（钉死「探活超时」到底是客户端误判还是 runtime 级阻塞——若此断言失败，说明还存在 async 上下文里的阻塞 IO，需单独开刀）。

### 刀 2（P0）：`connect_lock` 临界区内消灭无界 await

- lock 临界区内所有无界 kill 统一换 `kill_acp_bounded`：connect.rs 156–158、758–760、301、322、400、493、870；`control.rs` 的 11 处（83/138/154/271/571/779/1134/1140/1204/1209/1214）逐一判定是否在锁内后处理。connect.rs 1314/1453 两处 prewarm 路径 kill 不持 connect_lock（prewarm_inner 明确 no connect_lock），可不改但要在 rg 全扫时确认。
- `open_session_at` / `initialize_and_open_session` 保持「先绑 acp 再握手」（已有），但给握手 RPC 补**单独的硬上界**（如 60s，小于 wall-clock），超时即视为 connect 失败并 bounded-kill，不依赖外层 abort 兜底。

验收：`rg '\.kill\(\)\.await' src-tauri/src/`（覆盖 `acp.kill` 与 `client.kill` 等别名，connect.rs 1123/1402/1429 也要查）在 lock 临界区内为 0；新增单测覆盖握手超时路径。

### 刀 3（P0）：session API 快速失败，不再让 HTTP/CLI 挂死

- `session_api.rs::handle_turn`：给 `dispatch_turn` 包 **15s 超时**。超时回 `503` + 新 status（建议复用 `error`，message 明确 `host busy: connect in progress, retry later`；或加 `retry_later`），**绝不让请求挂到最坏 ~180s**（connect 等锁 90s + send 再等锁 90s）。注意：drop 掉 `dispatch_turn` 的 future **不会** abort 已 spawn 的 connect 任务——刀 3 只保证 15s 内回包，**放锁靠刀 1**（锁恢复时间在刀 1 落地后仍是 ≤90s 量级，不是立即）。
- CLI：区分「连不上端口」（→ `app_not_running`，exit 2）与「HTTP 超时/5xx」（→ `error` + 原始信息，exit 1）。8s 客户端超时可保留，但报文不许再写 "Grok App is not running"。
- `/v1/health` 加只读诊断字段：`connectLockBusy: bool`（`try_lock_connect(Duration::ZERO)` 探测），外部调用方能区分「app 活着但通道卡死」。

验收：人为持锁时，`POST /turns` ≤15s 返回明确错误；CLI 输出不再出现误导性的 app_not_running；health 显示 lockBusy=true。

### 刀 4（P1）：`queued` 不再依赖主窗口 webview

- 最小修：`enqueue_while_busy` 前检查主窗口 webview 是否存在且活跃；不满足则不回 202，回 `error`（message：`no active window to drain the queue`），调用方可自行重试。
- 正解（session-api.md「后续」提前做一半）：外部 queued 项**落盘**（Host 端持久队列），轮次结束事件（turn end）由 Host 直接 drain 重新走 `dispatch_turn`，webview 只做展示。GUI 队列条继续吃 `session://send_queue` 事件不变。

验收：托盘无窗口状态下派活到 busy 会话 → 要么明确报错、要么落盘并在本轮结束后自动补发；重启 App 后落盘队列不丢。

### 刀 5（P1）：僵尸 worker 抑制与观测

- `connect_inner` 开头已有 `sweep_dead_parked()`（调用在 connect.rs:173，定义在 process.rs:218），刀 5 只做增量：对**上一次 connect 失败遗留**的同会话 child 按 process_id 登记并 bounded kill（与刀 1 的 `pending_children` 登记表共用）。
- `connect_lock busy` 连续 N 次（如 12 次 ≈ 1 分钟）升级为 `error!` 并附**持锁者上下文**：在拿锁处记录 `holder: {session_id, phase, since}` 到一个 `AtomicPtr`/`Mutex<Option<HolderInfo>>`，watchdog 打出来。日志直接指认凶手，不用再靠外部翻进程树。

验收：日志里出现 `connect_lock held by session=… phase=open_session since=…s`；连发 3 轮派活不再累积 >1 个空闲 worker。

### 刀 6（P2）：文档与用户侧缓解

- `docs/llm-wiki/session-api.md`：补「故障排查」小节——`app_not_running` 的真实含义、health 的 lockBusy 字段、Windows 代理继承说明（App 启动时读系统代理，子进程继承 App 环境；命令行派活的 CLI 自身不读系统代理设置）。
- `CHANGELOG.md` Unreleased 记 fix 条目。

## 三、给用户的临时缓解（改版发布前）

1. Windows 上把代理设为**系统级/用户级环境变量**（`HTTPS_PROXY`/`HTTP_PROXY`），设完**彻底退出再启动** Grok App（托盘右键退出，不是关窗口），保证子进程能连上游——消除最主要的 wedge 诱因。
2. 派活侧串行发送：上一轮拿到 `turn_started` 且轮次结束后再发下一条；收到超时不要立刻重试轰炸（每次重试可能多一个僵尸 worker）。
3. 卡死后：结束多余的 `grok.exe` 干活子进程可让探活恢复，但会话通道（connect_lock）不会自愈，**需重启 Grok App**。（刀 1 落地后此症状放宽为「最长 ~90s 自动恢复」，仍非立即。）

## 四、验证与回归

- 新增 `session_manager` 单测：wedged 握手 + wall-clock → 锁释放、child 清理（复用 `stall_tests.rs` / `routing_tests_p2.rs` 的 mock 手法）。
- `session_api` 单测：dispatch 超时 → 15s 内 503；CLI timeout 分类。
- 手测脚本（Windows 优先）：断网/坏代理下连发 3 轮 `--session-send`，观察日志、worker 数、health.lockBusy。
