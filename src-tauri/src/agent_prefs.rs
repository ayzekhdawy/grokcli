//! Sync App composer prefs into the agent process environment.
//!
//! Independent mode (`GROK_HOME` = app agent-home): write `[ui]` permission keys so
//! Grok Build enforces dontAsk / acceptEdits / YOLO at the agent layer (not only Host).
//! Shared mode leaves `~/.grok/config.toml` alone — Host policy + spawn flags only.

use std::fs;
use std::path::PathBuf;

use crate::agent_home_config::{
    set_table_bool, set_table_string, update_config_toml_if_independent,
};
use crate::paths::{agent_home_dir, resolve_agent_grok_home};
use crate::permission::PermissionPolicy;

/// Map App policy → `[ui] permission_mode` values used by Grok Build config.toml.
pub fn ui_permission_mode(policy: &str) -> &'static str {
    match PermissionPolicy::parse(policy) {
        PermissionPolicy::AcceptEdits => "acceptEdits",
        PermissionPolicy::DontAsk => "dontAsk",
        PermissionPolicy::Auto => "auto",
        PermissionPolicy::AlwaysApprove => "always-approve",
        PermissionPolicy::AllowForSession
        | PermissionPolicy::AllowOnce
        | PermissionPolicy::Deny
        | PermissionPolicy::Ask => "default",
    }
}

/// Claude Code-compatible `defaultMode` for `.claude/settings.json`.
pub fn claude_default_mode(policy: &str) -> &'static str {
    match PermissionPolicy::parse(policy) {
        PermissionPolicy::AcceptEdits => "acceptEdits",
        PermissionPolicy::DontAsk => "dontAsk",
        PermissionPolicy::Auto => "auto",
        PermissionPolicy::AlwaysApprove => "bypassPermissions",
        _ => "default",
    }
}

/// Apply `[ui] permission_mode` + `yolo` to a TOML-ish text blob (exact key match).
pub fn set_permission_in_toml(text: &str, permission_policy: &str) -> String {
    let mode = ui_permission_mode(permission_policy);
    let yolo = matches!(
        PermissionPolicy::parse(permission_policy),
        PermissionPolicy::AlwaysApprove
    );
    let mut next = set_table_string(text, "ui", "permission_mode", mode);
    next = set_table_bool(&next, "ui", "yolo", yolo);
    next
}

/// Write permission prefs into App agent-home (independent GROK_HOME only).
pub fn sync_permission_to_agent_profile(
    session_data_mode: &str,
    permission_policy: &str,
) -> Result<(), String> {
    let mode = ui_permission_mode(permission_policy);
    let yolo = matches!(
        PermissionPolicy::parse(permission_policy),
        PermissionPolicy::AlwaysApprove
    );
    let path = update_config_toml_if_independent(session_data_mode, |existing| {
        set_permission_in_toml(existing, permission_policy)
    })?;

    // Belt-and-suspenders: Claude-compatible defaultMode (agent reads when present).
    // Only touch agent-home under independent mode (same gate as config write).
    if path.is_some() {
        let claude_dir = agent_home_dir().join(".claude");
        let _ = fs::create_dir_all(&claude_dir);
        let settings = serde_json::json!({
            "permissions": {
                "defaultMode": claude_default_mode(permission_policy)
            }
        });
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&settings).unwrap_or_else(|_| "{}".into()),
        )
        .map_err(|e| e.to_string())?;

        if let Some(ref path) = path {
            tracing::info!(
                "agent_prefs: synced permission_mode={mode} yolo={yolo} → {}",
                path.display()
            );
        }
    }
    Ok(())
}

/// Map product session mode → ACP `session/set_mode` modeId candidates (first wins).
pub fn product_mode_candidates(mode: &str) -> Vec<&'static str> {
    match mode.trim().to_ascii_lowercase().as_str() {
        "plan" => vec!["plan", "Plan"],
        "ask" => vec!["ask", "Ask"],
        // Agent / default coding mode
        _ => vec!["agent", "default", "code", "normal", "Agent"],
    }
}

/// GROK_HOME path for logging / tests.
#[allow(dead_code)]
pub fn agent_grok_home(session_data_mode: &str) -> PathBuf {
    resolve_agent_grok_home(session_data_mode)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_home_config::count_duplicate_assignments;

    #[test]
    fn maps_policies() {
        assert_eq!(ui_permission_mode("ask"), "default");
        assert_eq!(ui_permission_mode("accept_edits"), "acceptEdits");
        assert_eq!(ui_permission_mode("auto"), "auto");
        assert_eq!(ui_permission_mode("dont_ask"), "dontAsk");
        assert_eq!(ui_permission_mode("always_approve"), "always-approve");
        assert_eq!(claude_default_mode("always_approve"), "bypassPermissions");
        assert_eq!(claude_default_mode("auto"), "auto");
    }

    #[test]
    fn upserts_ui_table() {
        let t = set_permission_in_toml("", "ask");
        assert!(t.contains("[ui]"));
        assert!(t.contains("permission_mode = \"default\""));
        assert!(t.contains("yolo = false"));
        let t2 = set_permission_in_toml(&t, "always_approve");
        assert!(t2.contains("permission_mode = \"always-approve\""));
        assert!(t2.contains("yolo = true"));
        assert_eq!(t2.matches("permission_mode").count(), 1);
        assert_eq!(t2.matches("yolo =").count(), 1);
    }

    #[test]
    fn does_not_prefix_match_yolo_mode() {
        let base = "[ui]\npermission_mode = \"default\"\nyolo_mode = false\nyolo = false\n";
        let next = set_permission_in_toml(base, "always_approve");
        assert!(next.contains("yolo_mode = false"), "{next}");
        assert!(next.contains("yolo = true"), "{next}");
        assert_eq!(next.matches("yolo =").count(), 1, "{next}");
        assert_eq!(count_duplicate_assignments(&next).0, 0, "{next}");
    }

    #[test]
    fn shared_mode_skips_write() {
        assert!(sync_permission_to_agent_profile("shared", "always_approve").is_ok());
    }
}
