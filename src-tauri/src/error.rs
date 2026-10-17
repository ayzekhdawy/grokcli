//! Host-side error taxonomy. UI maps codes via `src/lib/session.ts` errorCopy.

use serde::{Deserialize, Serialize};

/// Stable error codes for agent / runtime failures.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentErrorCode {
    /// Binary missing or not executable.
    CliNotFound,
    /// 401 / invalid key / not logged in.
    AuthFailed,
    /// DNS / timeout / provider 5xx / model 404.
    NetworkProvider,
    /// Process died or protocol crashed.
    AgentCrashed,
    /// Quota / rate limit / insufficient credits.
    QuotaExceeded,
    /// Could not attach agent to this session (no ACP / connect failed).
    ConnectFailed,
    /// Max concurrent agent processes reached (I02).
    ProcessLimit,
    /// Installed grok CLI predates the flag set this app spawns with.
    /// Without this code the failure surfaces as `AgentCrashed`, which points
    /// the user nowhere (NEW-03).
    CliTooOld,
    /// Linux sandbox (bubblewrap / user namespaces) blocked — common on
    /// Ubuntu 24.04 when `kernel.apparmor_restrict_unprivileged_userns=1`.
    /// Without this code the failure looks like a generic agent crash (#541).
    SandboxBlocked,
}

impl AgentErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CliNotFound => "CLI_NOT_FOUND",
            Self::AuthFailed => "AUTH_FAILED",
            Self::NetworkProvider => "NETWORK_PROVIDER",
            Self::AgentCrashed => "AGENT_CRASHED",
            Self::QuotaExceeded => "QUOTA_EXCEEDED",
            Self::ConnectFailed => "CONNECT_FAILED",
            Self::ProcessLimit => "PROCESS_LIMIT",
            Self::CliTooOld => "CLI_TOO_OLD",
            Self::SandboxBlocked => "SANDBOX_BLOCKED",
        }
    }
}

/// True when stderr / RPC text indicates bubblewrap / unprivileged user-namespace
/// denial (Ubuntu 24.04 AppArmor default, etc.). Prefer this over generic crash.
pub fn looks_like_linux_sandbox_block(msg: &str) -> bool {
    let lower = msg.to_ascii_lowercase();
    if lower.contains("bwrap") {
        return true;
    }
    if lower.contains("setting up uid map") {
        return true;
    }
    if lower.contains("uid map")
        && (lower.contains("permission denied") || lower.contains("operation not permitted"))
    {
        return true;
    }
    if lower.contains("apparmor_restrict_unprivileged_userns") {
        return true;
    }
    if lower.contains("unprivileged user namespace")
        || (lower.contains("user namespace")
            && (lower.contains("permission denied")
                || lower.contains("operation not permitted")
                || lower.contains("restricted")))
    {
        return true;
    }
    false
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentError {
    pub code: AgentErrorCode,
    pub message: String,
}

impl AgentError {
    pub fn new(code: AgentErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_codes_serialize_to_stable_names() {
        let codes = [
            AgentErrorCode::CliNotFound,
            AgentErrorCode::AuthFailed,
            AgentErrorCode::NetworkProvider,
            AgentErrorCode::AgentCrashed,
            AgentErrorCode::QuotaExceeded,
            AgentErrorCode::ConnectFailed,
            AgentErrorCode::ProcessLimit,
            AgentErrorCode::CliTooOld,
            AgentErrorCode::SandboxBlocked,
        ];
        let expected = [
            "CLI_NOT_FOUND",
            "AUTH_FAILED",
            "NETWORK_PROVIDER",
            "AGENT_CRASHED",
            "QUOTA_EXCEEDED",
            "CONNECT_FAILED",
            "PROCESS_LIMIT",
            "CLI_TOO_OLD",
            "SANDBOX_BLOCKED",
        ];
        for (code, name) in codes.into_iter().zip(expected) {
            assert_eq!(code.as_str(), name);
            let json = serde_json::to_string(&code).unwrap();
            assert_eq!(json, format!("\"{name}\""));
        }
    }

    #[test]
    fn detects_bwrap_uid_map_denial() {
        let msg = "Agent stream closed (EOF); stderr: bwrap: setting up uid map: Permission denied";
        assert!(looks_like_linux_sandbox_block(msg));
        assert!(!looks_like_linux_sandbox_block("Agent process exited"));
        assert!(!looks_like_linux_sandbox_block(
            "permission denied writing /tmp/foo"
        ));
    }
}
