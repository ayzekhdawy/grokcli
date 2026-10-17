//! Remote IM resilience helpers (RIM-RESILIENCE).
//!
//! Pure reconnect backoff, error classification, and inbound turn rate limits.
//! Soft-fail style: decisions only; callers reply with honest user text.

use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Base for exponential backoff (seconds). attempt≥1 → base^attempt capped.
pub const BACKOFF_BASE_SECS: u64 = 2;
pub const BACKOFF_CAP_SECS: u64 = 60;
pub const BACKOFF_MAX_EXP: u32 = 6;

/// Per-chat inbound agent turns per window.
pub const RATE_PER_CHAT: u32 = 8;
/// Global inbound agent turns per window.
pub const RATE_GLOBAL: u32 = 40;
pub const RATE_WINDOW_SECS: u64 = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RimErrorKind {
    RateLimit,
    Auth,
    Network,
    Crash,
    Config,
    Unknown,
}

impl RimErrorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RateLimit => "rate_limit",
            Self::Auth => "auth",
            Self::Network => "network",
            Self::Crash => "crash",
            Self::Config => "config",
            Self::Unknown => "unknown",
        }
    }
}

/// Exponential reconnect delay for 0-based `attempt`.
/// attempt 0 → 0; 1 → 2; 2 → 4; … capped at 60.
pub fn reconnect_backoff_secs(attempt: u32) -> u64 {
    if attempt == 0 {
        return 0;
    }
    let exp = attempt.min(BACKOFF_MAX_EXP);
    BACKOFF_BASE_SECS.saturating_pow(exp).min(BACKOFF_CAP_SECS)
}

/// After `failed_attempt` failures (0-based count), wait this long before next try.
pub fn next_retry_after_failure_secs(failed_attempt: u32) -> u64 {
    reconnect_backoff_secs(failed_attempt.saturating_add(1))
}

pub fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn can_attempt_restart(now_unix: u64, next_retry_unix: u64) -> bool {
    next_retry_unix == 0 || now_unix >= next_retry_unix
}

pub fn seconds_until_retry(now_unix: u64, next_retry_unix: u64) -> u32 {
    if next_retry_unix == 0 || now_unix >= next_retry_unix {
        return 0;
    }
    (next_retry_unix - now_unix).min(u64::from(u32::MAX)) as u32
}

/// Classify connector / bridge / agent error text (honest UI kind).
pub fn classify_rim_error(raw: &str) -> RimErrorKind {
    let s = raw.to_lowercase();
    if s.trim().is_empty() {
        return RimErrorKind::Unknown;
    }
    if s.contains("rate limit")
        || s.contains("rate_limit")
        || s.contains("ratelimit")
        || s.contains("too many request")
        || s.contains("429")
        || s.contains("quota")
        || s.contains("usage limit")
        || s.contains("throttl")
        || s.contains("slow down")
        || s.contains("insufficient credit")
        || s.contains("out of credits")
        || s.contains("not entitled")
    {
        return RimErrorKind::RateLimit;
    }
    if s.contains("401")
        || s.contains("403")
        || s.contains("unauthor")
        || s.contains("forbidden")
        || s.contains("invalid token")
        || s.contains("invalid_app")
        || s.contains("app_secret")
        || s.contains("authentication")
        || s.contains("access denied")
        || s.contains("login required")
    {
        return RimErrorKind::Auth;
    }
    if s.contains("missing ")
        || s.contains("no enabled channel")
        || s.contains("no credentials")
        || s.contains("missing_credentials")
        || s.contains("not configured")
        || s.contains("invalid config")
    {
        return RimErrorKind::Config;
    }
    if s.contains("exited unexpectedly")
        || s.contains("connectors exited")
        || s.contains("panic")
        || s.contains("crashed")
        || s.contains("runtime handle finished")
        || s.contains("pump exited")
    {
        return RimErrorKind::Crash;
    }
    if s.contains("timeout")
        || s.contains("timed out")
        || s.contains("connection reset")
        || s.contains("connection refused")
        || s.contains("network")
        || s.contains("dns")
        || s.contains("econn")
        || s.contains("socket")
        || s.contains("ws connect")
        || s.contains("tls")
        || s.contains("unreachable")
        || s.contains("offline")
    {
        return RimErrorKind::Network;
    }
    RimErrorKind::Unknown
}

