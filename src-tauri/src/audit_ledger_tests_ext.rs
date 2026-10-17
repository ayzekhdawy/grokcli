#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::APP_HOME_ENV_LOCK;
    use std::sync::Mutex;

    fn with_temp_home<F: FnOnce(PathBuf)>(f: F) {
        let _env = APP_HOME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // Serialize tests that touch the ledger path.
        static TEST_LOCK: Mutex<()> = Mutex::new(());
        let _t = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        let dir = std::env::temp_dir().join(format!(
            "grok-audit-test-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        std::env::set_var("GROK_APP_HOME", &dir);
        f(dir.clone());
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("GROK_APP_HOME");
    }

    #[test]
    fn sanitize_redacts_and_caps() {
        let s = sanitize_field(
            &format!("path /tmp/x sk-abcdefghijklmnopqrstuvwxyz012345 {}", "y".repeat(300)),
            MAX_SUMMARY_CHARS,
        );
        assert!(!s.contains("sk-abcdefghijklmnopqrstuvwxyz012345"));
        assert!(s.chars().count() <= MAX_SUMMARY_CHARS);
    }

    #[test]
    fn outcome_maps_terminal_statuses() {
        assert_eq!(outcome_from_tool_status("completed"), Some(OUTCOME_OK));
        assert_eq!(outcome_from_tool_status("failed"), Some(OUTCOME_ERR));
        assert_eq!(outcome_from_tool_status("error"), Some(OUTCOME_ERR));
        assert_eq!(outcome_from_tool_status("in_progress"), None);
        assert_eq!(outcome_from_tool_status(""), None);
    }

    #[test]
    fn parse_entry_line_accepts_camel_case() {
        let line = r#"{"ts":"2026-01-01T00:00:00.000Z","sessionId":"s1","toolName":"bash","event":"tool_end","outcome":"ok","summary":"ls"}"#;
        let e = parse_entry_line(line).expect("parse");
        assert_eq!(e.session_id.as_deref(), Some("s1"));
        assert_eq!(e.tool_name, "bash");
        assert_eq!(e.event, EVENT_TOOL_END);
        assert_eq!(e.outcome.as_deref(), Some("ok"));
    }

    #[test]
    fn parse_rejects_unknown_event() {
        let line = r#"{"ts":"t","toolName":"x","event":"hack"}"#;
        assert!(parse_entry_line(line).is_none());
    }

    #[test]
    fn append_list_clear_roundtrip() {
        with_temp_home(|_home| {
            record_permission(
                Some("sess-a"),
                Some("/proj"),
                "read_file",
                "allow_once",
                Some("src/main.rs"),
            );
            record_tool_start(Some("sess-a"), Some("/proj"), "bash", Some("echo hi"));
            record_tool_end(
                Some("sess-a"),
                Some("/proj"),
                "bash",
                OUTCOME_OK,
                Some("echo hi"),
            );

            let listed = list_recent(Some(10));
            assert_eq!(listed.len(), 3);
            // Newest first
            assert_eq!(listed[0].event, EVENT_TOOL_END);
            assert_eq!(listed[1].event, EVENT_TOOL_START);
            assert_eq!(listed[2].event, EVENT_PERMISSION);
            assert_eq!(listed[2].permission.as_deref(), Some("allow_once"));

            let export = export_redacted_jsonl();
            assert!(export.lines().count() >= 3);

            clear_ledger().unwrap();
            assert!(list_recent(None).is_empty());
            assert!(export_redacted_jsonl().is_empty());
        });
    }

    #[test]
    fn remember_and_resolve_permission_context() {
        with_temp_home(|_home| {
            remember_permission("sid", 42, "write_file", Some("notes.md"));
            record_permission_resolve(Some("sid"), Some("/p"), 42, "deny");
            let listed = list_recent(Some(5));
            assert_eq!(listed.len(), 1);
            assert_eq!(listed[0].tool_name, "write_file");
            assert_eq!(listed[0].permission.as_deref(), Some("deny"));
            assert_eq!(listed[0].summary.as_deref(), Some("notes.md"));
        });
    }

    #[test]
    fn normalize_limit_clamps() {
        assert_eq!(normalize_list_limit(None), DEFAULT_LIST_LIMIT);
        assert_eq!(normalize_list_limit(Some(0)), 1);
        assert_eq!(normalize_list_limit(Some(50)), 50);
        assert_eq!(
            normalize_list_limit(Some(99_999)),
            MAX_LIST_LIMIT
        );
    }

    #[test]
    fn normalize_retention_presets() {
        assert_eq!(normalize_retention_days(7), RETENTION_7);
        assert_eq!(normalize_retention_days(30), RETENTION_30);
        assert_eq!(normalize_retention_days(90), RETENTION_90);
        assert_eq!(normalize_retention_days(0), RETENTION_UNLIMITED);
        assert_eq!(normalize_retention_days(14), RETENTION_UNLIMITED);
        assert_eq!(normalize_retention_days(999), RETENTION_UNLIMITED);
    }

    #[test]
    fn filter_by_retention_drops_old() {
        let now = chrono::Utc::now();
        let old = AuditLedgerEntry {
            ts: (now - chrono::Duration::days(40))
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            session_id: Some("s".into()),
            project_path: None,
            tool_name: "bash".into(),
            event: EVENT_TOOL_END.into(),
            permission: None,
            outcome: Some(OUTCOME_OK.into()),
            summary: Some("old".into()),
        };
        let young = AuditLedgerEntry {
            ts: (now - chrono::Duration::days(2))
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            session_id: Some("s".into()),
            project_path: None,
            tool_name: "bash".into(),
            event: EVENT_TOOL_END.into(),
            permission: None,
            outcome: Some(OUTCOME_OK.into()),
            summary: Some("young".into()),
        };
        let kept = filter_by_retention(
            vec![old.clone(), young.clone()],
            RETENTION_30,
            now.timestamp_millis(),
        );
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].summary.as_deref(), Some("young"));

        let all = filter_by_retention(
            vec![old, young],
            RETENTION_UNLIMITED,
            now.timestamp_millis(),
        );
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn filter_entries_by_event_session_and_range() {
        let a = AuditLedgerEntry {
            ts: "2026-07-01T12:00:00.000Z".into(),
            session_id: Some("sess-a".into()),
            project_path: None,
            tool_name: "bash".into(),
            event: EVENT_TOOL_END.into(),
            permission: None,
            outcome: Some(OUTCOME_OK.into()),
            summary: None,
        };
        let b = AuditLedgerEntry {
            ts: "2026-07-15T12:00:00.000Z".into(),
            session_id: Some("sess-b".into()),
            project_path: None,
            tool_name: "read_file".into(),
            event: EVENT_PERMISSION.into(),
            permission: Some("allow_once".into()),
            outcome: None,
            summary: None,
        };
        let c = AuditLedgerEntry {
            ts: "2026-07-20T12:00:00.000Z".into(),
            session_id: Some("sess-a".into()),
            project_path: None,
            tool_name: "bash".into(),
            event: EVENT_TOOL_START.into(),
            permission: None,
            outcome: None,
            summary: None,
        };

        let by_event = filter_entries(
            vec![a.clone(), b.clone(), c.clone()],
            &AuditLedgerFilter {
                event: Some(EVENT_PERMISSION.into()),
                ..Default::default()
            },
        );
        assert_eq!(by_event.len(), 1);
        assert_eq!(by_event[0].tool_name, "read_file");

        let by_sid = filter_entries(
            vec![a.clone(), b.clone(), c.clone()],
            &AuditLedgerFilter {
                session_id: Some("sess-a".into()),
                ..Default::default()
            },
        );
        assert_eq!(by_sid.len(), 2);

        let by_range = filter_entries(
            vec![a, b, c],
            &AuditLedgerFilter {
                from_ts: Some("2026-07-10".into()),
                to_ts: Some("2026-07-18".into()),
                ..Default::default()
            },
        );
        assert_eq!(by_range.len(), 1);
        assert_eq!(by_range[0].session_id.as_deref(), Some("sess-b"));
    }

    #[test]
    fn prune_drops_old_rows_on_disk() {
        with_temp_home(|_home| {
            let path = ledger_path();
            let now = chrono::Utc::now();
            let old_ts = (now - chrono::Duration::days(60))
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            let young_ts = (now - chrono::Duration::days(3))
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            let body = format!(
                "{}\n{}\n",
                serde_json::json!({
                    "ts": old_ts,
                    "toolName": "bash",
                    "event": "tool_end",
                    "outcome": "ok",
                    "summary": "old-row"
                }),
                serde_json::json!({
                    "ts": young_ts,
                    "toolName": "bash",
                    "event": "tool_end",
                    "outcome": "ok",
                    "summary": "young-row"
                }),
            );
            fs::write(&path, body).unwrap();

            let dropped = prune_ledger(Some(RETENTION_30)).expect("prune");
            assert!(dropped >= 1);
            let listed = list_recent(Some(10));
            assert_eq!(listed.len(), 1);
            assert_eq!(listed[0].summary.as_deref(), Some("young-row"));

            // Unlimited: no further drops.
            assert_eq!(prune_ledger(Some(RETENTION_UNLIMITED)).unwrap(), 0);
            assert_eq!(list_recent(Some(10)).len(), 1);
        });
    }

    #[test]
    fn export_filtered_respects_event() {
        with_temp_home(|_home| {
            record_permission(Some("s1"), None, "read_file", "allow_once", Some("a.rs"));
            record_tool_start(Some("s1"), None, "bash", Some("echo"));
            let all = export_redacted_jsonl();
            assert!(all.lines().count() >= 2);
            let only_perm = export_redacted_jsonl_filtered(&AuditLedgerFilter {
                event: Some(EVENT_PERMISSION.into()),
                ..Default::default()
            });
            assert_eq!(only_perm.lines().count(), 1);
            assert!(only_perm.contains("permission"));
            assert!(!only_perm.contains("tool_start"));
        });
    }
}
