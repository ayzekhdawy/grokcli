# Agent-Side Session Fork Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move “Fork from here” onto completed assistant bubbles, cut the new chat at the containing user turn, and trim the child agent (`session/fork` then rewind) so its memory matches the truncated journal.

**Architecture:** Host `session_fork` still truncates via `through_user_prompt_index`. Partial forks that copy an agent id also store one-shot `forkRewindPromptIndex`. First connect of the child ACP-forks the parent, immediately rewinds **the child** (`restoreFiles=false`), and on rewind/fork failure falls back to `session/new` + journal bootstrap. Parent is never rewound. UI derives the prompt index from the assistant message; the partial-fork dialog hides the CLI checkbox and auto-arms agent fork when a source id exists.

**Tech Stack:** TypeScript/React (Vitest), Rust Tauri Host (`store` + `session_manager::connect`), ACP `session/fork` + `x.ai/rewind/execute`, i18n catalogs (`en` authority).

**Design:** `docs/plans/2026-08-20-agent-side-session-fork-design.md`

**Constraints:** No new `useState` in `App.tsx`. No `window.confirm`. All new copy via `createT` / `t()`, 15 locales lockstep with `en`. Do not mix this work into `fix/windows-end-of-turn-freeze-754` — branch from `main`.

---

### Task 1: `userPromptIndexContaining` + assistant-fork predicate

**Files:**
- Modify: `src/lib/session.ts` (after `userPromptIndexOf`)
- Modify: `src/lib/session.test.ts`
- Modify: `src/lib/sessionFork.ts`
- Modify: `src/lib/sessionFork.test.ts`

**Step 1: Write the failing tests**

In `src/lib/session.test.ts`, next to the existing rewind tests:

```ts
it("userPromptIndexContaining maps assistant/tool to the parent user turn", () => {
  const msgs: ChatMessage[] = [
    { id: "u1", role: "user", content: "first" },
    { id: "a1", role: "assistant", content: "ok" },
    { id: "t1", role: "tool", content: "ran" },
    { id: "u2", role: "user", content: "second" },
    { id: "a2", role: "assistant", content: "later" },
    {
      id: "i1",
      role: "user",
      content: "steer",
      marker: "interjection",
    },
  ];
  expect(userPromptIndexContaining(msgs, "a1")).toBe(0);
  expect(userPromptIndexContaining(msgs, "t1")).toBe(0);
  expect(userPromptIndexContaining(msgs, "u1")).toBe(0);
  expect(userPromptIndexContaining(msgs, "a2")).toBe(1);
  expect(userPromptIndexContaining(msgs, "i1")).toBe(1);
  expect(userPromptIndexContaining(msgs, "missing")).toBe(-1);
  expect(userPromptIndexContaining([{ id: "a0", role: "assistant", content: "x" }], "a0")).toBe(-1);
});
```

Add the import. In `src/lib/sessionFork.test.ts`:

```ts
it("shouldOfferAssistantFork is idle completed assistant with a parent prompt", () => {
  expect(
    shouldOfferAssistantFork({
      streaming: false,
      turnLive: false,
      canRewindSession: true,
      parentPromptIndex: 0,
    }),
  ).toBe(true);
  expect(
    shouldOfferAssistantFork({
      streaming: true,
      turnLive: false,
      canRewindSession: true,
      parentPromptIndex: 0,
    }),
  ).toBe(false);
  expect(
    shouldOfferAssistantFork({
      streaming: false,
      turnLive: true,
      canRewindSession: true,
      parentPromptIndex: 0,
    }),
  ).toBe(false);
  expect(
    shouldOfferAssistantFork({
      streaming: false,
      turnLive: false,
      canRewindSession: false,
      parentPromptIndex: 0,
    }),
  ).toBe(false);
  expect(
    shouldOfferAssistantFork({
      streaming: false,
      turnLive: false,
      canRewindSession: true,
      parentPromptIndex: -1,
    }),
  ).toBe(false);
});

it("partial fork hides CLI checkbox and auto-arms when an agent id exists", () => {
  expect(shouldShowForkCliCheckbox(0)).toBe(false);
  expect(shouldShowForkCliCheckbox(null)).toBe(true);
  expect(
    resolveForkCliOnConfirm({
      throughUserPromptIndex: 0,
      checkboxChecked: false,
      agentSessionId: "agent-1",
    }),
  ).toBe(true);
  expect(
    resolveForkCliOnConfirm({
      throughUserPromptIndex: 0,
      checkboxChecked: true,
      agentSessionId: null,
    }),
  ).toBe(false);
  expect(
    resolveForkCliOnConfirm({
      throughUserPromptIndex: null,
      checkboxChecked: true,
      agentSessionId: "agent-1",
    }),
  ).toBe(true);
  expect(
    resolveForkCliOnConfirm({
      throughUserPromptIndex: null,
      checkboxChecked: false,
      agentSessionId: "agent-1",
    }),
  ).toBe(false);
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/lib/session.test.ts src/lib/sessionFork.test.ts`

