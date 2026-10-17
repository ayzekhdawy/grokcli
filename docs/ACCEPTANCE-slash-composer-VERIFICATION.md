---
verified: 2026-07-23T12:00:00Z
doc: docs/ACCEPTANCE-slash-composer.md
status: gaps_found
score: static review complete; shell suite not executed in this agent session
gaps:
  - id: H1
    truth: "User bubble shows skill chips for [[skill:…]]"
    status: failed
    reason: "App uses lobe-chat ConversationThread which renders m.content as plain text; SkillChip path exists only in unused chat/ConversationThread.tsx"
    artifacts:
      - path: src/components/lobe-chat/ConversationThread.tsx
        issue: "line ~211: <div className=\"lobe-chat-bubble\">{m.content}</div> — no parseStoredContent / SkillChip"
      - path: src/components/chat/ConversationThread.tsx
        issue: "Has UserMessageBody with chips but is not imported by App.tsx"
    missing:
      - "Port UserMessageBody (parseStoredContent + SkillChip) into lobe-chat ConversationThread user bubble"
  - id: M8
    truth: "Plan and Goal mutually exclusive"
    status: partial
    reason: "Slash applySlashItem clears the other mode; ComposerAccessMenu onMode and Plus→Plan do not clear goalMode"
    artifacts:
      - path: src/App.tsx
        issue: "onMode only setMode(v); plus menu setMode(\"plan\") without setGoalMode(false)"
    missing:
      - "When mode becomes plan (any path), setGoalMode(false); when goal enables, clear plan (already done on slash)"
---

# Acceptance Verification · Slash / Skills / Goal / Doctor

> **已过时（2026-07-23 的快照，保留作历史记录）。**
> C 段（编辑器与 chip）此后被多次改动：composer 从自研 contenteditable 换成
> TipTap/ProseMirror；内联文件与 URL 引用 chip 落地；Markdown 渲染对齐聊天侧；
> 列表内换行与 `@` 插入的坐标空间先后调整。
> **现行验收标准以 [ACCEPTANCE-slash-composer.md](./ACCEPTANCE-slash-composer.md) 的 C 段为准。**

**Source:** [ACCEPTANCE-slash-composer.md](./ACCEPTANCE-slash-composer.md)  
**Verified:** 2026-07-23  
**Method:** Static code review + existing unit-test source review.  
**Shell note:** This verifier session had no Shell tool; `pnpm typecheck`, `pnpm test`, and `cargo check` were **not executed**. Orchestrator/human must run them for R1/R2 and cargo gate.

## Summary

| Area | Result |
|------|--------|
| Doctor (D1–D6) | Static **PASS** (runtime UI UNTESTED) |
| Skills data (S1–S3) | Static **PASS** (CLI-backed list UNTESTED) |
| Contenteditable (C1–C5) | Static **PASS** (IME/backspace runtime UNTESTED) |
| Slash palette (P1–P6) | Static **PASS** (P1–P3 unit-tested) |
| Modes & actions (M1–M8) | **M8 PARTIAL**; others static PASS |
| History & send (H1–H4) | **H1 FAIL**; H2–H4 static PASS |
| Regression (R1–R3) | R1/R2 **UNTESTED**; R3 static PASS |

**Blocker gap:** H1 — skill tokens show as raw `[[skill:name]]` text in the live thread.

---

## Full table (mapped to acceptance IDs)

