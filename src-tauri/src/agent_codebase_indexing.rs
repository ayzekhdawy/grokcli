//! Codebase indexing — allowlisted read/write of
//! `[features].codebase_indexing` in the active `GROK_HOME` `config.toml`.
//!
//! ## Semantics (Grok Build user guide)
//! - **Code graph** indexing for search / code-nav — **not** memory embeddings.
//! - CLI default when unset: **true**.
//! - Value may be bool or richer forms (globs). App writes **bool only**.
//!
//! ## Honesty / soft-fail
//! - Missing key stays `None` (never invent “on” as a set key).
//! - Non-bool forms surface as `kind = "custom"` with raw text (read-only).
//! - Writes are path-scoped to independent agent-home only (never `~/.grok`).
//! - Shared mode is read-only against the live `~/.grok/config.toml`.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::agent_config_edit::{
    is_agent_home_config_path, parse_toml_bool, parse_toml_scalar, require_agent_home_config_path,
    set_table_key,
};
use crate::agent_config_view::{config_toml_path, normalize_mode};
use crate::paths::{agent_config_toml, agent_home_dir, ensure_app_dirs, resolve_agent_grok_home};
use crate::store;

/// Hard cap on bytes read before parse.
pub const MAX_CODEBASE_INDEXING_CONFIG_BYTES: u64 = 256 * 1024;

/// CLI documented default when the key is missing.
pub const CLI_DEFAULT_ENABLED: bool = true;

/// Snapshot for Settings UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodebaseIndexingSnapshot {
    /// Absolute path of the config.toml being shown (active mode).
    pub path: String,
    /// Absolute GROK_HOME root for this mode.
    pub grok_home: String,
    /// `independent` | `shared`
    pub mode: String,
    /// True only when mode is independent (edits apply to App agent-home).
    pub writable: bool,
    pub file_exists: bool,
    /// `unset` | `bool` | `custom`
    pub kind: String,
    /// Bool form when `kind == "bool"`; otherwise null.
    pub enabled: Option<bool>,
    /// Raw non-bool assignment when `kind == "custom"`.
    pub custom_raw: Option<String>,
    /// CLI default when key is unset (always true per user guide).
    pub cli_default: bool,
    /// Derived: effective enable following CLI default for unset / custom.
    pub effective_enabled: bool,
    /// Redacted one-line preview of the features assignment when present.
    pub redacted_preview: String,
    /// Always false: this surface is code-graph only, never embeddings.
    pub invents_embeddings: bool,
}

/// Partial patch. `None` = leave unchanged. Only bool writes.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodebaseIndexingPatch {
    pub enabled: Option<bool>,
}

impl CodebaseIndexingPatch {
    pub fn is_empty(&self) -> bool {
        self.enabled.is_none()
    }
}

/// Parsed allowlisted value (soft-fail missing).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CodebaseIndexingFlags {
    /// Present only for bool form.
    pub enabled: Option<bool>,
    /// Present only for non-bool form.
    pub custom_raw: Option<String>,
}

impl CodebaseIndexingFlags {
    pub fn kind(&self) -> &'static str {
        if self.custom_raw.is_some() {
            "custom"
        } else if self.enabled.is_some() {
            "bool"
        } else {
            "unset"
        }
    }

    pub fn effective_enabled(&self) -> bool {
        match self.kind() {
            "bool" => self.enabled == Some(true),
            "custom" => true,
            _ => CLI_DEFAULT_ENABLED,
        }
    }
}

/// Extract `[features].codebase_indexing` from full config text (pure).
pub fn parse_codebase_indexing_flags(text: &str) -> CodebaseIndexingFlags {
    let mut flags = CodebaseIndexingFlags::default();
    let mut table = String::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            table = trimmed
                .trim_start_matches('[')
                .trim_end_matches(']')
                .to_string();
            continue;
        }
        let Some(eq) = trimmed.find('=') else {
            continue;
        };
        let key = trimmed[..eq].trim();
        let val = trimmed[eq + 1..].trim();
        // Strip inline comments for unquoted values carefully via parse helpers.
        if table == "features" && key == "codebase_indexing" {
            if let Some(b) = parse_toml_bool(val) {
                flags.enabled = Some(b);
                flags.custom_raw = None;
            } else {
                // Non-bool: globs / arrays / tables — keep raw honesty.
                let raw = parse_toml_scalar(val);
                if !raw.is_empty() {
                    flags.enabled = None;
                    flags.custom_raw = Some(raw);
                }
            }
        }
    }

    flags
}

