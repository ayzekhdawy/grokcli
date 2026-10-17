//! IM slash commands: /p project · /r resume · /help …
//! Also used as the catalog for Telegram Bot API `setMyCommands` (native / menu).

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BuiltinCommand {
    Help,
    New,
    Whoami,
    Status,
    /// Compact the currently bound agent session; optional text guides the summary.
    Compact {
        note: Option<String>,
    },
    /// Show current/last-reported context usage for the bound session.
    Context,
    Stop,
    /// List saved Grok accounts + quota; optional query picks/switches by number or label.
    Account {
        query: Option<String>,
    },
    Project {
        query: Option<String>,
    },
    Resume {
        query: Option<String>,
    },
    Unknown {
        raw: String,
    },
}

/// One entry for Telegram-style native bot command menus.
#[derive(Debug, Clone, Copy)]
pub struct NativeBotCommand {
    pub command: &'static str,
    pub description_en: &'static str,
    pub description_zh: &'static str,
}

/// Commands registered via Telegram `setMyCommands` (and documented in `/help`).
/// Names: 1–32 chars, lowercase a-z / 0-9 / underscore only.
pub fn native_bot_commands() -> &'static [NativeBotCommand] {
    &[
        NativeBotCommand {
            command: "start",
            description_en: "Welcome & help",
            description_zh: "欢迎与帮助",
        },
        NativeBotCommand {
            command: "help",
            description_en: "List all commands",
            description_zh: "显示全部命令",
        },
        NativeBotCommand {
            command: "p",
            description_en: "List / bind a trusted project",
            description_zh: "列出或绑定已信任项目",
        },
        NativeBotCommand {
            command: "project",
            description_en: "Same as /p",
            description_zh: "同 /p",
        },
        NativeBotCommand {
            command: "r",
            description_en: "List / resume a prior session",
            description_zh: "列出或恢复历史会话",
        },
        NativeBotCommand {
            command: "resume",
            description_en: "Same as /r",
            description_zh: "同 /r",
        },
        NativeBotCommand {
            command: "new",
            description_en: "Fresh session (keep project)",
            description_zh: "保持项目，开启新会话",
        },
        NativeBotCommand {
            command: "status",
            description_en: "Binding & runtime snapshot",
            description_zh: "绑定与运行状态",
        },
        NativeBotCommand {
            command: "context",
            description_en: "Show current context usage",
            description_zh: "查看当前会话上下文用量",
        },
        NativeBotCommand {
            command: "compact",
            description_en: "Compact the current session",
            description_zh: "压缩当前会话上下文",
        },
        NativeBotCommand {
            command: "whoami",
            description_en: "Show your sender id",
            description_zh: "查看发送者 id",
        },
        NativeBotCommand {
            command: "stop",
            description_en: "Cancel in-flight turn",
            description_zh: "中断当前任务",
        },
        NativeBotCommand {
            command: "account",
            description_en: "List accounts & quota; /account n to switch",
            description_zh: "查看账号与额度；/account n 切换",
        },
        NativeBotCommand {
            command: "accounts",
            description_en: "Same as /account",
            description_zh: "同 /account",
        },
        NativeBotCommand {
            command: "switch",
            description_en: "Switch Grok account by number",
            description_zh: "按序号切换 Grok 账号",
        },
        NativeBotCommand {
            command: "quota",
            description_en: "Show SuperGrok remaining quota",
            description_zh: "查看 SuperGrok 剩余额度",
        },
    ]
}

/// Strip Telegram group form `/cmd@BotName` → `cmd`.
fn normalize_command_head(head: &str) -> String {
    let lower = head.to_ascii_lowercase();
    match lower.split_once('@') {
        Some((cmd, _)) => cmd.to_string(),
        None => lower,
    }
}

pub fn parse_slash(text: &str) -> Option<BuiltinCommand> {
    let t = text.trim();
    if !t.starts_with('/') {
        return None;
    }
    let rest = &t[1..];
    let (head_raw, query) = match rest.find(char::is_whitespace) {
        Some(i) => {
            let q = rest[i + 1..].trim();
            (
                rest[..i].to_string(),
                if q.is_empty() {
                    None
                } else {
                    Some(q.to_string())
                },
            )
        }
        None => (rest.to_string(), None),
    };
    let head = normalize_command_head(&head_raw);
    Some(match head.as_str() {
        // Telegram always sends /start on first open; treat as help/welcome.
        "start" | "help" | "h" | "?" => BuiltinCommand::Help,
        "new" | "reset" => BuiltinCommand::New,
        "whoami" | "id" => BuiltinCommand::Whoami,
        "status" => BuiltinCommand::Status,
        "context" | "ctx" => BuiltinCommand::Context,
        "compact" => BuiltinCommand::Compact { note: query },
        "stop" | "cancel" => BuiltinCommand::Stop,
        // Multi-account: list quota + switch (Telegram native menu + aliases).
        "account" | "accounts" | "quota" | "usage" | "switch" => BuiltinCommand::Account { query },
        "p" | "project" => BuiltinCommand::Project { query },
        "r" | "resume" => BuiltinCommand::Resume { query },
        other => BuiltinCommand::Unknown {
            raw: other.to_string(),
        },
    })
}

