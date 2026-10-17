//! SuperGrok weekly credit quota — ported from sister project **grok-go** `quota.rs`.
//!
//! Source of truth for the grok.com "Weekly SuperGrok Limit" UI:
//! `POST https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig`
//! (empty gRPC-web request, Bearer OAuth access token).

use chrono::{DateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const BILLING_URL: &str = "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig";
/// Empty protobuf message framed as gRPC-web (flags=0, length=0).
const EMPTY_GRPC_WEB_FRAME: &[u8] = &[0x00, 0x00, 0x00, 0x00, 0x00];
const SUPERGROK_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaProductUsage {
    pub product_id: u32,
    pub label: String,
    pub used_percent: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountQuotaSnapshot {
    pub used_percent: f32,
    pub remaining_percent: f32,
    pub period_start_at: Option<DateTime<Utc>>,
    pub resets_at: Option<DateTime<Utc>>,
    pub products: Vec<QuotaProductUsage>,
    pub fetched_at: DateTime<Utc>,
    #[serde(default)]
    pub last_error: Option<String>,
    /// Where the snapshot came from (grpc / json fallback).
    #[serde(default)]
    pub source: String,
}

impl AccountQuotaSnapshot {
    pub fn from_used(
        used_percent: f32,
        period_start_at: Option<DateTime<Utc>>,
        resets_at: Option<DateTime<Utc>>,
        products: Vec<QuotaProductUsage>,
        source: impl Into<String>,
    ) -> Self {
        let used = sanitize_percent(used_percent);
        Self {
            used_percent: used,
            remaining_percent: (100.0 - used).max(0.0),
            period_start_at,
            resets_at,
            products,
            fetched_at: Utc::now(),
            last_error: None,
            source: source.into(),
        }
    }
}

fn product_label(id: u32) -> String {
    match id {
        1 => "API".into(),
        2 => "Grok Build".into(),
        4 => "Other".into(),
        _ => format!("Product {id}"),
    }
}

fn sanitize_percent(v: f32) -> f32 {
    if !v.is_finite() {
        return 0.0;
    }
    v.clamp(0.0, 200.0)
}

pub fn default_unused_quota_snapshot() -> AccountQuotaSnapshot {
    AccountQuotaSnapshot::from_used(0.0, None, None, Vec::new(), "empty")
}

pub async fn fetch_quota_snapshot(access_token: &str) -> Result<AccountQuotaSnapshot, String> {
    let client = crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .timeout(SUPERGROK_TIMEOUT)
        .user_agent("GrokApp/0.1 (desktop; unofficial; sister-of-grok-go)")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(BILLING_URL)
        .timeout(SUPERGROK_TIMEOUT)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Content-Type", "application/grpc-web+proto")
        .header("x-grpc-web", "1")
        .header("x-user-agent", "connect-es/2.1.1")
        .header("Origin", "https://grok.com")
        .header("Referer", "https://grok.com/?_s=usage")
        .header("Accept", "*/*")
        .header("Cookie", "")
        .body(EMPTY_GRPC_WEB_FRAME.to_vec())
        .send()
        .await
        .map_err(|e| format!("quota request failed: {e}"))?;

    let status = resp.status();
    let headers = resp.headers().clone();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("quota response body: {e}"))?;

    if let Some(grpc_status) = header_str(&headers, "grpc-status") {
        if grpc_status != "0" {
            let msg = header_str(&headers, "grpc-message").unwrap_or_default();
            return Err(format!("quota RPC status {grpc_status}: {msg}"));
        }
    }

    if !status.is_success() {
        let preview = String::from_utf8_lossy(&bytes);
        return Err(format!(
            "quota HTTP {}: {}",
            status.as_u16(),
            truncate(&preview, 200)
        ));
    }

    // Cloudflare HTML challenge
    if bytes.starts_with(b"<!DOCTYPE")
        || bytes.starts_with(b"<html")
        || bytes.starts_with(b"<!doctype")
    {
        return Err("quota endpoint returned HTML (blocked)".into());
    }

    validate_grpc_web_trailers(&bytes)?;
    let mut snap = parse_grpc_web_quota(&bytes)?;
    snap.source = "grpc-web".into();
    Ok(snap)
}

/// Fallback: JSON billing used by Grok Build CLI extension.
pub async fn fetch_quota_via_cli_proxy(access_token: &str) -> Result<AccountQuotaSnapshot, String> {
    let client = crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .timeout(SUPERGROK_TIMEOUT)
        .user_agent("GrokApp/0.1 (desktop; unofficial)")
        .build()
        .map_err(|e| e.to_string())?;

    let url = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
    let resp = client
        .get(url)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("x-grok-client-mode", "cli")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("cli-proxy billing failed: {e}"))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("cli-proxy body: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "cli-proxy HTTP {}: {}",
            status.as_u16(),
            truncate(&body, 160)
        ));
    }
    if body.trim_start().starts_with('<') {
        return Err("cli-proxy returned HTML".into());
    }
    let v: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("cli-proxy json: {e}"))?;
    let root = v.get("config").cloned().unwrap_or(v);

    let used = root
        .get("creditUsagePercent")
        .and_then(|x| x.as_f64())
        .unwrap_or(0.0) as f32;

    let mut products = Vec::new();
    if let Some(arr) = root.get("productUsage").and_then(|x| x.as_array()) {
        for p in arr {
            let name = p.get("product").and_then(|x| x.as_str()).unwrap_or("");
            let pct = p
                .get("usagePercent")
                .and_then(|x| x.as_f64())
                .unwrap_or(0.0) as f32;
            let product_id = match name {
                "Api" | "API" => 1,
                "GrokBuild" | "Grok Build" => 2,
                "GrokChat" => 4,
                _ => 0,
            };
            products.push(QuotaProductUsage {
                product_id,
                label: if name.is_empty() {
                    product_label(product_id)
                } else {
                    name.into()
                },
                used_percent: pct,
            });
        }
    }

    let period_start = root
        .get("billingPeriodStart")
        .or_else(|| root.pointer("/currentPeriod/start"))
        .and_then(|x| x.as_str())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc));
    let resets_at = root
        .get("billingPeriodEnd")
        .or_else(|| root.pointer("/currentPeriod/end"))
        .and_then(|x| x.as_str())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc));

    Ok(AccountQuotaSnapshot::from_used(
        used,
        period_start,
        resets_at,
        products,
        "cli-chat-proxy",
    ))
}

