//! X Evidence Rail — search X via headless Grok CLI and persist every post as
//! a local *evidence row* (sqlite), so later agent turns can list / re-read /
//! quote it without re-searching or hallucinating URLs.
//!
//! Design: `docs/features/x-search.md`. MVP surface:
//! - [`x_search`] — the only entry that pulls new posts; each result is upserted
//!   as evidence with a stable `evidence_id`. No canonical `x.com/...status/...`
//!   URL → stored but flagged `verified = false`.
//! - [`evidence_list`] / [`evidence_get`] — the local evidence bus.
//! - [`quote_pack`] — turn evidence ids into a paste-ready markdown pack under
//!   `{app_data}/x-evidence/packs/`.
//!
//! Write path (publishing to X) is intentionally absent.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::paths;
use crate::wallpaper_source::{require_cli_ready, run_grok_headless};

/// Headless X evidence search budget.
const X_EVIDENCE_TIMEOUT: Duration = Duration::from_secs(150);
/// Hard cap on posts per search (context-blowup guard, per design doc).
const MAX_LIMIT: u32 = 25;
const DEFAULT_LIMIT: u32 = 10;

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceItem {
    pub evidence_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub likes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_tag: Option<String>,
    /// `x_search` | `x_get` | `import`
    pub source: String,
    /// Has a canonical `x.com/<user>/status/<id>` anchor.
    pub verified: bool,
    pub fetched_at_ms: i64,
}

/// Envelope returned by [`x_search`] — evidence ids first, prose never.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XSearchEnvelope {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub query: String,
    pub evidence: Vec<EvidenceItem>,
    pub new_count: usize,
    pub unverified_count: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceFilter {
    #[serde(default)]
    pub session_tag: Option<String>,
    #[serde(default)]
    pub query_contains: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
}

/// Small dashboard counters: today's new evidence / this week's quote packs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceStats {
    pub total: i64,
    pub today_new: i64,
    pub week_packs: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotePack {
    pub markdown: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub count: usize,
}

// ── Storage ──────────────────────────────────────────────────────────────────

fn x_evidence_root() -> PathBuf {
    paths::app_data_root().join("x-evidence")
}

fn db_path() -> PathBuf {
    x_evidence_root().join("evidence.db")
}

fn packs_dir() -> PathBuf {
    x_evidence_root().join("packs")
}

fn open_db() -> Result<Connection, String> {
    let root = x_evidence_root();
    fs::create_dir_all(&root).map_err(|e| format!("x-evidence dir: {e}"))?;
    let conn = Connection::open(db_path()).map_err(|e| format!("x-evidence db: {e}"))?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS evidence (
            evidence_id  TEXT PRIMARY KEY,
            status_id    TEXT,
            url          TEXT,
            author       TEXT,
            text         TEXT,
            created_at   TEXT,
            likes        INTEGER,
            query        TEXT,
            session_tag  TEXT,
            source       TEXT NOT NULL,
            verified     INTEGER NOT NULL DEFAULT 0,
            fetched_at   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_evidence_session ON evidence(session_tag);
        CREATE INDEX IF NOT EXISTS idx_evidence_status ON evidence(status_id);",
    )
    .map_err(|e| format!("x-evidence schema: {e}"))
}

/// Insert or refresh one evidence row. Returns `true` when it was new.
fn upsert_evidence(conn: &Connection, it: &EvidenceItem) -> Result<bool, String> {
    let inserted = conn
        .execute(
            "INSERT OR IGNORE INTO evidence
             (evidence_id, status_id, url, author, text, created_at, likes,
              query, session_tag, source, verified, fetched_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                it.evidence_id,
                it.status_id,
                it.url,
                it.author,
                it.text,
                it.created_at,
                it.likes,
                it.query,
                it.session_tag,
                it.source,
                it.verified as i64,
                it.fetched_at_ms,
            ],
        )
        .map_err(|e| format!("x-evidence insert: {e}"))?;
    if inserted == 0 {
        // Same evidence seen again — refresh volatile fields, keep first-seen anchor.
        conn.execute(
            "UPDATE evidence SET likes = COALESCE(?2, likes), fetched_at = ?3
             WHERE evidence_id = ?1",
            params![it.evidence_id, it.likes, it.fetched_at_ms],
        )
        .map_err(|e| format!("x-evidence refresh: {e}"))?;
        return Ok(false);
    }
    Ok(true)
}