| ID | Check | Status | Evidence / how to manual-test |
|----|--------|--------|-------------------------------|
| **D1** | Doctor modal is not bare JSON `<pre>` | **PASS** (static) | `DoctorModal.tsx` structured checks UI; comment notes it replaces raw JSON dump. No `<pre>` in modal. **Manual:** Settings → Runtime → Run Doctor; sidebar/tray Doctor. |
| **D2** | Check rows ok/warn/fail | **PASS** (static) | `doctor_report` builds cli/auth/workspace/backend/logs with levels; UI maps `doctor-check--${level}`. **Manual:** open Doctor with/without CLI. |
| **D3** | Re-run refreshes report | **PASS** (static) / **UNTESTED** runtime | Footer Re-run → `run()` → `api.doctorReport()`; `generatedAt` from host. **Manual:** click Re-run; timestamp updates. |
| **D4** | Copy redacted report | **PASS** (static) / **UNTESTED** runtime | `onCopy` uses `redact(JSON.stringify(payload))` + clipboard. Unit: `redact.test.ts`. **Manual:** Copy → paste elsewhere. |
| **D5** | `/doctor` opens same modal | **PASS** (static) | `applySlashItem` action `doctor` → `openDoctor()` → same `DoctorModal`. **Manual:** type `/doctor` Enter. |
| **D6** | Doctor chrome via `t()` | **PASS** (static) | All chrome keys under `doctor.*` via `createT`; en/zh in `messages.ts`. Note: check *details* from Rust are English (not chrome). Unused key `doctor.rawToggle` (info only). **Manual:** switch locale. |
| **S1** | `skills_list` / inspect returns skills | **PASS** (API exists) / **UNTESTED** data | Host: `commands::skills_list`, `inspect_mcp` registered in `lib.rs`; FE `api.skillsList` / `inspectMcp`. **Manual:** Tauri + CLI present → Plus menu / `/` skills non-empty. |
| **S2** | Plus menu Skills section | **PASS** (static) | Plus menu: loading / empty / up to 8 skills insert `[[skill:…]]`. **Manual:** open + menu. |
| **S3** | Skills filter by name/desc | **PASS** (unit) | `filterSlashItems` + tests (`/aih` → aihot). Wired via `flattenFilteredCatalog`. **Manual:** type `/aih`. |
| **C1** | Composer contenteditable | **PASS** (static) | `ComposerEditor`: `contentEditable={!disabled}`, not textarea. **Manual:** Inspect DOM. |
| **C2** | Skill inserts inline chip at caret | **PASS** (static) / **UNTESTED** caret | `applySkillAtSlash` + re-render chips; skill select in palette. **Manual:** mid-sentence `/skill` Enter. |
| **C3** | Backspace deletes whole chip | **PASS** (intent) / **UNTESTED** | Chips `contentEditable=false` / `data-skill` (browser atomic delete). No custom Backspace handler. **Manual:** caret after chip, Backspace. |
| **C4** | IME Enter does not send | **PASS** (static) / **UNTESTED** | `isComposing` + `keyCode === 229` early return in `onKeyDown`. **Manual:** Chinese IME compose + Enter. |
| **C5** | Shift+Enter newline; Enter sends | **PASS** (static) / **UNTESTED** | Enter+!shift → send when palette closed; Shift+Enter not prevented (default newline). **Manual:** both keys. |
| **P1** | `/` at start opens palette | **PASS** (unit) | `detectSlashQuery("/")` tested; `onSlashQueryChange`. **Manual:** type `/`. |
| **P2** | `hello /` opens palette | **PASS** (unit) | `detectSlashQuery("a /x")` tested. **Manual:** type `hello /`. |
| **P3** | `https://` does not open | **PASS** (unit) | `detectSlashQuery("https://")` → null. **Manual:** type URL. |
| **P4** | ↑↓ + hover same style | **PASS** (static) | Arrow keys change `activeIndex`; hover `onMouseEnter`; CSS `.slash-palette__item:hover, .is-active` shared. **Manual:** hover vs keyboard. |
| **P5** | Esc closes palette | **PASS** (static) | Escape → `setSlashQuery(null)`. **Manual:** Esc. |
| **P6** | Sections: commands then skills | **PASS** (static) | `SlashPalette` renders commands section then skills; flat = commands+skills. **Manual:** open `/`. |
| **M1** | `/goal` chip + placeholder | **PASS** (static) | mode goal → `setGoalMode(true)`; chip + `composer.goalPlaceholder`. **Manual:** `/goal`. |
| **M2** | Clear goal chip turns off | **PASS** (static) | Chip button `setGoalMode(false)`. **Manual:** click chip ×. |
| **M3** | Send with goal prefixes `/goal` | **PASS** (unit + wire) | `serializeForAgent(..., { goalMode })` tested; `send()` uses it. **Manual:** goal on, send, inspect agent prompt/log. |
| **M4** | `/plan` sets plan mode | **PASS** (static) | `setMode("plan")` + prefs; Access menu reflects `mode`. **Manual:** `/plan`, check Access. |
| **M5** | `/compact` confirm → sends | **PASS** (static) | Modal confirm → `sessionSend("/compact" \| "/compact note")`. **Manual:** `/compact` OK. |
| **M6** | `/status` opens status modal | **PASS** (static) | `setShowStatusModal(true)` + `StatusModal`. **Manual:** `/status`. |
| **M7** | `/mcp` opens MCP modal | **PASS** (static) | `openMcpModal` + `inspectMcp` + `McpStatusModal`. **Manual:** `/mcp`. |
| **M8** | Plan and Goal mutually exclusive | **PARTIAL** | Slash: goal clears plan; plan clears goal. **Gap:** Access menu `onMode` and Plus→Plan do **not** `setGoalMode(false)` — both can be active. **Manual:** goal on → Access→Plan; check chip still present. |
| **H1** | User bubble skill chips | **FAIL** | Live thread: `lobe-chat/ConversationThread.tsx` L211 `{m.content}` plain text. Chip renderer only in **unused** `chat/ConversationThread.tsx`. **Manual:** send with skill → bubble shows `[[skill:…]]` raw. |
| **H2** | Agent receives `/skill-name` | **PASS** (unit + wire) | `serializeForAgent` → `/name`; `sessionSend(agentText)`. **Manual:** inspect prompt with skill. |
| **H3** | Edit last user restores chips | **PASS** (static) / **UNTESTED** | `beginEditLastUser` → `setDraft(msg.content)`; ComposerEditor rehydrates tokens→chips. **Manual:** edit last after skill send. |
| **H4** | Attachments still work with chips | **PASS** (static) / **UNTESTED** | `buildAgentPrompt(agentBody, att)` independent of skills. **Manual:** skill + file send. |
| **R1** | `pnpm test` green | **UNTESTED** | Run: `pnpm test` (expects draftDoc/slashCatalog/redact/i18n suites green). |
| **R2** | `pnpm typecheck` green | **UNTESTED** | Run: `pnpm typecheck`. Also: `cd src-tauri && cargo check`. |
| **R3** | Plain composer send still works | **PASS** (static) | Empty skills path: `serializeForAgent` returns text; send still `sessionSend`. **Manual:** type hello Enter. |

