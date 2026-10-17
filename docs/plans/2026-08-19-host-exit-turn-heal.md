# Host-exit turn heal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** After a host cold start, an abandoned mid-turn chat shows `turn_cancelled|host_exit` (never looks finished) and offers one-click continue; Windows/non-clean exits leave a local forensic trail.

**Architecture:** Persist `turn_lease.json` while a prompt is in flight. On boot and session open, heal dirty leases / half-finished agent trails with the existing `journal_turn_cancelled` chip. Continue is a new `session/prompt` (not permission-RPC resume). Separate `host_runtime.json` + Windows exception filter record why the process vanished.

**Tech Stack:** Rust Host (`session_manager`, `cli_sessions`, `logging`, `win_shell`), React chip UI (`EndOfTurnChip`), i18n catalogs, vitest + `cargo test`.

**Design:** [2026-08-19-host-exit-turn-heal-design.md](./2026-08-19-host-exit-turn-heal-design.md)

**Constraints:** No new `App.tsx` state. No Settings catalog entry. No `window.confirm`. All UI strings via `src/i18n/`. Do not implement agent/host process decoupling.

---

### Task 1: Turn-lease types + disk helper (failing tests first)

**Files:**
- Create: `src-tauri/src/turn_lease.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod turn_lease;`)
- Test: `src-tauri/src/turn_lease.rs` (`#[cfg(test)]`)

**Step 1: Write the failing tests**

In `turn_lease.rs` tests, cover:

```rust
#[test]
fn write_and_read_active_lease_roundtrip() { /* … */ }

#[test]
fn mark_interrupted_preserves_pending_tool() { /* … */ }

#[test]
fn clear_removes_file() { /* … */ }

#[test]
fn missing_file_is_none() { /* … */ }
```

Use `tempfile::tempdir` or a test-only root override (`TurnLeasePaths { root }`) so tests never touch real app data.

**Step 2: Run test to verify it fails**

Run: `cargo test -p grok-app --lib turn_lease -- --nocapture`  
(adjust package name if the crate is `grok_app` / `grok-app-lib` — use the same `-p` as existing `cargo test` in this repo.)

Expected: compile fail (`turn_lease` module missing) or FAIL on missing APIs.

**Step 3: Minimal implementation**

```rust
pub const SCHEMA: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LeaseStatus { Active, Interrupted }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingTool {
    pub tool_call_id: String,
    pub tool_name: String,
    pub title: String,
    pub command: String, // truncated to 2000 chars on write
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TurnLease {
    pub schema: u32,
    pub status: LeaseStatus,
    pub session_id: String,
    pub agent_session_id: Option<String>,
    pub turn_id: Option<String>,
    pub started_at: String,
    pub updated_at: String,
    pub phase: String, // "streaming" | "permission_prompt" | "tool_execution"
    pub permission_pending: bool,
    pub pending_tool: Option<PendingTool>,
}

pub fn lease_path(session_id: &str) -> PathBuf {
    crate::paths::session_dir(session_id).join("turn_lease.json")
}

pub fn write_lease(lease: &TurnLease) -> std::io::Result<()> { /* create_dir_all + atomic write */ }
pub fn read_lease(session_id: &str) -> Option<TurnLease> { /* missing/invalid → None */ }
pub fn clear_lease(session_id: &str) { let _ = fs::remove_file(lease_path(session_id)); }
pub fn mark_interrupted(session_id: &str) -> Option<TurnLease> { /* status=interrupted, keep pending */ }
pub fn list_active_lease_session_ids() -> Vec<String> { /* scan sessions/*/turn_lease.json */ }
```

Atomic write: write `turn_lease.json.tmp` then rename. IO errors: caller logs, never panic.

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```bash
git add src-tauri/src/turn_lease.rs src-tauri/src/lib.rs
git commit -m "feat: persist session turn lease on disk"
```

---

### Task 2: Detect abandoned agent trails (pure)

**Files:**
- Create: `src-tauri/src/turn_interrupt.rs`
- Modify: `src-tauri/src/lib.rs` (`mod turn_interrupt;`)
- Test: in `turn_interrupt.rs`

**Step 1: Failing tests using fixtures that match the 7a57a3d1 shape**