fn row_to_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<EvidenceItem> {
    Ok(EvidenceItem {
        evidence_id: row.get(0)?,
        status_id: row.get(1)?,
        url: row.get(2)?,
        author: row.get(3)?,
        text: row.get(4)?,
        created_at: row.get(5)?,
        likes: row.get(6)?,
        query: row.get(7)?,
        session_tag: row.get(8)?,
        source: row.get(9)?,
        verified: row.get::<_, i64>(10)? != 0,
        fetched_at_ms: row.get(11)?,
    })
}

const SELECT_COLS: &str = "evidence_id, status_id, url, author, text, created_at, likes, \
                           query, session_tag, source, verified, fetched_at";

fn list_evidence(conn: &Connection, filter: &EvidenceFilter) -> Result<Vec<EvidenceItem>, String> {
    let mut sql = format!("SELECT {SELECT_COLS} FROM evidence WHERE 1=1");
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(tag) = filter
        .session_tag
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        sql.push_str(" AND session_tag = ?");
        args.push(Box::new(tag.trim().to_string()));
    }
    if let Some(q) = filter
        .query_contains
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        sql.push_str(" AND query LIKE ?");
        args.push(Box::new(format!("%{}%", q.trim())));
    }
    if let Some(a) = filter.author.as_deref().filter(|s| !s.trim().is_empty()) {
        sql.push_str(" AND author = ?");
        args.push(Box::new(a.trim().trim_start_matches('@').to_string()));
    }
    let limit = filter.limit.unwrap_or(100).clamp(1, 500);
    sql.push_str(&format!(" ORDER BY fetched_at DESC LIMIT {limit}"));

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("x-evidence list: {e}"))?;
    let params_ref: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| b.as_ref()).collect();
    let rows = stmt
        .query_map(params_ref.as_slice(), row_to_item)
        .map_err(|e| format!("x-evidence list: {e}"))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("x-evidence list: {e}"))
}

fn get_evidence(conn: &Connection, ids: &[String]) -> Result<Vec<EvidenceItem>, String> {
    let mut out = Vec::with_capacity(ids.len());
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SELECT_COLS} FROM evidence WHERE evidence_id = ?1"
        ))
        .map_err(|e| format!("x-evidence get: {e}"))?;
    for id in ids {
        let id = id.trim();
        if id.is_empty() {
            continue;
        }
        if let Some(item) =
            stmt.query_row(params![id], row_to_item)
                .map(Some)
                .or_else(|e| match e {
                    rusqlite::Error::QueryReturnedNoRows => Ok(None),
                    other => Err(format!("x-evidence get: {other}")),
                })?
        {
            out.push(item);
        }
    }
    Ok(out)
}

// ── URL / id helpers ─────────────────────────────────────────────────────────

/// Extract the numeric status id from pathname `status|statuses/<digits>`.
/// Query / fragment / spoofed hosts are ignored here; callers still gate host.
pub fn extract_status_id(url: &str) -> Option<String> {
    let u = url.trim();
    if u.is_empty() {
        return None;
    }
    if u.chars().all(|c| c.is_ascii_digit()) && u.len() >= 8 {
        return Some(u.to_string());
    }
    let parsed = url::Url::parse(u).ok()?;
    let segs: Vec<&str> = parsed.path().split('/').filter(|s| !s.is_empty()).collect();
    for i in 0..segs.len().saturating_sub(1) {
        let name = segs[i].to_ascii_lowercase();
        if name != "status" && name != "statuses" {
            continue;
        }
        let id = segs[i + 1];
        if id.len() >= 8 && id.chars().all(|c| c.is_ascii_digit()) {
            return Some(id.to_string());
        }
        return None;
    }
    None
}

fn is_canonical_x_status_url(url: &str) -> bool {
    let parsed = match url::Url::parse(url.trim()) {
        Ok(p) => p,
        Err(_) => return false,
    };
    let scheme = parsed.scheme();
    if scheme != "https" && scheme != "http" {
        return false;
    }
    let host = parsed
        .host_str()
        .unwrap_or("")
        .trim_start_matches("www.")
        .to_ascii_lowercase();
    if host != "x.com" && host != "twitter.com" && host != "mobile.twitter.com" {
        return false;
    }
    extract_status_id(url).is_some()
}

