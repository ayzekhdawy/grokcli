// ── X Evidence Rail (search → local evidence store → quote pack) ────────────
// Design: docs/features/x-search.md — every X search result becomes a local
// evidence row with a stable id; later turns list / re-read / quote without
// re-searching. Write path (publishing to X) intentionally absent.

#[tauri::command]
pub async fn x_evidence_search(
    query: String,
    limit: Option<u32>,
    session_tag: Option<String>,
) -> Result<crate::x_evidence::XSearchEnvelope, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::x_evidence::x_search(&query, limit, session_tag.as_deref())
    })
    .await
    .map_err(|e| format!("x_evidence_search: {e}"))
}

#[tauri::command]
pub async fn x_evidence_list(
    filter: Option<crate::x_evidence::EvidenceFilter>,
) -> Result<Vec<crate::x_evidence::EvidenceItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::x_evidence::evidence_list(&filter.unwrap_or_default())
    })
    .await
    .map_err(|e| format!("x_evidence_list: {e}"))?
}

#[tauri::command]
pub async fn x_evidence_get(
    ids: Vec<String>,
) -> Result<Vec<crate::x_evidence::EvidenceItem>, String> {
    tauri::async_runtime::spawn_blocking(move || crate::x_evidence::evidence_get(&ids))
        .await
        .map_err(|e| format!("x_evidence_get: {e}"))?
}

#[tauri::command]
pub async fn x_evidence_stats() -> Result<crate::x_evidence::EvidenceStats, String> {
    tauri::async_runtime::spawn_blocking(crate::x_evidence::evidence_stats)
        .await
        .map_err(|e| format!("x_evidence_stats: {e}"))?
}

#[tauri::command]
pub async fn x_quote_pack(
    ids: Vec<String>,
    title: Option<String>,
) -> Result<crate::x_evidence::QuotePack, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::x_evidence::quote_pack(&ids, title.as_deref())
    })
    .await
    .map_err(|e| format!("x_quote_pack: {e}"))?
}