Do **not** check in the user zip. Inline tiny concatenated JSON (events are space-separated objects, not always newline-delimited — parser must handle both).

```rust
#[test]
fn permission_requested_without_resolve_is_abandoned() { /* 6 vs 5 */ }

#[test]
fn assistant_tool_calls_without_result_is_abandoned() { /* last assistant has tool_calls, no tool_result */ }

#[test]
fn turn_completed_is_not_abandoned() {}

#[test]
fn empty_dir_is_not_abandoned() {}
```

**Step 2: Run — expect FAIL**

**Step 3: Implement**

```rust
pub struct TrailVerdict {
    pub abandoned: bool,
    pub pending_tool: Option<PendingTool>,
}

pub fn inspect_agent_trail(agent_dir: &Path) -> TrailVerdict
```

Reuse `cli_sessions` JSON-object walk if one exists; otherwise a small `raw_decode` loop like the diagnostic parse. Count `permission_requested` / `permission_resolved` / `turn_completed`. Parse `chat_history` last assistant `tool_calls` vs following `tool_result` ids.

**Step 4: Tests PASS**

**Step 5: Commit** `feat: detect abandoned in-flight agent trails`

---

### Task 3: `heal_interrupted_turn` + `host_exit` reason

**Files:**
- Modify: `src-tauri/src/turn_interrupt.rs` (heal fn)
- Modify: `src-tauri/src/session_manager/stream.rs` (`normalize_hard_end_reason` — `host_exit` already passes the alphanumeric `_` arm; add an explicit match arm + unit test)
- Modify: `src-tauri/src/cli_sessions.rs` (`try_reconcile_linked_session` calls heal after reconcile)
- Modify: `src-tauri/src/session_manager/connect.rs` (after successful connect/load, heal the session)
- Hook cold-start scan: `logging::init` is too early (no sessions needed). Call `heal_all_active_leases()` from `SessionManager::new` or first `run()` after `ensure_app_dirs` — **not** from a UI module.

**Step 1: Failing tests**

```rust
#[test]
fn heal_writes_host_exit_and_marks_lease_interrupted() {}

#[test]
fn heal_skips_when_end_marker_already_present() {}

#[test]
fn heal_uses_lease_even_without_agent_dir() {}
```

Use a temp app-data root if `paths::session_dir` is hard to override. Prefer injecting a `HealFs` trait or `#[cfg(test)]` setter. If the repo already tests `store::append_message` with a temp data dir, copy that pattern (search `app_data_root` test overrides).

**Step 2: FAIL**

**Step 3: Implement `heal_interrupted_turn(session_id) -> bool`**

1. If `has_turn_end_marker_after_last_user` → false  
2. `abandoned = lease.status==Active || trail.abandoned`  
3. If not abandoned → false  
4. Append the same `ChatMessageStored` shape as `journal_hard_end_for_busy_agents` (`turn_cancelled|host_exit`, `marker: turn_cancelled`, `is_error: true`)  
5. If a LiveSession exists, also `emit session://turn_marker` (connect path). Boot scan: journal only is OK  
6. `mark_interrupted`; copy trail `pending_tool` onto lease if lease had none  
7. `tracing::warn!(target: "session", session=…, "healed interrupted turn after host exit")`

Call sites:

- After `try_reconcile_linked_session`  
- End of successful `connect` for that `app_session_id`  
- Once at process start: `for id in list_active_lease_session_ids() { heal_interrupted_turn(&id); }`

**Step 4: Tests PASS** + existing `normalize` test includes `host_exit`

**Step 5: Commit** `feat: heal abandoned turns as host_exit on open`

---

### Task 4: Write/clear lease on the live turn path

**Files:**
- Modify: `src-tauri/src/session_manager/turn.rs` (set `prompt_in_flight = true` → `write_lease` active)
- Modify: `src-tauri/src/session_manager/events.rs` + `events_bg.rs` (`PermissionRequest` → update lease; `ProcessExited` already journals `agent_exit` → `clear_lease`)
- Modify: `src-tauri/src/session_manager/stream.rs` (`journal_turn_cancelled` → `clear_lease` except when reason is `host_exit` — that path uses `mark_interrupted` instead)
- Clear on authoritative PromptComplete (same place `prompt_in_flight` becomes false)

