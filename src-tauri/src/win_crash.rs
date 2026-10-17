//! Windows last-words file for native exceptions (no minidump).

/// Format a single last-crash line. Tested on every OS.
pub fn format_last_crash_line(code: u32, address: u64, pid: u32) -> String {
    format!("code=0x{code:08X} address=0x{address:016X} pid={pid}")
}

#[cfg(windows)]
pub fn install() {
    // windows 0.61 gates SetUnhandledExceptionFilter / EXCEPTION_POINTERS on
    // Win32_System_Kernel; EXCEPTION_CONTINUE_SEARCH lives in Debug as i32.
    use windows::Win32::System::Diagnostics::Debug::{
        SetUnhandledExceptionFilter, EXCEPTION_CONTINUE_SEARCH, EXCEPTION_POINTERS,
    };

    unsafe extern "system" fn filter(info: *const EXCEPTION_POINTERS) -> i32 {
        let (code, address) = if info.is_null() {
            (0u32, 0u64)
        } else {
            let rec = (*info).ExceptionRecord;
            if rec.is_null() {
                (0u32, 0u64)
            } else {
                (
                    (*rec).ExceptionCode.0 as u32,
                    (*rec).ExceptionAddress as usize as u64,
                )
            }
        };
        write_last_crash_sync(code, address, std::process::id());
        EXCEPTION_CONTINUE_SEARCH
    }

    unsafe {
        let _ = SetUnhandledExceptionFilter(Some(filter));
    }
}

#[cfg(not(windows))]
pub fn install() {}

#[cfg_attr(not(windows), allow(dead_code))]
fn write_last_crash_sync(code: u32, address: u64, pid: u32) {
    let ts = chrono::Utc::now().to_rfc3339();
    let line = format!("{ts} {}\n", format_last_crash_line(code, address, pid));
    let path = crate::host_runtime::last_crash_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
    {
        use std::io::Write;
        let _ = f.write_all(line.as_bytes());
        let _ = f.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_includes_code_address_pid() {
        let line = format_last_crash_line(0xC0000005, 0x7FF123, 4242);
        assert!(line.contains("code=0xC0000005"));
        assert!(line.contains("address=0x00000000007FF123"));
        assert!(line.contains("pid=4242"));
    }
}