/// Recovery phase string for status DTO / UI.
pub fn recovery_phase(
    running: bool,
    phase: &str,
    enabled: bool,
    next_retry_secs: u32,
    rate_limited: bool,
    has_error: bool,
) -> &'static str {
    if rate_limited {
        return "rate_limited";
    }
    if running || phase == "listening" {
        return "listening";
    }
    if phase == "starting" {
        return if next_retry_secs > 0 || has_error {
            "restarting"
        } else {
            "starting"
        };
    }
    if phase == "error" || (has_error && !enabled) {
        return "error";
    }
    if enabled && !running {
        if next_retry_secs > 0 {
            return "backing_off";
        }
        return "degraded";
    }
    "stopped"
}

// ─── Inbound turn rate limiter ──────────────────────────────────────────────

#[derive(Debug, Clone)]
struct Bucket {
    tokens: f64,
    last: Instant,
}

impl Bucket {
    fn full(capacity: f64) -> Self {
        Self {
            tokens: capacity,
            last: Instant::now(),
        }
    }

    fn refill(&mut self, capacity: f64, window: Duration) {
        let now = Instant::now();
        let elapsed = now.saturating_duration_since(self.last);
        if window.as_secs_f64() > 0.0 {
            let gained = (elapsed.as_secs_f64() / window.as_secs_f64()) * capacity;
            self.tokens = (self.tokens + gained).min(capacity);
        }
        self.last = now;
    }

    fn try_take(&mut self, capacity: f64, window: Duration) -> Result<(), Duration> {
        self.refill(capacity, window);
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            Ok(())
        } else {
            let need = 1.0 - self.tokens;
            let secs = (need / capacity) * window.as_secs_f64();
            Err(Duration::from_secs_f64(secs.max(1.0)))
        }
    }
}

/// Process-wide soft inbound rate limiter (per chat + global).
pub struct InboundRateLimiter {
    per_chat: HashMap<String, Bucket>,
    global: Bucket,
    chat_cap: f64,
    global_cap: f64,
    window: Duration,
}

impl Default for InboundRateLimiter {
    fn default() -> Self {
        Self::new(RATE_PER_CHAT, RATE_GLOBAL, RATE_WINDOW_SECS)
    }
}

impl InboundRateLimiter {
    pub fn new(per_chat: u32, global: u32, window_secs: u64) -> Self {
        let chat_cap = per_chat.max(1) as f64;
        let global_cap = global.max(1) as f64;
        Self {
            per_chat: HashMap::new(),
            global: Bucket::full(global_cap),
            chat_cap,
            global_cap,
            window: Duration::from_secs(window_secs.max(1)),
        }
    }

    /// Try admit one agent turn for `scope_key`. Soft-fail: Err(retry_after).
    pub fn try_acquire(&mut self, scope_key: &str) -> Result<(), Duration> {
        match self.global.try_take(self.global_cap, self.window) {
            Ok(()) => {}
            Err(d) => return Err(d),
        }
        let bucket = self
            .per_chat
            .entry(scope_key.to_string())
            .or_insert_with(|| Bucket::full(self.chat_cap));
        match bucket.try_take(self.chat_cap, self.window) {
            Ok(()) => Ok(()),
            Err(d) => {
                // refund global
                self.global.tokens = (self.global.tokens + 1.0).min(self.global_cap);
                Err(d)
            }
        }
    }

    /// Bound map growth (drop idle entries opportunistically).
    pub fn prune_if_large(&mut self, max_keys: usize) {
        if self.per_chat.len() <= max_keys {
            return;
        }
        // Drop half oldest-ish by clearing all when huge — simple soft bound.
        self.per_chat.clear();
    }
}

/// Honest user-facing rate-limit copy (engine lang = "en" | other → zh).
pub fn rate_limit_user_message(lang: &str, retry_after: Duration) -> String {
    let secs = retry_after.as_secs().max(1);
    if lang == "en" {
        format!(
            "Rate limited: too many remote turns. Try again in about {secs}s. (Bridge soft-limit; not a silent drop.)"
        )
    } else {
        format!(
            "已触发速率限制：远程回合过于频繁。约 {secs} 秒后再试。（Bridge 软限制，非静默丢弃）"
        )
    }
}

