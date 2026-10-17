
async fn handle_server_event(
    host: &Arc<VoiceHost>,
    app: &AppHandle,
    mgr: &Arc<SessionManager>,
    raw: &str,
) {
    let v: Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return,
    };
    let ty = v.get("type").and_then(|x| x.as_str()).unwrap_or("");

    match ty {
        "response.created" | "response.output_item.added" => {
            let mut st = host.snapshot();
            st.thinking = true;
            st.listening = false;
            st.speaking = false;
            host.inner.lock().state = st;
            host.emit_state(app);
        }
        "input_audio_buffer.speech_started" | "input_audio_buffer.speech_stopped" => {
            let mut st = host.snapshot();
            st.listening = true;
            st.thinking = false;
            st.speaking = false;
            host.inner.lock().state = st;
            host.emit_state(app);
        }
        "response.output_audio.delta" | "response.audio.delta" => {
            if let Some(delta) = v.get("delta").and_then(|x| x.as_str()) {
                let _ = app.emit("voice://audio", json!({ "delta": delta }));
            }
            let mut st = host.snapshot();
            st.speaking = true;
            st.thinking = false;
            st.listening = false;
            host.inner.lock().state = st;
            host.emit_state(app);
        }
        "response.output_audio.done" | "response.audio.done" | "response.done" => {
            let mut st = host.snapshot();
            st.speaking = false;
            st.thinking = false;
            st.listening = true;
            host.inner.lock().state = st;
            host.emit_state(app);
        }
        "response.output_text.delta" | "response.text.delta" => {
            if let Some(delta) = v.get("delta").and_then(|x| x.as_str()) {
                let _ = app.emit(
                    "voice://transcript",
                    json!({ "role": "assistant", "text": delta, "final": false }),
                );
            }
        }
        "response.output_text.done" | "conversation.item.input_audio_transcription.completed" => {
            let text = v
                .get("transcript")
                .or_else(|| v.get("text"))
                .and_then(|x| x.as_str())
                .unwrap_or("");
            if !text.is_empty() {
                let role = if ty.contains("input_audio") {
                    "user"
                } else {
                    "assistant"
                };
                let _ = app.emit(
                    "voice://transcript",
                    json!({ "role": role, "text": text, "final": true }),
                );
            }
        }
        // Function / tool call completion (OpenAI-compatible shapes)
        "response.function_call_arguments.done"
        | "response.output_item.done"
        | "conversation.item.completed" => {
            let name = v
                .pointer("/name")
                .or_else(|| v.pointer("/item/name"))
                .and_then(|x| x.as_str())
                .unwrap_or("");
            let call_id = v
                .get("call_id")
                .or_else(|| v.pointer("/item/call_id"))
                .and_then(|x| x.as_str())
                .unwrap_or("tool");
            let args = v
                .get("arguments")
                .or_else(|| v.pointer("/item/arguments"))
                .and_then(|x| x.as_str())
                .unwrap_or("{}");
            if voice_tools::VoiceToolName::parse(name).is_some() {
                let snap = host.snapshot();
                // execute_tool emits running → ok/soft_fail/error + tool_result.
                // Soft-fail (e.g. CLI missing) returns Ok(structured) so the
                // model can speak honestly without ending the voice session.
                let _ = execute_tool(app, mgr, host, &snap, name, args).await;
                let _ = call_id; // reserved for future realtime function_call_output
            }
        }
        "error" => {
            let msg = v
                .pointer("/error/message")
                .or_else(|| v.get("message"))
                .and_then(|x| x.as_str())
                .unwrap_or("voice error");
            let class = voice_tools::classify_tool_error(msg);
            let _ = app.emit(
                "voice://error",
                json!({ "message": msg, "errorClass": class }),
            );
        }
        _ => {}
    }
}

// --- Tauri commands ---

#[tauri::command]
pub async fn voice_state(host: State<'_, Arc<VoiceHost>>) -> Result<VoiceSessionState, String> {
    Ok(host.snapshot())
}

#[tauri::command]
pub async fn voice_start(
    app: AppHandle,
    host: State<'_, Arc<VoiceHost>>,
    mgr: State<'_, Arc<SessionManager>>,
    project_path: Option<String>,
    project_id: Option<String>,
    project_name: Option<String>,
    keep_agents_on_end: Option<bool>,
) -> Result<VoiceSessionState, String> {
    host.start(
        app,
        mgr.inner().clone(),
        project_path,
        project_id,
        project_name,
        keep_agents_on_end.unwrap_or(true),
    )
    .await
}

#[tauri::command]
pub async fn voice_stop(
    app: AppHandle,
    host: State<'_, Arc<VoiceHost>>,
    mgr: State<'_, Arc<SessionManager>>,
) -> Result<VoiceSessionState, String> {
    Ok(host.stop(&app, mgr.inner()).await)
}

#[tauri::command]
pub async fn voice_push_pcm(
    host: State<'_, Arc<VoiceHost>>,
    pcm_base64: String,
) -> Result<(), String> {
    let bytes = B64
        .decode(pcm_base64.trim())
        .map_err(|e| format!("pcm base64: {e}"))?;
    host.push_pcm(bytes)
}

#[tauri::command]
pub async fn voice_invoke_tool(
    app: AppHandle,
    host: State<'_, Arc<VoiceHost>>,
    mgr: State<'_, Arc<SessionManager>>,
    name: String,
    args_json: Option<String>,
) -> Result<Value, String> {
    host.invoke_tool(
        &app,
        mgr.inner(),
        &name,
        args_json.as_deref().unwrap_or("{}"),
    )
    .await
}

#[tauri::command]
pub async fn voice_dictation_transcribe(
    audio_base64: String,
    mime: Option<String>,
    language: Option<String>,
) -> Result<crate::voice_stt::SttResult, String> {
    crate::voice_stt::transcribe_base64(
        &audio_base64,
        mime.as_deref(),
        language.as_deref(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_inactive() {
        let h = VoiceHost::new();
        assert!(!h.snapshot().active);
        assert!(h.snapshot().active_tool.is_none());
        assert!(h.snapshot().keep_agents_on_end);
        assert!(h.snapshot().tool_status.is_none());
    }

    #[test]
    fn tool_generation_invalidates_on_begin() {
        let h = VoiceHost::new();
        // Simulated: begin bumps gen so prior gen is stale.
        {
            let mut g = h.inner.lock();
            g.tool_generation = 1;
        }
        assert!(!tool_still_current(&h, 0));
        assert!(tool_still_current(&h, 1));
        h.inner.lock().stop.store(true, Ordering::SeqCst);
        assert!(!tool_still_current(&h, 1));
    }
}
