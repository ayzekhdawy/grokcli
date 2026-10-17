# Structural inventory (honest screenshot substitute)

Full-window screencapture previously captured IDE chrome (blank white overlay), not Grok App content. Until interactive window capture is reliable, this inventory is the visual acceptance artifact paired with source + token CSS.

## Shell
- Frameless: `src-tauri/tauri.conf.json` → `decorations: false`
- Dark tokens: `src/styles/tokens.css` `[data-theme="dark"]` `--bg-app: #0d0d0d`
- Light tokens: full isomorphic set under `[data-theme="light"]`
- Title drag: `.titlebar-drag` + `data-tauri-drag-region`

## Left nav (reference-shaped)
| Item | Source |
|------|--------|
| Logo + Grok App | `App.tsx` `.brand` |
| New chat | button `nav-new` |
| Chat (amber active) | `Nav id=chat` + `.nav-item--active` |
| Sessions | Nav |
| MCP Servers | Nav + soon badge |
| Plugins | Nav + soon |
| Worktrees | Nav + soon |
| Memory | Nav + soon |
| Config & Auth | Nav → settings modal |
| Recents | session list from `sessions_list` |
| User corner | footer Local / MIT non-official |

## Center
| Item | Source |
|------|--------|
| Chat title + agent stdio subtitle | `.main__title` / `.main__sub` |
| Reasoning fold | `.fold` when thought present |
| working… | `.working` when streaming |
| Plan card | `.plan-card` always in DOM |
| Messages | `.messages` + stream events |
| Permission bar | `.perm-bar` + `mapPermissionButtons(perm.options)` |
| Composer + chips | project · model · effort · mode · **Ask** |

## Right
- Aside default collapsed (`DEFAULT_LAYOUT.asideCollapsed: true`)

## Policy diffs vs 参考图
- Bottom permission default **Ask** not Always approve
- Brand Grok App + non-official

## Evidence commands
```bash
pnpm test
cd src-tauri && cargo test permission
grep -n "nav-item--active\|plan-card\|chip--ask\|decorations" src src-tauri
```
