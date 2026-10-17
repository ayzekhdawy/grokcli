/**
 * Subagent worktree snapshot (CLI 0.2.117+ config) — pure normalize helpers.
 *
 * When enabled, Grok Build can snapshot / rehydrate isolated worktrees for
 * nested subagents (`subagent_worktree_snapshot_enabled` in agent-home
 * config.toml; env `GROK_SUBAGENT_WORKTREE_SNAPSHOT`). No dedicated CLI flag.
 *
 * App default: **off** (opt-in). Independent mode writes the top-level config
 * key; spawn always sets the env so shared mode cannot re-enable via leftover
 * config. Soft-respawn after change so the next agent process reloads.
 */

/** Top-level config.toml key (CLI 0.2.117+). */
export const SUBAGENT_WORKTREE_SNAPSHOT_CONFIG_KEY =
  "subagent_worktree_snapshot_enabled";

/** Process env that mirrors the config key. */
export const SUBAGENT_WORKTREE_SNAPSHOT_ENV = "GROK_SUBAGENT_WORKTREE_SNAPSHOT";

/** First CLI that understands the config / env surface. */
export const SUBAGENT_WORKTREE_SNAPSHOT_MIN_CLI = "0.2.117";

/**
 * Normalize the enable toggle.
 * null / undefined → false (App + CLI-aligned opt-in default).
 */
export function normalizeSubagentWorktreeSnapshotEnabled(
  raw: boolean | null | undefined,
): boolean {
  return raw === true;
}

/**
 * Env overrides applied to the agent process.
 * Always set so shared-mode ~/.grok config cannot silently re-enable.
 */
export function subagentWorktreeSnapshotSpawnEnv(
  enabled: boolean | null | undefined,
): Record<typeof SUBAGENT_WORKTREE_SNAPSHOT_ENV, string> {
  return {
    [SUBAGENT_WORKTREE_SNAPSHOT_ENV]: normalizeSubagentWorktreeSnapshotEnabled(
      enabled,
    )
      ? "1"
      : "0",
  };
}

/**
 * Soft-gate: whether to emit the env override given a raw CLI version string.
 * - Known ≥ 0.2.117 → true
 * - Known older → false (omit; older builds ignore the env but avoid noise)
 * - Unknown / unparseable → true when enabled is default-safe (we still emit
 *   for off=0 / on=1; host may choose to always emit)
 *
 * Pure parse of `x.y.z` tokens only (no host IO).
 */
export function cliSupportsSubagentWorktreeSnapshot(
  rawVersion: string | null | undefined,
): boolean | null {
  if (rawVersion == null) return null;
  const m = String(rawVersion).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3] ?? "0");
  if (![major, minor, patch].every((n) => Number.isFinite(n))) return null;
  if (major > 0) return true;
  if (major < 0) return false;
  if (minor > 2) return true;
  if (minor < 2) return false;
  return patch >= 117;
}

/**
 * Env map for spawn with soft-fail on known-old CLI.
 * Empty object when CLI is known older (omit override); otherwise full map.
 */
export function subagentWorktreeSnapshotSpawnEnvSoft(
  enabled: boolean | null | undefined,
  rawCliVersion: string | null | undefined,
): Record<string, string> {
  const support = cliSupportsSubagentWorktreeSnapshot(rawCliVersion);
  if (support === false) return {};
  return subagentWorktreeSnapshotSpawnEnv(enabled);
}

/** True when two raw toggles normalize equal. */
export function subagentWorktreeSnapshotEqual(
  a: boolean | null | undefined,
  b: boolean | null | undefined,
): boolean {
  return (
    normalizeSubagentWorktreeSnapshotEnabled(a) ===
    normalizeSubagentWorktreeSnapshotEnabled(b)
  );
}