Expected: FAIL — `userPromptIndexContaining` / `shouldOfferAssistantFork` / `shouldShowForkCliCheckbox` / `resolveForkCliOnConfirm` are not defined.

**Step 3: Minimal implementation**

`src/lib/session.ts` after `userPromptIndexOf`:

```ts
/**
 * 0-based user-prompt index of the turn that contains `messageId`, or -1.
 * Prompt rows map to themselves; assistant/tool/interjection map to the
 * nearest preceding real user prompt (`isTurnPromptMessage`).
 */
export function userPromptIndexContaining(
  messages: ChatMessage[],
  messageId: string,
): number {
  let lastPrompt = -1;
  let idx = -1;
  for (const m of messages) {
    if (isTurnPromptMessage(m)) {
      idx += 1;
      lastPrompt = idx;
    }
    if (m.id === messageId) return lastPrompt;
  }
  return -1;
}
```

`src/lib/sessionFork.ts`:

```ts
export function shouldOfferAssistantFork(input: {
  streaming?: boolean | null;
  turnLive?: boolean | null;
  canRewindSession?: boolean | null;
  parentPromptIndex: number;
}): boolean {
  return (
    !input.streaming &&
    !input.turnLive &&
    !!input.canRewindSession &&
    input.parentPromptIndex >= 0
  );
}

/** CLI `--fork-session` checkbox is only for full (uncut) forks. */
export function shouldShowForkCliCheckbox(
  throughUserPromptIndex: number | null | undefined,
): boolean {
  return throughUserPromptIndex == null;
}

/**
 * Effective CLI-fork flag for `session_fork`.
 * Partial forks auto-arm when a source agent id exists (no checkbox).
 */
export function resolveForkCliOnConfirm(input: {
  throughUserPromptIndex?: number | null;
  checkboxChecked?: boolean | null;
  agentSessionId?: string | null;
}): boolean {
  if (!canOfferForkAgentSession(input.agentSessionId)) return false;
  if (input.throughUserPromptIndex != null) return true;
  return !!input.checkboxChecked;
}
```

**Step 4: Re-run tests**

Run: `pnpm exec vitest run src/lib/session.test.ts src/lib/sessionFork.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/session.ts src/lib/session.test.ts src/lib/sessionFork.ts src/lib/sessionFork.test.ts
git commit -m "feat(session): map assistant messages to the parent fork turn"
```

---

### Task 2: Host `forkRewindPromptIndex` on partial fork

**Files:**
- Modify: `src-tauri/src/store.rs` (`SessionMeta`, `create_session`, `fork_session`, `sample_session`, `clear_session_fork_agent_session`)
- Modify every other `SessionMeta {` literal that currently sets `fork_agent_session`:
  - `src-tauri/src/session_manager/routing_tests.rs`
  - `src-tauri/src/session_manager/routing_tests_p2.rs`
  - `src-tauri/src/session_manager/stall_tests.rs`
  - `src-tauri/src/session_manager/connect.rs` (test fixture ~1849)
  - `src-tauri/src/remote_im/app_sessions.rs`

