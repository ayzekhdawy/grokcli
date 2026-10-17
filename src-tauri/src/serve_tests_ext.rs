#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mask_secret_short_and_long() {
        assert_eq!(mask_secret(""), "");
        assert_eq!(mask_secret("ab"), "••••");
        assert_eq!(mask_secret("super-secret-token"), "••••oken");
        assert_eq!(mask_secret("abcd"), "••••");
        assert_eq!(mask_secret("abcde"), "••••bcde");
    }

    #[test]
    fn secret_last4_works() {
        assert_eq!(secret_last4(""), "");
        assert_eq!(secret_last4("xy"), "xy");
        assert_eq!(secret_last4("super-secret-token"), "oken");
    }

    #[test]
    fn generate_secret_is_long_url_safe() {
        let s = generate_serve_secret();
        assert!(s.len() >= 32, "len {}", s.len());
        assert!(!s.contains('+') && !s.contains('/') && !s.contains('='));
    }

    #[test]
    fn normalize_bind_default_and_valid() {
        assert_eq!(normalize_bind(None).unwrap(), DEFAULT_SERVE_BIND);
        assert_eq!(normalize_bind(Some("")).unwrap(), DEFAULT_SERVE_BIND);
        assert_eq!(
            normalize_bind(Some("127.0.0.1:3000")).unwrap(),
            "127.0.0.1:3000"
        );
        assert!(normalize_bind(Some("http://evil")).is_err());
        assert!(normalize_bind(Some("not-a-bind")).is_err());
    }

    #[test]
    fn build_connection_url_shape() {
        let url = build_connection_url("127.0.0.1:2419", "tokensecret99");
        assert_eq!(
            url,
            "ws://127.0.0.1:2419/ws?server-key=tokensecret99"
        );
        let masked = build_connection_url_masked("127.0.0.1:2419", "tokensecret99");
        assert!(masked.contains("••••et99"));
        assert!(!masked.contains("tokensecret99"));
    }

    #[test]
    fn build_connection_cli_template_and_mask() {
        let cli = build_connection_cli("127.0.0.1:2419", "tokensecret99");
        assert_eq!(
            cli,
            "grok --remote ws://127.0.0.1:2419/ws --secret tokensecret99"
        );
        let masked = build_connection_cli_masked("127.0.0.1:2419", "tokensecret99");
        assert!(masked.contains("••••et99"));
        assert!(!masked.contains("tokensecret99"));
        assert!(masked.starts_with("grok --remote ws://127.0.0.1:2419/ws --secret "));
        assert_eq!(build_remote_ws_base("127.0.0.1:2419"), "ws://127.0.0.1:2419/ws");
    }

    #[test]
    fn normalize_remote_url_accepts_ws_and_http() {
        assert_eq!(normalize_remote_url(None).unwrap(), None);
        assert_eq!(normalize_remote_url(Some("")).unwrap(), None);
        assert_eq!(
            normalize_remote_url(Some("  ws://upstream.example:9000/agent  "))
                .unwrap()
                .as_deref(),
            Some("ws://upstream.example:9000/agent")
        );
        assert_eq!(
            normalize_remote_url(Some("wss://edge.example/ws"))
                .unwrap()
                .as_deref(),
            Some("wss://edge.example/ws")
        );
        assert_eq!(
            normalize_remote_url(Some("https://edge.example/ws"))
                .unwrap()
                .as_deref(),
            Some("wss://edge.example/ws")
        );
        assert_eq!(
            normalize_remote_url(Some("http://127.0.0.1:3000/ws"))
                .unwrap()
                .as_deref(),
            Some("ws://127.0.0.1:3000/ws")
        );
        assert!(normalize_remote_url(Some("ftp://x")).is_err());
        assert!(normalize_remote_url(Some("not-a-url")).is_err());
        assert!(normalize_remote_url(Some("ws://x y")).is_err());
        assert!(normalize_remote_url(Some("ws://")).is_err());
        assert!(
            normalize_remote_url(Some("ws://h/ws?server-key=sekrit")).is_err(),
            "must reject secret in remote query"
        );
        assert!(normalize_remote_url(Some("ws://h/ws?token=abc")).is_err());
    }

    #[test]
    fn parse_serve_help_requires_bind_and_secret() {
        let ok_help = r#"
Run the agent as a WebSocket server
Options:
  --bind <BIND>      Address for the server to listen on
  --secret <SECRET>  Secret token for client authentication
  --remote <REMOTE>  Remote agent URL for proxy mode
"#;
        assert!(parse_serve_help_supports(ok_help, "", true));
        assert!(parse_serve_help_supports_remote(ok_help, "", true));
        assert!(!parse_serve_help_supports(ok_help, "", false));
        assert!(!parse_serve_help_supports("unknown command", "", true));
        assert!(!parse_serve_help_supports("--bind only", "", true));
        assert!(!parse_serve_help_supports_remote(
            "--bind and --secret only, no proxy",
            "",
            true
        ));
    }

    #[test]
    fn derive_state_matrix() {
        let (s, m) = derive_serve_state(false, false, false, false, None);
        assert_eq!(s, "error");
        assert!(m.unwrap().contains("not found"));

        let (s, m) = derive_serve_state(true, false, false, false, None);
        assert_eq!(s, "unsupported");
        assert!(m.unwrap().contains("agent serve"));

        let (s, _) = derive_serve_state(true, true, true, false, None);
        assert_eq!(s, "running");

        let (s, _) = derive_serve_state(true, true, false, true, None);
        assert_eq!(s, "running");

        let (s, _) = derive_serve_state(true, true, false, false, None);
        assert_eq!(s, "stopped");
    }

    #[test]
    fn status_dto_serde_omits_full_secret_fields_when_none() {
        let dto = ServeStatusDto {
            state: "stopped".into(),
            bind: DEFAULT_SERVE_BIND.into(),
            remote: None,
            secret_masked: None,
            secret_last4: None,
            connection_url: None,
            connection_cli: None,
            connection_cli_masked: None,
            pid: None,
            tracked_pid: None,
            port_open: false,
            cli_found: true,
            cli_supports_serve: true,
            cli_supports_remote: true,
            message: None,
        };
        let v = serde_json::to_value(&dto).unwrap();
        assert!(v.get("secretMasked").is_none() || v.get("secretMasked").unwrap().is_null());
        assert!(v.get("connectionUrl").is_none() || v.get("connectionUrl").unwrap().is_null());
        assert!(v.get("connectionCli").is_none() || v.get("connectionCli").unwrap().is_null());
        // Never a raw "secret" field.
        assert!(v.get("secret").is_none());
    }

    #[test]
    fn normalize_probe_addr_accepts_host_port_only() {
        assert_eq!(
            normalize_probe_addr("127.0.0.1:2419").unwrap(),
            "127.0.0.1:2419"
        );
        assert!(normalize_probe_addr("").is_err());
        assert!(normalize_probe_addr("ws://127.0.0.1:2419/ws?server-key=x").is_err());
        assert!(normalize_probe_addr("127.0.0.1:2419/ws").is_err());
        assert!(normalize_probe_addr("127.0.0.1:2419?server-key=abc").is_err());
        assert!(normalize_probe_addr("host with space:1").is_err());
    }
}
