# Plan: Live Voice + Agent Delegation in Grok App

**Date:** 2026-07-24  
**Repo:** `jchacker5/grok-app` (fork of RongleCat/grok-app)  
**Goal:** A **live, full-duplex voice session** where Grok Voice keeps talking with you while **delegating coding work to Grok Build agent sessions**—the product shape of OpenAI’s **GPT-Live + Codex on desktop** (July 2026).

---

## 1. What we’re copying (product, not implementation)

### OpenAI: GPT-Live + ChatGPT Voice on desktop (Codex)

Primary sources: OpenAI [GPT-Live announcement](https://openai.com/index/introducing-gpt-live/) (2026-07-08), ChatGPT release notes (2026-07-23), [ChatGPT Voice on desktop / Codex](https://learn.chatgpt.com/docs/features/voice), TechCrunch coverage of desktop voice controlling Work/Codex.

| Capability | Behavior |
|------------|----------|
| **Full-duplex voice** | Model listens and speaks at once (interrupt, pause, backchannel) — not “record → wait → speak.” |
| **Delegation** | Voice can start **separate threads/tasks** for longer work (e.g. “run tests and find the root cause”), keep talking, then report blockers/results. |
| **Permission parity** | Voice-directed tasks use the **same permission modes** as typing into Codex. |
| **Mode gate** | Chat/task must **start in voice**; text-started chats only get **dictation**. |
| **Hotkey** | Configurable “Start voice chat.” |
| **Screen context (macOS)** | Optional Appshots: “take a look at this.” |
| **Limits** | Separate voice allowance + agent usage still billed against Codex budget. |
| **CLI dictation (separate)** | Codex CLI also has mic/`Ctrl+M` **prompt dictation only** — not the desktop live-delegate product. |

**User mental model (demo shape):**  
*“Create a PR for the SEO title fix, run tests, and tell me if anything fails.”*  
Voice stays open → agent session(s) run in the sidebar → voice narrates progress and asks for approval when needed.

### Grok / xAI today

| Layer | What exists | Gap vs GPT-Live+Codex |
|-------|-------------|------------------------|
| **Grok Build CLI** (`grok` 0.2.x) | **Dictation only**: `/voice` or `Ctrl+Space`, live STT into the prompt (up to ~15 min continuous input reported in press). Mic capture helper on macOS; silence → “no speech detected.” | No full-duplex S2S, no “voice host that spawns agent threads.” |
| **xAI Voice APIs** | **Speech-to-speech realtime** `wss://api.x.ai/v1/realtime?model=grok-voice-latest` with VAD, tools, voices; **STT** REST + streaming WS; **TTS** REST/stream; custom voices; ephemeral tokens for clients. | Not wired into Grok App or CLI as an agent orchestrator. |
| **Grok App (this repo)** | Tauri 2 workbench: multi-session ACP (`grok agent stdio`), permissions (Ask/YOLO/project tiers), plan review, send queue, concurrent agent limits, SuperGrok account surface. **No mic / voice UI.** | Missing voice host + tool bridge into `SessionManager`. |

**Conclusion:** Building “GPT-Live for Grok” is **not** “expose CLI `/voice` in the composer.”  
It is a **new Voice Host** on top of xAI realtime + **delegation tools** into existing ACP sessions.

---

## 2. Target product definition

### 2.1 Modes (explicit product split)

| Mode | UX | Backend | Ships in |
|------|----|---------|----------|
| **A. Dictation** | Mic in composer; partial transcript; insert/send text | xAI streaming STT **or** shell out to CLI voice if ever exposable | Phase 1 |
| **B. Live Voice (chat)** | Full-duplex conversation about the project; no agent tools | xAI S2S realtime, tools empty / web_search only | Phase 2 |
| **C. Live Voice + Delegate (goal)** | Live voice that can create/steer/summarize **Grok Build sessions** | S2S realtime **+ host tools** → `SessionManager` | Phase 3 |

Phase C is the success criteria for this plan.

### 2.2 Success criteria (acceptance)

1. User starts **Voice** on a trusted project; mic + speakers work; can interrupt Grok mid-sentence.
2. User says: *“Start a session to fix failing tests and open a PR when green.”*
3. App creates (or reuses) a **Build agent session**, streams tool progress in the normal UI, respects **Ask vs YOLO** permissions.
4. Voice remains active and can: *“What’s blocking?”* / *“Allow the git push”* / *“Cancel that.”*
5. Agent completion is spoken back: *“Tests passed, PR #N opened.”*
6. Ending voice does **not** kill agent sessions (optional “stop agents on hangup” toggle).
7. No API keys in the webview; auth via CLI `auth.json` and/or server-minted ephemeral tokens.

### 2.3 Non-goals (v1)

- Phone remote control (Codex Remote parity) — later.
- Full Computer Use / desktop click-drive — later.
- Cloning GPT-Live model weights; we use **xAI grok-voice** + **grok-build** agents.
- Replacing ACP with a custom agent runtime.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Grok App UI (React)                                        │
│  VoiceOverlay · transcript · agent chips · permission bar   │
└───────────────┬─────────────────────────────┬───────────────┘
                │ Tauri events / commands     │
┌───────────────▼──────────────┐   ┌──────────▼────────────────┐
│  VoiceHost (Rust)            │   │  SessionManager (exists)  │
│  - mic capture / playback    │   │  - multi ACP processes    │
│  - realtime WS client        │   │  - prompt / cancel        │
│  - tool call dispatcher      │──▶│  - permission RPC         │
│  - session transcript log    │   │  - plan / ask_user        │
└───────────────┬──────────────┘   └───────────────────────────┘
                │
        wss://api.x.ai/v1/realtime?model=grok-voice-latest
                │
        tools: delegate_agent, list_sessions, agent_status,
               agent_prompt, agent_cancel, resolve_permission_hint
```

### 3.1 Why not “only use CLI `/voice`”?

CLI dictation writes **text into one prompt**. GPT-Live-style product needs:

- continuous **spoken** replies while agents work,
- **parallel** agent threads,
- **tool-mediated** control plane (not stuffing everything into one agent prompt),
- a UI host that owns mic permissions for **Grok.app**, not Ghostty/iTerm.

### 3.2 Auth strategy

| Option | Pros | Cons |
|--------|------|------|
| **A. Ephemeral tokens** (xAI docs) | Safe for client audio path | Needs mint endpoint / account bridge |
| **B. Host-side WS with CLI token** from `~/.grok/auth.json` | Matches app’s existing auth model (`account.rs`) | Must never ship token to frontend |
| **C. User API key in keychain** | Simple for power users | Extra setup; quota separation |

**v1 recommendation:** **B** — Rust `VoiceHost` opens the WebSocket using credentials already synced for ACP (`auth.json` / agent-home). Frontend only receives audio PCM / events, never secrets.

### 3.3 Host tools (voice model function calls)

Map 1:1 to existing app capabilities:

| Tool | Maps to | Notes |
|------|---------|--------|
| `list_sessions` | session index | status, title, busy/idle |
| `create_agent_session` | `session_create` + `session_connect` | cwd = active project |
| `prompt_agent` | ACP `session/prompt` | fire-and-forget with correlation id |
| `get_agent_status` | snapshot + last tool / plan state | for “what’s happening?” |
| `cancel_agent` | `session/cancel` | |
| `request_user_permission` | surface existing permission UI | Voice says “I need you to allow shell” |
| `summarize_agent_result` | host-built summary from journal | keep voice model short |

**Permission rule:** Voice never auto-bypasses Ask. YOLO remains user-selected on the project/composer, same as typed work.

### 3.4 Concurrency model

- App already has **multi-session parallel streaming** + `max_concurrent_agents`.
- VoiceHost holds **one** realtime voice session (OpenAI: one voice chat active).
- N agent sessions can run underneath; UI chips link voice transcript turns → agent session ids.

### 3.5 Audio pipeline (macOS first)

1. **Capture:** cpal / coreaudio in Rust (or WebView `getUserMedia` → IPC to Rust). Prefer **Rust capture** so permissions attach to **Grok.app** (same pain CLI has with terminal ownership of mic).
2. **Uplink:** PCM 16 kHz mono → realtime WS (match xAI STT/realtime expectations).
3. **Downlink:** `response.output_audio.delta` → local playback queue; barge-in cancels playback.
4. **Permissions:** Info.plist `NSMicrophoneUsageDescription`; optional later `NSScreenCapture` for appshots.

---

## 4. Phased delivery

### Phase 0 — Spike (1–2 days)

- [ ] Minimal Rust binary/module: connect `grok-voice-latest` with auth from `auth.json`; echo S2S with no tools.
- [ ] Confirm SuperGrok/OAuth token works for Voice API (or document API key requirement).
- [ ] Mic capture + playback loop in Tauri window; latency measurement.
- [ ] Tool call round-trip mock: voice model calls `list_sessions` → return JSON fixture.

**Exit:** “Hello” full-duplex works; tool call visible in logs.

### Phase 1 — Dictation in composer (fast user value)

- [ ] Mic button on `ComposerEditor` + hotkey (default `Ctrl+Space` / macOS configurable).
- [ ] Streaming STT (`wss://api.x.ai/v1/stt` interim results) → composer draft.
- [ ] Optional: “auto-send on silence” vs “insert only.”
- [ ] Keyterm bias: project name, `ValorAI`, stack terms.
- [ ] Settings: mic device, language, dictation vs live default.
- [ ] Tests: pure TS transcript merge; Rust STT client unit tests with recorded PCM fixtures.

**Exit:** Hands-free prompts into existing agent flow (parity with CLI dictation + Codex mic).

### Phase 2 — Live Voice session UI (no delegate yet)

- [ ] **Start voice chat** entry on empty session / project workbench.
- [ ] `VoiceOverlay`: waveform, listening/speaking state, End, mute.
- [ ] Transcript pane (user + assistant turns as text for accessibility).
- [ ] Session must start in voice (match OpenAI product rule) **or** allow promote-to-voice on empty thread — product choice; default **start in voice**.
- [ ] Instructions prompt: “You are Grok in the desktop coding workbench; project is {cwd}; be concise.”
- [ ] Persist voice transcripts under `sessions/<id>/voice.jsonl`.

**Exit:** Full-duplex chat about code without typing; still no agent spawn.

### Phase 3 — Agent delegation (the goal)

- [ ] Register host tools on `session.update`.
- [ ] `VoiceHost` → `SessionManager` bridge commands (dedicated `voice_*` Tauri cmds wrapping existing APIs).
- [ ] UI: **Delegated tasks** rail (active agent chips, open session, cancel).
- [ ] When agent hits `session/request_permission` / plan exit:  
  - pause or soft-duck voice,  
  - highlight permission bar,  
  - optional spoken prompt “Allow shell for npm test?”
- [ ] On agent end_turn: push short summary event into voice context (`conversation.item` / tool result).
- [ ] Rate limits: voice minutes vs agent concurrency errors surfaced in voice + toast.
- [ ] Integration tests: mock ACP + mock realtime tool frames.

**Exit:** Demo script passes (section 2.2).

### Phase 4 — Polish / parity stretch

- [ ] Screen context: optional “look at this” using existing media/screenshot paths (Appshots analogue).
- [ ] Multi-agent orchestration prompts (“run explore + implement in parallel”).
- [ ] Voice settings: voice_id (`eve`, …), VAD sensitivity, barge-in aggressiveness.
- [ ] Doctor panel: mic device, last WS error, auth path (like CLI `/doctor` Voice section).
- [ ] i18n EN/zh for all voice strings.
- [ ] Windows capture/playback parity.

---

## 5. Concrete code touchpoints (this repo)

| Area | Files (expected) |
|------|------------------|
| Host realtime | new `src-tauri/src/voice_host.rs`, `voice_audio.rs`, `voice_tools.rs` |
| Commands | `src-tauri/src/commands.rs` — `voice_start`, `voice_stop`, `voice_set_mute`, events `voice://*` |
| Wire-up | `src-tauri/src/lib.rs` modules + permissions |
| Session bridge | `session_manager.rs` — thin public methods if needed for prompt/status without UI |
| UI | `src/components/VoiceOverlay.tsx`, mic in `ComposerEditor.tsx`, entry in `App.tsx` |
| State helpers | `src/lib/voiceSession.ts`, `voiceTranscript.ts` |
| Capabilities | `src-tauri/capabilities/default.json` — only if filesystem/audio plugins require |
| macOS | `tauri.macos.conf.json` / Info.plist mic usage string |
| Settings | `SettingsPage.tsx` + store schema for voice prefs |
| Docs | this plan + `docs/llm-wiki/voice.md` |

**Reuse heavily:** multi-session streaming, permission bar, plan review, send queue, process limits, account auth sync.

---

## 6. Security & privacy

1. **Mic:** OS permission for Grok.app only; clear first-run copy.
2. **Tokens:** never in React; Rust only; prefer ephemeral token mint if available for SuperGrok.
3. **Audio:** xAI docs claim realtime audio not stored for training — still document in Settings privacy blurb.
4. **Permissions:** voice-delegated tools cannot escalate beyond project policy.
5. **Secrets on screen:** if Phase 4 screen context lands, warn + org kill-switch pattern like OpenAI.
6. **Local logs:** redact tokens; optional “don’t save voice audio” (default: no raw audio retention, transcripts only).

---

## 7. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| SuperGrok OAuth token **not** accepted by Voice API | Spike Phase 0; fallback API key / document requirement |
| Tool-calling quality of `grok-voice` for multi-step coding | Keep tools coarse; let **Build agent** do the coding, not the voice model |
| Double agent (voice model tries to write code itself) | System instructions: “never invent file edits; always `prompt_agent`” |
| Latency / talking over tool storms | Duck TTS while tools stream; speak only on milestones |
| Mic owned by wrong process | App-native capture, not terminal |
| Concurrent session limits | Voice tools return friendly errors; offer cancel oldest |

---

## 8. Demo script (ship checklist)

1. Open project `valorai`, Start Voice.  
2. “Summarize the open PR for title brand dedupe.” → `prompt_agent` on explore/read-only.  
3. “Implement remaining double-brand titles and open a PR.” → new implement session.  
4. Permission Ask: allow test command via bar while voice waits.  
5. “Status?” → spoken summary from `get_agent_status`.  
6. End voice; agent still visible in sidebar if still running.

---

## 9. Suggested sequencing for PRs

1. `feat(voice): Phase 0 spike branch` (no UI polish)  
2. `feat(voice): composer dictation (STT)`  
3. `feat(voice): live S2S session UI`  
4. `feat(voice): agent delegation tools + chips`  
5. `feat(voice): permissions + plan handoff polish`  
6. Docs + release notes

---

## 10. Decision log (defaults)

| Decision | Default | Revisit if |
|----------|---------|------------|
| Transport | xAI realtime S2S + host tools | Voice API lacks tools on our auth |
| Agent runtime | Existing ACP SessionManager | — |
| Auth | CLI `auth.json` in Rust | Need ephemeral for store compliance |
| Dictation vs Live | Both; Live is headline | — |
| Auto-send on silence | Off for Live; optional for Dictation | User research |
| Kill agents on hangup | Off | Power users |

---

## 11. References

- OpenAI GPT-Live: https://openai.com/index/introducing-gpt-live/  
- ChatGPT Voice desktop / Codex: https://learn.chatgpt.com/docs/features/voice  
- ChatGPT release notes (2026-07-23 Voice in Work & Codex)  
- TechCrunch desktop voice agents (2026-07-24)  
- xAI Voice overview: https://docs.x.ai/developers/model-capabilities/audio/voice  
- xAI STT: https://docs.x.ai/developers/model-capabilities/audio/speech-to-text  
- Grok CLI: `/voice`, `Ctrl+Space`, mic doctor — `~/.grok/docs/user-guide/21-terminal-support.md`  
- This app ACP spike: `docs/SPIKE-ACP.md`  
- Multi-session host: `src-tauri/src/session_manager.rs`

---

## 12. Immediate next step

**Approve Phase 0 spike** on branch `feat/live-voice-host` in this fork:

1. Connect realtime voice with existing login.  
2. Prove one host tool round-trip.  
3. Write measured latency + auth findings back into this doc under “Spike results.”

Once Phase 0 is green, implement Phase 1 dictation (quick win) and Phase 3 delegation in parallel tracks only if staffing allows; otherwise strict Phase 1 → 2 → 3.