/// Apply a bool patch onto TOML text (pure). Never rewrites secrets / globs.
pub fn apply_codebase_indexing_patch(text: &str, patch: &CodebaseIndexingPatch) -> String {
    let mut next = text.to_string();
    if let Some(v) = patch.enabled {
        next = set_table_key(
            &next,
            "features",
            "codebase_indexing",
            if v { "true" } else { "false" },
            false,
        );
    }
    next
}

/// Extract a short redacted preview of the features key line if present.
pub fn extract_codebase_indexing_preview(text: &str) -> String {
    let mut out = String::new();
    let mut in_features = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            let name = trimmed.trim_start_matches('[').trim_end_matches(']');
            in_features = name == "features";
            if in_features {
                out.push_str(trimmed);
                out.push('\n');
            }
            continue;
        }
        if in_features {
            // Keep only the codebase_indexing assignment (and blank lines around it).
            if (trimmed.starts_with("codebase_indexing")
                || trimmed.is_empty()
                || trimmed.starts_with('#'))
                && (trimmed.starts_with("codebase_indexing") || !out.is_empty())
            {
                out.push_str(line);
                out.push('\n');
            }
        }
    }
    // If we only got the header with no key, still return the header when key missing? Keep empty.
    if out
        .lines()
        .any(|l| l.trim().starts_with("codebase_indexing"))
    {
        out
    } else {
        String::new()
    }
}

fn read_config_text(path: &Path) -> (String, bool) {
    if !path.is_file() {
        return (String::new(), false);
    }
    let meta_len = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let truncated = meta_len > MAX_CODEBASE_INDEXING_CONFIG_BYTES;
    match fs::read(path) {
        Ok(bytes) => {
            let slice = if bytes.len() as u64 > MAX_CODEBASE_INDEXING_CONFIG_BYTES {
                &bytes[..MAX_CODEBASE_INDEXING_CONFIG_BYTES as usize]
            } else {
                &bytes
            };
            let mut s = String::from_utf8_lossy(slice).into_owned();
            if truncated {
                s.push_str("\n# … [truncated] …\n");
            }
            (s, true)
        }
        Err(_) => (String::new(), false),
    }
}

fn snapshot_from_raw(
    path: &Path,
    home: &Path,
    mode: &str,
    raw: &str,
    exists: bool,
) -> CodebaseIndexingSnapshot {
    let flags = parse_codebase_indexing_flags(raw);
    let preview = extract_codebase_indexing_preview(raw);
    CodebaseIndexingSnapshot {
        path: path.to_string_lossy().to_string(),
        grok_home: home.to_string_lossy().to_string(),
        mode: mode.to_string(),
        writable: mode == "independent",
        file_exists: exists,
        kind: flags.kind().to_string(),
        enabled: flags.enabled,
        custom_raw: flags.custom_raw.clone(),
        cli_default: CLI_DEFAULT_ENABLED,
        effective_enabled: flags.effective_enabled(),
        redacted_preview: preview,
        invents_embeddings: false,
    }
}

/// Load codebase-indexing snapshot for the active session data mode.
/// Soft-fails: missing file / missing keys → empty / `None` fields, never error.
pub fn load_codebase_indexing() -> Result<CodebaseIndexingSnapshot, String> {
    let settings = store::load_settings();
    let mode = normalize_mode(&settings.session_data_mode);
    if mode == "independent" {
        let _ = ensure_app_dirs();
    }
    let path = config_toml_path(mode);
    let home = resolve_agent_grok_home(mode);
    let (raw, exists) = read_config_text(&path);
    Ok(snapshot_from_raw(&path, &home, mode, &raw, exists))
}