fn evidence_id_for(status_id: Option<&str>, url: Option<&str>, fallback: &str) -> String {
    use sha2::{Digest, Sha256};
    let key = status_id
        .map(|s| format!("status:{s}"))
        .or_else(|| url.map(|u| format!("url:{}", u.trim())))
        .unwrap_or_else(|| format!("text:{fallback}"));
    let mut h = Sha256::new();
    h.update(key.as_bytes());
    let d = h.finalize();
    let hex: String = d.iter().take(6).map(|b| format!("{b:02x}")).collect();
    format!("ev-{hex}")
}

// ── Model output parsing ─────────────────────────────────────────────────────

/// First balanced `{…}` JSON object in free-form text (string-literal aware).
fn first_json_object(s: &str) -> Option<serde_json::Value> {
    let start = s.find('{')?;
    let mut depth = 0i32;
    let mut in_str = false;
    let mut esc = false;
    for (i, c) in s[start..].char_indices() {
        if esc {
            esc = false;
            continue;
        }
        if in_str {
            match c {
                '\\' => esc = true,
                '"' => in_str = false,
                _ => {}
            }
            continue;
        }
        match c {
            '"' => in_str = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let end = start + i + c.len_utf8();
                    return serde_json::from_str(&s[start..end]).ok();
                }
            }
            _ => {}
        }
    }
    None
}

fn has_items_array(v: &serde_json::Value) -> bool {
    v.get("items").map(|i| i.is_array()).unwrap_or(false)
}

/// Unwrap headless `grok -p --output-format json` envelopes down to the
/// `{ "items": [...] }` object (direct, `structuredOutput`, or nested `text`).
fn extract_items_value(raw: &str) -> Option<serde_json::Value> {
    let env = first_json_object(raw.trim())?;
    if has_items_array(&env) {
        return Some(env);
    }
    if let Some(so) = env.get("structuredOutput") {
        if has_items_array(so) {
            return Some(so.clone());
        }
    }
    if let Some(text) = env.get("text").and_then(|t| t.as_str()) {
        if let Some(v) = first_json_object(text) {
            if has_items_array(&v) {
                return Some(v);
            }
        }
    }
    None
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn items_to_evidence(
    value: &serde_json::Value,
    query: &str,
    session_tag: Option<&str>,
    source: &str,
) -> Vec<EvidenceItem> {
    let arr = value
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let fetched = now_ms();
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for raw in arr {
        let url = raw
            .get("url")
            .or_else(|| raw.get("postUrl"))
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let text = raw
            .get("text")
            .and_then(|v| v.as_str())
            .map(|s| s.chars().take(600).collect::<String>())
            .filter(|s| !s.trim().is_empty());
        if url.is_none() && text.is_none() {
            continue;
        }
        let status_id = url.as_deref().and_then(extract_status_id);
        let verified = url.as_deref().is_some_and(is_canonical_x_status_url);
        let fallback = text.clone().unwrap_or_default();
        let evidence_id = evidence_id_for(status_id.as_deref(), url.as_deref(), &fallback);
        if !seen.insert(evidence_id.clone()) {
            continue;
        }
        out.push(EvidenceItem {
            evidence_id,
            verified,
            status_id,
            url,
            author: raw
                .get("username")
                .or_else(|| raw.get("author"))
                .and_then(|v| v.as_str())
                .map(|s| s.trim().trim_start_matches('@').to_string())
                .filter(|s| !s.is_empty()),
            text,
            created_at: raw
                .get("createdAt")
                .or_else(|| raw.get("created_at"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            likes: raw.get("likes").and_then(|v| v.as_i64()),
            query: Some(query.to_string()),
            session_tag: session_tag.map(|s| s.to_string()),
            source: source.to_string(),
            fetched_at_ms: fetched,
        });
    }
    out
}

// ── Stats (dashboard Evidence block) ─────────────────────────────────────────

fn count_recent_packs(dir: &Path, days: u64) -> i64 {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let cutoff = std::time::SystemTime::now().checked_sub(Duration::from_secs(days * 24 * 3600));
    let Some(cutoff) = cutoff else {
        return 0;
    };
    entries
        .flatten()
        .filter(|e| {
            e.path().extension().and_then(|s| s.to_str()) == Some("md")
                && e.metadata()
                    .and_then(|m| m.modified())
                    .map(|t| t >= cutoff)
                    .unwrap_or(false)
        })
        .count() as i64
}

fn stats_from(
    conn: &Connection,
    today_start_ms: i64,
    packs: &Path,
) -> Result<EvidenceStats, String> {
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM evidence", [], |r| r.get(0))
        .map_err(|e| format!("x-evidence stats: {e}"))?;
    let today_new: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM evidence WHERE fetched_at >= ?1",
            params![today_start_ms],
            |r| r.get(0),
        )
        .map_err(|e| format!("x-evidence stats: {e}"))?;
    Ok(EvidenceStats {
        total,
        today_new,
        week_packs: count_recent_packs(packs, 7),
    })
}

/// Counters for the dashboard: total evidence / new since local midnight /
/// quote packs written in the last 7 days.
pub fn evidence_stats() -> Result<EvidenceStats, String> {
    let conn = open_db()?;
    let now = chrono::Local::now();
    let today_start_ms = now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .and_then(|naive| naive.and_local_timezone(chrono::Local).single())
        .map(|dt| dt.timestamp_millis())
        .unwrap_or_else(|| now.timestamp_millis() - 86_400_000);
    stats_from(&conn, today_start_ms, &packs_dir())
}

// ── Public API ───────────────────────────────────────────────────────────────

fn build_x_evidence_prompt(query: &str, limit: u32) -> String {
    format!(
        r#"You collect X (Twitter) posts as VERIFIABLE EVIDENCE for an agent workflow.

User query (raw): {query}

Rules:
1. Use X search tools only. Collect up to {limit} distinct, relevant posts (prefer higher engagement).
2. `url` MUST be the real canonical status link `https://x.com/<user>/status/<id>` exactly as found — NEVER fabricate or guess an id. Skip posts whose link you cannot confirm.
3. `text` = the post's own text (trim to ~500 chars, keep meaning). `username` without @. `createdAt` ISO date if known. `likes` if known.
4. Return exactly ONE JSON object matching the schema (items array). No prose, no markdown fences, no placeholder posts.
"#
    )
}

const X_EVIDENCE_SCHEMA: &str = r#"{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "url": { "type": "string" },
          "username": { "type": "string" },
          "text": { "type": "string" },
          "createdAt": { "type": "string" },
          "likes": { "type": "number" }
        },
        "required": ["url"]
      }
    }
  },
  "required": ["items"]
}"#;

