# Research: ego-lite as Grok App browser-automation plug-in

**Date:** 2026-08-05  
**Upstream:** [citrolabs/ego-lite](https://github.com/citrolabs/ego-lite) (MIT harness + free closed-source browser)  
**Question:** Can we ship browser automation as an external plug-in (skills + MCP packaged), guide download of the browser binary, and keep it aligned with Grok App structure?

## Verdict

| Question | Answer |
|----------|--------|
| Can ego-lite support our browser automation? | **Yes — strong fit as skill + CLI runtime**, not as in-app WebView control. |
| Package as installable Grok plug-in? | **Yes**, same class of work as ChatCut Codex → Grok adapter. |
| Bundle skills + MCP? | **Skills: yes (upstream SoT). MCP: not upstream — do not invent unless we need tool-surface parity.** |
| Guide browser binary download? | **Yes** — upstream already has `skills/ego-browser/scripts/install.sh` + onboarding PATH setup. |
| Ship as default core feature? | **No (v1)** — recommended plug-in + macOS-first, optional. |

**Recommended product shape:** *outer plug-in* (Recommended row next to ChatCut) that installs `ego-browser` skill, then an App-guided **browser install / doctor** step that reuses upstream install script semantics. Do **not** embed ego lite inside Tauri WebView.

**Implementable design (approved):** [`docs/plans/2026-08-05-ego-lite-browser-plugin-DESIGN.md`](../plans/2026-08-05-ego-lite-browser-plugin-DESIGN.md)

---

## 1. What ego-lite actually is

### Two layers

| Layer | Open? | Role |
|-------|-------|------|
| **ego lite browser** | Free download, **closed app** (Chromium-based) | Real browser UI; Task Spaces; login/cookie inheritance from Chrome; ships `ego-browser` helper inside the app bundle |
| **ego-browser harness + skill** | **MIT** in this repo | Agent-facing CLI: stdin Node JS → CDP helpers (`snapshotText`, `click`, `fillInput`, task spaces…) |

Repo statement (AGENTS.md): this repository is the open harness + skill package — **not** the browser binary. The app embeds the runtime and exposes `ego-browser` on PATH after onboarding.

### Agent control model (critical)

ego-lite is **skill + shell CLI**, not MCP-first:

```bash
ego-browser nodejs <<'EOF'
const task = await useOrCreateTaskSpace('inspect example page')
await openOrReuseTab('https://example.com', { wait: true, timeout: 20 })
cliLog(await snapshotText())
EOF
```

- Agent writes multi-step JS in one heredoc (code-base, fewer tool rounds).
- Helpers are pre-injected into the script scope.
- Browser state lives in **Task Spaces** across heredoc rounds (reuse by name/id).
- Handoff: agent can give control to user (login/captcha); must wait for explicit continue.

### Upstream packaging already present

| Surface | Path | Notes |
|---------|------|--------|
| Codex plug-in | `.codex-plugin/plugin.json` | `name: ego-lite`, `skills: ./skills/`, interface metadata, no MCP field |
| Claude market | `.claude-plugin/marketplace.json` | skill marketplace entry |
| Skill body | `skills/ego-browser/SKILL.md` + `references/install.md` + `scripts/install.sh` | install guides DMG download |
| Site learnings | `skills/ego-browser/learnings/*` | google, x-com packs |
| Runtime package | `package/ego-browser/` | TypeScript CDP harness (also embedded in app) |

**No `.mcp.json` / MCP servers** appear in the repo tree. Integration for Claude/Codex is skill install + shell execution of `ego-browser`.

### Platform

- **macOS only** today (arm64 + x64 DMG).
- Windows / Linux on official roadmap (`lite.ego.app/roadmap`).
- Install script dies on non-Darwin: `this script only supports macOS`.

### Install / binary guidance (upstream)

1. DMG URLs (example channel):  
   `https://cdn.ego.app/channel/.../macos/{arm64|x64}/egolite.dmg`
2. `install.sh`: download → mount → copy to `/Applications` (or `~/Applications`) → strip quarantine → `open` app.
3. First-run GUI: optional Chrome data migrate; registers `ego-browser` (usually `~/.local/bin`).
4. Verify: `command -v ego-browser` then minimal heredoc `cliLog('ego-browser ready')`.

---

## 2. Grok App surfaces that matter

| Surface | Current behavior | Implication for ego |
|---------|------------------|---------------------|
| **Plugins** | Settings → Extensions → Plugins; Recommended = ChatCut only; `plugin install --trust`; never auto-install | Natural home for ego as 2nd recommended row |
| **ChatCut pattern** | Codex layout → `.grok-plugin` + skills copy + optional MCP; pin + `scripts/chatcut-plugin-start.mjs` | Reuse for ego (skills-only is simpler) |
| **Skills** | Plugin install + Extensions prefs; slash / skill menu | Skill is primary agent surface |
| **MCP** | HTTP/stdio via agent-home `config.toml` + inject on session open | Optional; not required for ego v1 |
| **EmbeddedBrowser** | Resources pane open URL (ChatCut editor handoff) | **Not** automation; ego runs **external** OS browser |
| **Independent mode** | `GROK_HOME` = app `agent-home` | Plugin/skill must land where Grok Build agent reads; PATH for `ego-browser` must reach agent shell |
| **Sandbox / shell** | Permission modes; shell tool allow | Agent must be allowed to run `ego-browser` and launch apps outside sandbox |
| **Doctor** | CLI / MCP / extensions health | Add ego readiness checks (macOS, app present, `ego-browser` on PATH) |

Docs anchors: `docs/llm-wiki/plugins-marketplace.md`, `docs/llm-wiki/chatcut.md`.

---

## 3. Fit analysis

### What ego solves well for us

1. **Real logged-in automation** — inherits user Chrome profile / cookies without rebuilding auth in App.
2. **Parallel Spaces** — agent work does not steal the user's tabs (better than driving system Chrome via Playwright alone).
3. **Token-efficient control** — multi-step JS in one shell call vs MCP tool-call ping-pong.
4. **Zero cloud browser cost** — free, local.
5. **Already agent-skill shaped** — SKILL.md + install.md match how Grok Build agents consume skills.
6. **Codex plug-in layout** — almost the same migration path as ChatCut.

### What it does *not* do

| Expectation | Reality |
|-------------|---------|
| In-app browser automation | Separate Chromium app; user sees ego lite windows/spaces |
| MCP-native tools | No upstream MCP; skill tells agent to use Bash/`ego-browser` |
| Windows Grok App users | Blocked until ego ships Win/Linux |
| Pure open-source binary | Browser app is closed; trust + update channel is citrolabs CDN |
| Replace EmbeddedBrowser for ChatCut | Different product surface (open URL vs drive DOM) |

### Skill vs MCP (design honesty)

```text
                    ┌─────────────────────┐
                    │  Grok App / Agent   │
                    └─────────┬───────────┘
                              │
              skill SKILL.md  │  (primary)
                              ▼
                    ┌─────────────────────┐
                    │  shell: ego-browser │
                    │  nodejs <<'EOF' …   │
                    └─────────┬───────────┘
                              │ CDP / ego runtime
                              ▼
                    ┌─────────────────────┐
                    │  ego lite.app       │
                    │  Task Spaces        │
                    └─────────────────────┘
```

Optional MCP (if we ever add one) would only wrap the same CLI and **duplicate** the skill surface unless tools expose snapshot/click as discrete MCP tools — which fights ego's "code-base, not CLI-base" design.

**v1 recommendation: skills-only plug-in. No fabricated MCP.**

---

## 4. Integration options

### A. Recommended plug-in only (recommended)

Mirror ChatCut:

1. Pin upstream: `vendor/ego-lite.pin` (git URL + commit).
2. Adapter script: `scripts/ego-plugin-start.mjs`  
   - Source: repo root (or skills-focused subtree).  
   - Emit: `.grok-plugin/plugin.json` + copy `skills/ego-browser` (+ assets).  
   - Map from `.codex-plugin/plugin.json` fields (name, version, description, skills path).
3. UI: Recommended row **ego / Browser automation**  
   - Source e.g. `https://github.com/citrolabs/ego-lite` or adapted vendor path / marketplace pin.  
   - GlassModal confirm → `plugin install --trust` → enable → soft-respawn.
4. Post-install **setup wizard** (App-owned, not silent):
   - Detect Darwin.
   - Check `/Applications/ego lite.app` or `command -v ego-browser`.
   - If missing: offer open DMG URL / run install script from skill path / open lite.ego.app.
   - After user finishes GUI onboarding: re-check PATH (`~/.local/bin`).
5. Doctor row: `ego_browser_ready` / `ego_app_missing` / `ego_platform_unsupported`.

**Effort:** medium (mostly App UI + adapter; reuse ChatCut patterns).  
**Risk:** low product surface; no new Host browser engine.

### B. Skills install without full plug-in

Ship only skill copy into agent skill dirs / session plugin dirs. Skips marketplace UX.

**Worse** for discoverability and updates; App already has Plugins tab.

### C. Thin MCP stdio wrapper around `ego-browser`

Host or node MCP with tools like `run_script`, `status`.  

**Defer:** high maintenance, fights upstream model, OAuth/tool UX overhead without clear gain over skill+shell.

### D. Embed / rebrand browser in Tauri

Out of scope: closed binary, huge footprint, license/support, not "plug-in".

---

## 5. Proposed Grok packaging layout

```text
vendor/
  ego-lite.pin
  ego-lite/                    # optional clone (not committed if large)
  ego-grok-adapted/            # adapter output
    .grok-plugin/plugin.json
    skills/ego-browser/        # copy of upstream skill (no content fork)
      SKILL.md
      references/install.md
      scripts/install.sh
      learnings/...
    assets/
```

Minimal `.grok-plugin/plugin.json` (illustrative):

```json
{
  "name": "ego-lite",
  "version": "1.2.x",
  "description": "Browser automation for AI agents through ego lite.",
  "homepage": "https://lite.ego.app/document/",
  "repository": "https://github.com/citrolabs/ego-lite",
  "license": "MIT",
  "keywords": ["browser-automation", "ego-browser"]
}
```

No `.mcp.json` in v1.

App constants (parallel to ChatCut):

| Constant | Value sketch |
|----------|----------------|
| Recommended id | `ego-lite` |
| Install source | `https://github.com/citrolabs/ego-lite` or pin-adapted absolute path |
| Match installed | name `ego-lite` / `ego` / path contains `citrolabs/ego-lite` |

Skill rewrite policy: **never fork SKILL.md** for branding; only App-owned install/doctor strings (i18n). If PATH notes are wrong for independent mode, document in App doctor + llm-wiki, not by rewriting skill body.

---

## 6. Runtime & ops checklist (Grok-specific)

| Topic | Action |
|-------|--------|
| **PATH** | Ensure agent shell sees `~/.local/bin` (or resolve bundle helper path). Dock-launched App already enriches PATH for CLI probe — extend doctor for ego. |
| **Permissions** | Browser tasks need shell + ability to open external apps; document YOLO / full-access expectation (upstream does for Codex). |
| **Sandbox** | If workspace sandbox blocks launching `/Applications`, surface honest error + "allow shell / disable sandbox for browser tasks". |
| **Independent GROK_HOME** | Plugin install must target agent-home when App uses independent mode (same ChatCut pitfall). |
| **Platform gate** | macOS: full flow. Windows/Linux: show "browser not available on this OS" — still allow skill install for future, or hide recommended row. |
| **Trust** | Confirm dialog: third-party skill + separate binary from citrolabs CDN; never auto-install. |
| **Updates** | Skill: re-pull pin + re-adapt (ChatCut flow). Browser: ego lite self-update / re-download DMG. |
| **Handoff UX** | Agent may Ask user to complete login in ego lite GUI; App AskUser / permission UI already exists — no special Ego panel required for v1. |
| **Screenshots** | `captureScreenshot` may write files; media-delivery / Files workspace can open paths if agent reports absolute paths. |

---

## 7. Comparison: ego vs alternatives (for product framing)

| Approach | Login reuse | Parallel with user | Integration style | Platform | Fit as plug-in |
|----------|-------------|--------------------|-------------------|----------|----------------|
| **ego lite** | Strong (Chrome migrate) | Task Spaces | Skill + `ego-browser` CLI | macOS first | **Best** |
| Vercel agent-browser / Playwright | Weak / separate profile | Contended | CLI or MCP | Cross-platform | Possible, heavier |
| In-app EmbeddedBrowser | Session cookies only for that webview | Same pane | URL open only | All | Not automation |
| Cloud browser (Browserbase etc.) | Managed | Remote | MCP | All | Cost + privacy |

---

## 8. Risks & open questions

1. **Closed browser dependency** — product quality and DMG channel are outside our control; pin skill separately from browser version.
2. **macOS-only gap** vs Grok App multi-platform messaging — copy must be honest.
3. **PATH / onboarding race** — skill assumes user finished ego GUI onboarding; App doctor must not claim "ready" after DMG install alone.
4. **Skill tool assumption** — SKILL.md says use `Bash` tool; Grok may label tools differently — usually still shell; verify on real Grok Build agent.
5. **Does `grok plugin install` accept raw ego-lite repo** (Codex layout) without adapter? Prefer validate on adapted tree (ChatCut lesson: install does not follow symlinks).
6. **Upstream skill auto-write** — ego onboarding may inject skills into `~/.agents/skills` / `~/.claude/skills`; may **not** hit Grok independent agent-home — plug-in install remains necessary.
7. **Security narrative** — browser automation with real logins is powerful; confirm + Doctor honesty required.

---

## 9. Suggested delivery slices (if we greenlight)

| Slice | Outcome |
|-------|---------|
| **S0 Research** | This doc (done) |
| **S1 Adapter** | `ego-plugin-start.mjs` + pin + fixture + `plugin validate` green |
| **S2 Recommended UI** | Second recommended row + match/uninstall parity with ChatCut |
| **S3 Browser guide** | Post-install setup panel / Doctor: detect app + PATH; open download or run install.sh with consent |
| **S4 llm-wiki** | `docs/llm-wiki/ego-browser.md` (parity with chatcut.md) |
| **S5 Optional** | Host helper to resolve `ego-browser` absolute path for sparse PATH; PATH inject on agent spawn |
| **Out of scope v1** | MCP wrapper, Windows binary, in-app CDP, forking SKILL.md |

---

## 10. Conclusion

**ego-lite is a viable outer plug-in for Grok App browser automation**, with the right mental model:

- **Plug-in delivers the skill** (and optional site learnings).
- **Browser body is a guided external download** (upstream install.sh / DMG), not something we ship inside Grok App.
- **MCP packaging is optional and currently unnecessary** — upstream is skill+CLI; wrapping MCP would be a Grok-only invention that adds cost without matching design.

Closest implementation template in-tree: **ChatCut recommended plug-in** (`pluginRecommended.ts`, `chatcutCodexAdapter.ts`, `scripts/chatcut-plugin-start.mjs`, `docs/llm-wiki/chatcut.md`), simplified by dropping MCP/OAuth.

**Go / no-go for prototype:** **Go on macOS** as Recommended plug-in + setup doctor. **No-go** as core-embedded browser or as MCP-first product until upstream or we prove discrete tools beat heredoc JS.

---

## References

- Upstream: https://github.com/citrolabs/ego-lite  
- Docs: https://lite.ego.app/document/  
- Grok: `docs/llm-wiki/plugins-marketplace.md`, `docs/llm-wiki/chatcut.md`  
- App code: `src/lib/pluginRecommended.ts`, `src/lib/chatcutCodexAdapter.ts`, `scripts/chatcut-plugin-start.mjs`