/// Apply allowlisted bool patch to agent-home config.toml. Shared mode refused.
pub fn save_codebase_indexing(
    patch: &CodebaseIndexingPatch,
) -> Result<CodebaseIndexingSnapshot, String> {
    let settings = store::load_settings();
    let mode = normalize_mode(&settings.session_data_mode);
    if mode != "independent" {
        return Err(
            "shared session mode: agent-home config.toml is not the live GROK_HOME; switch to independent to edit codebase_indexing"
                .into(),
        );
    }

    if patch.is_empty() {
        return load_codebase_indexing();
    }

    let _ = ensure_app_dirs();
    let path = agent_config_toml();
    require_agent_home_config_path(&path)?;
    if !is_agent_home_config_path(&path) {
        return Err(format!(
            "path not allowed: only agent-home config.toml may be edited ({})",
            path.display()
        ));
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create agent-home: {e}"))?;
    }

    let existing = fs::read_to_string(&path).unwrap_or_default();
    if existing.contains("[REDACTED]") {
        tracing::warn!(
            "agent_codebase_indexing: on-disk config contains [REDACTED]; writing patch carefully"
        );
    }
    let next = apply_codebase_indexing_patch(&existing, patch);
    fs::write(&path, &next).map_err(|e| format!("write config: {e}"))?;

    tracing::info!(
        path = %path.display(),
        enabled = ?patch.enabled,
        "agent_codebase_indexing: saved [features].codebase_indexing"
    );

    let home = agent_home_dir();
    let (raw, exists) = read_config_text(&path);
    Ok(snapshot_from_raw(&path, &home, "independent", &raw, exists))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_app_home(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!(
            "grok-codebase-idx-{}-{}-{}",
            label,
            std::process::id(),
            nanos
        ));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn parse_missing_key_is_unset() {
        let flags = parse_codebase_indexing_flags("[ui]\nyolo = true\n");
        assert_eq!(flags, CodebaseIndexingFlags::default());
        assert_eq!(flags.kind(), "unset");
        assert!(flags.effective_enabled()); // CLI default on
    }

    #[test]
    fn parse_bool_forms() {
        let on = parse_codebase_indexing_flags(
            r#"
[features]
codebase_indexing = true
telemetry = false
"#,
        );
        assert_eq!(on.enabled, Some(true));
        assert_eq!(on.custom_raw, None);
        assert_eq!(on.kind(), "bool");
        assert!(on.effective_enabled());

        let off = parse_codebase_indexing_flags(
            r#"
[features]
codebase_indexing = false
"#,
        );
        assert_eq!(off.enabled, Some(false));
        assert!(!off.effective_enabled());
    }

    #[test]
    fn parse_custom_glob_form() {
        let flags = parse_codebase_indexing_flags(
            r#"
[features]
codebase_indexing = "src/**"
"#,
        );
        assert_eq!(flags.enabled, None);
        assert_eq!(flags.custom_raw.as_deref(), Some("src/**"));
        assert_eq!(flags.kind(), "custom");
        assert!(flags.effective_enabled());
    }

    #[test]
    fn apply_patch_writes_bool_preserves_other_keys() {
        let existing = r#"
[models]
default = "grok"

[features]
telemetry = true
codebase_indexing = false

[model.relay]
api_key = "sk-abcdefghijklmnopqrstuvwxyz0123"
"#;
        let next = apply_codebase_indexing_patch(
            existing,
            &CodebaseIndexingPatch {
                enabled: Some(true),
            },
        );
        assert!(next.contains("codebase_indexing = true"), "{next}");
        assert!(next.contains("telemetry = true"), "{next}");
        assert!(next.contains("sk-abcdefghijklmnopqrstuvwxyz0123"), "{next}");
        assert_eq!(next.matches("codebase_indexing").count(), 1);
    }

    #[test]
    fn apply_patch_inserts_features_table_when_missing() {
        let next = apply_codebase_indexing_patch(
            "[ui]\nyolo = false\n",
            &CodebaseIndexingPatch {
                enabled: Some(false),
            },
        );
        assert!(next.contains("[features]"), "{next}");
        assert!(next.contains("codebase_indexing = false"), "{next}");
    }

    #[test]
    fn invents_embeddings_always_false_on_snapshot() {
        let path = PathBuf::from("/tmp/fake-config.toml");
        let home = PathBuf::from("/tmp/fake-home");
        let snap = snapshot_from_raw(&path, &home, "independent", "", false);
        assert!(!snap.invents_embeddings);
        assert_eq!(snap.kind, "unset");
        assert!(snap.effective_enabled);
        assert_eq!(snap.enabled, None);
    }

    #[test]
    fn load_soft_fails_missing_file() {
        let home = temp_app_home("missing");
        // Point store via env if the project supports it — otherwise just unit-test parse.
        let path = home.join("config.toml");
        let (raw, exists) = read_config_text(&path);
        assert!(!exists);
        assert!(raw.is_empty());
        let snap = snapshot_from_raw(&path, &home, "shared", &raw, exists);
        assert!(!snap.file_exists);
        assert!(!snap.writable);
        assert_eq!(snap.kind, "unset");
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn extract_preview_only_when_key_present() {
        let empty = extract_codebase_indexing_preview("[features]\ntelemetry = false\n");
        assert!(empty.is_empty(), "{empty}");
        let with = extract_codebase_indexing_preview(
            "[features]\ncodebase_indexing = true\ntelemetry = false\n",
        );
        assert!(with.contains("codebase_indexing = true"), "{with}");
    }
}