pub fn help_text(lang: &str) -> String {
    if lang == "en" {
        [
            "**Grok Remote IM** — local Grok Build via IM (Rust)",
            "",
            "Commands (Telegram: type `/` for the native menu):",
            "- `/start` · `/help` — this message",
            "- `/p` · `/project` — list / bind a trusted project",
            "- `/p <name|n>` — bind by name or number",
            "- `/r` · `/resume` — list / resume a prior session",
            "- `/r <n>` — resume by number",
            "- `/new` — fresh session (keep project)",
            "- `/account` · `/quota` — list accounts & remaining SuperGrok quota",
            "- `/account <n|label>` · `/switch <n>` — switch Grok account",
            "- `/whoami` — show your sender id",
            "- `/status` — snapshot",
            "- `/context` — current context usage (agent-reported or clearly marked estimate)",
            "- `/compact [note]` — compact the current session context",
            "- `/stop` — cancel in-flight turn",
            "- `0` — cancel number-pick mode",
        ]
        .join("\n")
    } else {
        [
            "**Grok Remote IM** — 本地 Grok Build 远程 IM 桥（Rust 内置）",
            "",
            "命令（Telegram 输入 `/` 可唤起原生命令菜单）：",
            "- `/start` · `/help` — 显示帮助",
            "- `/p` · `/project` — 列出 / 绑定已信任项目",
            "- `/p <名|序号>` — 按名称或序号绑定",
            "- `/r` · `/resume` — 列出 / 恢复历史会话",
            "- `/r <序号>` — 按序号恢复",
            "- `/new` — 保持项目，开启新会话",
            "- `/account` · `/quota` — 查看已保存账号与剩余额度",
            "- `/account <序号|标签>` · `/switch <序号>` — 切换 Grok 账号",
            "- `/whoami` — 查看发送者 id",
            "- `/status` — 状态快照",
            "- `/context` — 当前会话上下文用量（上报值或明确标注的估算值）",
            "- `/compact [备注]` — 压缩当前会话上下文",
            "- `/stop` — 中断当前任务",
            "- `0` — 取消序号选择",
        ]
        .join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_project_resume() {
        assert_eq!(
            parse_slash("/p"),
            Some(BuiltinCommand::Project { query: None })
        );
        assert_eq!(
            parse_slash("/p 1"),
            Some(BuiltinCommand::Project {
                query: Some("1".into())
            })
        );
        assert_eq!(
            parse_slash("/r"),
            Some(BuiltinCommand::Resume { query: None })
        );
        assert!(parse_slash("hi").is_none());
    }

    #[test]
    fn parses_context_and_compact() {
        assert_eq!(parse_slash("/context"), Some(BuiltinCommand::Context));
        assert_eq!(parse_slash("/ctx"), Some(BuiltinCommand::Context));
        assert_eq!(
            parse_slash("/compact keep decisions"),
            Some(BuiltinCommand::Compact {
                note: Some("keep decisions".into())
            })
        );
    }

    #[test]
    fn strips_telegram_bot_suffix() {
        assert_eq!(parse_slash("/help@MyGrokBot"), Some(BuiltinCommand::Help));
        assert_eq!(
            parse_slash("/p@MyGrokBot 2"),
            Some(BuiltinCommand::Project {
                query: Some("2".into())
            })
        );
        assert_eq!(parse_slash("/START@bot"), Some(BuiltinCommand::Help));
    }

    #[test]
    fn start_is_help() {
        assert_eq!(parse_slash("/start"), Some(BuiltinCommand::Help));
        assert_eq!(parse_slash("/start payload"), Some(BuiltinCommand::Help));
    }

    #[test]
    fn parses_account_and_aliases() {
        assert_eq!(
            parse_slash("/account"),
            Some(BuiltinCommand::Account { query: None })
        );
        assert_eq!(
            parse_slash("/accounts"),
            Some(BuiltinCommand::Account { query: None })
        );
        assert_eq!(
            parse_slash("/quota"),
            Some(BuiltinCommand::Account { query: None })
        );
        assert_eq!(
            parse_slash("/switch 2"),
            Some(BuiltinCommand::Account {
                query: Some("2".into())
            })
        );
        assert_eq!(
            parse_slash("/account@MyBot 1"),
            Some(BuiltinCommand::Account {
                query: Some("1".into())
            })
        );
        assert_eq!(
            parse_slash("/accounts@MyBot work"),
            Some(BuiltinCommand::Account {
                query: Some("work".into())
            })
        );
    }

    #[test]
    fn native_catalog_has_account_once() {
        let names: Vec<&str> = native_bot_commands().iter().map(|c| c.command).collect();
        assert_eq!(names.iter().filter(|n| **n == "account").count(), 1);
        assert!(names.contains(&"switch"));
        assert!(names.contains(&"quota"));
    }

    #[test]
    fn help_mentions_account() {
        let zh = help_text("zh");
        assert!(zh.contains("/account"));
        assert!(zh.contains("额度") || zh.contains("账号"));
        let en = help_text("en");
        assert!(en.contains("/account"));
        assert!(en.contains("quota") || en.contains("account"));
    }

    #[test]
    fn native_catalog_commands_are_valid() {
        for c in native_bot_commands() {
            assert!(!c.command.is_empty() && c.command.len() <= 32);
            assert!(c
                .command
                .chars()
                .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_'));
            assert!(!c.description_en.is_empty() && c.description_en.len() <= 256);
            assert!(!c.description_zh.is_empty() && c.description_zh.len() <= 256);
        }
    }
}