**Step 1: Write the failing store test**

In `src-tauri/src/store.rs` `mod tests`, next to `create_session_defaults_to_orphan`, using the same `APP_HOME_ENV_LOCK` + temp `GROK_APP_HOME` pattern:

```rust
#[test]
fn fork_session_partial_stores_rewind_index() {
    let _g = crate::paths::APP_HOME_ENV_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let tmp = std::env::temp_dir().join(format!(
        "grok-app-fork-rewind-{}-{}",
        std::process::id(),
        Uuid::new_v4()
    ));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).expect("tmp home");
    std::env::set_var("GROK_APP_HOME", &tmp);
    let _ = ensure_app_dirs();

    let src = create_session(None, Some("src".into()), false).expect("create");
    let mut src = src;
    src.agent_session_id = Some("agent-parent".into());
    update_session_meta(&src).expect("meta");
    save_messages(
        &src.id,
        &[
            ChatMessageStored {
                id: "u1".into(),
                role: "user".into(),
                content: "first".into(),
                created_at: Utc::now(),
                ..Default::default()
            },
            ChatMessageStored {
                id: "a1".into(),
                role: "assistant".into(),
                content: "ok".into(),
                created_at: Utc::now(),
                ..Default::default()
            },
            ChatMessageStored {
                id: "u2".into(),
                role: "user".into(),
                content: "second".into(),
                created_at: Utc::now(),
                ..Default::default()
            },
        ],
    )
    .expect("msgs");

    let partial = fork_session(&src.id, Some(0), None, true).expect("partial");
    assert_eq!(partial.agent_session_id.as_deref(), Some("agent-parent"));
    assert!(partial.fork_agent_session);
    assert_eq!(partial.fork_rewind_prompt_index, Some(0));
    let kept = load_messages(&partial.id);
    assert_eq!(kept.len(), 2, "through first turn only");
    assert!(kept.iter().all(|m| m.content != "second"));

    let full = fork_session(&src.id, None, None, true).expect("full");
    assert!(full.fork_agent_session);
    assert_eq!(full.fork_rewind_prompt_index, None);
    assert_eq!(load_messages(&full.id).len(), 3);

    let journal_only = fork_session(&src.id, Some(0), None, false).expect("journal");
    assert!(!journal_only.fork_agent_session);
    assert_eq!(journal_only.fork_rewind_prompt_index, None);
    assert!(journal_only.agent_session_id.is_none());

    std::env::remove_var("GROK_APP_HOME");
    let _ = fs::remove_dir_all(&tmp);
}
```

If `ChatMessageStored` has no `Default`, construct required fields the same way other store tests do (grep `ChatMessageStored {` in `store.rs` tests). Do **not** invent fields.

Also add a tiny unit test for oneshot clear:

```rust
#[test]
fn clear_fork_oneshots_clears_rewind_index() {
    // same temp-home setup
    // set fork_agent_session + fork_rewind_prompt_index on a row
    // clear_session_fork_agent_session(&id)
    // assert both false / None
}
```

**Step 2: Run the test — expect compile/fail**

Run: `cd src-tauri && cargo test fork_session_partial_stores_rewind_index -- --nocapture`

Expected: FAIL compile (`fork_rewind_prompt_index` missing).

**Step 3: Implement**

On `SessionMeta` after `fork_agent_session`:

```rust
/// One-shot: after ACP session/fork, rewind the CHILD to this 0-based
/// user prompt index (`restoreFiles=false`). Partial forks only.
/// Cleared after the connect attempt.
#[serde(default, skip_serializing_if = "Option::is_none")]
pub fork_rewind_prompt_index: Option<u32>,
```

`create_session` / every `SessionMeta {` literal: add `fork_rewind_prompt_index: None`.

In `fork_session`, when copying the agent id:

