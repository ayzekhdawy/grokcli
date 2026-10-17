//! Context usage/compaction data shared by Remote IM commands and headless turns.

use crate::store::ChatMessageStored;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsageSnapshot {
    pub total_tokens: Option<u64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub system_tokens: Option<u64>,
    pub tools_tokens: Option<u64>,
    pub history_tokens: Option<u64>,
    /// Agent event kind, for example `usage`, `turn_usage`, or `compact`.
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCompactSnapshot {
    pub trigger: String,
    pub tokens_before: Option<u64>,
    pub tokens_after: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary_preview: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ContextSignals {
    pub usage: Option<ContextUsageSnapshot>,
    pub compact: Option<ContextCompactSnapshot>,
}

fn token_u64(obj: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| {
        obj.get(*key).and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_i64().map(|n| n.max(0) as u64))
                .or_else(|| value.as_f64().map(|n| n.max(0.0) as u64))
        })
    })
}

fn event_kind(value: &Value) -> String {
    ["sessionUpdate", "session_update", "type", "event", "kind"]
        .iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn parse_usage(kind: &str, update: &Value) -> Option<ContextUsageSnapshot> {
    let root = update
        .get("usage")
        .or_else(|| update.get("tokenUsage"))
        .or_else(|| update.get("token_usage"))
        .or_else(|| update.get("tokens"))
        .filter(|value| value.is_object())
        .unwrap_or(update);
    let input_tokens = token_u64(
        root,
        &[
            "inputTokens",
            "input_tokens",
            "promptTokens",
            "prompt_tokens",
            "input",
        ],
    );
    let output_tokens = token_u64(
        root,
        &[
            "outputTokens",
            "output_tokens",
            "completionTokens",
            "completion_tokens",
            "output",
        ],
    );
    let total_tokens = token_u64(
        root,
        &[
            "totalTokens",
            "total_tokens",
            "contextTokens",
            "context_tokens",
            "usedTokens",
            "used_tokens",
            "tokens",
            "total",
        ],
    )
    .or_else(|| match (input_tokens, output_tokens) {
        (Some(input), Some(output)) => Some(input.saturating_add(output)),
        _ => None,
    });
    let system_tokens = token_u64(root, &["systemTokens", "system_tokens", "system"]);
    let tools_tokens = token_u64(
        root,
        &[
            "toolsTokens",
            "tools_tokens",
            "toolTokens",
            "tool_tokens",
            "tools",
        ],
    );
    let history_tokens = token_u64(
        root,
        &[
            "historyTokens",
            "history_tokens",
            "messagesTokens",
            "messages_tokens",
            "history",
        ],
    );
    if total_tokens.is_none()
        && input_tokens.is_none()
        && output_tokens.is_none()
        && system_tokens.is_none()
        && tools_tokens.is_none()
        && history_tokens.is_none()
    {
        return None;
    }
    // Compact-only before/after counters are not a regular usage report.
    if kind.contains("compact")
        && total_tokens.is_none()
        && (update.get("tokens_before").is_some()
            || update.get("tokensBefore").is_some()
            || update.get("tokens_after").is_some()
            || update.get("tokensAfter").is_some())
    {
        return None;
    }
    Some(ContextUsageSnapshot {
        total_tokens,
        input_tokens,
        output_tokens,
        system_tokens,
        tools_tokens,
        history_tokens,
        source: if kind.is_empty() { "usage" } else { kind }.to_string(),
    })
}

fn parse_compact(kind: &str, update: &Value) -> Option<ContextCompactSnapshot> {
    let tokens_before = token_u64(update, &["tokens_before", "tokensBefore"]);
    let tokens_after = token_u64(update, &["tokens_after", "tokensAfter"]);
    // Kind / token counters only — never free-text `title` substrings.
    // Tool titles often embed "compact" in shell scripts and must not count.
    let is_compact = kind.contains("compact") || tokens_before.is_some() || tokens_after.is_some();
    if !is_compact {
        return None;
    }
    let trigger_raw = update
        .get("trigger")
        .or_else(|| update.get("trigger_type"))
        .or_else(|| update.get("triggerType"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let trigger = if trigger_raw.eq_ignore_ascii_case("manual") || kind.contains("manual") {
        "manual"
    } else if trigger_raw.eq_ignore_ascii_case("auto")
        || kind.contains("auto")
        || trigger_raw.is_empty()
    {
        "auto"
    } else {
        trigger_raw
    };
    let summary_preview = update
        .get("summary_preview")
        .or_else(|| update.get("summaryPreview"))
        .or_else(|| update.get("summary"))
        .and_then(Value::as_str)
        .map(|text| text.chars().take(500).collect());
    let note = update
        .get("note")
        .or_else(|| update.get("message"))
        .or_else(|| update.get("reason"))
        .and_then(Value::as_str)
        .map(str::to_string);
    Some(ContextCompactSnapshot {
        trigger: trigger.to_string(),
        tokens_before,
        tokens_after,
        summary_preview,
        note,
    })
}

fn visit_signals(value: &Value, signals: &mut ContextSignals) {
    let Value::Object(map) = value else {
        return;
    };
    let kind = event_kind(value);
    if let Some(usage) = parse_usage(&kind, value) {
        signals.usage = Some(usage);
    }
    if let Some(compact) = parse_compact(&kind, value) {
        signals.compact = Some(compact);
    }
    // Headless stream envelopes differ between CLI versions. Recursing through
    // JSON objects keeps Remote IM compatible with both flat and ACP-like payloads.
    for child in map.values() {
        if child.is_object() {
            visit_signals(child, signals);
        } else if let Value::Array(items) = child {
            for item in items.iter().filter(|item| item.is_object()) {
                visit_signals(item, signals);
            }
        }
    }
}

pub fn extract_context_signals(value: &Value) -> ContextSignals {
    let mut signals = ContextSignals::default();
    visit_signals(value, &mut signals);
    signals
}

pub fn estimate_visible_tokens(messages: &[ChatMessageStored]) -> u64 {
    let chars: usize = messages
        .iter()
        .filter(|message| {
            message.role != "tool"
                && !matches!(
                    message.marker.as_deref(),
                    Some("context_compact" | "turn_cancelled" | "turn_end" | "tool_step")
                )
        })
        .map(|message| {
            message.content.chars().count()
                + message
                    .thought
                    .as_deref()
                    .map(|thought| thought.chars().count())
                    .unwrap_or(0)
        })
        .sum();
    chars.div_ceil(4) as u64
}

fn parse_compact_marker(message: &ChatMessageStored) -> Option<ContextCompactSnapshot> {
    if message.marker.as_deref() != Some("context_compact")
        && !message.content.starts_with("context_compact|")
    {
        return None;
    }
    let (head, summary) = message
        .content
        .split_once('\n')
        .map(|(head, summary)| (head, Some(summary.trim().to_string())))
        .unwrap_or((message.content.as_str(), None));
    let mut trigger = "auto".to_string();
    let mut tokens_before = None;
    let mut tokens_after = None;
    let mut note = None;
    for part in head.split('|').skip(1) {
        if part == "manual" || part == "auto" {
            trigger = part.to_string();
        } else if let Some(tokens) = part.strip_prefix("tokens:") {
            if let Some((before, after)) = tokens.split_once("->") {
                tokens_before = before.parse().ok();
                tokens_after = after.parse().ok();
            }
        } else if let Some(before) = part.strip_prefix("tokens_before:") {
            tokens_before = before.parse().ok();
        } else if let Some(after) = part.strip_prefix("tokens_after:") {
            tokens_after = after.parse().ok();
        } else if let Some(value) = part.strip_prefix("note:") {
            note = Some(value.to_string());
        }
    }
    Some(ContextCompactSnapshot {
        trigger,
        tokens_before,
        tokens_after,
        summary_preview: summary.filter(|summary| !summary.is_empty()),
        note,
    })
}

pub fn latest_compact_from_messages(
    messages: &[ChatMessageStored],
) -> Option<(usize, ContextCompactSnapshot)> {
    messages
        .iter()
        .enumerate()
        .rev()
        .find_map(|(index, message)| parse_compact_marker(message).map(|compact| (index, compact)))
}

pub fn format_tokens(tokens: u64) -> String {
    let raw = tokens.to_string();
    let mut out = String::with_capacity(raw.len() + raw.len() / 3);
    for (index, ch) in raw.chars().enumerate() {
        if index > 0 && (raw.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use serde_json::json;

    #[test]
    fn extracts_nested_usage_and_compaction() {
        let signals = extract_context_signals(&json!({
            "type": "session_update",
            "params": {
                "update": {
                    "sessionUpdate": "compaction_completed",
                    "trigger": "manual",
                    "tokensBefore": 12000,
                    "tokensAfter": 3200,
                    "usage": { "inputTokens": 3000, "outputTokens": 200, "totalTokens": 3200 }
                }
            }
        }));
        assert_eq!(
            signals.usage.as_ref().and_then(|u| u.total_tokens),
            Some(3200)
        );
        assert_eq!(
            signals.compact.as_ref().and_then(|c| c.tokens_before),
            Some(12000)
        );
        assert_eq!(
            signals.compact.as_ref().map(|c| c.trigger.as_str()),
            Some("manual")
        );
    }

    #[test]
    fn estimates_only_visible_conversation_text() {
        let message = |role: &str, content: &str, marker: Option<&str>| ChatMessageStored {
            id: uuid::Uuid::new_v4().to_string(),
            role: role.into(),
            content: content.into(),
            thought: None,
            created_at: Utc::now(),
            is_error: false,
            attachments: None,
            marker: marker.map(str::to_string),
        };
        let messages = vec![
            message("user", "12345678", None),
            message("assistant", "1234", None),
            message("tool", "ignored", Some("context_compact")),
        ];
        assert_eq!(estimate_visible_tokens(&messages), 3);
        assert_eq!(format_tokens(1234567), "1,234,567");
    }

    #[test]
    fn hydrates_latest_compact_marker() {
        let message = ChatMessageStored {
            id: "compact-1".into(),
            role: "tool".into(),
            content: "context_compact|manual|tokens:12000->3200|note:keep decisions".into(),
            thought: None,
            created_at: Utc::now(),
            is_error: false,
            attachments: None,
            marker: Some("context_compact".into()),
        };
        let (_, compact) = latest_compact_from_messages(&[message]).expect("compact marker");
        assert_eq!(compact.trigger, "manual");
        assert_eq!(compact.tokens_before, Some(12000));
        assert_eq!(compact.tokens_after, Some(3200));
        assert_eq!(compact.note.as_deref(), Some("keep decisions"));
    }

    #[test]
    fn tool_title_containing_compact_word_is_not_compaction() {
        let signals = extract_context_signals(&json!({
            "sessionUpdate": "tool_call_update",
            "status": "completed",
            "title": "[bg] python3\nprint('=== ALL POSTS compact ===')\n"
        }));
        assert!(
            signals.compact.is_none(),
            "free-text title must not be treated as compact: {:?}",
            signals.compact
        );
    }
}
