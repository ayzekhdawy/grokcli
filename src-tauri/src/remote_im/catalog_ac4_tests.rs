//! AC4: every catalog channel has real protocol + scanSupport aligned with Host.

#[cfg(test)]
mod tests {
    use crate::remote_im::channels::{self, CATALOG_CHANNELS};
    use crate::remote_im::weixin_reg;

    /// Host scan support (must match GUI scanSupport true set).
    fn host_scan_channels() -> &'static [&'static str] {
        weixin_reg::scan_supported_channels()
    }

    /// Frontend scanSupport: true only for these (mirrors channelSchemas.ts).
    const GUI_SCAN_TRUE: &[&str] = &["feishu", "lark", "weixin"];

    #[test]
    fn scan_support_gui_matches_host() {
        for ch in GUI_SCAN_TRUE {
            assert!(
                weixin_reg::channel_supports_scan(ch) || matches!(*ch, "feishu" | "lark"),
                "GUI scanSupport true but Host rejects {ch}"
            );
        }
        // Host list is the source for weixin + feishu/lark
        for ch in host_scan_channels() {
            assert!(
                GUI_SCAN_TRUE.contains(ch),
                "Host scan supports {ch} but GUI scanSupport not true"
            );
        }
        // Explicit: weixin must not be unsupported
        assert!(weixin_reg::channel_supports_scan("weixin"));
        // telegram etc must not claim host scan
        assert!(!weixin_reg::channel_supports_scan("telegram"));
        assert!(!weixin_reg::channel_supports_scan("dingtalk"));
    }

    #[test]
    fn every_catalog_channel_has_non_empty_protocol_and_dispatch() {
        for ch in CATALOG_CHANNELS {
            let p = channels::protocol_for(ch);
            assert!(!p.is_empty(), "{ch} empty protocol");
            // Core channels must not be pure generic-health
            if matches!(
                *ch,
                "feishu"
                    | "lark"
                    | "dingtalk"
                    | "wecom"
                    | "weixin"
                    | "telegram"
                    | "discord"
                    | "slack"
                    | "qq"
                    | "qqbot"
                    | "matrix"
                    | "line"
                    | "imessage"
                    | "weibo"
                    | "wps-xiezuo"
            ) {
                assert_ne!(
                    p, "generic-health",
                    "AC4: {ch} must have real connector protocol, got generic-health"
                );
                assert!(
                    channels::is_real_protocol(ch),
                    "AC4: is_real_protocol({ch}) false"
                );
            }
        }
    }

    #[test]
    fn catalog_matches_required_sidebar_ids() {
        // Align with frontend REQUIRED_CHANNEL_IDS (active picker; WPS retired)
        let required = [
            "feishu", "lark", "dingtalk", "wecom", "weixin", "weibo", "qq", "qqbot", "telegram",
            "slack", "discord", "matrix", "line", "imessage",
        ];
        for id in required {
            assert!(
                CATALOG_CHANNELS.contains(&id),
                "missing catalog channel {id}"
            );
            let _ = channels::protocol_for(id);
        }
        // Soft-retired WPS ids remain in Host catalog for legacy instance dispatch
        assert!(CATALOG_CHANNELS.contains(&"wps-xiezuo"));
        assert!(CATALOG_CHANNELS.contains(&"wps-agentspace"));
    }
}
