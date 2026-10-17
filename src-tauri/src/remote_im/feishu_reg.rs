//! Feishu / Lark PersonalAgent QR registration (real HTTP, not mock).

use serde_json::Value;

use super::{ScanBeginDto, ScanPollDto};

fn accounts_base(platform: &str) -> &'static str {
    if platform == "lark" {
        "https://accounts.larksuite.com"
    } else {
        "https://accounts.feishu.cn"
    }
}

async fn registration_call(
    base_url: &str,
    action: &str,
    params: Option<&[(&str, &str)]>,
) -> Result<Value, String> {
    let client = crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let mut form = vec![("action".to_string(), action.to_string())];
    if let Some(ps) = params {
        for (k, v) in ps {
            form.push((k.to_string(), v.to_string()));
        }
    }

    let res = client
        .post(format!("{base_url}/oauth/v1/app/registration"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("registration request failed: {e}"))?;

    let status = res.status();
    let body = res.text().await.map_err(|e| format!("read body: {e}"))?;
    let data: Value = serde_json::from_str(&body).map_err(|_| {
        format!(
            "bad registration response HTTP {status}: {}",
            body.chars().take(200).collect::<String>()
        )
    })?;
    Ok(data)
}

pub async fn scan_begin(channel: &str) -> Result<ScanBeginDto, String> {
    let platform = if channel == "lark" { "lark" } else { "feishu" };
    // Weixin and others: not this OAuth registration
    if channel != "feishu" && channel != "lark" {
        return Err(format!(
            "scan not supported for channel {channel}; use paste credentials"
        ));
    }
    let base = accounts_base(platform);

    let init = registration_call(base, "init", None).await?;
    if let Some(err) = init.get("error").and_then(|e| e.as_str()) {
        return Err(format!(
            "{err}: {}",
            init.get("error_description")
                .and_then(|d| d.as_str())
                .unwrap_or("")
        ));
    }

    let begin = registration_call(
        base,
        "begin",
        Some(&[
            ("archetype", "PersonalAgent"),
            ("auth_method", "client_secret"),
            ("request_user_info", "open_id"),
        ]),
    )
    .await?;

    if let Some(err) = begin.get("error").and_then(|e| e.as_str()) {
        return Err(format!(
            "{err}: {}",
            begin
                .get("error_description")
                .and_then(|d| d.as_str())
                .unwrap_or("")
        ));
    }

    let device_code = begin
        .get("device_code")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let uri = begin
        .get("verification_uri_complete")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if device_code.is_empty() || uri.is_empty() {
        return Err("incomplete onboarding response from Feishu".into());
    }

    Ok(ScanBeginDto {
        device_code,
        verification_uri: uri,
        interval_sec: begin.get("interval").and_then(|v| v.as_u64()).unwrap_or(5) as u32,
        expire_in_sec: begin
            .get("expire_in")
            .and_then(|v| v.as_u64())
            .unwrap_or(600) as u32,
        platform: platform.into(),
    })
}

pub async fn scan_poll(channel: &str, device_code: &str) -> Result<ScanPollDto, String> {
    let mut base = accounts_base(if channel == "lark" { "lark" } else { "feishu" });
    let code = device_code.trim();
    if code.is_empty() {
        return Err("missing device_code".into());
    }

    for _ in 0..2 {
        let data = registration_call(base, "poll", Some(&[("device_code", code)])).await?;
        let user_info = data.get("user_info").cloned().unwrap_or(Value::Null);
        let brand = user_info
            .get("tenant_brand")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        if brand == "lark" && base != accounts_base("lark") {
            base = accounts_base("lark");
            continue;
        }

        let client_id = data
            .get("client_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let client_secret = data
            .get("client_secret")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if !client_id.is_empty() && !client_secret.is_empty() {
            return Ok(ScanPollDto {
                status: "completed".into(),
                app_id: Some(client_id),
                app_secret: Some(client_secret),
                owner_open_id: user_info
                    .get("open_id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                platform: Some(if brand == "lark" {
                    "lark".into()
                } else {
                    "feishu".into()
                }),
                error: None,
                ..Default::default()
            });
        }

        let err = data
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        return Ok(match err.as_str() {
            "" | "authorization_pending" | "slow_down" => ScanPollDto {
                status: "pending".into(),
                app_id: None,
                app_secret: None,
                owner_open_id: None,
                platform: None,
                error: None,
                ..Default::default()
            },
            "access_denied" => ScanPollDto {
                status: "denied".into(),
                app_id: None,
                app_secret: None,
                owner_open_id: None,
                platform: None,
                error: Some("authorization denied".into()),
                ..Default::default()
            },
            "expired_token" => ScanPollDto {
                status: "expired".into(),
                app_id: None,
                app_secret: None,
                owner_open_id: None,
                platform: None,
                error: Some("session expired".into()),
                ..Default::default()
            },
            other => ScanPollDto {
                status: "error".into(),
                app_id: None,
                app_secret: None,
                owner_open_id: None,
                platform: None,
                error: Some(format!(
                    "{other}: {}",
                    data.get("error_description")
                        .and_then(|d| d.as_str())
                        .unwrap_or("")
                )),
                ..Default::default()
            },
        });
    }
    Ok(ScanPollDto {
        status: "pending".into(),
        app_id: None,
        app_secret: None,
        owner_open_id: None,
        platform: None,
        error: None,
        ..Default::default()
    })
}
