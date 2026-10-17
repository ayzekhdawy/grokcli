#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn user_hooks_dir_joins_home_dot_grok_hooks() {
        let dir = user_hooks_dir();
        let s = dir.to_string_lossy();
        assert!(s.ends_with(".grok/hooks") || s.ends_with(".grok\\hooks"), "{s}");
    }

    #[test]
    fn project_hooks_dir_joins_project_root() {
        let d = project_hooks_dir("/tmp/my-app").expect("path");
        assert_eq!(d, PathBuf::from("/tmp/my-app/.grok/hooks"));
        assert!(project_hooks_dir("").is_none());
        assert!(project_hooks_dir("   ").is_none());
    }

    #[test]
    fn join_hooks_path_accepts_simple_names() {
        let base = PathBuf::from("/tmp/hooks");
        assert_eq!(
            join_hooks_path(&base, "session-start.json"),
            Some(PathBuf::from("/tmp/hooks/session-start.json"))
        );
        assert_eq!(
            join_hooks_path(&base, "  note.md  "),
            Some(PathBuf::from("/tmp/hooks/note.md"))
        );
    }

    #[test]
    fn join_hooks_path_rejects_traversal_and_empty() {
        let base = PathBuf::from("/tmp/hooks");
        assert!(join_hooks_path(&base, "").is_none());
        assert!(join_hooks_path(&base, "..").is_none());
        assert!(join_hooks_path(&base, "../etc/passwd").is_none());
        assert!(join_hooks_path(&base, "a/b.json").is_none());
        assert!(join_hooks_path(&base, "a\\b.json").is_none());
    }

    #[test]
    fn sort_hook_entries_user_before_project_then_name() {
        let mut items = vec![
            HookEntry {
                name: "z.json".into(),
                path: "/p/z.json".into(),
                scope: "project".into(),
                kind: "file".into(),
                ext: "json".into(),
                size: 1,
                mtime_ms: 0,
            },
            HookEntry {
                name: "b.json".into(),
                path: "/u/b.json".into(),
                scope: "user".into(),
                kind: "file".into(),
                ext: "json".into(),
                size: 1,
                mtime_ms: 0,
            },
            HookEntry {
                name: "a.json".into(),
                path: "/u/a.json".into(),
                scope: "user".into(),
                kind: "file".into(),
                ext: "json".into(),
                size: 1,
                mtime_ms: 0,
            },
        ];
        sort_hook_entries(&mut items);
        assert_eq!(
            items.iter().map(|h| h.name.as_str()).collect::<Vec<_>>(),
            vec!["a.json", "b.json", "z.json"]
        );
        assert_eq!(items[0].scope, "user");
        assert_eq!(items[2].scope, "project");
    }

    #[test]
    fn list_hooks_in_dir_reads_real_files() {
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-hooks-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).expect("mkdir");
        let file = tmp.join("session-start.json");
        {
            let mut f = fs::File::create(&file).expect("create");
            write!(f, r#"{{"hooks":{{}}}}"#).expect("write");
        }
        fs::create_dir(tmp.join("scripts")).expect("subdir");
        // hidden skipped
        let _ = fs::File::create(tmp.join(".hidden"));

        let listed = list_hooks_in_dir(&tmp, "user");
        let names: Vec<_> = listed.iter().map(|h| h.name.as_str()).collect();
        assert!(names.contains(&"session-start.json"), "{names:?}");
        assert!(names.contains(&"scripts"), "{names:?}");
        assert!(!names.iter().any(|n| n.starts_with('.')), "{names:?}");

        let json = listed
            .iter()
            .find(|h| h.name == "session-start.json")
            .expect("json entry");
        assert_eq!(json.kind, "file");
        assert_eq!(json.ext, "json");
        assert_eq!(json.scope, "user");
        assert!(json.size > 0);
        assert!(json.path.ends_with("session-start.json"));

        let dir = listed.iter().find(|h| h.name == "scripts").expect("dir");
        assert_eq!(dir.kind, "dir");
        assert_eq!(dir.size, 0);

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn entry_ext_for_files() {
        assert_eq!(entry_ext("a.json", false), "json");
        assert_eq!(entry_ext("A.JSON", false), "json");
        assert_eq!(entry_ext("noext", false), "");
        assert_eq!(entry_ext("scripts", true), "");
    }

    #[test]
    fn clamp_timeout_bounds() {
        assert_eq!(
            clamp_hooks_try_timeout(None),
            HOOKS_TRY_DEFAULT_TIMEOUT_SECS
        );
        assert_eq!(clamp_hooks_try_timeout(Some(0)), HOOKS_TRY_MIN_TIMEOUT_SECS);
        assert_eq!(
            clamp_hooks_try_timeout(Some(9999)),
            HOOKS_TRY_MAX_TIMEOUT_SECS
        );
        assert_eq!(clamp_hooks_try_timeout(Some(10)), 10);
    }

    #[test]
    fn path_under_hooks_root_component_wise() {
        let root = PathBuf::from("/tmp/hooks");
        assert!(path_under_hooks_root(Path::new("/tmp/hooks"), &root));
        assert!(path_under_hooks_root(Path::new("/tmp/hooks/a.sh"), &root));
        assert!(path_under_hooks_root(
            Path::new("/tmp/hooks/sub/b.sh"),
            &root
        ));
        assert!(!path_under_hooks_root(Path::new("/tmp/hooksother/x"), &root));
        assert!(!path_under_hooks_root(Path::new("/tmp/other"), &root));
        assert!(!path_under_hooks_root(Path::new("/tmp"), &root));
    }

    #[test]
    fn validate_stdin_empty_and_json() {
        assert_eq!(validate_hooks_try_stdin(None).unwrap(), None);
        assert_eq!(validate_hooks_try_stdin(Some("")).unwrap(), None);
        assert_eq!(validate_hooks_try_stdin(Some("   \n")).unwrap(), None);
        let ok = validate_hooks_try_stdin(Some(r#"{"hookEventName":"PreToolUse"}"#)).unwrap();
        assert!(ok.is_some());
        let err = validate_hooks_try_stdin(Some("not-json")).unwrap_err();
        assert_eq!(err.0, "invalid_json");
        let big = "x".repeat(HOOKS_TRY_MAX_STDIN_BYTES + 1);
        let err2 = validate_hooks_try_stdin(Some(&big)).unwrap_err();
        assert_eq!(err2.0, "stdin_too_large");
    }

    #[test]
    fn redact_output_scrubs_keys_and_tokens() {
        let s = redact_hooks_output("api_key = sk-abcdefghijklmnopqrstuvwxyz0123\nhello");
        assert!(s.contains("[REDACTED]"), "{s}");
        assert!(!s.contains("abcdefghijklmnopqrstuvwxyz"), "{s}");
        let s2 = redact_hooks_output("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWX");
        assert!(s2.contains("[REDACTED]"), "{s2}");
        let s3 = redact_hooks_output("Authorization: Bearer supersecrettokenvalue");
        assert!(s3.contains("[REDACTED]"), "{s3}");
        assert!(!s3.contains("supersecrettokenvalue"), "{s3}");
        let normal = redact_hooks_output("ok exit 0");
        assert_eq!(normal, "ok exit 0");
    }

    #[test]
    fn resolve_refuses_outside_and_accepts_inside() {
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-hooks-try-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).expect("mkdir");
        let script = tmp.join("echo-ok.sh");
        {
            let mut f = fs::File::create(&script).expect("create");
            writeln!(f, "#!/bin/sh").unwrap();
            writeln!(f, "echo hello-try").unwrap();
            writeln!(f, "cat").unwrap(); // echo stdin
            writeln!(f, "exit 0").unwrap();
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&script).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&script, perms).unwrap();
        }

        let roots = vec![(tmp.clone(), "user".to_string())];
        let (resolved, scope) =
            resolve_hooks_try_path(&script.to_string_lossy(), &roots).expect("inside");
        assert_eq!(scope, "user");
        assert!(resolved.ends_with("echo-ok.sh"));

        let outside = std::env::temp_dir().join(format!(
            "grok-app-hooks-outside-{}",
            std::process::id()
        ));
        let _ = fs::write(&outside, "#!/bin/sh\necho no\n");
        let err = resolve_hooks_try_path(&outside.to_string_lossy(), &roots).unwrap_err();
        assert_eq!(err.0, "path_outside_hooks");

        let err_rel = resolve_hooks_try_path("relative.sh", &roots).unwrap_err();
        assert_eq!(err_rel.0, "path_not_absolute");

        let err_empty = resolve_hooks_try_path("  ", &roots).unwrap_err();
        assert_eq!(err_empty.0, "empty_path");

        let _ = fs::remove_file(&outside);
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn try_run_real_script_with_stdin_and_refuse_outside() {
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-hooks-tryrun-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("sub")).expect("mkdir");

        // Platform-native scripts: Unix /bin/sh vs Windows cmd.exe (`.sh` via cmd /C fails).
        #[cfg(windows)]
        let (ok_name, fail_name, slow_name) = ("echo-ok.cmd", "fail.cmd", "slow.cmd");
        #[cfg(not(windows))]
        let (ok_name, fail_name, slow_name) = ("echo-ok.sh", "fail.sh", "slow.sh");

        let script = tmp.join("sub").join(ok_name);
        {
            let mut f = fs::File::create(&script).expect("create");
            #[cfg(windows)]
            {
                // stdin is not piped into `type` easily; print fixed OUT + any stdin via more.
                writeln!(f, "@echo off").unwrap();
                writeln!(f, "echo OUT").unwrap();
                // Read all stdin and echo it (findstr matches every line).
                writeln!(f, "findstr /r \".*\"").unwrap();
                writeln!(f, "exit /b 0").unwrap();
            }
            #[cfg(not(windows))]
            {
                writeln!(f, "#!/bin/sh").unwrap();
                writeln!(f, "echo OUT").unwrap();
                writeln!(f, "cat").unwrap();
                writeln!(f, "exit 0").unwrap();
            }
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&script).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&script, perms).unwrap();
        }

        let roots = vec![(tmp.clone(), "user".to_string())];
        let ok = try_run_hook_script_with_roots(
            &script.to_string_lossy(),
            &roots,
            Some(r#"{"hookEventName":"PreToolUse"}"#),
            Some(5),
        );
        assert!(ok.ok, "{ok:?}");
        assert!(!ok.refused);
        assert!(!ok.timed_out);
        assert_eq!(ok.exit_code, Some(0));
        assert!(ok.stdout.contains("OUT"), "{ok:?}");
        assert!(ok.stdout.contains("PreToolUse"), "{ok:?}");
        assert_eq!(ok.scope, "user");

        // Fail exit is honest (not ok).
        let fail_script = tmp.join(fail_name);
        {
            let mut f = fs::File::create(&fail_script).expect("create");
            #[cfg(windows)]
            {
                writeln!(f, "@echo off").unwrap();
                writeln!(f, "echo boom 1>&2").unwrap();
                writeln!(f, "exit /b 2").unwrap();
            }
            #[cfg(not(windows))]
            {
                writeln!(f, "#!/bin/sh").unwrap();
                writeln!(f, "echo boom 1>&2").unwrap();
                writeln!(f, "exit 2").unwrap();
            }
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&fail_script).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&fail_script, perms).unwrap();
        }
        let fail = try_run_hook_script_with_roots(
            &fail_script.to_string_lossy(),
            &roots,
            None,
            Some(5),
        );
        assert!(!fail.ok, "{fail:?}");
        assert!(!fail.refused);
        assert_eq!(fail.exit_code, Some(2));
        assert!(fail.stderr.contains("boom") || fail.stdout.contains("boom"), "{fail:?}");

        // Timeout is honest (not ok).
        let slow = tmp.join(slow_name);
        {
            let mut f = fs::File::create(&slow).expect("create");
            #[cfg(windows)]
            {
                writeln!(f, "@echo off").unwrap();
                // ~5s hang without requiring external tools.
                writeln!(f, "ping -n 6 127.0.0.1 >nul").unwrap();
            }
            #[cfg(not(windows))]
            {
                writeln!(f, "#!/bin/sh").unwrap();
                writeln!(f, "sleep 5").unwrap();
            }
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&slow).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&slow, perms).unwrap();
        }
        let timed = try_run_hook_script_with_roots(
            &slow.to_string_lossy(),
            &roots,
            None,
            Some(1),
        );
        assert!(!timed.ok, "{timed:?}");
        assert!(timed.timed_out, "{timed:?}");
        assert_eq!(timed.reason.as_deref(), Some("timeout"));

        // Full try_run_hook_script refuses paths outside real user/project hooks dirs.
        let refused = try_run_hook_script(
            &script.to_string_lossy(),
            None,
            Some(r#"{"a":1}"#),
            Some(5),
        );
        assert!(!refused.ok);
        assert!(refused.refused, "{refused:?}");
        assert_eq!(refused.reason.as_deref(), Some("path_outside_hooks"));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn try_run_refuses_invalid_json_without_spawn() {
        let r = try_run_hook_script(
            "/tmp/does-not-matter.sh",
            None,
            Some("not-json{"),
            Some(5),
        );
        assert!(!r.ok);
        assert!(r.refused);
        assert_eq!(r.reason.as_deref(), Some("invalid_json"));
        assert!(r.duration_ms == 0);
    }
}
