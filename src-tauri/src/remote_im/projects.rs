//! Load trusted projects from Grok App `projects.json`.
//!
//! Project scope formats (GUI + legacy):
//! - `"all_trusted"` (string) — Settings default
//! - `{ "allow": ["id", ...] }` — Settings whitelist chips
//! - `{ "mode": "all_trusted" | "whitelist", "projectIds": [...] }` — legacy

use super::types::TrustedProject;
use crate::paths::app_data_root;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

pub fn load_trusted_projects() -> Vec<TrustedProject> {
    let roots = [
        app_data_root(),
        PathBuf::from(std::env::var("GROK_APP_HOME").unwrap_or_default()),
    ];
    for root in roots {
        if root.as_os_str().is_empty() {
            continue;
        }
        let file = root.join("projects.json");
        if !file.is_file() {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&file) else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        let Some(arr) = v.as_array() else {
            continue;
        };
        let mut out = Vec::new();
        for p in arr {
            let trusted = p.get("trusted").and_then(|x| x.as_bool()).unwrap_or(false);
            if !trusted {
                continue;
            }
            let id = p.get("id").and_then(|x| x.as_str()).unwrap_or("");
            let path = p.get("path").and_then(|x| x.as_str()).unwrap_or("");
            if id.is_empty() || path.is_empty() {
                continue;
            }
            let name = p
                .get("name")
                .and_then(|x| x.as_str())
                .unwrap_or(id)
                .to_string();
            out.push(TrustedProject {
                id: id.to_string(),
                name,
                path: path.to_string(),
            });
        }
        return out;
    }
    Vec::new()
}

