//! Gating tests: drive **shipped** weixin_reg::scan_begin / scan_poll + long-poll/send.

#[cfg(test)]
mod tests {
    use crate::remote_im::channels::weixin;
    use crate::remote_im::fixture_http::spawn_fixture;
    use crate::remote_im::types::{ChannelInstance, IncomingMessage};
    use crate::remote_im::weixin_reg;
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::OnceLock;
    use std::time::Duration;
    use tokio::sync::{mpsc, watch, Mutex as AsyncMutex};

    /// scan_begin/scan_poll share process-global QR_STATE — serialize those tests.
    fn scan_lock() -> &'static AsyncMutex<()> {
        static L: OnceLock<AsyncMutex<()>> = OnceLock::new();
        L.get_or_init(|| AsyncMutex::new(()))
    }

    #[test]
    fn weixin_is_scan_supported_on_host() {
        assert!(weixin_reg::channel_supports_scan("weixin"));
        assert!(!weixin_reg::channel_supports_scan("telegram"));
    }

    /// Plan step 3: call shipped scan_begin → scan_poll wait → scan_poll completed
    /// with base_url = fixture (not hand-built DTO, not raw re-GET).
    #[tokio::test]
    async fn shipped_scan_begin_then_poll_wait_then_confirmed() {
        let _guard = scan_lock().lock().await;
        let (base, state, _shutdown) = spawn_fixture().await;
        state.set_route(
            "get_bot_qrcode",
            200,
            r#"{"qrcode":"KEY_WAIT_CONF","qrcode_img_content":"https://cdn.test/qr-wait.png"}"#,
        );
        // First status poll → wait; second → confirmed (shipped scan_poll hits get_qrcode_status)
        state.set_route_sequence(
            "get_qrcode_status",
            vec![
                (200, r#"{"status":"wait"}"#.into()),
                (
                    200,
                    r#"{"status":"confirmed","bot_token":"BEARER_FROM_HOST","ilink_bot_id":"bot-host-1","ilink_user_id":"user@im.wechat"}"#.into(),
                ),
            ],
        );

        let mut opts = HashMap::new();
        opts.insert("base_url".into(), base.clone());

        // --- shipped scan_begin ---
        let begin = weixin_reg::scan_begin(Some(&opts))
            .await
            .expect("scan_begin must succeed against fixture");
        assert_eq!(begin.platform, "weixin");
        assert_eq!(begin.device_code, "KEY_WAIT_CONF");
        assert!(
            begin.verification_uri.contains("qr-wait"),
            "verification_uri={}",
            begin.verification_uri
        );
        let paths = state.request_paths();
        assert!(
            paths.iter().any(|p| p.contains("get_bot_qrcode")),
            "scan_begin must call get_bot_qrcode: {paths:?}"
        );

        // --- shipped scan_poll #1: wait ---
        let p1 = weixin_reg::scan_poll(&begin.device_code)
            .await
            .expect("scan_poll wait");
        assert_eq!(p1.status, "wait", "first poll should be wait: {p1:?}");
        assert!(p1.app_secret.is_none());

        // --- shipped scan_poll #2: confirmed → Host maps to completed + token ---
        let p2 = weixin_reg::scan_poll(&begin.device_code)
            .await
            .expect("scan_poll confirmed");
        assert_eq!(
            p2.status, "completed",
            "confirmed must map to completed for GUI auto-save: {p2:?}"
        );
        assert_eq!(p2.app_secret.as_deref(), Some("BEARER_FROM_HOST"));
        assert_eq!(p2.app_id.as_deref(), Some("bot-host-1"));
        assert_eq!(p2.owner_open_id.as_deref(), Some("user@im.wechat"));
        assert_eq!(p2.platform.as_deref(), Some("weixin"));

        let paths2 = state.request_paths();
        let status_hits = paths2
            .iter()
            .filter(|p| p.contains("get_qrcode_status"))
            .count();
        assert!(
            status_hits >= 2,
            "expected ≥2 get_qrcode_status via scan_poll, got {paths2:?}"
        );
    }

    /// Plan step 3: expired status → shipped poll refreshes QR and returns wait + new URI/key.
    #[tokio::test]
    async fn shipped_scan_poll_expired_refreshes_and_returns_new_uri() {
        let _guard = scan_lock().lock().await;
        let (base, state, _shutdown) = spawn_fixture().await;
        state.set_route_sequence(
            "get_bot_qrcode",
            vec![
                (
                    200,
                    r#"{"qrcode":"KEY_OLD","qrcode_img_content":"https://cdn.test/old.png"}"#
                        .into(),
                ),
                (
                    200,
                    r#"{"qrcode":"KEY_NEW","qrcode_img_content":"https://cdn.test/new-qr.png"}"#
                        .into(),
                ),
            ],
        );
        state.set_route("get_qrcode_status", 200, r#"{"status":"expired"}"#);

        let mut opts = HashMap::new();
        opts.insert("base_url".into(), base);

        let begin = weixin_reg::scan_begin(Some(&opts))
            .await
            .expect("scan_begin");
        assert_eq!(begin.device_code, "KEY_OLD");

        let poll = weixin_reg::scan_poll(&begin.device_code)
            .await
            .expect("scan_poll on expired");
        // Must not leave GUI in terminal expired without refresh payload
        assert_eq!(
            poll.status, "wait",
            "expired must become wait after refresh: {poll:?}"
        );
        assert_eq!(poll.error.as_deref(), Some("qr_refreshed"));
        assert_eq!(
            poll.verification_uri.as_deref(),
            Some("https://cdn.test/new-qr.png")
        );
        assert_eq!(poll.device_code.as_deref(), Some("KEY_NEW"));

        let paths = state.request_paths();
        assert!(
            paths
                .iter()
                .filter(|p| p.contains("get_bot_qrcode"))
                .count()
                >= 2,
            "refresh must re-call get_bot_qrcode: {paths:?}"
        );
        assert!(paths.iter().any(|p| p.contains("get_qrcode_status")));
    }

    /// Connector long-poll + send (shipped weixin::run / send_text).
    #[tokio::test]
    async fn long_poll_getupdates_delivers_inbound_and_send_uses_context_token() {
        let (base, state, _shutdown) = spawn_fixture().await;
        state.set_route(
            "getupdates",
            200,
            r#"{"ret":0,"get_updates_buf":"cursor1","msgs":[{"from_user_id":"peer1@im.wechat","msg_id":"m1","item_list":[{"text_item":{"text":"hello from wx"}}],"context_token":"CTX_PEER1"}]}"#,
        );
        state.set_route("sendmessage", 200, r#"{"ret":0}"#);

        let inst_id = format!("test-wx-{}", uuid::Uuid::new_v4());
        let mut secrets = HashMap::new();
        secrets.insert("token".into(), "tok".into());
        secrets.insert("base_url".into(), base.clone());
        secrets.insert("_instance_id".into(), inst_id.clone());

        let inst = ChannelInstance {
            id: inst_id.clone(),
            channel: "weixin".into(),
            name: "t".into(),
            enabled: true,
            secrets: secrets.clone(),
            options: json!({}),
            acl: json!({}),
            project_scope: json!({}),
        };

        let (tx, mut rx) = mpsc::channel::<IncomingMessage>(8);
        let (cancel_tx, cancel_rx) = watch::channel(false);

        let run = tokio::spawn(async move {
            let _ = weixin::run(inst, tx, cancel_rx).await;
        });

        let msg = tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("timeout waiting inbound")
            .expect("channel closed");
        assert_eq!(msg.content, "hello from wx");
        assert_eq!(msg.sender_id, "peer1@im.wechat");

        let ct = weixin::get_context_token(&inst_id, "peer1@im.wechat");
        assert_eq!(ct.as_deref(), Some("CTX_PEER1"));

        let send = weixin::send_text(&secrets, "peer1@im.wechat", "reply body").await;
        assert!(send.is_ok(), "send_text failed: {send:?}");

        let _ = cancel_tx.send(true);
        let _ = run.await;
        let paths2 = state.request_paths();
        assert!(
            paths2
                .iter()
                .any(|p| p.to_ascii_lowercase().contains("getupdates")),
            "expected getupdates: {paths2:?}"
        );
        assert!(
            paths2
                .iter()
                .any(|p| p.to_ascii_lowercase().contains("sendmessage")),
            "expected sendmessage: {paths2:?}"
        );
    }
}
