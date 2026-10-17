//! TodoGate (CLI 0.2.117+) — spawn flag + agent-home config.toml sync.
//!
//! CLI: top-level `--todo-gate` (session-scoped; overrides remote
//! `todo_gate_enabled` and the built-in default `false`).
//!
//! Config keys (independent agent-home only):
//! - `todo_gate_enabled` (bool)
//! - `todo_gate_max_fires_per_prompt` (u32, 1–20)
//!
//! Shared mode never rewrites `~/.grok/config.toml`.

use crate::agent_home_config::{
    set_top_level_assignment, set_top_level_bool, update_config_toml_if_independent,
};

pub const MIN_TODO_GATE_MAX_FIRES: u32 = 1;
pub const MAX_TODO_GATE_MAX_FIRES: u32 = 20;
pub const DEFAULT_TODO_GATE_MAX_FIRES: u32 = 3;

/// Normalize max fires: 0 / None → default; clamp 1–20.
pub fn normalize_todo_gate_max_fires(raw: Option<u32>) -> u32 {
    match raw {
        None | Some(0) => DEFAULT_TODO_GATE_MAX_FIRES,
        Some(n) => n.clamp(MIN_TODO_GATE_MAX_FIRES, MAX_TODO_GATE_MAX_FIRES),
    }
}

/// Top-level CLI flags (before `agent`) when enabled.
pub fn todo_gate_spawn_flags(enabled: bool) -> Vec<&'static str> {
    if enabled {
        vec!["--todo-gate"]
    } else {
        vec![]
    }
}

/// Apply spawn flag on a tokio Command (top-level, before `agent`).
pub fn apply_todo_gate_to_command(cmd: &mut tokio::process::Command, enabled: bool) {
    for flag in todo_gate_spawn_flags(enabled) {
        cmd.arg(flag);
    }
}

/// Upsert both TodoGate keys into a TOML-ish text blob.
pub fn set_todo_gate_in_toml(text: &str, enabled: bool, max_fires: u32) -> String {
    let fires = normalize_todo_gate_max_fires(Some(max_fires));
    let with_enabled = set_top_level_bool(text, "todo_gate_enabled", enabled);
    set_top_level_assignment(
        &with_enabled,
        "todo_gate_max_fires_per_prompt",
        &fires.to_string(),
    )
}

/// Write TodoGate keys into App agent-home (independent GROK_HOME only).
pub fn sync_todo_gate_to_agent_profile(
    session_data_mode: &str,
    enabled: bool,
    max_fires: u32,
) -> Result<(), String> {
    let fires = normalize_todo_gate_max_fires(Some(max_fires));
    let path = update_config_toml_if_independent(session_data_mode, |existing| {
        set_todo_gate_in_toml(existing, enabled, fires)
    })?;
    if let Some(path) = path {
        tracing::info!(
            "agent_todo_gate: synced todo_gate_enabled={} todo_gate_max_fires_per_prompt={} → {}",
            enabled,
            fires,
            path.display()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_and_flags() {
        assert_eq!(
            normalize_todo_gate_max_fires(None),
            DEFAULT_TODO_GATE_MAX_FIRES
        );
        assert_eq!(
            normalize_todo_gate_max_fires(Some(0)),
            DEFAULT_TODO_GATE_MAX_FIRES
        );
        assert_eq!(normalize_todo_gate_max_fires(Some(1)), 1);
        assert_eq!(normalize_todo_gate_max_fires(Some(20)), 20);
        assert_eq!(normalize_todo_gate_max_fires(Some(99)), 20);
        assert!(todo_gate_spawn_flags(false).is_empty());
        assert_eq!(todo_gate_spawn_flags(true), vec!["--todo-gate"]);
    }

    #[test]
    fn upserts_top_level_keys() {
        let t = set_todo_gate_in_toml("", true, 5);
        assert!(t.contains("todo_gate_enabled = true"));
        assert!(t.contains("todo_gate_max_fires_per_prompt = 5"));

        let existing = "[ui]\nyolo = false\n\n[subagents]\nenabled = true\n";
        let next = set_todo_gate_in_toml(existing, false, 2);
        assert!(next.contains("todo_gate_enabled = false"));
        assert!(next.contains("todo_gate_max_fires_per_prompt = 2"));
        // Keys sit before tables.
        let ui_pos = next.find("[ui]").unwrap();
        let en_pos = next.find("todo_gate_enabled").unwrap();
        assert!(en_pos < ui_pos);
        assert!(next.contains("[subagents]"));
        assert!(next.contains("yolo = false"));

        // Update existing root keys.
        let again = set_todo_gate_in_toml(&next, true, 99);
        assert!(again.contains("todo_gate_enabled = true"));
        assert!(again.contains("todo_gate_max_fires_per_prompt = 20"));
        assert_eq!(again.matches("todo_gate_enabled").count(), 1);
        assert_eq!(again.matches("todo_gate_max_fires_per_prompt").count(), 1);
    }

    #[test]
    fn shared_mode_skips_write() {
        assert!(sync_todo_gate_to_agent_profile("shared", true, 5).is_ok());
    }
}
