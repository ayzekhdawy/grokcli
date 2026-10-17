# Diagnostics center

Free-form host errors are classified into product decks (CLI / auth / network / crash) via `classifyErrorMessage` / `resolveErrorDeckCode`.

## Reliability / Observability panel

UI entry points: command palette (`reliability` / observability), Settings → Runtime → Tools, Doctor → Advanced.

Pure assembly: `src/lib/reliabilityCenter.ts` (`buildReliabilityCenter` / `assembleReliabilityCenter`) from:

| Card | Source |
|------|--------|
| Busy sessions | `liveMap` via activity rules (titles from session list) |
| Stall signals | Active soft stall, liveMap `terminalReason: stall`, in-memory hard_end ring |
| Recent errors | Current error-deck banner + in-memory ring of prior cards |

Actions reuse Host APIs: `exportSupportBundle`, open Doctor. Export from Reliability center also attaches a redacted **stall timeline** snapshot (`stall-timeline.json`: structured kinds/seconds/session ids only; Host runs `redact_text`). The Stall timeline card can **download** a client-side redacted history JSON (`buildStallHistoryExport` / known fields only), **clear** via GlassModal confirm (`planClearStallHistory`), and **Open session** when the row’s session id is still in the app list (`planOpenStallSession`). Empty honesty distinguishes no history vs filter-empty (`resolveStallTimelineEmptyState`); durations use `formatStallDuration`. Does **not** scrape secrets from logs into the UI.

## Windows day-use checklist

Acceptance source: [`docs/验收/windows-dayuse-acceptance.md`](../验收/windows-dayuse-acceptance.md).

UI: **Doctor** card “Windows day-use” (always visible with platform badge; non-Windows shows N/A honesty). Pure helpers: `src/lib/windowsDayuseChecklist.ts`.

| Item id | Auto-probe? | Notes |
|---------|-------------|--------|
| `install_path` | Manual unless host probes SmartScreen/signature | Never invent unsigned status |
| `cli_found` | Doctor CLI probe | Fail when missing |
| `project_spaces` | Trusted projects + path whitespace | Manual if project exists without spaces |
| `single_attachment` | Always manual | Paste-once cannot be auto-proven |
| `app_update_check` | `updater_status` / auto-update support | Links to Settings → About |
| `mirror_readonly` | `mirror_status.readOnly` | Pass when write off (default) |

## Host file logs

On startup the Host enables dual-sink tracing:

| Sink | Location |
|------|----------|
| stderr | When launched from a terminal |
| Daily rolling file | `{app_data}/logs/app.log.YYYY-MM-DD` |

`RUST_LOG` still controls the filter (default `info`). Support bundles and Doctor can pick up the `logs/` directory after a mid-turn failure.

## Tool heartbeat (protocol)

While a turn has open tool call ids, Host emits (about every 25s):

```json
{
  "sessionId": "…",
  "toolCallIds": ["…"],
  "openCount": 1,
  "intervalSecs": 25
}
```

Event name: `session://tool_heartbeat`. Purpose: re-arm stream-stall progress and
give UI/diagnostics an explicit “tools still open” signal without requiring CLI
progress lines. Heartbeats stop if the oldest open tool exceeds 3 hours.
