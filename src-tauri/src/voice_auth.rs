//! Resolve a Bearer token for xAI Voice / STT without exposing secrets to the UI.

use std::fs;
use std::path::PathBuf;

use serde_json::Value;

use crate::process_util;
use crate::secrets;

/// Preferred auth for xAI voice endpoints (never return to the webview).
pub fn resolve_bearer_token() -> Result<String, String> {
    // 1) Official API key from app secrets (optional power-user path).
    let sec = secrets::load_secrets();
    if let Some(key) = sec.official_api_key.filter(|k| !k.trim().is_empty()) {
        return Ok(key.trim().to_string());
    }

    // 2) CLI OIDC / coding token from ~/.grok/auth.json (`key` field).
    if let Some(key) = read_cli_auth_key() {
        return Ok(key);
    }

    // 3) Environment fallback for CI / custom setups.
    for var in ["XAI_API_KEY", "GROK_API_KEY"] {
        if let Ok(key) = std::env::var(var) {
            let key = key.trim().to_string();
            if !key.is_empty() {
                return Ok(key);
            }
        }
    }

    Err(
        "No xAI credentials found. Sign in with Grok CLI (`grok login`) or add an official API key in Settings."
            .into(),
    )
}

fn read_cli_auth_key() -> Option<String> {
    // Route-aware: official syncs OIDC into agent-home; custom strips it.
    // Never blind-copy auth.json here — a custom relay process could lazily
    // load it and send OIDC to the relay ("works until I use voice").
    // Custom falls back to ~/.grok/auth.json below (voice is official xAI).
    crate::providers::prepare_route_auth_for_agent();
    let path = auth_json_path();
    let raw = fs::read_to_string(path).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    let entry = v.as_object()?.values().next()?;
    entry
        .get("key")
        .or_else(|| entry.get("access_token"))
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn auth_json_path() -> PathBuf {
    if let Ok(home) = std::env::var("GROK_HOME") {
        let p = PathBuf::from(home).join("auth.json");
        if p.is_file() {
            return p;
        }
    }
    process_util::user_home().join(".grok").join("auth.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_is_callable() {
        let _ = resolve_bearer_token();
    }
}