/// Honest user-facing agent error when classified as rate limit / quota.
pub fn agent_error_user_message(lang: &str, kind: RimErrorKind, raw: &str) -> String {
    match kind {
        RimErrorKind::RateLimit => {
            if lang == "en" {
                "Grok quota / rate limit reached. Wait and retry, or check Account / provider credits. (Honest: the model API refused this turn.)".into()
            } else {
                "已触及 Grok 配额或速率限制。请稍后再试，或检查账号 / 中转额度。（诚实说明：模型 API 拒绝了本回合）".into()
            }
        }
        RimErrorKind::Auth => {
            if lang == "en" {
                "Authentication failed for Grok Build. Check login / API key in Settings → Account or Providers.".into()
            } else {
                "Grok Build 鉴权失败。请在 设置 → 账号 或 中转 中检查登录 / API 密钥。".into()
            }
        }
        _ => {
            // Soft-fail: keep a short redacted-ish prefix of the raw error.
            let snippet: String = raw.chars().take(200).collect();
            if lang == "en" {
                format!("Error: {snippet}")
            } else {
                format!("错误：{snippet}")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_curve() {
        assert_eq!(reconnect_backoff_secs(0), 0);
        assert_eq!(reconnect_backoff_secs(1), 2);
        assert_eq!(reconnect_backoff_secs(2), 4);
        assert_eq!(reconnect_backoff_secs(5), 32);
        assert_eq!(reconnect_backoff_secs(6), 60); // 2^6=64 → cap 60
        assert_eq!(reconnect_backoff_secs(99), 60);
    }

    #[test]
    fn next_after_failure() {
        assert_eq!(next_retry_after_failure_secs(0), 2);
        assert_eq!(next_retry_after_failure_secs(1), 4);
    }

    #[test]
    fn schedule_helpers() {
        assert!(can_attempt_restart(100, 0));
        assert!(can_attempt_restart(100, 100));
        assert!(!can_attempt_restart(99, 100));
        assert_eq!(seconds_until_retry(100, 130), 30);
        assert_eq!(seconds_until_retry(130, 100), 0);
    }

    #[test]
    fn classify_errors() {
        assert_eq!(classify_rim_error("HTTP 429"), RimErrorKind::RateLimit);
        assert_eq!(
            classify_rim_error("quota exceeded"),
            RimErrorKind::RateLimit
        );
        assert_eq!(classify_rim_error("401 unauthorized"), RimErrorKind::Auth);
        assert_eq!(
            classify_rim_error("no enabled channel with credentials"),
            RimErrorKind::Config
        );
        assert_eq!(
            classify_rim_error("bridge connectors exited unexpectedly"),
            RimErrorKind::Crash
        );
        assert_eq!(
            classify_rim_error("ws connect: connection refused"),
            RimErrorKind::Network
        );
        assert_eq!(classify_rim_error("weird"), RimErrorKind::Unknown);
    }

    #[test]
    fn recovery_phase_honest() {
        assert_eq!(
            recovery_phase(true, "listening", true, 0, false, false),
            "listening"
        );
        assert_eq!(
            recovery_phase(false, "degraded", true, 12, false, true),
            "backing_off"
        );
        assert_eq!(
            recovery_phase(false, "stopped", true, 0, false, false),
            "degraded"
        );
        assert_eq!(
            recovery_phase(false, "error", true, 0, true, true),
            "rate_limited"
        );
    }

    #[test]
    fn rate_limiter_soft_blocks() {
        let mut lim = InboundRateLimiter::new(2, 10, 60);
        assert!(lim.try_acquire("a").is_ok());
        assert!(lim.try_acquire("a").is_ok());
        assert!(lim.try_acquire("a").is_err());
        // other chat still ok under global
        assert!(lim.try_acquire("b").is_ok());
    }

    #[test]
    fn rate_limit_messages_nonempty() {
        let m = rate_limit_user_message("en", Duration::from_secs(5));
        assert!(m.contains("Rate limited"));
        let m2 = rate_limit_user_message("zh", Duration::from_secs(5));
        assert!(m2.contains("速率"));
    }
}