```rust
if fork_agent_session {
    if let Some(aid) = source_agent {
        meta.agent_session_id = Some(aid);
        meta.fork_agent_session = true;
        meta.fork_rewind_prompt_index = through_user_prompt_index;
    }
}
```

(`through_user_prompt_index` is already `Option<u32>` — full fork passes `None`.)

Extend `set_session_fork_agent_session` so disabling also clears rewind:

```rust
s.fork_agent_session = fork_agent_session && has_agent;
if !s.fork_agent_session {
    s.fork_rewind_prompt_index = None;
}
```

When enabling via this setter (resume UI), leave rewind index as-is (full fork / resume has no cut).

**Step 4: Re-run**

Run: `cd src-tauri && cargo test fork_session_partial_stores_rewind_index clear_fork_oneshots -- --nocapture`

Also: `cd src-tauri && cargo test --lib` enough to catch missing struct fields.

Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/store.rs src-tauri/src/session_manager/routing_tests.rs \
  src-tauri/src/session_manager/routing_tests_p2.rs \
  src-tauri/src/session_manager/stall_tests.rs \
  src-tauri/src/session_manager/connect.rs \
  src-tauri/src/remote_im/app_sessions.rs
git commit -m "feat(session): persist child rewind index on partial forks"
```

---

### Task 3: Pure connect trim plan + rewind-fail fallback helper

**Files:**
- Create: `src-tauri/src/session_manager/fork_trim.rs` (or add to an existing small module if one already owns fork connect — prefer a new file to keep `connect.rs` from growing more policy)
- Modify: `src-tauri/src/session_manager/mod.rs` (`mod fork_trim`)

**Step 1: Failing tests in `fork_trim.rs`**

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChildTrimPlan {
    /// Full fork or journal-only: nothing to rewind.
    Skip,
    /// session/fork returned resumed=true and a cut index is armed.
    RewindChild { prompt_index: u32 },
    /// Fork fell through to session/new; journal already truncated → bootstrap.
    Bootstrap,
}

pub fn child_trim_plan(
    rewind_index: Option<u32>,
    open_resumed: bool,
) -> ChildTrimPlan {
    match rewind_index {
        Some(prompt_index) if open_resumed => ChildTrimPlan::RewindChild { prompt_index },
        Some(_) => ChildTrimPlan::Bootstrap,
        None => ChildTrimPlan::Skip,
    }
}

/// After a failed child rewind, do not keep the untrimmed forked agent id.
pub fn child_trim_after_rewind_error(rewind_ok: bool) -> ChildTrimPlan {
    if rewind_ok {
        ChildTrimPlan::Skip
    } else {
        ChildTrimPlan::Bootstrap
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trim_plan_rewinds_only_resumed_partial() {
        assert_eq!(
            child_trim_plan(Some(2), true),
            ChildTrimPlan::RewindChild { prompt_index: 2 }
        );
        assert_eq!(child_trim_plan(Some(2), false), ChildTrimPlan::Bootstrap);
        assert_eq!(child_trim_plan(None, true), ChildTrimPlan::Skip);
        assert_eq!(child_trim_plan(None, false), ChildTrimPlan::Skip);
    }

    #[test]
    fn rewind_error_forces_bootstrap() {
        assert_eq!(child_trim_after_rewind_error(true), ChildTrimPlan::Skip);
        assert_eq!(
            child_trim_after_rewind_error(false),
            ChildTrimPlan::Bootstrap
        );
    }
}
```

Write the test file first with `todo!()` in the functions if you want a red run; or put tests + unimplemented fn.

**Step 2: Run**

`cd src-tauri && cargo test child_trim -- --nocapture`

Expected: FAIL until implemented (or PASS if you landed the functions in the same edit — still run).

**Step 3: Implement the two functions as above. No I/O.**

**Step 4: Re-run — PASS**

**Step 5: Commit**

```bash
git add src-tauri/src/session_manager/fork_trim.rs src-tauri/src/session_manager/mod.rs
git commit -m "feat(session): plan child rewind vs bootstrap after fork"
```