fn err_envelope(query: &str, code: &str, message: Option<String>) -> XSearchEnvelope {
    XSearchEnvelope {
        ok: false,
        error_code: Some(code.into()),
        message,
        query: query.to_string(),
        evidence: vec![],
        new_count: 0,
        unverified_count: 0,
    }
}

/// Search X and persist every post as evidence. Sync (headless CLI); call from
/// `spawn_blocking`.
pub fn x_search(query: &str, limit: Option<u32>, session_tag: Option<&str>) -> XSearchEnvelope {
    let q = query.trim();
    if q.is_empty() {
        return err_envelope(q, "empty", Some("empty query".into()));
    }
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let cli = match require_cli_ready() {
        Ok(p) => p,
        Err(code) => return err_envelope(q, &code, None),
    };
    let prompt = build_x_evidence_prompt(q, limit);
    let stdout = match run_grok_headless(
        &cli,
        &prompt,
        X_EVIDENCE_SCHEMA,
        14,
        X_EVIDENCE_TIMEOUT,
        None,
    ) {
        Ok(s) => s,
        Err(code) => return err_envelope(q, &code, None),
    };
    let Some(value) = extract_items_value(&stdout) else {
        return err_envelope(
            q,
            "search_failed",
            Some("could not parse evidence JSON".into()),
        );
    };
    let mut items = items_to_evidence(&value, q, session_tag, "x_search");
    items.truncate(limit as usize);
    if items.is_empty() {
        return err_envelope(q, "empty", Some("no posts found".into()));
    }

    let conn = match open_db() {
        Ok(c) => c,
        Err(e) => return err_envelope(q, "store_failed", Some(e)),
    };
    let mut new_count = 0usize;
    for it in &items {
        match upsert_evidence(&conn, it) {
            Ok(true) => new_count += 1,
            Ok(false) => {}
            Err(e) => return err_envelope(q, "store_failed", Some(e)),
        }
    }
    let unverified_count = items.iter().filter(|i| !i.verified).count();
    XSearchEnvelope {
        ok: true,
        error_code: None,
        message: None,
        query: q.to_string(),
        evidence: items,
        new_count,
        unverified_count,
    }
}

