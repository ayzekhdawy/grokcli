import fs from "node:fs";
import path from "node:path";
import { defaultDataDir, ensureDir } from "./paths.js";
import { redactObject, redactString } from "./redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let currentLevel: LogLevel = "info";
let filePath: string | null = null;
/** Captured lines for unit tests (redacted). */
let capture: string[] | null = null;

export function setLogLevel(level: string | undefined): void {
  const n = String(level || "info").toLowerCase() as LogLevel;
  if (n in LEVEL_ORDER) currentLevel = n;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

/** Enable append-only file logging under ~/.agent-connect/logs/ (or custom path). */
export function enableFileLog(customPath?: string): string {
  const dir = path.join(defaultDataDir(), "logs");
  ensureDir(dir);
  filePath = customPath
    ? path.resolve(customPath)
    : path.join(dir, "agent-connect.log");
  ensureDir(path.dirname(filePath));
  const banner = `\n======== session ${new Date().toISOString()} pid=${process.pid} ========\n`;
  fs.appendFileSync(filePath, banner, "utf8");
  return filePath;
}

export function getLogFilePath(): string | null {
  return filePath;
}

/** Test helper: capture redacted log lines */
export function startLogCapture(): void {
  capture = [];
}
export function stopLogCapture(): string[] {
  const out = capture || [];
  capture = null;
  return out;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function line(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const ts = new Date().toISOString();
  const safeMsg = redactString(msg);
  const safeExtra = extra ? redactObject(extra) : undefined;
  const suffix =
    safeExtra && Object.keys(safeExtra).length > 0
      ? ` ${JSON.stringify(safeExtra)}`
      : "";
  const out = `${ts} [${level.toUpperCase()}] ${safeMsg}${suffix}`;
  if (capture) capture.push(out);
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
  if (filePath) {
    try {
      fs.appendFileSync(filePath, out + "\n", "utf8");
    } catch {
      /* ignore disk errors */
    }
  }
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => line("debug", msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => line("info", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => line("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => line("error", msg, extra),
};