---

### Task 4: Wire trim into `session_connect`

**Files:**
- Modify: `src-tauri/src/session_manager/connect.rs`
- Modify: `src-tauri/src/acp_client.rs` only if you need `open_session_at(None, false)` already exists (it does)

**Behavior (after `initialize_and_open_session` returns Ok, before or just after live meta bind):**

1. Read `rewind_index = meta.fork_rewind_prompt_index` **before** clearing oneshots.
2. Clear oneshots (`clear_session_fork_agent_session`) as today, plus rewind index (Task 2 already folds this into clear).
3. `plan = child_trim_plan(rewind_index, resumed)`.
4. If `RewindChild { prompt_index }`:
   - `client.rewind_execute_for(&agent_sid, prompt_index, false).await`
   - Ok → keep `agent_sid`, `needs_history_bootstrap = false`
   - Err → log warn; `open_session_at(None, false, cwd)` → new empty id; `needs_history_bootstrap = journal_has_history`; **do not** keep the forked id
5. If `Bootstrap`: `needs_history_bootstrap = journal_has_history` (already true when `!resumed`)
6. If `Skip`: existing logic
7. Emit `session://fork_trimmed` only when `rewind_index.is_some()`:

```rust
let _ = app.emit(
    "session://fork_trimmed",
    serde_json::json!({
        "sessionId": meta.id,
        "outcome": match plan_after { /* "rewound" | "bootstrap" */ },
    }),
);
```

`outcome`:
- rewind Ok → `"rewound"`
- rewind Err or plan Bootstrap → `"bootstrap"`
- Skip → do not emit

Parent agent id must not be passed to `rewind_execute_for`. Use the **child** `agent_sid` from the fork result.

After rewind-fail `session/new`, run `set_mode` (fresh session). Skip `set_mode` only on successful fork+rewind (existing fork skip).

**Step 1: If connect has no cheap fixture for ACP, add a focused test of the emit payload helper in `fork_trim.rs`:**

```rust
pub fn fork_trimmed_outcome(
    plan: ChildTrimPlan,
    rewind_ok: Option<bool>,
) -> Option<&'static str> { ... }
```

Test the mapping. Manual/ACP wiring in connect is reviewed against this table.

**Step 2–4: Implement connect branch, `cargo test child_trim`, `cargo test --lib` still green.**

**Step 5: Commit**

```bash
git add src-tauri/src/session_manager/connect.rs src-tauri/src/session_manager/fork_trim.rs
git commit -m "feat(session): rewind forked child so memory matches the cut"
```

---

### Task 5: i18n key `session.forkOkBootstrap`

**Files:**
- Modify: `src/i18n/messages/en/session.ts` (authority)
- Modify the other 14 `src/i18n/messages/*/session.ts`: `de` `es` `fil` `fr` `id` `it` `ja` `ko` `pt-BR` `ru` `ta` `uk` `zh` `zh-TW`

**en:**

```ts
"session.forkOkBootstrap": "Forked · agent context is the copied history (not the original’s later turns)",
```

**zh:**

```ts
"session.forkOkBootstrap": "已分叉 · Agent 上下文是复制的截断历史（不含原会话后续回合）",
```

Other locales: complete translations, not English leftovers for this chrome string if you can; English is acceptable only where the catalog already keeps deep settings in English — this toast is user-visible chrome, so translate. Placeholders: none. `messages.test.ts` will fail if any catalog drops the key.

**Step 1:** Add only `en`, run `pnpm exec vitest run src/i18n/messages.test.ts` — expect FAIL key parity.

**Step 2:** Add the key to all 15 catalogs.

**Step 3:** Re-run `src/i18n/messages.test.ts` — PASS.

**Step 4: Commit**

```bash
git add src/i18n/messages/*/session.ts
git commit -m "feat(i18n): bootstrap toast for trimmed session forks"
```

---

### Task 6: Toast helper + host event on the UI

