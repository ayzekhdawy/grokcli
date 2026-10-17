/**
 * PID file helpers for single-instance + stop.
 * File format: one line with process id (decimal).
 */
import fs from "node:fs";
import path from "node:path";
import { ensureDir, defaultPidPath, runDir } from "../util/paths.js";

export interface PidInfo {
  pid: number;
  path: string;
}

export function getPidPath(custom?: string): string {
  return custom || defaultPidPath();
}

/** True if process appears alive (signal 0). Windows: process.kill(pid, 0) works in Node/Bun. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    // EPERM: process exists but we cannot signal it
    if (err.code === "EPERM") return true;
    return false;
  }
}

export function readPidFile(pidPath = getPidPath()): PidInfo | null {
  try {
    if (!fs.existsSync(pidPath)) return null;
    const raw = fs.readFileSync(pidPath, "utf8").trim();
    const pid = Number.parseInt(raw.split(/\s+/)[0] || "", 10);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return { pid, path: pidPath };
  } catch {
    return null;
  }
}

/** Return running instance if PID file points to a live process. */
export function getRunningInstance(pidPath = getPidPath()): PidInfo | null {
  const info = readPidFile(pidPath);
  if (!info) return null;
  if (!isProcessAlive(info.pid)) {
    try {
      fs.unlinkSync(pidPath);
    } catch {
      /* ignore */
    }
    return null;
  }
  return info;
}

/**
 * Claim single-instance lock by writing our pid.
 * @returns error message if another instance holds the lock
 */
export function acquirePidLock(opts?: {
  pidPath?: string;
  pid?: number;
  force?: boolean;
}): { ok: true; path: string } | { ok: false; error: string; existing?: PidInfo } {
  const pidPath = opts?.pidPath || getPidPath();
  const pid = opts?.pid ?? process.pid;
  const existing = getRunningInstance(pidPath);
  if (existing && existing.pid !== pid) {
    if (!opts?.force) {
      return {
        ok: false,
        error: `already running (pid=${existing.pid}). Use: agent-connect stop  or  start --force`,
        existing,
      };
    }
    // force: best-effort kill then continue
  }
  ensureDir(runDir());
  ensureDir(path.dirname(pidPath));
  fs.writeFileSync(pidPath, `${pid}\n`, "utf8");
  return { ok: true, path: pidPath };
}

export function releasePidLock(pidPath = getPidPath(), onlyIfPid?: number): void {
  try {
    if (!fs.existsSync(pidPath)) return;
    if (onlyIfPid != null) {
      const info = readPidFile(pidPath);
      if (info && info.pid !== onlyIfPid) return;
    }
    fs.unlinkSync(pidPath);
  } catch {
    /* ignore */
  }
}

export interface StopResult {
  ok: boolean;
  message: string;
  pid?: number;
  /** true if we sent a signal */
  signaled?: boolean;
}

/**
 * Stop process referenced by PID file.
 * Unix: SIGTERM then SIGKILL after timeout.
 * Windows: process.kill → falls back to taskkill if needed.
 */
export async function stopFromPidFile(opts?: {
  pidPath?: string;
  timeoutMs?: number;
}): Promise<StopResult> {
  const pidPath = opts?.pidPath || getPidPath();
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  const info = readPidFile(pidPath);
  if (!info) {
    return { ok: true, message: "not running (no pid file)" };
  }
  if (!isProcessAlive(info.pid)) {
    releasePidLock(pidPath);
    return { ok: true, message: `stale pid file removed (was ${info.pid})`, pid: info.pid };
  }

  const pid = info.pid;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Windows may not support SIGTERM name the same way; try default
    try {
      process.kill(pid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, message: `failed to signal pid=${pid}: ${msg}`, pid, signaled: false };
    }
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      releasePidLock(pidPath);
      return { ok: true, message: `stopped pid=${pid}`, pid, signaled: true };
    }
    await sleep(200);
  }

  // force kill
  try {
    if (process.platform === "win32") {
      await tryTaskKill(pid);
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    /* ignore */
  }
  await sleep(300);
  if (!isProcessAlive(pid)) {
    releasePidLock(pidPath);
    return { ok: true, message: `force-stopped pid=${pid}`, pid, signaled: true };
  }
  return {
    ok: false,
    message: `pid=${pid} still alive after ${timeoutMs}ms — kill manually`,
    pid,
    signaled: true,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function tryTaskKill(pid: number): Promise<void> {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve) => {
    const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}