/// Prefer gRPC-web (same as grok-go), fall back to CLI chat proxy JSON.
pub async fn fetch_quota_best_effort(access_token: &str) -> AccountQuotaSnapshot {
    match fetch_quota_snapshot(access_token).await {
        Ok(s) => s,
        Err(grpc_err) => {
            tracing::warn!(target: "quota", error = %grpc_err, "gRPC SuperGrok quota failed; trying cli-proxy");
            match fetch_quota_via_cli_proxy(access_token).await {
                Ok(s) => s,
                Err(json_err) => {
                    tracing::warn!(target: "quota", error = %json_err, "cli-proxy quota failed");
                    let mut s = default_unused_quota_snapshot();
                    s.last_error = Some(format!("{grpc_err}; fallback: {json_err}"));
                    s.source = "error".into();
                    s
                }
            }
        }
    }
}

fn header_str(headers: &reqwest::header::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| percent_decode_lightweight(s.trim()))
}

fn percent_decode_lightweight(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (from_hex(bytes[i + 1]), from_hex(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn from_hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let t: String = s.chars().take(max).collect();
        format!("{t}…")
    }
}

fn validate_grpc_web_trailers(data: &[u8]) -> Result<(), String> {
    let trailers = grpc_web_trailer_fields(data);
    if let Some(status) = trailers.get("grpc-status") {
        if status != "0" {
            let msg = trailers.get("grpc-message").cloned().unwrap_or_default();
            return Err(format!("quota RPC trailer status {status}: {msg}"));
        }
    }
    Ok(())
}

fn grpc_web_trailer_fields(data: &[u8]) -> std::collections::BTreeMap<String, String> {
    let mut fields = std::collections::BTreeMap::new();
    let mut index = 0usize;
    while index + 5 <= data.len() {
        let flags = data[index];
        let length = u32::from_be_bytes([
            data[index + 1],
            data[index + 2],
            data[index + 3],
            data[index + 4],
        ]) as usize;
        let start = index + 5;
        let end = start.saturating_add(length);
        if end > data.len() {
            break;
        }
        if flags & 0x80 != 0 {
            if let Ok(text) = std::str::from_utf8(&data[start..end]) {
                for line in text.split(['\n', '\r']) {
                    if line.is_empty() {
                        continue;
                    }
                    if let Some((k, v)) = line.split_once(':') {
                        fields.insert(
                            k.trim().to_ascii_lowercase(),
                            percent_decode_lightweight(v.trim()),
                        );
                    }
                }
            }
        }
        index = end;
    }
    fields
}

fn grpc_web_data_frames(data: &[u8]) -> Vec<Vec<u8>> {
    let mut frames = Vec::new();
    let mut index = 0usize;
    while index + 5 <= data.len() {
        let flags = data[index];
        let length = u32::from_be_bytes([
            data[index + 1],
            data[index + 2],
            data[index + 3],
            data[index + 4],
        ]) as usize;
        let start = index + 5;
        let end = start.saturating_add(length);
        if end > data.len() {
            return Vec::new();
        }
        if flags & 0x80 == 0 {
            frames.push(data[start..end].to_vec());
        }
        index = end;
    }
    frames
}

fn looks_like_protobuf(data: &[u8]) -> bool {
    let Some(&first) = data.first() else {
        return false;
    };
    let field_number = first >> 3;
    let wire_type = first & 0x07;
    field_number > 0 && matches!(wire_type, 0 | 1 | 2 | 5)
}

pub fn parse_grpc_web_quota(data: &[u8]) -> Result<AccountQuotaSnapshot, String> {
    let mut payloads = grpc_web_data_frames(data);
    if payloads.is_empty() && looks_like_protobuf(data) {
        payloads = vec![data.to_vec()];
    }
    if payloads.is_empty() || payloads.iter().all(|p| p.is_empty()) {
        return Ok(default_unused_quota_snapshot());
    }

    let mut used_percent: Option<f32> = None;
    let mut period_start: Option<DateTime<Utc>> = None;
    let mut resets_at: Option<DateTime<Utc>> = None;
    let products: Vec<QuotaProductUsage> = Vec::new();

    for payload in &payloads {
        if let Some(parsed) = try_parse_credits_config(payload) {
            return Ok(parsed);
        }
        let scan = scan_protobuf(payload, 0, &[]);
        if used_percent.is_none() {
            used_percent = scan
                .fixed32
                .iter()
                .filter(|f| f.path.last() == Some(&1) && (0.0..=100.0).contains(&f.value))
                .min_by(|a, b| a.path.len().cmp(&b.path.len()).then(a.order.cmp(&b.order)))
                .map(|f| f.value);
        }
        if used_percent.is_none() {
            used_percent = scan
                .fixed32
                .iter()
                .filter(|f| f.path.last() == Some(&1) && f.value == 0.0)
                .min_by_key(|f| f.path.len())
                .map(|f| f.value);
        }
        let epochs: Vec<(Vec<u64>, DateTime<Utc>)> = scan
            .varints
            .iter()
            .filter_map(|f| {
                let raw = f.value;
                if (1_700_000_000..=2_100_000_000).contains(&raw) {
                    Utc.timestamp_opt(raw as i64, 0)
                        .single()
                        .map(|dt| (f.path.clone(), dt))
                } else {
                    None
                }
            })
            .collect();
        if resets_at.is_none() {
            let now = Utc::now();
            let future: Vec<_> = epochs.iter().filter(|(_, d)| *d > now).collect();
            resets_at = future
                .iter()
                .find(|(p, _)| p.as_slice() == [1, 5, 1])
                .map(|(_, d)| *d)
                .or_else(|| future.iter().map(|(_, d)| *d).min())
                .or_else(|| epochs.iter().map(|(_, d)| *d).max());
        }
        if period_start.is_none() {
            period_start = epochs
                .iter()
                .find(|(p, _)| p.as_slice() == [1, 4, 1])
                .map(|(_, d)| *d)
                .or_else(|| epochs.iter().map(|(_, d)| *d).min());
        }
    }

    let used = used_percent.unwrap_or(0.0);
    Ok(AccountQuotaSnapshot::from_used(
        used,
        period_start,
        resets_at,
        products,
        "grpc-scan",
    ))
}

fn try_parse_credits_config(payload: &[u8]) -> Option<AccountQuotaSnapshot> {
    let mut i = 0usize;
    let (key, next) = read_varint(payload, i)?;
    i = next;
    let field = key >> 3;
    let wire = key & 7;
    if field != 1 || wire != 2 {
        return None;
    }
    let (len, next) = read_varint(payload, i)?;
    i = next;
    let end = i.saturating_add(len as usize);
    if end > payload.len() {
        return None;
    }
    let inner = &payload[i..end];

    let mut used: Option<f32> = None;
    let mut period_start: Option<DateTime<Utc>> = None;
    let mut resets_at: Option<DateTime<Utc>> = None;
    let mut products: Vec<QuotaProductUsage> = Vec::new();

    let mut j = 0usize;
    while j < inner.len() {
        let (k, n) = match read_varint(inner, j) {
            Some(v) => v,
            None => break,
        };
        j = n;
        let fn_ = k >> 3;
        let wt = k & 7;
        match (fn_, wt) {
            (1, 5) => {
                if j + 4 > inner.len() {
                    break;
                }
                used = Some(f32::from_le_bytes(inner[j..j + 4].try_into().ok()?));
                j += 4;
            }
            (4, 2) | (5, 2) => {
                let (ln, n) = read_varint(inner, j)?;
                j = n;
                let e = j.saturating_add(ln as usize);
                if e > inner.len() {
                    break;
                }
                let ts = parse_timestamp_message(&inner[j..e]);
                j = e;
                if fn_ == 4 {
                    period_start = ts;
                } else {
                    resets_at = ts;
                }
            }
            (7, 2) => {
                let (ln, n) = read_varint(inner, j)?;
                j = n;
                let e = j.saturating_add(ln as usize);
                if e > inner.len() {
                    break;
                }
                if let Some(p) = parse_product_message(&inner[j..e]) {
                    products.push(p);
                }
                j = e;
            }
            (_, 0) => {
                let (_, n) = read_varint(inner, j)?;
                j = n;
            }
            (_, 1) => {
                j = j.saturating_add(8);
            }
            (_, 2) => {
                let (ln, n) = read_varint(inner, j)?;
                j = n.saturating_add(ln as usize);
            }
            (_, 5) => {
                j = j.saturating_add(4);
            }
            _ => break,
        }
    }

    let used = used.unwrap_or(0.0);
    for p in &mut products {
        if !p.used_percent.is_finite() {
            p.used_percent = 0.0;
        }
    }
    Some(AccountQuotaSnapshot::from_used(
        used,
        period_start,
        resets_at,
        products,
        "grpc-structured",
    ))
}

fn parse_timestamp_message(msg: &[u8]) -> Option<DateTime<Utc>> {
    let mut i = 0usize;
    let mut seconds: Option<i64> = None;
    let mut nanos: u32 = 0;
    while i < msg.len() {
        let (k, n) = read_varint(msg, i)?;
        i = n;
        let fn_ = k >> 3;
        let wt = k & 7;
        match (fn_, wt) {
            (1, 0) => {
                let (v, n) = read_varint(msg, i)?;
                i = n;
                seconds = Some(v as i64);
            }
            (2, 0) => {
                let (v, n) = read_varint(msg, i)?;
                i = n;
                nanos = v as u32;
            }
            (_, 0) => {
                let (_, n) = read_varint(msg, i)?;
                i = n;
            }
            (_, 2) => {
                let (ln, n) = read_varint(msg, i)?;
                i = n.saturating_add(ln as usize);
            }
            (_, 5) => i = i.saturating_add(4),
            (_, 1) => i = i.saturating_add(8),
            _ => break,
        }
    }
    let secs = seconds?;
    Utc.timestamp_opt(secs, nanos).single()
}

fn parse_product_message(msg: &[u8]) -> Option<QuotaProductUsage> {
    let mut i = 0usize;
    let mut product_id: Option<u32> = None;
    let mut used_percent: Option<f32> = None;
    while i < msg.len() {
        let (k, n) = read_varint(msg, i)?;
        i = n;
        let fn_ = k >> 3;
        let wt = k & 7;
        match (fn_, wt) {
            (1, 0) => {
                let (v, n) = read_varint(msg, i)?;
                i = n;
                product_id = Some(v as u32);
            }
            (2, 5) => {
                if i + 4 > msg.len() {
                    break;
                }
                used_percent = Some(f32::from_le_bytes(msg[i..i + 4].try_into().ok()?));
                i += 4;
            }
            (_, 0) => {
                let (_, n) = read_varint(msg, i)?;
                i = n;
            }
            (_, 2) => {
                let (ln, n) = read_varint(msg, i)?;
                i = n.saturating_add(ln as usize);
            }
            (_, 5) => i = i.saturating_add(4),
            (_, 1) => i = i.saturating_add(8),
            _ => break,
        }
    }
    let id = product_id?;
    Some(QuotaProductUsage {
        product_id: id,
        label: product_label(id),
        used_percent: used_percent.unwrap_or(0.0),
    })
}

#[derive(Default)]
struct ProtoScan {
    fixed32: Vec<Fixed32Field>,
    varints: Vec<VarintField>,
}

struct Fixed32Field {
    path: Vec<u64>,
    value: f32,
    order: usize,
}

struct VarintField {
    path: Vec<u64>,
    value: u64,
}

fn scan_protobuf(data: &[u8], depth: usize, path: &[u64]) -> ProtoScan {
    let mut scan = ProtoScan::default();
    let mut index = 0usize;
    let mut order = 0usize;
    while index < data.len() {
        let start = index;
        let Some((key, next)) = read_varint(data, index) else {
            break;
        };
        index = next;
        if key == 0 {
            index = start + 1;
            continue;
        }
        let field_number = key >> 3;
        let wire_type = key & 7;
        let field_path = {
            let mut p = path.to_vec();
            p.push(field_number);
            p
        };
        match wire_type {
            0 => {
                if let Some((value, next)) = read_varint(data, index) {
                    scan.varints.push(VarintField {
                        path: field_path,
                        value,
                    });
                    index = next;
                } else {
                    index = start + 1;
                }
            }
            1 => {
                if index + 8 > data.len() {
                    break;
                }
                index += 8;
            }
            2 => {
                let Some((len, next)) = read_varint(data, index) else {
                    index = start + 1;
                    continue;
                };
                index = next;
                let end = index.saturating_add(len as usize);
                if end > data.len() {
                    break;
                }
                if depth < 4 {
                    let nested = scan_protobuf(&data[index..end], depth + 1, &field_path);
                    scan.fixed32.extend(nested.fixed32);
                    scan.varints.extend(nested.varints);
                }
                index = end;
            }
            5 => {
                if index + 4 > data.len() {
                    break;
                }
                let bits = u32::from_le_bytes(data[index..index + 4].try_into().unwrap_or([0; 4]));
                let value = f32::from_bits(bits);
                scan.fixed32.push(Fixed32Field {
                    path: field_path,
                    value,
                    order,
                });
                order += 1;
                index += 4;
            }
            _ => {
                index = start + 1;
            }
        }
    }
    scan
}

fn read_varint(data: &[u8], mut index: usize) -> Option<(u64, usize)> {
    let mut value: u64 = 0;
    let mut shift: u32 = 0;
    while index < data.len() && shift < 64 {
        let byte = data[index];
        index += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Some((value, index));
        }
        shift += 7;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unused_snapshot_is_100_remaining() {
        let s = default_unused_quota_snapshot();
        assert_eq!(s.used_percent, 0.0);
        assert_eq!(s.remaining_percent, 100.0);
    }

    #[test]
    fn from_used_clamps() {
        let s = AccountQuotaSnapshot::from_used(12.5, None, None, vec![], "t");
        assert!((s.remaining_percent - 87.5).abs() < 0.01);
    }
}
