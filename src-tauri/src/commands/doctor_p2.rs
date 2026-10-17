/// Save arbitrary bytes via native save dialog (share-card PNG, etc.).
/// Returns `{ ok, path, cancelled }`. Cancel → `ok:false, cancelled:true` (not an error).
#[tauri::command]
pub async fn export_bytes_save(
    bytes_base64: String,
    default_name: String,
    dialog_title: Option<String>,
    filter_name: Option<String>,
    extensions: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    let raw = bytes_base64.trim();
    if raw.is_empty() {
        return Err("export payload is empty".into());
    }
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw)
        .map_err(|e| format!("invalid base64: {e}"))?;
    if bytes.is_empty() {
        return Err("export payload is empty".into());
    }
    // Soft cap ~40 MiB decoded — share cards stay well under this.
    if bytes.len() > 40 * 1024 * 1024 {
        return Err("export payload too large".into());
    }

    let name = default_name.trim();
    let name = if name.is_empty() {
        "export.bin".to_string()
    } else {
        // Keep basename only (no path separators).
        name.replace(['/', '\\'], "_")
    };
    let title = dialog_title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Save file")
        .to_string();
    let filter = filter_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("File")
        .to_string();
    let exts: Vec<String> = extensions
        .unwrap_or_else(|| vec!["bin".into()])
        .into_iter()
        .map(|s| s.trim().trim_start_matches('.').to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let exts = if exts.is_empty() {
        vec!["bin".into()]
    } else {
        exts
    };

    tauri::async_runtime::spawn_blocking(move || {
        let ext_refs: Vec<&str> = exts.iter().map(String::as_str).collect();
        let dest = rfd::FileDialog::new()
            .set_title(&title)
            .set_file_name(&name)
            .add_filter(&filter, &ext_refs)
            .save_file();

        let Some(path) = dest else {
            return Ok(serde_json::json!({
                "ok": false,
                "cancelled": true,
                "path": serde_json::Value::Null,
            }));
        };

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create parent dir: {e}"))?;
        }
        std::fs::write(&path, &bytes).map_err(|e| format!("write file: {e}"))?;

        let path_s = path.display().to_string();
        let _ = crate::process_util::reveal_in_file_manager(&path);

        Ok(serde_json::json!({
            "ok": true,
            "cancelled": false,
            "path": path_s,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Save dialog + reveal. Always runs rfd/copy on a blocking thread so async
/// commands (export bundle/trace) do not hang on macOS when the dialog needs
/// main-thread affinity via spawn_blocking.
async fn save_and_reveal_file(
    tmp: std::path::PathBuf,
    dialog_title: &str,
    fallback_name: &str,
    filter_name: &str,
    extensions: &[&str],
) -> Result<serde_json::Value, String> {
    let dialog_title = dialog_title.to_string();
    let fallback_name = fallback_name.to_string();
    let filter_name = filter_name.to_string();
    let extensions: Vec<String> = extensions.iter().map(|s| (*s).to_string()).collect();

    tauri::async_runtime::spawn_blocking(move || {
        save_and_reveal_file_blocking(
            tmp,
            &dialog_title,
            &fallback_name,
            &filter_name,
            &extensions,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

fn save_and_reveal_file_blocking(
    tmp: std::path::PathBuf,
    dialog_title: &str,
    fallback_name: &str,
    filter_name: &str,
    extensions: &[String],
) -> Result<serde_json::Value, String> {
    let suggested = tmp
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(fallback_name)
        .to_string();
    let ext_refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let dest = rfd::FileDialog::new()
        .set_title(dialog_title)
        .set_file_name(&suggested)
        .add_filter(filter_name, &ext_refs)
        .save_file();

    let final_path = if let Some(dest) = dest {
        std::fs::copy(&tmp, &dest).map_err(|e| format!("copy archive: {e}"))?;
        let _ = std::fs::remove_file(&tmp);
        dest
    } else {
        // User cancelled: keep temp zip and still return path so UI can open it.
        tmp
    };

    let path_s = final_path.display().to_string();
    // Cheap metadata only — never read archive contents into the App.
    let size_bytes = std::fs::metadata(&final_path).ok().map(|m| m.len());
    // Reveal is best-effort and must never block export/close. Fire-and-forget
    // via shared helper (correct Windows explorer flags / Linux ShowItems).
    {
        let reveal_path = final_path.clone();
        let _ = std::thread::Builder::new()
            .name("reveal-export".into())
            .spawn(move || {
                let _ = crate::process_util::reveal_in_file_manager(&reveal_path);
            });
    }

    Ok(serde_json::json!({
        "ok": true,
        "path": path_s,
        "sizeBytes": size_bytes,
    }))
}

/// Wipe App data under the data root (sessions, projects, settings).
/// Does not touch the CLI home (`~/.grok`). Double-confirm in the UI before calling.
#[tauri::command]
pub async fn reset_app_data(
    app: tauri::AppHandle,
    keep_secrets: Option<bool>,
    mgr: State<'_, Arc<SessionManager>>,
) -> Result<serde_json::Value, String> {
    // Drop live agent first so session files are not mid-write.
    let _ = mgr.disconnect(app).await;
    let keep = keep_secrets.unwrap_or(true);
    crate::support_bundle::reset_app_data(keep)
}

// ── Skills / MCP via `grok inspect --json` ──────────────────────────────────

const INSPECT_TIMEOUT_SECS: u64 = 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDto {
    pub name: String,
    pub description: String,
    /// Normalized source type string (e.g. "user", "project", "plugin").
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default)]
    pub user_invocable: bool,
    /// Owning plugin id when this skill came from a plugin pack (#929).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDto {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compatibility_status: Option<String>,
}

/// Run probed CLI: `grok inspect --json` with optional project cwd.
/// Returns (parsed JSON, error message). Never panics; empty on failure.
fn run_grok_inspect(project_path: Option<&str>) -> (Option<serde_json::Value>, Option<String>) {
    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    let Some(cli_path) = probe.path.filter(|_| probe.found) else {
        return (None, Some("Grok Build CLI not found".into()));
    };

    let cwd = project_path
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from);

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut cmd = std::process::Command::new(&cli_path);
        cmd.arg("inspect").arg("--json");
        cmd.env("GROK_HOME", crate::skill_compat::inspect_grok_home());
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        crate::process_util::apply_no_window_std(&mut cmd);
        if let Some(path_env) = crate::process_util::enriched_path_env() {
            cmd.env("PATH", path_env);
        }
        let result = cmd.output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(std::time::Duration::from_secs(INSPECT_TIMEOUT_SECS)) {
        Ok(Ok(output)) => {
            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let msg = if err.is_empty() {
                    format!("grok inspect exited with {}", output.status)
                } else {
                    // Truncate; never log secrets (inspect should not print keys)
                    err.chars().take(400).collect()
                };
                return (None, Some(msg));
            }
            let stdout = String::from_utf8_lossy(&output.stdout);
            match serde_json::from_str::<serde_json::Value>(stdout.trim()) {
                Ok(v) => (Some(v), None),
                Err(e) => (None, Some(format!("Failed to parse grok inspect JSON: {e}"))),
            }
        }
        Ok(Err(e)) => (None, Some(format!("Failed to run grok inspect: {e}"))),
        Err(_) => (None, Some(format!(
            "grok inspect timed out after {INSPECT_TIMEOUT_SECS}s"
        ))),
    }
}

fn plugin_name_from_skill_path(path: Option<&str>) -> Option<String> {
    let raw = path?;
    let p = raw.replace('\\', "/");
    let p = p
        .split('/')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("/");
    let p = format!("/{p}");
    for marker in ["/installed-plugins/", "/plugins/"] {
        if let Some(idx) = p.to_ascii_lowercase().find(marker) {
            let rest = &p[idx + marker.len()..];
            let name = rest.split('/').next().unwrap_or("").trim();
            if !name.is_empty() && !name.eq_ignore_ascii_case("skills") {
                return Some(name.to_string());
            }
        }
    }
    None
}

fn normalize_skill_source(source: &serde_json::Value) -> (String, Option<String>) {
    if let Some(s) = source.as_str() {
        return (s.to_string(), None);
    }
    if let Some(obj) = source.as_object() {
        let ty = obj
            .get("type")
            .and_then(|x| x.as_str())
            .unwrap_or("unknown")
            .to_string();
        let path = obj
            .get("path")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        return (ty, path);
    }
    ("unknown".into(), None)
}

fn parse_skills(v: &serde_json::Value) -> Vec<SkillDto> {
    let Some(arr) = v.get("skills").and_then(|x| x.as_array()) else {
        return Vec::new();
    };
    let mut out = Vec::with_capacity(arr.len());
    for item in arr {
        let name = item
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let description = item
            .get("description")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let (source, path_from_source) =
            normalize_skill_source(item.get("source").unwrap_or(&serde_json::Value::Null));
        let path = item
            .get("path")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .or(path_from_source);
        // Missing field ⇒ treat as invocable. Only explicit `false` hides a skill
        // from the composer/slash picker (agent-only / disable-model-invocation).
        let user_invocable = item
            .get("userInvocable")
            .or_else(|| item.get("user_invocable"))
            .or_else(|| item.get("user-invocable"))
            .and_then(|x| x.as_bool())
            .unwrap_or(true);
        let plugin_name = item
            .get("pluginName")
            .or_else(|| item.get("plugin_name"))
            .or_else(|| item.get("plugin"))
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| plugin_name_from_skill_path(path.as_deref()));
        out.push(SkillDto {
            name,
            description,
            source,
            path,
            user_invocable,
            plugin_name,
        });
    }
    out
}

/// Soft cap for project-local skill dirs scanned by the App host.
const PROJECT_SKILLS_SCAN_MAX: usize = 500;
/// Soft cap for reading a single SKILL.md when scanning project skills.
const PROJECT_SKILL_MD_READ_MAX: usize = 64 * 1024;

/// Pure: project skills root `{project}/.grok/skills` when path is non-empty.
fn project_skills_dir(project_path: Option<&str>) -> Option<std::path::PathBuf> {
    let raw = project_path.map(str::trim).filter(|s| !s.is_empty())?;
    if raw.contains('\0') {
        return None;
    }
    let p = std::path::Path::new(raw);
    // Reject obvious traversal in the project path string itself.
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return None;
    }
    Some(p.join(".grok").join("skills"))
}

/// Pure: simple SKILL.md frontmatter (`---` … `---`) key:value lines.
/// Returns (name, description, user_invocable). Missing invocable ⇒ true.
fn parse_skill_md_frontmatter_meta(content: &str) -> (Option<String>, String, bool) {
    let text = content.trim_start_matches('\u{feff}');
    let mut lines = text.lines();
    let first = match lines.next() {
        Some(l) if l.trim() == "---" => l,
        _ => return (None, String::new(), true),
    };
    let _ = first;
    let mut name: Option<String> = None;
    let mut description = String::new();
    let mut user_invocable = true;
    let mut closed = false;
    for line in lines {
        let t = line.trim();
        if t == "---" {
            closed = true;
            break;
        }
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let Some((key_raw, val_raw)) = t.split_once(':') else {
            continue;
        };
        let key = key_raw.trim().to_ascii_lowercase();
        let mut val = val_raw.trim().to_string();
        // Strip simple quotes used in YAML scalars.
        if (val.starts_with('"') && val.ends_with('"') && val.len() >= 2)
            || (val.starts_with('\'') && val.ends_with('\'') && val.len() >= 2)
        {
            val = val[1..val.len() - 1].to_string();
        }
        match key.as_str() {
            "name" => {
                let n = val.trim();
                if !n.is_empty() {
                    name = Some(n.to_string());
                }
            }
            "description" => {
                description = val;
            }
            "user-invocable" | "user_invocable" | "userinvocable" => {
                let lower = val.trim().to_ascii_lowercase();
                user_invocable = !matches!(lower.as_str(), "false" | "no" | "0" | "off");
            }
            _ => {}
        }
    }
    if !closed {
        // Unclosed frontmatter: still use keys we parsed (best-effort).
    }
    (name, description, user_invocable)
}

/// Scan `{project}/.grok/skills/*/SKILL.md` on disk (one level).
/// Independent of `grok inspect` so project skills still appear when CLI
/// inspect is slow, partial, or missing project entries.
fn scan_project_skills(project_path: Option<&str>) -> Vec<SkillDto> {
    let Some(root) = project_skills_dir(project_path) else {
        return Vec::new();
    };
    if !root.is_dir() {
        return Vec::new();
    }
    let entries = match std::fs::read_dir(&root) {
        Ok(rd) => rd,
        Err(_) => return Vec::new(),
    };
    let mut out: Vec<SkillDto> = Vec::new();
    for entry in entries.flatten() {
        if out.len() >= PROJECT_SKILLS_SCAN_MAX {
            break;
        }
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let folder = match path.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.trim(),
            None => continue,
        };
        if folder.is_empty() || folder.starts_with('.') {
            continue;
        }
        // Prefer SKILL.md; accept skill.md for case-insensitive filesystems.
        let skill_md = {
            let upper = path.join("SKILL.md");
            if upper.is_file() {
                upper
            } else {
                let lower = path.join("skill.md");
                if lower.is_file() {
                    lower
                } else {
                    continue;
                }
            }
        };
        let content = match std::fs::read(&skill_md) {
            Ok(bytes) => {
                let take = bytes.len().min(PROJECT_SKILL_MD_READ_MAX);
                String::from_utf8_lossy(&bytes[..take]).into_owned()
            }
            Err(_) => String::new(),
        };
        let (fm_name, description, user_invocable) = parse_skill_md_frontmatter_meta(&content);
        let name = fm_name
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| folder.to_string());
        if name.is_empty() {
            continue;
        }
        out.push(SkillDto {
            name,
            description,
            source: "project".into(),
            path: Some(skill_md.to_string_lossy().to_string()),
            user_invocable,
            plugin_name: None,
        });
    }
    out.sort_by(|a, b| {
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
    });
    out
}

/// Merge inspect skills with project-disk skills.
/// Same name (case-insensitive): **project wins** over global/user/plugin/bundled.
/// Project scan also fills gaps when inspect omitted project skills.
fn merge_skills_prefer_project(
    inspect: Vec<SkillDto>,
    project: Vec<SkillDto>,
) -> Vec<SkillDto> {
    let mut map: std::collections::HashMap<String, SkillDto> =
        std::collections::HashMap::with_capacity(inspect.len() + project.len());
    for s in inspect {
        let key = s.name.to_ascii_lowercase();
        if key.is_empty() {
            continue;
        }
        map.insert(key, s);
    }
    for s in project {
        let key = s.name.to_ascii_lowercase();
        if key.is_empty() {
            continue;
        }
        // Project always overwrites (including prior project from inspect).
        map.insert(key, s);
    }
    let mut out: Vec<SkillDto> = map.into_values().collect();
    out.sort_by(|a, b| {
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
    });
    out
}

#[cfg(test)]
mod skill_project_scan_tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn project_skills_dir_joins_dot_grok_skills() {
        let d = project_skills_dir(Some("/tmp/demo")).unwrap();
        assert!(d.ends_with(std::path::Path::new(".grok/skills")) || d.ends_with(".grok\\skills"));
        assert!(project_skills_dir(Some("")).is_none());
        assert!(project_skills_dir(None).is_none());
        assert!(project_skills_dir(Some("/tmp/../evil")).is_none());
    }

    #[test]
    fn parse_frontmatter_name_desc_invocable() {
        let (n, d, inv) = parse_skill_md_frontmatter_meta(
            "---\nname: hello-proj\ndescription: Project skill\nuser-invocable: false\n---\n# Body\n",
        );
        assert_eq!(n.as_deref(), Some("hello-proj"));
        assert_eq!(d, "Project skill");
        assert!(!inv);
    }

    #[test]
    fn merge_prefers_project_over_user() {
        let inspect = vec![SkillDto {
            name: "shared".into(),
            description: "from user".into(),
            source: "user".into(),
            path: Some("/u/shared/SKILL.md".into()),
            user_invocable: true,
            plugin_name: None,
        }];
        let project = vec![SkillDto {
            name: "shared".into(),
            description: "from project".into(),
            source: "project".into(),
            path: Some("/p/shared/SKILL.md".into()),
            user_invocable: true,
            plugin_name: None,
        }];
        let merged = merge_skills_prefer_project(inspect, project);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].source, "project");
        assert_eq!(merged[0].description, "from project");
    }

    #[test]
    fn merge_keeps_unique_global_and_project_only() {
        let inspect = vec![
            SkillDto {
                name: "global-only".into(),
                description: "g".into(),
                source: "user".into(),
                path: None,
                user_invocable: true,
                plugin_name: None,
            },
            SkillDto {
                name: "Both".into(),
                description: "user copy".into(),
                source: "user".into(),
                path: None,
                user_invocable: true,
                plugin_name: None,
            },
        ];
        let project = vec![
            SkillDto {
                name: "both".into(), // case-insensitive collide
                description: "proj copy".into(),
                source: "project".into(),
                path: Some("/p/both/SKILL.md".into()),
                user_invocable: true,
                plugin_name: None,
            },
            SkillDto {
                name: "proj-only".into(),
                description: "p".into(),
                source: "project".into(),
                path: Some("/p/proj-only/SKILL.md".into()),
                user_invocable: true,
                plugin_name: None,
            },
        ];
        let merged = merge_skills_prefer_project(inspect, project);
        let names: Vec<_> = merged.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"global-only"));
        assert!(names.contains(&"proj-only"));
        assert!(names.iter().any(|n| n.eq_ignore_ascii_case("both")));
        let both = merged
            .iter()
            .find(|s| s.name.eq_ignore_ascii_case("both"))
            .unwrap();
        assert_eq!(both.source, "project");
        assert_eq!(both.description, "proj copy");
    }

    #[test]
    fn scan_project_skills_reads_disk() {
        let dir = std::env::temp_dir().join(format!(
            "grok-project-skills-scan-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let skill_dir = dir.join(".grok").join("skills").join("disk-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        let md = skill_dir.join("SKILL.md");
        let mut f = std::fs::File::create(&md).unwrap();
        write!(
            f,
            "---\nname: disk-skill\ndescription: From disk\n---\n# Hi\n"
        )
        .unwrap();
        let found = scan_project_skills(Some(dir.to_str().unwrap()));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "disk-skill");
        assert_eq!(found[0].source, "project");
        assert_eq!(found[0].description, "From disk");
        assert!(found[0]
            .path
            .as_ref()
            .is_some_and(|p| p.ends_with("SKILL.md")));
    }

    #[test]
    fn plugin_name_from_skill_path_markers() {
        assert_eq!(
            plugin_name_from_skill_path(Some(
                "/Users/me/.grok/installed-plugins/agent-plugin-codex/skills/x/SKILL.md"
            ))
            .as_deref(),
            Some("agent-plugin-codex")
        );
        assert_eq!(
            plugin_name_from_skill_path(Some(
                "/Users/me/.grok/plugins/foo/skills/bar/SKILL.md"
            ))
            .as_deref(),
            Some("foo")
        );
        assert_eq!(
            plugin_name_from_skill_path(Some(r"D:\work\.grok\plugins\pdf\skills\a\SKILL.md"))
                .as_deref(),
            Some("pdf")
        );
        assert_eq!(
            plugin_name_from_skill_path(Some("/Users/me/.grok/skills/help/SKILL.md")),
            None
        );
        assert_eq!(
            plugin_name_from_skill_path(Some("/Users/me/.grok/bundled/skills/pdf/SKILL.md")),
            None
        );
    }
}

fn parse_mcp_servers(v: &serde_json::Value) -> Vec<McpDto> {
    let Some(arr) = v
        .get("mcpServers")
        .or_else(|| v.get("mcp"))
        .and_then(|x| x.as_array())
    else {
        return Vec::new();
    };
    let mut out = Vec::with_capacity(arr.len());
    for item in arr {
        let name = item
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let transport = item
            .get("transport")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        let target = item
            .get("target")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        let vendor = item
            .get("vendor")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        let compatibility_status = item
            .get("compatibilityStatus")
            .or_else(|| item.get("compatibility_status"))
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        out.push(McpDto {
            name,
            transport,
            target,
            vendor,
            compatibility_status,
        });
    }
    out
}