**Step 1: Add a focused test if one can hook `LiveSession` without full ACP. If not, test the helper `lease_from_live(session, phase, pending)` and call it from those sites.**

**Step 2–4: Implement, `cargo test` the new + hard_end tests.**

Do **not** write the lease on every stream token.

**Step 5: Commit** `feat: keep turn lease in sync with prompt and permissions`

---

### Task 5: i18n + EndOfTurn reason mapping

**Files:**
- Modify: `src/lib/endOfTurn.ts` (`host_exit` → `endOfTurn.hostExit`, tone warning)
- Modify: `src/lib/endOfTurn.test.ts` (or create if missing — search first)
- Modify: `src/i18n/messages/en/core.ts`
- Modify: `src/i18n/messages/zh/core.ts`
- Modify: `src/i18n/messages/zh-TW/core.ts`
- Optional: `src/i18n/messages/ru/session.ts` or `ru/extra.ts` override
- Modify: `src/components/lobe-chat/EndOfTurnChip.tsx` (treat `host_exit` like other warning reasons — icon already uses `IconAlertTriangle` for listed reasons; add `host_exit` to that list)

Keys:

| key | en | zh |
|-----|----|----|
| `endOfTurn.hostExit` | App restarted — this turn did not finish | 应用重启，这一轮没做完 |
| `endOfTurn.continue` | Continue | 继续 |
| `endOfTurn.continuePrompt` | Continue the interrupted task | 继续上次中断的任务 |

**Step 1: Failing vitest** for `mapEndOfTurnReason("host_exit")` and `parseEndOfTurnContent("turn_cancelled|host_exit")`.

**Step 2:** `npx vitest run src/lib/endOfTurn.ts src/lib/endOfTurn.test.ts` (adjust path) — FAIL

**Step 3: Implement mapping + catalogs. `messages.test.ts` key parity must stay green.**

**Step 4:** `npx vitest run src/i18n src/lib/endOfTurn` — PASS

**Step 5: Commit** `feat: i18n host_exit end-of-turn chip`

---

### Task 6: Continue prompt helper + chip button

**Files:**
- Create: `src/lib/continueInterruptedTurn.ts`
- Create: `src/lib/continueInterruptedTurn.test.ts`
- Modify: `src/components/lobe-chat/EndOfTurnChip.tsx`
- Modify: `src/components/lobe-chat/ConversationThread.tsx` (pass `onContinueInterrupted?`)
- Modify: `src/app/AppWorkbench.tsx` **only** to pass `onContinueInterrupted` into `ConversationThreadLive` — no new `useState`. Reuse `executeSend`.
- Host: add `session_interrupt_resume_context(session_id) -> { command, title, toolName }` reading interrupted lease (invoke from FE) **or** include pending command in the chip payload. Prefer a small invoke `session_interrupt_context` so the renderer does not read app_data.

**Continue send contract:**

```ts
await executeSend({
  text: tr("endOfTurn.continuePrompt"), // journal + composer
  // If executeSend already splits agent vs journal, pass:
  agentText: buildContinueAgentPrompt(ctx),
  journalDisplay: tr("endOfTurn.continuePrompt"),
});
```

Inspect `executeSend` opts in `AppWorkbench.tsx` (~8062). Match existing fields; do not invent a second send pipeline.

`buildContinueAgentPrompt`:

- Locale-neutral agent English is OK for the model body; user-visible journal is i18n.
- Include pending command in a fenced block when present.
- Instruct: do not redo successful steps; continue the user's last request from the interrupted tool.

Chip: button only when `reason` is `host_exit` or `agent_exit` and `onContinue` is provided. Existing `.lobe-end-turn` styles — text button, no native `<button>` unstyled dump; reuse transcript chip / link button classes already used in the thread. No modal.

**Step 1: Failing tests** for prompt builder (command present / absent).

**Step 2–4: Implement UI + wiring. `npx vitest run src/lib/continueInterruptedTurn.test.ts src/lib/endOfTurn`**

**Step 5: Commit** `feat: continue interrupted turn from end-of-turn chip`

---

### Task 7: Host runtime heartbeat + unclean-restart log