/// List local evidence (read-only bus).
pub fn evidence_list(filter: &EvidenceFilter) -> Result<Vec<EvidenceItem>, String> {
    let conn = open_db()?;
    list_evidence(&conn, filter)
}

/// Fetch evidence rows by id (missing ids are silently skipped).
pub fn evidence_get(ids: &[String]) -> Result<Vec<EvidenceItem>, String> {
    let conn = open_db()?;
    get_evidence(&conn, ids)
}

/// Render evidence ids into a paste-ready markdown quote pack and save it under
/// `{app_data}/x-evidence/packs/`.
pub fn quote_pack(ids: &[String], title: Option<&str>) -> Result<QuotePack, String> {
    let items = evidence_get(ids)?;
    if items.is_empty() {
        return Err("no evidence found for given ids".into());
    }
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let markdown = build_pack_markdown(&items, title, &date);

    let dir = packs_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("packs dir: {e}"))?;
    let name = format!("pack-{}.md", chrono::Local::now().format("%Y%m%d-%H%M%S"));
    let path = dir.join(&name);
    fs::write(&path, &markdown).map_err(|e| format!("write pack: {e}"))?;

    Ok(QuotePack {
        markdown,
        path: Some(path.display().to_string()),
        count: items.len(),
    })
}

fn build_pack_markdown(items: &[EvidenceItem], title: Option<&str>, date: &str) -> String {
    let title = title
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("X 证据包");
    let mut md = format!("## {title} · {date}\n\n");
    for (i, it) in items.iter().enumerate() {
        let author = it.author.as_deref().unwrap_or("unknown");
        let excerpt: String = it.text.as_deref().unwrap_or("").chars().take(160).collect();
        let anchor = match it.url.as_deref() {
            Some(u) if it.verified => format!("[链接]({u})"),
            Some(u) => format!("[链接·未验证]({u})"),
            None => "无链接·unverified".to_string(),
        };
        md.push_str(&format!(
            "{}. @{author} ({anchor}) — 「{excerpt}」 `{}`\n",
            i + 1,
            it.evidence_id
        ));
    }
    md
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    fn sample(url: Option<&str>, text: &str) -> EvidenceItem {
        let status_id = url.and_then(extract_status_id);
        EvidenceItem {
            evidence_id: evidence_id_for(status_id.as_deref(), url, text),
            verified: status_id.is_some(),
            status_id,
            url: url.map(|s| s.to_string()),
            author: Some("xai".into()),
            text: Some(text.into()),
            created_at: None,
            likes: Some(5),
            query: Some("grok".into()),
            session_tag: Some("s1".into()),
            source: "x_search".into(),
            fetched_at_ms: 1,
        }
    }

    #[test]
    fn status_id_extraction() {
        assert_eq!(
            extract_status_id("https://x.com/xai/status/1234567890123"),
            Some("1234567890123".into())
        );
        assert_eq!(
            extract_status_id("https://twitter.com/a/status/99887766?s=20"),
            Some("99887766".into())
        );
        // 幻觉/短 id、非 status 页面一律拒绝。
        assert_eq!(extract_status_id("https://x.com/xai/status/123"), None);
        assert_eq!(extract_status_id("https://x.com/xai"), None);
        assert_eq!(
            extract_status_id("https://example.com/status/1234567890"),
            Some("1234567890".into())
        );
        assert_eq!(
            extract_status_id("https://x.com/search?q=/status/12345678"),
            None
        );
        assert_eq!(
            extract_status_id("https://x.com/search#/status/12345678"),
            None
        );
        assert_eq!(
            extract_status_id("https://x.com/victim/photo?u=/status/99999999"),
            None
        );
        assert_eq!(
            extract_status_id("ftp://x.com/user/status/12345678"),
            Some("12345678".into())
        );
        assert_eq!(
            extract_status_id("https://cdn.evil.com/x.com/status/12345678"),
            Some("12345678".into())
        );
        assert_eq!(
            extract_status_id("https://x.com.evil.com/user/status/12345678"),
            Some("12345678".into())
        );
    }

    #[test]
    fn upsert_dedupes_by_status_id() {
        let conn = mem_db();
        let a = sample(Some("https://x.com/xai/status/1234567890123"), "hello");
        assert!(upsert_evidence(&conn, &a).unwrap());
        // Same status id again → refresh, not a new row.
        let mut b = sample(
            Some("https://x.com/xai/status/1234567890123"),
            "hello again",
        );
        b.likes = Some(42);
        assert!(!upsert_evidence(&conn, &b).unwrap());
        let rows = list_evidence(&conn, &EvidenceFilter::default()).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].likes, Some(42));
        assert!(rows[0].verified);
    }

    #[test]
    fn list_filters_and_get_roundtrip() {
        let conn = mem_db();
        let a = sample(Some("https://x.com/xai/status/1111111111111"), "one");
        let mut b = sample(Some("https://x.com/other/status/2222222222222"), "two");
        b.author = Some("other".into());
        b.session_tag = Some("s2".into());
        upsert_evidence(&conn, &a).unwrap();
        upsert_evidence(&conn, &b).unwrap();

        let by_tag = list_evidence(
            &conn,
            &EvidenceFilter {
                session_tag: Some("s2".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(by_tag.len(), 1);
        assert_eq!(by_tag[0].author.as_deref(), Some("other"));

        let got = get_evidence(&conn, &[a.evidence_id.clone(), "ev-missing".into()]).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].evidence_id, a.evidence_id);
    }

    #[test]
    fn parse_headless_envelope_nested_text() {
        let raw = r#"{
  "text": "{\"items\":[{\"url\":\"https://x.com/xai/status/1234567890123\",\"username\":\"xai\",\"text\":\"Grok ships\",\"likes\":10}]}",
  "stopReason": "EndTurn",
  "structuredOutput": null
}"#;
        let v = extract_items_value(raw).expect("items");
        let items = items_to_evidence(&v, "grok", Some("s1"), "x_search");
        assert_eq!(items.len(), 1);
        assert!(items[0].verified);
        assert_eq!(items[0].status_id.as_deref(), Some("1234567890123"));
        assert_eq!(items[0].author.as_deref(), Some("xai"));
    }

    #[test]
    fn unverified_when_no_canonical_url() {
        let v = serde_json::json!({
            "items": [
                { "url": "https://example.com/blog", "text": "not a status" },
                { "text": "no url at all" },
                { "url": "ftp://x.com/user/status/11111111", "text": "ftp" },
                { "url": "https://cdn.evil.com/x.com/status/22222222", "text": "cdn" },
                { "url": "https://x.com.evil.com/user/status/33333333", "text": "suffix" },
                { "url": "https://x.com/search#/status/44444444", "text": "fragment" }
            ]
        });
        let items = items_to_evidence(&v, "q", None, "x_search");
        assert_eq!(items.len(), 6);
        assert!(items.iter().all(|i| !i.verified));
    }

    #[test]
    fn stats_counts_today_and_total() {
        let conn = mem_db();
        let mut old = sample(Some("https://x.com/xai/status/1111111111111"), "old");
        old.fetched_at_ms = 100;
        upsert_evidence(&conn, &old).unwrap();
        let mut fresh = sample(Some("https://x.com/xai/status/2222222222222"), "fresh");
        fresh.fetched_at_ms = 5_000;
        upsert_evidence(&conn, &fresh).unwrap();

        let tmp = std::env::temp_dir().join("grok-app-x-evidence-test-empty-packs");
        let stats = stats_from(&conn, 1_000, &tmp).unwrap();
        assert_eq!(stats.total, 2);
        assert_eq!(stats.today_new, 1);
        assert_eq!(stats.week_packs, 0);
    }

    #[test]
    fn quote_pack_markdown_marks_unverified() {
        let a = sample(
            Some("https://x.com/xai/status/1234567890123"),
            "verified post",
        );
        let b = sample(None, "unverified note");
        let md = build_pack_markdown(&[a.clone(), b], Some("测试包"), "2026-07-31");
        assert!(md.starts_with("## 测试包 · 2026-07-31"));
        assert!(md.contains("[链接](https://x.com/xai/status/1234567890123)"));
        assert!(md.contains("unverified"));
        assert!(md.contains(&a.evidence_id));
    }
}
