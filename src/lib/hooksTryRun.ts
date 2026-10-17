/**
 * Pure helpers for Settings → Extensions → Hooks real try-run.
 *
 * Host `hooks_try_run` executes a script under hooks dirs only.
 * These helpers validate client-side input and format results for the UI.
 * Never invent success — only surface host `ok` / exit / timeout honestly.
 */

import { redact } from "./redact";
import { redactHookDetail, type HookActivityOutcome } from "./hooksDebug";

/** Cap for optional stdin JSON (~32 KiB), matches host. */
export const HOOKS_TRY_STDIN_MAX = 32 * 1024;

/** Default / clamp bounds for timeout (seconds). */
export const HOOKS_TRY_DEFAULT_TIMEOUT_SECS = 5;
export const HOOKS_TRY_MIN_TIMEOUT_SECS = 1;
export const HOOKS_TRY_MAX_TIMEOUT_SECS = 60;

/** Extensions that look like scripts (dirs / pure config JSON still tryable if host allows). */
const SCRIPT_EXTS = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "py",
  "js",
  "mjs",
  "cjs",
  "ts",
  "pl",
  "rb",
  "ps1",
  "bat",
  "cmd",
  "exe",
]);

export type HooksTryRunLike = {
  ok: boolean;
  refused?: boolean;
  timedOut?: boolean;
  exitCode?: number | null;
  stdout?: string | null;
  stderr?: string | null;
  durationMs?: number | null;
  path?: string | null;
  scope?: string | null;
  timeoutSecs?: number | null;
  reason?: string | null;
  message?: string | null;
};

export type ValidateTryStdinOk = { ok: true; body: string | null };
export type ValidateTryStdinErr = { ok: false; error: string };
export type ValidateTryStdinResult = ValidateTryStdinOk | ValidateTryStdinErr;

/**
 * Optional JSON stdin: empty → null body; non-empty must be valid JSON and within size.
 */
export function validateHooksTryStdin(
  text: string | null | undefined,
): ValidateTryStdinResult {
  const raw = text == null ? "" : String(text);
  if (!raw.trim()) {
    return { ok: true, body: null };
  }
  if (raw.length > HOOKS_TRY_STDIN_MAX) {
    return {
      ok: false,
      error: `too_large:${raw.length}:${HOOKS_TRY_STDIN_MAX}`,
    };
  }
  try {
    JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `invalid_json:${msg}` };
  }
  return { ok: true, body: raw };
}

/** Clamp timeout seconds for the host call. */
export function clampHooksTryTimeout(
  secs: number | null | undefined,
): number {
  const n =
    typeof secs === "number" && Number.isFinite(secs)
      ? Math.floor(secs)
      : HOOKS_TRY_DEFAULT_TIMEOUT_SECS;
  if (n < HOOKS_TRY_MIN_TIMEOUT_SECS) return HOOKS_TRY_MIN_TIMEOUT_SECS;
  if (n > HOOKS_TRY_MAX_TIMEOUT_SECS) return HOOKS_TRY_MAX_TIMEOUT_SECS;
  return n;
}

/** Whether a listed hook row is a candidate for Try (file with script-like ext). */
export function isHookScriptTryable(hook: {
  kind?: string | null;
  ext?: string | null;
  name?: string | null;
}): boolean {
  if ((hook.kind ?? "").toLowerCase() === "dir") return false;
  const ext = (hook.ext ?? "").trim().toLowerCase();
  if (ext && SCRIPT_EXTS.has(ext)) return true;
  // Extension-less executables sometimes live under hooks/
  const name = (hook.name ?? "").trim();
  if (name && !name.includes(".") && (hook.kind ?? "file") === "file") {
    return true;
  }
  return false;
}

/** Human summary line for a try-run result (redacted). */
export function formatHooksTryRunSummary(
  result: HooksTryRunLike | null | undefined,
  labels?: {
    refused?: string;
    timedOut?: string;
    ok?: string;
    fail?: string;
  },
): string {
  if (!result) return "";
  if (result.refused) {
    const base = labels?.refused ?? "Refused";
    const reason = result.reason ? ` (${result.reason})` : "";
    const msg = result.message ? ` — ${redactHookDetail(result.message, 120)}` : "";
    return `${base}${reason}${msg}`;
  }
  if (result.timedOut) {
    const base = labels?.timedOut ?? "Timed out";
    const t =
      typeof result.timeoutSecs === "number" ? ` after ${result.timeoutSecs}s` : "";
    return `${base}${t}`;
  }
  if (result.ok) {
    const base = labels?.ok ?? "Exit 0";
    const ms =
      typeof result.durationMs === "number" ? ` · ${result.durationMs}ms` : "";
    return `${base}${ms}`;
  }
  const code =
    result.exitCode == null || result.exitCode === undefined
      ? "?"
      : String(result.exitCode);
  const base = labels?.fail ?? `Exit ${code}`;
  const ms =
    typeof result.durationMs === "number" ? ` · ${result.durationMs}ms` : "";
  return `${base}${ms}`;
}

/** Combined redacted stdout+stderr preview for the result panel. */
export function formatHooksTryRunOutput(
  result: HooksTryRunLike | null | undefined,
  maxLen = 4000,
): string {
  if (!result) return "";
  const parts: string[] = [];
  const out = String(result.stdout ?? "").trimEnd();
  const err = String(result.stderr ?? "").trimEnd();
  if (out) parts.push(out);
  if (err) parts.push(parts.length ? `--- stderr ---\n${err}` : err);
  let text = parts.join("\n");
  text = redact(text);
  if (text.length > maxLen) {
    text = `${text.slice(0, Math.max(1, maxLen - 1))}…`;
  }
  return text;
}

/** Map try-run result to an activity outcome (honest). */
export function hooksTryRunActivityOutcome(
  result: HooksTryRunLike,
): HookActivityOutcome {
  if (result.refused) return "skip";
  if (result.timedOut) return "fail";
  if (result.ok) return "ok";
  return "fail";
}

/** Machine stdin validation error → short code for i18n mapping. */
export function hooksTryStdinErrorCode(
  result: ValidateTryStdinResult,
): "empty" | "too_large" | "invalid_json" | null {
  if (result.ok) return null;
  if (result.error.startsWith("too_large:")) return "too_large";
  if (result.error.startsWith("invalid_json:")) return "invalid_json";
  return "invalid_json";
}
