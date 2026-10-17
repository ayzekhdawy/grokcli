//! Generic / long-tail channels: credential health loop in Rust (no Node).
//! Full protocol adapters can replace these incrementally without Host changes.

use super::super::outbound::http_client;
use super::super::types::{ChannelInstance, IncomingMessage};
use serde_json::json;
use std::time::Duration;
use tokio::sync::{mpsc, watch};

pub async fn run(
    channel: &str,
    inst: ChannelInstance,
    _tx: mpsc::Sender<IncomingMessage>,
    mut cancel: watch::Receiver<bool>,
) -> Result<(), String> {
    if inst.secrets.is_empty() {
        return Err(format!("{channel}: no secrets"));
    }
    tracing::info!(
        instance = %inst.id,
        channel,
        "generic Rust connector active (health loop)"
    );

    // Channel-specific light probes
    let client = http_client().ok();
    loop {
        if *cancel.borrow() {
            return Ok(());
        }
        if let Some(ref c) = client {
            match channel {
                "matrix" => {
                    let hs = inst
                        .secrets
                        .get("homeserver")
                        .cloned()
                        .or_else(|| {
                            inst.options
                                .get("homeserver")
                                .and_then(|x| x.as_str())
                                .map(|s| s.to_string())
                        })
                        .filter(|s| !s.is_empty());
                    if let Some(hs) = hs {
                        let base = hs.trim_end_matches('/');
                        let _ = c
                            .get(format!("{base}/_matrix/client/versions"))
                            .send()
                            .await;
                    }
                }
                "line" => {
                    if let Some(token) = inst.secrets.get("channel_access_token") {
                        let _ = c
                            .get("https://api.line.me/v2/bot/info")
                            .bearer_auth(token)
                            .send()
                            .await;
                    }
                }
                "qq" | "qqbot" => {
                    // OneBot / QQ bot: optional HTTP probe
                    if let Some(base) = inst
                        .secrets
                        .get("http_url")
                        .or_else(|| inst.secrets.get("api_base"))
                    {
                        let _ = c.get(base).send().await;
                    }
                }
                _ => {
                    // keep process alive for Host "running" state
                    let _ = json!({ "channel": channel, "ok": true });
                }
            }
        }
        tokio::select! {
            _ = cancel.changed() => { if *cancel.borrow() { return Ok(()); } }
            _ = tokio::time::sleep(Duration::from_secs(120)) => {}
        }
    }
}
