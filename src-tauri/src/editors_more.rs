
pub fn resolve_editor_command(open_target: Option<&str>) -> Option<String> {
    let list = {
        let g = cache_state().lock().unwrap_or_else(|e| e.into_inner());
        g.result
            .as_ref()
            .map(|r| r.editors.clone())
            .unwrap_or_else(detect_editors_fast)
    };
    let t = open_target.unwrap_or("").trim().to_ascii_lowercase();
    if t.is_empty() || t == "finder" || t == "explorer" || t == "system" || t == "default"
    {
        return None;
    }
    if t == "editor" {
        return list
            .iter()
            .find(|e| e.id == "cursor")
            .or_else(|| list.iter().find(|e| e.id == "code"))
            .or_else(|| list.first())
            .map(|e| e.command.clone())
            .or_else(|| std::env::var("GROK_APP_EDITOR").ok());
    }
    if let Some(by_id) = list.iter().find(|e| e.id == t) {
        return Some(by_id.command.clone());
    }
    if t.contains('/') || t.contains('\\') || t.ends_with(".cmd") || t.ends_with(".exe") {
        return Some(open_target.unwrap().trim().to_string());
    }
    Some(open_target.unwrap().trim().to_string())
}

fn path_for_cwd(file_path: &str) -> PathBuf {
    let p = PathBuf::from(file_path);
    if p.is_dir() {
        p
    } else {
        p.parent()
            .map(|x| x.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."))
    }
}

fn open_with_mac_app(app_name: &str, path: &str) -> Result<(), String> {
    crate::process_util::command("open")
        .args(["-a", app_name, path])
        .spawn()
        .map_err(|e| format!("open -a {app_name}: {e}"))?;
    Ok(())
}

fn open_terminal(id: &str, abs: &str) -> Result<(), String> {
    let cwd = path_for_cwd(abs);
    let cwd_s = cwd.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        let app = match id {
            "terminal" => "Terminal",
            "iterm" => "iTerm",
            "warp" => "Warp",
            "alacritty" => "Alacritty",
            "kitty" => "kitty",
            "wezterm" => "WezTerm",
            _ => "Terminal",
        };
        return open_with_mac_app(app, &cwd_s);
    }

    #[cfg(target_os = "windows")]
    {
        match id {
            "wt" => {
                crate::process_util::command("wt")
                    .args(["-d", &cwd_s])
                    .spawn()
                    .map_err(|e| format!("wt: {e}"))?;
            }
            "cmd" => {
                crate::process_util::command("cmd")
                    .args(["/k", "cd", "/d", &cwd_s])
                    .spawn()
                    .map_err(|e| format!("cmd: {e}"))?;
            }
            "powershell" => {
                let script = format!("Set-Location -LiteralPath '{}'", cwd_s.replace('\'', "''"));
                crate::process_util::command("powershell")
                    .args(["-NoExit", "-Command", &script])
                    .spawn()
                    .map_err(|e| format!("powershell: {e}"))?;
            }
            "pwsh" => {
                let script = format!("Set-Location -LiteralPath '{}'", cwd_s.replace('\'', "''"));
                crate::process_util::command("pwsh")
                    .args(["-NoExit", "-Command", &script])
                    .spawn()
                    .map_err(|e| format!("pwsh: {e}"))?;
            }
            _ => {
                // Fallback Windows Terminal or cmd
                if crate::process_util::command("wt")
                    .args(["-d", &cwd_s])
                    .spawn()
                    .is_ok()
                {
                    return Ok(());
                }
                crate::process_util::command("cmd")
                    .args(["/k", "cd", "/d", &cwd_s])
                    .spawn()
                    .map_err(|e| format!("cmd: {e}"))?;
            }
        }
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let cmd = resolve_editor_command(Some(id)).unwrap_or_else(|| id.to_string());
        if cmd.starts_with(MAC_OPEN_PREFIX) {
            return Err("terminal app not available".into());
        }
        // Prefer opening a new window in cwd for known terminals
        match id {
            "alacritty" => {
                crate::process_util::command(&cmd)
                    .args(["--working-directory", &cwd_s])
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            "kitty" => {
                crate::process_util::command(&cmd)
                    .args(["--directory", &cwd_s])
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            "wezterm" => {
                crate::process_util::command(&cmd)
                    .args(["start", "--cwd", &cwd_s])
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            "pwsh" => {
                let script = format!("Set-Location -LiteralPath '{}'", cwd_s.replace('\'', "''"));
                crate::process_util::command(&cmd)
                    .args(["-NoExit", "-Command", &script])
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            _ => {
                // Generic: xdg-terminal or env $TERMINAL
                if let Ok(term) = std::env::var("TERMINAL") {
                    crate::process_util::command(&term)
                        .current_dir(&cwd)
                        .spawn()
                        .map_err(|e| e.to_string())?;
                } else {
                    crate::process_util::command(&cmd)
                        .current_dir(&cwd)
                        .spawn()
                        .map_err(|e| e.to_string())?;
                }
            }
        }
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("terminal open not supported on this platform".into())
}

fn open_git_gui(id: &str, abs: &str) -> Result<(), String> {
    let root = path_for_cwd(abs);
    let root_s = root.to_string_lossy().to_string();

    // Prefer CLI when resolved
    if let Some(cmd) = resolve_editor_command(Some(id)) {
        if let Some(app) = cmd.strip_prefix(MAC_OPEN_PREFIX) {
            return open_with_mac_app(app, &root_s);
        }
        crate::process_util::command(&cmd)
            .arg(&root_s)
            .spawn()
            .map_err(|e| format!("failed to open {id}: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let app = match id {
            "fork" => "Fork",
            "sourcetree" => "SourceTree",
            "github-desktop" => "GitHub Desktop",
            _ => id,
        };
        open_with_mac_app(app, &root_s)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err(format!("{id} not found"))
    }
}

/// Open file (optional line) in the resolved editor / terminal / git GUI, or OS default.
pub fn open_in_editor(
    file_path: &str,
    line: Option<u32>,
    editor: Option<&str>,
) -> Result<(), String> {
    let path = PathBuf::from(file_path);
    if !path.exists() {
        return Err(format!("path not found: {file_path}"));
    }
    let abs = crate::process_util::path_for_editor(&path);

    let id = editor.unwrap_or("").trim().to_ascii_lowercase();
    if !id.is_empty() && id != "finder" && id != "explorer" && id != "system" && id != "default"
    {
        match open_kind_for_id(&id) {
            OpenKind::Terminal => return open_terminal(&id, &abs),
            OpenKind::GitGui => return open_git_gui(&id, &abs),
            OpenKind::EditorGoto | OpenKind::PathArg => {}
        }
    }

    let cmd = resolve_editor_command(editor);
    if let Some(cmd) = cmd {
        if let Some(app) = cmd.strip_prefix(MAC_OPEN_PREFIX) {
            return open_with_mac_app(app, &abs);
        }

        let kind = open_kind_for_id(&id);
        let mut args: Vec<String> = Vec::new();
        if kind == OpenKind::EditorGoto {
            if let Some(ln) = line {
                args.push("-g".into());
                args.push(format!("{abs}:{ln}"));
            } else {
                args.push(abs.clone());
            }
        } else {
            args.push(abs.clone());
        }
        let mut c = crate::process_util::command(&cmd);
        c.args(&args)
            .spawn()
            .map_err(|e| format!("failed to open editor `{cmd}`: {e}"))?;
        return Ok(());
    }

    // Fallback: OS default open
    #[cfg(target_os = "macos")]
    {
        crate::process_util::command("open")
            .arg(&abs)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        crate::process_util::command("rundll32")
            .args(["url.dll,FileProtocolHandler", &abs])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        crate::process_util::command("xdg-open")
            .arg(&abs)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Whether a path looks like a known editor binary (for tests / doctor).
#[allow(dead_code)]
pub fn is_executable_file(p: &Path) -> bool {
    fs::metadata(p).map(|m| m.is_file()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_editors_runs() {
        let list = detect_editors_fast();
        let _ = list.len();
    }

    #[test]
    fn list_with_icons_shape() {
        let r = list_editors_with_icons();
        let _ = r.editors;
        let _ = r.finder_icon;
        let _ = r.system_icon;
    }

    #[test]
    fn candidates_include_terminals_and_git_guis() {
        let ids: Vec<&str> = CANDIDATES.iter().map(|c| c.id).collect();
        for need in [
            "terminal",
            "cmd",
            "powershell",
            "pwsh",
            "wt",
            "fork",
            "sourcetree",
            "github-desktop",
            "iterm",
            "warp",
        ] {
            assert!(ids.contains(&need), "missing candidate {need}");
        }
    }

    #[test]
    fn open_kind_maps() {
        assert_eq!(open_kind_for_id("code"), OpenKind::EditorGoto);
        assert_eq!(open_kind_for_id("terminal"), OpenKind::Terminal);
        assert_eq!(open_kind_for_id("fork"), OpenKind::GitGui);
    }
}
