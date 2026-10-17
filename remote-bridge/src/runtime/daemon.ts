/**
 * Detached background start (cross-platform).
 * Spawns a child that runs `start` without --daemon; parent exits after child is up.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getRunningInstance, getPidPath, isProcessAlive } from "./pid.js";
import { defaultLogFilePath, ensureDir, logsDir } from "../util/paths.js";
import { resolveCliInvocation } from "../service/resolve-exec.js";

export interface DaemonStartOptions {
  /** Full argv after the CLI name, must include start/run and should NOT include --daemon */
  childArgv: string[];
  pidPath?: string;
  logFile?: string;
  /** Wait for PID file / child alive (ms) */
  waitMs?: number;
  force?: boolean;
}

export interface DaemonStartResult {
  ok: boolean;
  message: string;
  pid?: number;
  logFile?: string;
  pidPath?: string;
}

/**
 * Strip --daemon / -d from argv for the child process.
 */
export function stripDaemonFlags(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--daemon" || a === "-d") continue;
    out.push(a);
  }
  // Ensure start command present
  const hasStart = out.some((a) => a === "start" || a === "run" || a === "serve");
  if (!hasStart) {
    out.unshift("start");
  }
  return out;
}

export async function startDaemon(opts: DaemonStartOptions): Promise<DaemonStartResult> {
  const pidPath = opts.pidPath || getPidPath();
  const logFile = opts.logFile || defaultLogFilePath();
  const waitMs = opts.waitMs ?? 4000;

  const existing = getRunningInstance(pidPath);
  if (existing && !opts.force) {
    return {
      ok: false,
      message: `already running (pid=${existing.pid}). agent-connect stop  first, or start --daemon --force`,
      pid: existing.pid,
      pidPath,
      logFile,
    };
  }

  ensureDir(logsDir());
  ensureDir(path.dirname(logFile));
  ensureDir(path.dirname(pidPath));

  const inv = resolveCliInvocation();
  const childArgv = stripDaemonFlags(opts.childArgv);

  // Prefer file log for daemons
  if (!childArgv.includes("--log-file")) {
    childArgv.push("--log-file", logFile);
  }

  const outFd = fs.openSync(logFile, "a");
  const errFd = fs.openSync(logFile, "a");

  const child = spawn(inv.executable, [...inv.prefixArgs, ...childArgv], {
    detached: true,
    stdio: ["ignore", outFd, errFd],
    env: { ...process.env },
    cwd: inv.workDir,
    windowsHide: true,
  });

  fs.closeSync(outFd);
  fs.closeSync(errFd);

  if (child.pid == null) {
    return { ok: false, message: "failed to spawn background process", logFile, pidPath };
  }

  child.unref();

  // Wait until PID file appears or process dies
  const spawnedPid = child.pid;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const running = getRunningInstance(pidPath);
    if (running) {
      return {
        ok: true,
        message: `daemon started pid=${running.pid}`,
        pid: running.pid,
        logFile,
        pidPath,
      };
    }
    if (!isProcessAlive(spawnedPid)) {
      return {
        ok: false,
        message: `daemon exited early (spawn pid=${spawnedPid}). Check log: ${logFile}`,
        logFile,
        pidPath,
      };
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  // Child may still be starting; treat spawn pid as success if alive
  if (isProcessAlive(spawnedPid)) {
    return {
      ok: true,
      message: `daemon spawned pid=${spawnedPid} (pid file not yet written; check status shortly)`,
      pid: spawnedPid,
      logFile,
      pidPath,
    };
  }

  return {
    ok: false,
    message: `daemon failed to stay up. Check log: ${logFile}`,
    logFile,
    pidPath,
  };
}
