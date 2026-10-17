/**
 * Two-pass / prefire compaction (CLI 0.2.117+ config) — pure normalize helpers.
 *
 * When enabled, Grok Build may prefire a hierarchical two-pass compact
 * (`two_pass_compaction_enabled` in agent-home config.toml; env
 * `GROK_TWO_PASS_COMPACTION`). No dedicated CLI flag.
 *
 * App default: **off** (opt-in). Independent mode writes the top-level config
 * key; spawn always sets the env so shared mode cannot re-enable via leftover
 * config. Soft-respawn after change so the next agent process reloads.
 */

/** Top-level config.toml key (CLI 0.2.117+). */
export const TWO_PASS_COMPACTION_CONFIG_KEY = "two_pass_compaction_enabled";

/** Process env that mirrors the config key. */
export const TWO_PASS_COMPACTION_ENV = "GROK_TWO_PASS_COMPACTION";

/** First CLI that understands the config / env surface. */
export const TWO_PASS_COMPACTION_MIN_CLI = "0.2.117";

/**
 * Normalize the enable toggle.
 * null / undefined → false (App + CLI-aligned opt-in default).
 */
export function normalizeTwoPassCompactionEnabled(
  raw: boolean | null | undefined,
): boolean {
  return raw === true;
}

/**
 * Env overrides applied to the agent process.
 * Always set so shared-mode ~/.grok config cannot silently re-enable.
 */
export function twoPassCompactionSpawnEnv(
  enabled: boolean | null | undefined,
): Record<typeof TWO_PASS_COMPACTION_ENV, string> {
  return {
    [TWO_PASS_COMPACTION_ENV]: normalizeTwoPassCompactionEnabled(enabled)
      ? "1"
      : "0",
  };
}

/**
 * Soft-gate: whether to emit the env override given a raw CLI version string.
 * - Known ≥ 0.2.117 → true
 * - Known older → false (omit; older builds ignore the env but avoid noise)
 * - Unknown / unparseable → null
 *
 * Pure parse of `x.y.z` tokens only (no host IO).
 */
export function cliSupportsTwoPassCompaction(
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
export function twoPassCompactionSpawnEnvSoft(
  enabled: boolean | null | undefined,
  rawCliVersion: string | null | undefined,
): Record<string, string> {
  const support = cliSupportsTwoPassCompaction(rawCliVersion);
  if (support === false) return {};
  return twoPassCompactionSpawnEnv(enabled);
}

/** True when two raw toggles normalize equal. */
export function twoPassCompactionEqual(
  a: boolean | null | undefined,
  b: boolean | null | undefined,
): boolean {
  return (
    normalizeTwoPassCompactionEnabled(a) ===
    normalizeTwoPassCompactionEnabled(b)
  );
}