**Files:**
- Modify: `src/lib/sessionFork.ts` (`forkSuccessToastKey` stays for the immediate toast)
- Modify: `src/lib/sessionFork.test.ts`
- Modify: `src/hooks/useSessionHostEvents.ts` (listen `session://fork_trimmed`)
- Modify: `src/app/AppWorkbench.tsx` only to pass `showToast` if the hook does not already have it — **prefer doing the toast inside the host-events hook / a 10-line helper**, do not add `useState`

**Step 1: Test**

```ts
it("forkTrimmedToastKey is silent on rewound and honest on bootstrap", () => {
  expect(forkTrimmedToastKey("rewound")).toBe(null);
  expect(forkTrimmedToastKey("bootstrap")).toBe("session.forkOkBootstrap");
  expect(forkTrimmedToastKey("nope")).toBe(null);
});
```

**Step 2:** FAIL then implement:

```ts
export function forkTrimmedToastKey(
  outcome: string | null | undefined,
): "session.forkOkBootstrap" | null {
  return outcome === "bootstrap" ? "session.forkOkBootstrap" : null;
}
```

Immediate success toast for partial forks: keep using `forkSuccessToastKey({ restoredWorktree, forkedAgent })`. Auto-armed CLI fork may toast `session.forkOkCli` **before** rewind finishes — design says: partial immediate toast should stay **neutral** `session.forkOk` (do not claim new-agent-id until rewind is confirmed). Implement:

```ts
// in runForkSession success path, when throughUserPromptIndex != null:
showToast(tr(forkSuccessToastKey({
  restoredWorktree,
  forkedAgent: false, // wait for session://fork_trimmed
})));
```

Full (uncut) forks unchanged (`forkedAgent` from the checkbox).

Listen in `useSessionHostEvents.ts`:

```ts
listenWithRetry<{ sessionId?: string; outcome?: string }>(
  "session://fork_trimmed",
  (p) => {
    const key = forkTrimmedToastKey(p?.outcome);
    if (key) showToast(tr(key));
  },
)
```

Wire `showToast` / `tr` only if the hook already receives them; if not, handle the event in the existing workbench listener cluster that already toasts `session://agents_recycled` (search that). Reuse that site rather than inventing a new App state bag.

**Step 3:** `pnpm exec vitest run src/lib/sessionFork.test.ts` PASS

**Step 4: Commit**

```bash
git add src/lib/sessionFork.ts src/lib/sessionFork.test.ts src/hooks/useSessionHostEvents.ts src/app/AppWorkbench.tsx
git commit -m "feat(session): toast when a forked child falls back to bootstrap"
```

---

### Task 7: Move the fork button to assistant bubbles

**Files:**
- Modify: `src/components/lobe-chat/ConversationThread.tsx`
- Modify: `src/app/AppWorkbench.tsx`

**Step 1:** There is no ConversationThread RTL suite. Guard with the Task 1 predicates and a comment in the assistant actions block. Manual check at the end of this task.

**Step 2: ConversationThread**

- Rename prop `onForkFromUserMessage` → `onForkFromAssistantMessage` everywhere (props, `TranscriptMessageRowProps`, memo compare if it compared the callback — it currently does not).
- **Remove** the user-bubble fork `MessageActionButton` (~lines 1249–1260).
- In assistant `actions` (~1650): include fork when `onForkFromAssistantMessage` and `shouldOfferAssistantFork({ streaming: m.streaming, turnLive, canRewindSession, parentPromptIndex })`. The row does not have the full `messages` array — pass `canForkFromAssistant` as a boolean from the parent `ConversationThread` which **does** have `messages`, computing `userPromptIndexContaining(messages, m.id)` per row, **or** compute in the row if you pass `messages` (avoid passing the whole array if it breaks memo). Simplest: in `ConversationThread` map, `const parentIdx = userPromptIndexContaining(messages, m.id)` and pass `canForkFromAssistant={shouldOfferAssistantFork({... parentPromptIndex: parentIdx })}`.
- Button: `label={tr("message.forkHere")}`, `disabled={!canRewindSession}`, `IconFork`, `onClick={() => onForkFromAssistantMessage(m)}`.
- Expand the early `if (!showCopy && !showRegen) return null` so fork-only rows still show actions.

