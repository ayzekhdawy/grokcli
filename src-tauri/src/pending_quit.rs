//! Fail-closed app exit when the frontend never completes quit.
//!
//! Window close always `prevent_close`s and asks the FE to confirm (when busy)
//! or call `app_force_quit`. If the FE is wedged / never responds, the host
//! must still exit — otherwise users need Task Manager (Windows field reports).
//!
//! Second close/tray-quit while a pending quit is already armed → exit now.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use tauri::AppHandle;
use tracing::{info, warn};

/// How long the host waits for FE `app_force_quit` / `app_cancel_pending_quit`
/// before force-exiting itself.
pub const PENDING_QUIT_TIMEOUT_SECS: u64 = 3;

static PENDING: AtomicBool = AtomicBool::new(false);
/// Bumped on cancel/force so in-flight timers become no-ops.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Arm a host-side force-exit deadline after emitting `app://close-requested`.
///
/// - First call: arm timer (`PENDING_QUIT_TIMEOUT_SECS`).
/// - Call while already pending (second close / tray Quit): exit immediately.
pub fn schedule_pending_quit(app: &AppHandle) {
    if PENDING.swap(true, Ordering::SeqCst) {
        info!("pending quit: second close request → force exit now");
        app.exit(0);
        return;
    }
    let gen = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::Builder::new()
        .name("pending-quit".into())
        .spawn(move || {
            std::thread::sleep(Duration::from_secs(PENDING_QUIT_TIMEOUT_SECS));
            if PENDING.load(Ordering::SeqCst) && GENERATION.load(Ordering::SeqCst) == gen {
                warn!(
                    secs = PENDING_QUIT_TIMEOUT_SECS,
                    "pending quit: frontend did not complete quit — host force exit"
                );
                app.exit(0);
            }
        })
        .ok();
}

/// User dismissed the busy-quit confirm (or otherwise cancelled exit).
pub fn cancel_pending_quit() {
    PENDING.store(false, Ordering::SeqCst);
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

/// Clear the timer and exit the process (called from `app_force_quit`).
pub fn clear_and_exit(app: AppHandle) {
    PENDING.store(false, Ordering::SeqCst);
    GENERATION.fetch_add(1, Ordering::SeqCst);
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_disarms_pending_flag() {
        PENDING.store(true, Ordering::SeqCst);
        cancel_pending_quit();
        assert!(!PENDING.load(Ordering::SeqCst));
    }
}