/// Allow-list of project ids when scope is whitelist; `None` = all trusted.
///
/// Accepts GUI (`"all_trusted"` | `{ allow: [...] }`) and legacy
/// (`{ mode, projectIds }`). Empty allow list still means whitelist with no
/// projects (not "all").
pub fn scope_allow_ids(project_scope: &serde_json::Value) -> Option<Vec<String>> {
    // GUI string form
    if let Some(s) = project_scope.as_str() {
        return if s == "all_trusted" || s.is_empty() {
            None
        } else {
            // Unknown string → fail closed to empty whitelist
            Some(vec![])
        };
    }

    // GUI whitelist: { allow: string[] }
    if let Some(arr) = project_scope.get("allow").and_then(|x| x.as_array()) {
        return Some(
            arr.iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
        );
    }

    // Legacy: { mode, projectIds }
    let mode = project_scope
        .get("mode")
        .and_then(|m| m.as_str())
        .unwrap_or("all_trusted");
    if mode == "whitelist" {
        if let Some(ids) = project_scope.get("projectIds").and_then(|x| x.as_array()) {
            return Some(
                ids.iter()
                    .filter_map(|x| x.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect(),
            );
        }
        return Some(vec![]);
    }

    None
}

/// Filter trusted projects by instance project_scope (no arbitrary paths).
pub fn filter_by_scope(
    projects: &[TrustedProject],
    project_scope: &serde_json::Value,
) -> Vec<TrustedProject> {
    match scope_allow_ids(project_scope) {
        None => projects.to_vec(),
        Some(ids) => {
            let set: HashSet<&str> = ids.iter().map(|s| s.as_str()).collect();
            projects
                .iter()
                .filter(|p| set.contains(p.id.as_str()))
                .cloned()
                .collect()
        }
    }
}

/// Load trusted projects then apply instance scope.
pub fn load_scoped_projects(project_scope: &serde_json::Value) -> Vec<TrustedProject> {
    let all = load_trusted_projects();
    filter_by_scope(&all, project_scope)
}

/// Default work dir from instance project_scope JSON (first scoped trusted path).
/// Empty / fail-closed scope → `None` (never `$HOME`).
pub fn default_work_dir(project_scope: &serde_json::Value) -> Option<String> {
    load_scoped_projects(project_scope)
        .into_iter()
        .next()
        .map(|p| p.path)
}

fn normalize_scope_path(path: &str) -> String {
    let mut s = path.trim().replace('\\', "/");
    while s.len() > 1 && s.ends_with('/') {
        s.pop();
    }
    s
}

fn path_is_under_project(work_dir: &str, project_path: &str) -> bool {
    let child = normalize_scope_path(work_dir);
    let root = normalize_scope_path(project_path);
    if child.is_empty() || root.is_empty() {
        return false;
    }
    child == root || child.starts_with(&(root + "/"))
}

/// True when a persisted binding is still inside the instance project scope.
///
/// - `project_id` present → must match a scoped project id
/// - legacy work_dir-only → path must be the project root or a subdirectory
/// - empty scope or empty binding → false
pub fn binding_allowed_in_scope(
    project_id: Option<&str>,
    work_dir: &str,
    scoped: &[TrustedProject],
) -> bool {
    if scoped.is_empty() {
        return false;
    }
    if let Some(id) = project_id.map(str::trim).filter(|s| !s.is_empty()) {
        return scoped.iter().any(|p| p.id == id);
    }
    if work_dir.trim().is_empty() {
        return false;
    }
    scoped
        .iter()
        .any(|p| path_is_under_project(work_dir, &p.path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> Vec<TrustedProject> {
        vec![
            TrustedProject {
                id: "p1".into(),
                name: "One".into(),
                path: "/tmp/one".into(),
            },
            TrustedProject {
                id: "p2".into(),
                name: "Two".into(),
                path: "/tmp/two".into(),
            },
            TrustedProject {
                id: "p3".into(),
                name: "Three".into(),
                path: "/tmp/three".into(),
            },
        ]
    }

    #[test]
    fn all_trusted_string_and_object_pass_through() {
        let all = sample();
        assert_eq!(filter_by_scope(&all, &json!("all_trusted")).len(), 3);
        assert_eq!(
            filter_by_scope(&all, &json!({ "mode": "all_trusted" })).len(),
            3
        );
        assert!(scope_allow_ids(&json!("all_trusted")).is_none());
    }

    #[test]
    fn gui_allow_whitelist_filters() {
        let all = sample();
        let scoped = filter_by_scope(&all, &json!({ "allow": ["p2", "p3"] }));
        assert_eq!(scoped.len(), 2);
        assert_eq!(scoped[0].id, "p2");
        assert_eq!(scoped[1].id, "p3");
    }

    #[test]
    fn legacy_project_ids_whitelist_filters() {
        let all = sample();
        let scoped = filter_by_scope(&all, &json!({ "mode": "whitelist", "projectIds": ["p1"] }));
        assert_eq!(scoped.len(), 1);
        assert_eq!(scoped[0].id, "p1");
    }

    #[test]
    fn empty_whitelist_yields_no_projects() {
        let all = sample();
        assert!(filter_by_scope(&all, &json!({ "allow": [] })).is_empty());
        assert!(
            filter_by_scope(&all, &json!({ "mode": "whitelist", "projectIds": [] })).is_empty()
        );
    }

    #[test]
    fn unknown_string_scope_is_fail_closed() {
        let all = sample();
        assert!(filter_by_scope(&all, &json!("weird")).is_empty());
    }

    #[test]
    fn default_work_dir_is_none_for_empty_allow() {
        assert!(default_work_dir(&json!({ "allow": [] })).is_none());
        assert!(default_work_dir(&json!("weird")).is_none());
    }

    #[test]
    fn binding_allowed_requires_scoped_project() {
        let scoped = sample();
        assert!(binding_allowed_in_scope(Some("p2"), "/tmp/two", &scoped));
        assert!(!binding_allowed_in_scope(Some("gone"), "/tmp/two", &scoped));
        assert!(binding_allowed_in_scope(None, "/tmp/one/src", &scoped));
        assert!(!binding_allowed_in_scope(None, "/tmp/other", &scoped));
        assert!(!binding_allowed_in_scope(Some("p1"), "/tmp/one", &[]));
        assert!(!binding_allowed_in_scope(None, "", &scoped));
    }
}