**Step 3: AppWorkbench**

Rename `onForkFromUserMessage` → `onForkFromAssistantMessage`. Body:

```ts
const idx = userPromptIndexContaining(messages, msg.id);
if (idx < 0) return;
confirmForkSession(row, idx);
```

Pass the new prop name into `ConversationThread`.

Confirm dialog:

- Hide the CLI checkbox when `!shouldShowForkCliCheckbox(forkConfirm.throughUserPromptIndex)`.
- Footer `forkCliSession: resolveForkCliOnConfirm({ throughUserPromptIndex, checkboxChecked: forkAgentCheckbox.checked, agentSessionId: forkConfirm.source.agentSessionId })`.

`confirmForkSession` can still default the checkbox via `defaultForkAgentChecked` for **full** forks; partial ignores it.

**Step 4:** `pnpm exec vitest run src/lib/session.test.ts src/lib/sessionFork.test.ts` still PASS. Typecheck the renamed prop.

**Step 5: Commit**

```bash
git add src/components/lobe-chat/ConversationThread.tsx src/app/AppWorkbench.tsx
git commit -m "feat(session): fork from assistant replies instead of user prompts"
```

---

### Task 8: Wiki + CHANGELOG

**Files:**
- Modify: `docs/llm-wiki/session-continuity.md` (new subsection after 3a / near fork mentions)
- Modify: `CHANGELOG.md` `[Unreleased]` → Added (English + 中文)

**Wiki bullets:**

- Fork-from-here is on completed assistant bubbles; cut = containing user turn (`through_user_prompt_index`).
- Child connect: `session/fork` then `x.ai/rewind/execute` on the **child** (`restoreFiles=false`). Parent untouched.
- Rewind/fork failure: `session/new` + journal bootstrap; never keep an untrimmed forked agent id.
- Partial dialog does not show the CLI checkbox; auto-fork when a source agent id exists.
- Sidebar full fork unchanged.

**CHANGELOG (en):**

```md
- **Fork from an assistant reply**: “Fork from here” sits on completed Grok bubbles (not user prompts). The new chat copies through that turn; the child agent is rewound to match (bootstrap fallback if rewind is unavailable).
```

**CHANGELOG (zh):** matching sentence. Do not invent a version heading.

**Commit**

```bash
git add docs/llm-wiki/session-continuity.md CHANGELOG.md
git commit -m "docs: agent-side session fork cut and child rewind"
```

---

### Task 9: Verify

**Frontend:** `pnpm exec vitest run src/lib/session.test.ts src/lib/sessionFork.test.ts src/i18n/messages.test.ts`

**Host:** `cd src-tauri && cargo test fork_session_partial_stores_rewind_index child_trim -- --nocapture`

**Manual (app):**

1. Idle multi-turn chat: user bubbles have rewind/edit, **no** fork; assistant bubbles have “Fork from here”.
2. Fork from the first assistant reply → new chat ends at that turn; composer empty; original intact.
3. Send a different follow-up in the fork — model must not cite later turns from the original (when CLI rewind exists).
4. Sidebar “Fork chat” still copies everything and still shows the CLI checkbox.
5. Streaming / tools: fork disabled.
6. No agent id: journal fork still works.

**Do not** add App.tsx state.

---

## Execution

Plan complete and saved to `docs/plans/2026-08-20-agent-side-session-fork.md`. Two execution options:

**1. Subagent-Driven (this session)** — fresh subagent per task, review between tasks.

**2. Parallel Session (separate)** — new session with executing-plans, branch from `main` (cherry-pick the design + this plan off `fix/windows-end-of-turn-freeze-754` if they are not on `main` yet).

Which approach?
