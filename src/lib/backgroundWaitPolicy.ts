/**
 * Headless background-wait policy → CLI flags (Grok Build 0.2.117+).
 *
 * After the first agent turn ends, headless `grok -p` can wait for pending
 * background bash/monitor tasks and background subagents.
 *
 * | Policy   | Spawn flags                                      |
 * |----------|--------------------------------------------------|
 * | wait     | (default — omit; CLI waits up to its timeout)    |
 * | no_wait  | `--no-wait-for-background`                       |
 * | timeout  | `--background-wait-timeout <secs>` (1–3600)      |
 *
 * Flags are top-level and headless-only in effect. Older CLIs reject them —
 * Host soft-fails (version-gate / omit) so ACP spawn still works.
 */

export type BackgroundWaitPolicy = "wait" | "no_wait" | "timeout";

export const BACKGROUND_WAIT_POLICIES = [
  "wait",
  "no_wait",
  "timeout",
] as const satisfies readonly BackgroundWaitPolicy[];

export const DEFAULT_BACKGROUND_WAIT_POLICY: BackgroundWaitPolicy = "wait";

/** CLI default when waiting without an explicit timeout flag. */
export const DEFAULT_BACKGROUND_WAIT_TIMEOUT_SEC = 600;

export const MIN_BACKGROUND_WAIT_TIMEOUT_SEC = 1;
export const MAX_BACKGROUND_WAIT_TIMEOUT_SEC = 3600;

/** First CLI that documents/accepts the background-wait flags. */
export const BACKGROUND_WAIT_MIN_CLI = "0.2.117";

/**
 * Normalize a stored / form policy string.
 * Unknown / empty → `wait` (CLI default).
 */
export function normalizeBackgroundWaitPolicy(
  raw: unknown,
): BackgroundWaitPolicy {
  if (raw == null) return DEFAULT_BACKGROUND_WAIT_POLICY;
  const s = String(raw).trim().toLowerCase().replace(/-/g, "_");
  if (s === "wait" || s === "default" || s === "") {
    return "wait";
  }
  if (
    s === "no_wait" ||
    s === "nowait" ||
    s === "no_wait_for_background" ||
    s === "false"
  ) {
    return "no_wait";
  }
  if (s === "timeout" || s === "timed" || s === "secs" || s === "seconds") {
    return "timeout";
  }
  return DEFAULT_BACKGROUND_WAIT_POLICY;
}

/**
 * Clamp timeout seconds for `--background-wait-timeout`.
 * Invalid / non-finite → default 600. Always returns 1–3600.
 */
export function normalizeBackgroundWaitTimeoutSec(raw: unknown): number {
  if (raw == null || raw === "") return DEFAULT_BACKGROUND_WAIT_TIMEOUT_SEC;
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw.trim())
        : NaN;
  if (!Number.isFinite(n)) return DEFAULT_BACKGROUND_WAIT_TIMEOUT_SEC;
  const rounded = Math.round(n);
  return Math.min(
    MAX_BACKGROUND_WAIT_TIMEOUT_SEC,
    Math.max(MIN_BACKGROUND_WAIT_TIMEOUT_SEC, rounded),
  );
}

/**
 * Top-level CLI argv fragments for the resolved policy.
 * Empty for `wait` (CLI default).
 */
export function backgroundWaitSpawnArgs(
  policy: unknown,
  timeoutSec?: unknown,
): string[] {
  const p = normalizeBackgroundWaitPolicy(policy);
  if (p === "no_wait") {
    return ["--no-wait-for-background"];
  }
  if (p === "timeout") {
    const secs = normalizeBackgroundWaitTimeoutSec(timeoutSec);
    return ["--background-wait-timeout", String(secs)];
  }
  return [];
}

/** True when spawn would emit non-default flags. */
export function backgroundWaitNeedsFlags(policy: unknown): boolean {
  return normalizeBackgroundWaitPolicy(policy) !== "wait";
}

/**
 * Whether two policy+timeout pairs are equivalent after normalize
 * (used for soft-respawn flip detection).
 */
export function backgroundWaitSettingsEqual(
  a: { policy?: unknown; timeoutSec?: unknown },
  b: { policy?: unknown; timeoutSec?: unknown },
): boolean {
  const pa = normalizeBackgroundWaitPolicy(a.policy);
  const pb = normalizeBackgroundWaitPolicy(b.policy);
  if (pa !== pb) return false;
  if (pa !== "timeout") return true;
  return (
    normalizeBackgroundWaitTimeoutSec(a.timeoutSec) ===
    normalizeBackgroundWaitTimeoutSec(b.timeoutSec)
  );
}

/**
 * Pure: does a CLI version string look new enough for bg-wait flags?
 * Unparseable → `null` (caller may fail-open or omit non-default flags).
 */
export function cliSupportsBackgroundWait(
  rawVersion: string | null | undefined,
): boolean | null {
  if (rawVersion == null) return null;
  const m = String(rawVersion)
    .trim()
    .match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (![major, minor, patch].every(Number.isFinite)) return null;
  const [rm, rn, rp] = BACKGROUND_WAIT_MIN_CLI.split(".").map(Number);
  if (major > rm!) return true;
  if (major < rm!) return false;
  if (minor > rn!) return true;
  if (minor < rn!) return false;
  return patch >= rp!;
}

/**
 * Soft-fail gate: only emit flags when the CLI is known to support them,
 * or when version is unknown and policy is default (empty).
 *
 * - Known ≥ 0.2.117 → emit policy flags
 * - Known < 0.2.117 → omit (soft-fail; settings still stored)
 * - Unknown version + non-default → omit (safer than AGENT_CRASHED)
 * - Unknown + wait → empty (no-op)
 */
export function backgroundWaitSpawnArgsSoft(
  policy: unknown,
  timeoutSec: unknown,
  rawCliVersion: string | null | undefined,
): string[] {
  const args = backgroundWaitSpawnArgs(policy, timeoutSec);
  if (args.length === 0) return args;
  const ok = cliSupportsBackgroundWait(rawCliVersion);
  if (ok === true) return args;
  return [];
}