**Files:**
- Create: `src-tauri/src/host_runtime.rs`
- Modify: `src-tauri/src/lib.rs` (`mod host_runtime`; after `logging::init()` call `host_runtime::on_process_start()`)
- Modify: `src-tauri/src/lib.rs` `RunEvent::Exit` arm: `host_runtime::on_process_shutdown()`
- Modify: `src-tauri/src/session_manager/watchdog.rs` (or existing 25s heartbeat): `host_runtime::touch_heartbeat()`
- Test: in `host_runtime.rs`

**Step 1: Failing tests** with temp dir override:

```rust
#[test]
fn previous_shutdown_false_records_unclean() {}

#[test]
fn previous_shutdown_true_is_clean() {}

#[test]
fn missing_file_is_clean() {}
```

**Step 2: FAIL**

**Step 3: Implement** `logs/host_runtime.json` + append-only `logs/unclean-restart.log` (one line JSON: old pid, startedAt, heartbeatAt, dirtyLeaseSessionIds). Then write a fresh runtime file `shutdown: false`. `on_process_shutdown` sets `shutdown: true`.

**Step 4: PASS**

**Step 5: Commit** `feat: record unclean host restarts`

---

### Task 8: Windows last-crash file

**Files:**
- Create: `src-tauri/src/win_crash.rs` (`#![cfg(windows)]`)
- Modify: `src-tauri/src/lib.rs` after AUMID: `win_crash::install()`
- Test: keep filter logic tiny; test the **formatter** on all OS:

```rust
pub fn format_last_crash_line(code: u32, address: u64, pid: u32) -> String
```

**Step 1: Failing test** for formatter.

**Step 2–3:** On Windows, `SetUnhandledExceptionFilter` writes `logs/last_crash.txt` (overwrite) with that line + timestamp, `flush`, then return `EXCEPTION_CONTINUE_SEARCH`. No heap-heavy work. No minidump.

If Tauri `RunEvent` has a webview-crash variant in this crate's Tauri version, append one line; otherwise skip.

**Step 4: `cargo test` formatter. `cargo check --target` Windows only if the agent host is macOS — at least `#[cfg(windows)]` must compile in CI if Windows CI exists; check `docs/BUILD.md` / existing cfg tests.**

**Step 5: Commit** `feat: write Windows last_crash.txt on native exceptions`

---

### Task 9: Diagnostic bundle + wiki + CHANGELOG

**Files:**
- Modify: `src-tauri/src/support_bundle.rs` — include `host/turn_lease.json`, `logs/host_runtime.json`, `logs/unclean-restart.log`, `logs/last_crash.txt` if present (panic.log / daily app.log already in `logs/`)
- Modify: `docs/llm-wiki/session-continuity.md` — new subsection: host-process death heals as `host_exit`; continue is a new prompt; in-flight permission is not resumed
- Modify: `CHANGELOG.md` under Unreleased / next version (follow existing heading style)

**Step 1:** If support_bundle has tests, add one that a fake lease file appears in the zip list. Else a small unit that `bundle_extra_paths()` returns the expected relative names.

**Step 2–4: Implement + test.**

**Step 5: Commit** `docs: host_exit heal in continuity wiki and changelog`

---

### Task 10: Full verification

**Step 1:**

```bash
npx tsc -b
npx eslint src --max-warnings 0
npx vitest run src/lib/endOfTurn src/lib/continueInterruptedTurn src/i18n
cargo test -p <crate> turn_lease turn_interrupt host_runtime -- --nocapture
```

Use the repo's actual crate name (see `src-tauri/Cargo.toml`).

**Step 2:** Mentally replay `7a57a3d1`: lease active + permission 6/5 + last assistant tool_call without result → `host_exit` chip + Continue. No second chip if heal runs twice.

**Step 3:** Browser/Tauri UI: if a packaged app is available, start a turn, kill the process, reopen — chip + continue. If not, say so and rely on unit tests + a manual Host-only replay script is **not** required.

**Step 4:** Final commit only if verification forced drive-by fixes.

---

## Out of scope (do not do in this plan)

- Sidecar / detached grok agent
- Auto-send continue
- Changing `permissionPolicy` / yolo
- New Settings toggle
- Full crash minidumps
- Editing `App.tsx` feature blocks