---

## Host APIs (existence)

| Command | Rust | Frontend | Registered |
|---------|------|----------|------------|
| `doctor_report` | `commands.rs` `doctor_report` | `api.doctorReport()` | `lib.rs` generate_handler |
| `skills_list` | `commands.rs` `skills_list` | `api.skillsList()` | yes |
| `inspect_mcp` | `commands.rs` `inspect_mcp` | `api.inspectMcp()` | yes |

---

## Key static findings

### PASS highlights

1. **DoctorModal** is structured (summary pills, check list, re-run, copy, i18n) — not raw JSON-only UI.
2. **draftDoc** `serializeForAgent` + skill tokens + `detectSlashQuery` covered by unit tests.
3. **ComposerEditor** is contenteditable with chip DOM serialization.
4. **SlashPalette** hover and keyboard share `is-active` + same CSS rule.
5. **Goal mode** chip, placeholder, and agent prefix wired through `send()`.
6. Host commands for doctor/skills/mcp present and invoked.

### FAIL / PARTIAL

1. **H1 FAIL — skill chips not in live user bubbles**  
   - App imports `@/components/lobe-chat` ConversationThread.  
   - User bubble: plain `{m.content}`.  
   - Fix: reuse `parseStoredContent` + `SkillChip` (as in unused `chat/ConversationThread.tsx` `UserMessageBody`).

2. **M8 PARTIAL — goal/plan exclusivity incomplete**  
   - Fix Access menu + Plus plan path to clear `goalMode` when entering plan; optionally clear plan when enabling goal from other entry points (slash already does).

### Dead / orphan code (info)

- `src/components/chat/ConversationThread.tsx` — skill-chip UserMessageBody, **not imported**.
- i18n key `doctor.rawToggle` — defined, unused.

---

## Commands for orchestrator (must run)

```bash
pnpm typecheck
pnpm test
cd src-tauri && cargo check
```

All three must pass for R1/R2 + cargo gate.

---

## Manual smoke (runtime-only)

1. Doctor from Settings / tray / `/doctor` — structured rows, re-run, copy.
2. Plus menu skills + `/aih` filter with real CLI.
3. Contenteditable: chip insert mid-sentence, Backspace chip, IME Enter, Shift+Enter.
4. Goal chip send → agent text starts with `/goal`.
5. **After H1 fix:** user bubble shows chips not raw tokens.
6. Locale switch on Doctor chrome.

---

_Verified: 2026-07-23_  
_Verifier: Grok Build subagent (static; shell suite not run)_
