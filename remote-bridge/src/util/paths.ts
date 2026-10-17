import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PRODUCT = "grok-app";

/**
 * Data directory for the in-app Remote Bridge.
 * Prefer GROK_REMOTE_BRIDGE_HOME, then ~/.grok-app/remote/bridge-data.
 */
export function defaultDataDir(): string {
  if (process.env.GROK_REMOTE_BRIDGE_HOME) {
    return process.env.GROK_REMOTE_BRIDGE_HOME;
  }
  if (process.env.GROK_APP_HOME) {
    return path.join(process.env.GROK_APP_HOME, "remote", "bridge-data");
  }
  return path.join(os.homedir(), `.${PRODUCT}`, "remote", "bridge-data");
}

/** Oldest legacy data directory: ~/.lark-grok */
export function legacyDataDir(): string {
  return path.join(os.homedir(), ".lark-grok");
}

/** External agent-connect data dir (import only; never spawn that CLI). */
export function agentConnectDataDir(): string {
  return path.join(os.homedir(), ".agent-connect");
}

export function defaultConfigPath(dataDir = defaultDataDir()): string {
  return path.join(dataDir, "config.toml");
}

export function sessionsDir(dataDir = defaultDataDir()): string {
  return path.join(dataDir, "data", "sessions");
}

/** Runtime state: PID, locks */
export function runDir(dataDir = defaultDataDir()): string {
  return path.join(dataDir, "run");
}

export function defaultPidPath(dataDir = defaultDataDir()): string {
  return path.join(runDir(dataDir), "remote-bridge.pid");
}

export function logsDir(dataDir = defaultDataDir()): string {
  return path.join(dataDir, "logs");
}

export function defaultLogFilePath(dataDir = defaultDataDir()): string {
  return path.join(logsDir(dataDir), "remote-bridge.log");
}

/** Generated service artifacts (WinSW xml, printed units, etc.) */
export function serviceDir(dataDir = defaultDataDir()): string {
  return path.join(dataDir, "service");
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Resolve grok binary: explicit path, PATH, then ~/.grok/bin/grok */
export function resolveGrokBinary(command = "grok"): string {
  const trimmed = (command || "grok").trim() || "grok";
  if (path.isAbsolute(trimmed) && fs.existsSync(trimmed)) {
    return trimmed;
  }
  // Relative path that exists from cwd
  if (trimmed.includes(path.sep) && fs.existsSync(path.resolve(trimmed))) {
    return path.resolve(trimmed);
  }
  // PATH search
  const pathEnv = process.env.PATH || "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, trimmed);
    if (fs.existsSync(candidate)) return candidate;
  }
  // ~/.grok/bin/grok fallback
  const homeFallback = path.join(
    os.homedir(),
    ".grok",
    "bin",
    process.platform === "win32" ? "grok.exe" : "grok",
  );
  if (fs.existsSync(homeFallback)) return homeFallback;
  return trimmed;
}

export function grokAuthExists(): boolean {
  return fs.existsSync(path.join(os.homedir(), ".grok", "auth.json"));
}

export const PRODUCT_NAME = "grok-remote-bridge";
export const CLI_NAME = "grok-remote-bridge";
