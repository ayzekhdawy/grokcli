//! Long-running tool heartbeat (host-side protocol).
//!
//! While a turn has open tool call ids and no stream/tool status updates, the
//! stall watchdog would otherwise soft/hard-end the turn. Host emits an
//! explicit `session://tool_heartbeat` and re-arms stream progress so long
//! shell / find / subagent tools are not false-stalled.
//!
//! This is intentionally Host-driven (does not require CLI cooperation). When
//! the agent later sends a real tool update, normal progress paths resume.

use std::time::{Duration, Instant};

/// Emit / re-arm cadence while tools remain open (seconds).
pub const TOOL_HEARTBEAT_INTERVAL_SECS: u64 = 25;
/// Absolute age of an open tool without terminal status before we stop
/// heartbeating (safety valve — still allow hard stall after this).
pub const TOOL_HEARTBEAT_MAX_AGE_SECS: u64 = 3 * 60 * 60;

pub fn heartbeat_interval() -> Duration {
    Duration::from_secs(TOOL_HEARTBEAT_INTERVAL_SECS)
}

pub fn heartbeat_max_age() -> Duration {
    Duration::from_secs(TOOL_HEARTBEAT_MAX_AGE_SECS)
}

/// Whether Host should fire another tool heartbeat for this session.
pub fn should_emit_tool_heartbeat(
    open_tool_count: usize,
    last_emit: Option<Instant>,
    oldest_open_tool: Option<Instant>,
    now: Instant,
) -> bool {
    if open_tool_count == 0 {
        return false;
    }
    // Stop propping up tools that have been open unreasonably long with no
    // terminal status — hard stall / orphan prune can take over.
    if let Some(oldest) = oldest_open_tool {
        if now.saturating_duration_since(oldest) >= heartbeat_max_age() {
            return false;
        }
    }
    match last_emit {
        None => true,
        Some(t) => now.saturating_duration_since(t) >= heartbeat_interval(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_tools_no_heartbeat() {
        let now = Instant::now();
        assert!(!should_emit_tool_heartbeat(0, None, None, now));
    }

    #[test]
    fn first_open_emits() {
        let now = Instant::now();
        assert!(should_emit_tool_heartbeat(1, None, Some(now), now));
    }

    #[test]
    fn respects_interval() {
        let t0 = Instant::now();
        assert!(!should_emit_tool_heartbeat(
            1,
            Some(t0),
            Some(t0),
            t0 + Duration::from_secs(10)
        ));
        assert!(should_emit_tool_heartbeat(
            1,
            Some(t0),
            Some(t0),
            t0 + Duration::from_secs(TOOL_HEARTBEAT_INTERVAL_SECS)
        ));
    }

    #[test]
    fn stops_after_max_age() {
        let t0 = Instant::now();
        let now = t0 + heartbeat_max_age();
        assert!(!should_emit_tool_heartbeat(2, None, Some(t0), now));
    }
}
