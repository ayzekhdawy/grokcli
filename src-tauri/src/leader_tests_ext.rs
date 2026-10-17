#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn parse_list_empty() {
        assert!(parse_leader_list_json("").unwrap().is_empty());
        assert!(parse_leader_list_json("[]").unwrap().is_empty());
    }

    #[test]
    fn parse_list_array_camel_case() {
        let raw = r#"[{"pid":7601,"pidFromLock":7601,"pidLive":7601,"classification":"Reachable","socketPath":"/Users/x/.grok/leader.sock","lockPath":"/Users/x/.grok/leader.lock","wsUrlSuffix":""}]"#;
        let rows = parse_leader_list_json(raw).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].pid, Some(7601));
        assert_eq!(
            rows[0].socket_path.as_deref(),
            Some("/Users/x/.grok/leader.sock")
        );
        assert_eq!(rows[0].classification.as_deref(), Some("Reachable"));
        assert_eq!(
            rows[0].lock_path.as_deref(),
            Some("/Users/x/.grok/leader.lock")
        );
    }

    #[test]
    fn parse_info_nested_and_flat() {
        let raw = r#"{
            "pid": 42,
            "socket_path": "/tmp/l.sock",
            "lock_path": "/tmp/l.lock",
            "leader_binary_version": "0.3.1",
            "leader_protocol_version": "1",
            "classification": "Reachable",
            "uptime_ms": 12000,
            "active_tool_calls": 2,
            "ws_url_suffix": ""
        }"#;
        let info = parse_leader_info_json(raw).unwrap();
        assert_eq!(info.pid, Some(42));
        assert_eq!(info.socket_path.as_deref(), Some("/tmp/l.sock"));
        assert_eq!(info.version.as_deref(), Some("0.3.1"));
        assert_eq!(info.protocol_version.as_deref(), Some("1"));
        assert_eq!(info.uptime_ms, Some(12000));
        assert_eq!(info.active_tool_calls, Some(2));
        assert!(!info.unsupported);
        assert!(info.error.is_none());

        let wrapped = r#"{"info":{"leaderPid":9,"socketPath":"/a.sock","leaderBinaryVersion":"1.0.0"}}"#;
        let info2 = parse_leader_info_json(wrapped).unwrap();
        assert_eq!(info2.pid, Some(9));
        assert_eq!(info2.socket_path.as_deref(), Some("/a.sock"));
        assert_eq!(info2.version.as_deref(), Some("1.0.0"));
    }

    #[test]
    fn parse_info_empty_and_invalid() {
        assert!(parse_leader_info_json("").is_err());
        assert!(parse_leader_info_json("not-json").is_err());
    }

    #[test]
    fn soft_info_error_marks_unsupported() {
        let e = soft_info_error("unknown subcommand info", true);
        assert!(e.unsupported);
        assert!(e.error.as_deref().unwrap().contains("unknown"));
        assert!(e.pid.is_none());
    }

    #[test]
    fn parse_list_wrapped_object() {
        let raw = r#"{"leaders":[{"leader_pid":42,"socket_path":"/tmp/l.sock","leader_binary_version":"0.2.1"}]}"#;
        let rows = parse_leader_list_json(raw).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].pid, Some(42));
        assert_eq!(rows[0].version.as_deref(), Some("0.2.1"));
    }

    #[test]
    fn parse_list_single_object() {
        let raw = r#"{"pid":9,"socket":"/tmp/a.sock"}"#;
        let rows = parse_leader_list_json(raw).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].pid, Some(9));
        assert_eq!(rows[0].socket_path.as_deref(), Some("/tmp/a.sock"));
    }

    #[test]
    fn parse_list_invalid_json() {
        assert!(parse_leader_list_json("not-json").is_err());
    }

    #[test]
    fn derive_state_running_reachable() {
        let leaders = vec![LeaderProcessDto {
            pid: Some(1),
            socket_path: Some("/tmp/x".into()),
            version: None,
            classification: Some("Reachable".into()),
            lock_path: None,
            ws_url_suffix: None,
            raw: None,
        }];
        let (s, m) = derive_leader_state(true, &leaders, true, true, None);
        assert_eq!(s, "running");
        assert!(m.is_none());
    }

    #[test]
    fn derive_state_stopped() {
        let (s, _) = derive_leader_state(false, &[], true, true, None);
        assert_eq!(s, "stopped");
    }

    #[test]
    fn derive_state_unsupported() {
        let (s, m) = derive_leader_state(false, &[], true, false, None);
        assert_eq!(s, "unsupported");
        assert!(m.unwrap().contains("does not expose"));
    }

    #[test]
    fn derive_state_cli_missing() {
        let (s, m) = derive_leader_state(false, &[], false, false, None);
        assert_eq!(s, "error");
        assert!(m.unwrap().contains("not found"));
    }

    #[test]
    fn derive_state_stale_socket() {
        let (s, m) = derive_leader_state(true, &[], true, true, None);
        assert_eq!(s, "error");
        assert!(m.unwrap().contains("socket exists"));
    }

    #[test]
    fn mask_secret_short_and_long() {
        assert_eq!(mask_secret(""), "");
        assert_eq!(mask_secret("ab"), "••••");
        assert_eq!(mask_secret("super-secret-token"), "••••oken");
    }

    #[test]
    fn path_age_secs_recent_file() {
        let dir = std::env::temp_dir().join(format!("grok-leader-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let f = dir.join("sock-ish");
        std::fs::write(&f, b"x").unwrap();
        let age = path_age_secs(&f, SystemTime::now()).unwrap();
        assert!(age < 5);
        // Advance "now"
        let later = SystemTime::now() + Duration::from_secs(30);
        // mtime is in the past relative to later — age should grow (platform may have 1s resolution)
        let age2 = path_age_secs(&f, later).unwrap();
        assert!(age2 >= 29);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn default_socket_respects_env() {
        // SAFETY: test-only env mutation; single-threaded test process.
        std::env::set_var("GROK_LEADER_SOCKET", "/tmp/custom-leader.sock");
        let p = default_leader_socket_path();
        assert_eq!(p, PathBuf::from("/tmp/custom-leader.sock"));
        std::env::remove_var("GROK_LEADER_SOCKET");
        let p2 = default_leader_socket_path();
        assert!(p2.ends_with(Path::new(".grok/leader.sock")) || p2.ends_with("leader.sock"));
    }
}
