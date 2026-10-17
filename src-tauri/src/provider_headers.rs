//! Per-channel `extra_headers` for Grok Build `[model.<id>]`.
//!
//! CLI sends these verbatim on inference requests. App stores the inline TOML
//! table Grok already documents (`extra_headers = { "Name" = "value" }`).

use serde::{Deserialize, Serialize};

/// One HTTP header row on a custom provider.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHeaderEntry {
    pub name: String,
    pub value: String,
}

pub const EXTRA_HEADERS_KEY: &str = "extra_headers";
const MAX_HEADERS: usize = 32;
const MAX_NAME: usize = 64;
const MAX_VALUE: usize = 1024;

/// RFC 7230 token: header names used as extra_headers keys.
pub fn is_http_header_name(name: &str) -> bool {
    let n = name.trim();
    if n.is_empty() || n.len() > MAX_NAME {
        return false;
    }
    n.chars().all(|c| {
        c.is_ascii_alphanumeric()
            || matches!(
                c,
                '!' | '#'
                    | '$'
                    | '%'
                    | '&'
                    | '\''
                    | '*'
                    | '+'
                    | '-'
                    | '.'
                    | '^'
                    | '_'
                    | '`'
                    | '|'
                    | '~'
            )
    })
}

fn header_value_ok(value: &str) -> bool {
    let v = value.trim();
    !v.is_empty() && v.len() <= MAX_VALUE && !v.contains('\r') && !v.contains('\n')
}

/// Drop empty / invalid rows; last value wins for a case-insensitive name.
pub fn normalize_extra_headers(raw: &[ProviderHeaderEntry]) -> Vec<ProviderHeaderEntry> {
    let mut out: Vec<ProviderHeaderEntry> = Vec::new();
    for row in raw {
        let name = row.name.trim();
        let value = row.value.trim();
        if !is_http_header_name(name) || !header_value_ok(value) {
            continue;
        }
        if let Some(slot) = out.iter_mut().find(|h| h.name.eq_ignore_ascii_case(name)) {
            slot.name = name.to_string();
            slot.value = value.to_string();
            continue;
        }
        if out.len() >= MAX_HEADERS {
            continue;
        }
        out.push(ProviderHeaderEntry {
            name: name.to_string(),
            value: value.to_string(),
        });
    }
    out
}

/// Inline TOML table: `{ "User-Agent" = "grok-app", "Originator" = "codex_cli_rs" }`.
pub fn encode_extra_headers_toml(headers: &[ProviderHeaderEntry]) -> String {
    let list = normalize_extra_headers(headers);
    if list.is_empty() {
        return String::new();
    }
    let body = list
        .iter()
        .map(|h| {
            format!(
                "{} = {}",
                serde_json::to_string(&h.name).unwrap_or_else(|_| format!("\"{}\"", h.name)),
                serde_json::to_string(&h.value).unwrap_or_else(|_| format!("\"{}\"", h.value)),
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!("{{ {body} }}")
}

/// Parse CLI inline table or a leftover quoted JSON object.
pub fn decode_extra_headers(raw: Option<&str>) -> Vec<ProviderHeaderEntry> {
    let Some(s) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Vec::new();
    };
    if let Some(inner) = s.strip_prefix('{').and_then(|t| t.strip_suffix('}')) {
        return parse_inline_pairs(inner);
    }
    Vec::new()
}

fn parse_inline_pairs(inner: &str) -> Vec<ProviderHeaderEntry> {
    let mut out = Vec::new();
    let mut rest = inner.trim();
    while !rest.is_empty() {
        rest = rest.trim_start_matches(',').trim_start();
        if rest.is_empty() {
            break;
        }
        let Some(eq) = find_unquoted_eq(rest) else {
            break;
        };
        let name = unquote_toml_str(rest[..eq].trim());
        rest = rest[eq + 1..].trim_start();
        let (value, next) = split_toml_string(rest);
        rest = next;
        if !name.is_empty() {
            out.push(ProviderHeaderEntry { name, value });
        }
    }
    normalize_extra_headers(&out)
}

fn find_unquoted_eq(s: &str) -> Option<usize> {
    let mut in_str = false;
    let mut esc = false;
    for (i, c) in s.char_indices() {
        if in_str {
            if esc {
                esc = false;
            } else if c == '\\' {
                esc = true;
            } else if c == '"' {
                in_str = false;
            }
            continue;
        }
        if c == '"' {
            in_str = true;
            continue;
        }
        if c == '=' {
            return Some(i);
        }
    }
    None
}

fn split_toml_string(s: &str) -> (String, &str) {
    let t = s.trim_start();
    if let Some(rest) = t.strip_prefix('"') {
        let mut esc = false;
        let mut buf = String::from("\"");
        for (i, c) in rest.char_indices() {
            buf.push(c);
            if esc {
                esc = false;
                continue;
            }
            if c == '\\' {
                esc = true;
                continue;
            }
            if c == '"' {
                let after = rest.get(i + 1..).unwrap_or("");
                return (unquote_toml_str(&buf), after);
            }
        }
        return (unquote_toml_str(&buf), "");
    }
    let end = t.find(',').unwrap_or(t.len());
    (t[..end].trim().to_string(), t.get(end..).unwrap_or(""))
}

fn unquote_toml_str(v: &str) -> String {
    let t = v.trim();
    if t.starts_with('"') && t.ends_with('"') && t.len() >= 2 {
        if let Ok(s) = serde_json::from_str::<String>(t) {
            return s;
        }
        return t[1..t.len() - 1].to_string();
    }
    t.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_inline_table() {
        let rows = vec![
            ProviderHeaderEntry {
                name: "Originator".into(),
                value: "codex_cli_rs".into(),
            },
            ProviderHeaderEntry {
                name: "User-Agent".into(),
                value: "codex_cli_rs/0.101.0 (Mac OS)".into(),
            },
        ];
        let toml = encode_extra_headers_toml(&rows);
        assert!(toml.starts_with("{ "));
        assert!(toml.contains("\"Originator\""));
        let back = decode_extra_headers(Some(&toml));
        assert_eq!(back, rows);
    }

    #[test]
    fn drops_empty_and_newline_values() {
        let rows = normalize_extra_headers(&[
            ProviderHeaderEntry {
                name: "".into(),
                value: "x".into(),
            },
            ProviderHeaderEntry {
                name: "Bad".into(),
                value: "a\nb".into(),
            },
            ProviderHeaderEntry {
                name: "X-Ok".into(),
                value: "1".into(),
            },
        ]);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "X-Ok");
    }

    #[test]
    fn last_duplicate_name_wins() {
        let rows = normalize_extra_headers(&[
            ProviderHeaderEntry {
                name: "x-api-key".into(),
                value: "old".into(),
            },
            ProviderHeaderEntry {
                name: "X-Api-Key".into(),
                value: "new".into(),
            },
        ]);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].value, "new");
    }
}
