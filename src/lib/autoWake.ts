/**
 * Auto-wake (CLI `[features].auto_wake`) — pure normalize helpers.
 *
 * When enabled, Grok Build may inject a synthetic turn after background
 * work completes (bash / monitor / task completion, scheduled loops) so the
 * agent can react without a new user prompt. Behavior is entirely CLI-side.
 *
 * - Independent: write agent-home `auto_wake_enabled` + `[features].auto_wake`.
 * - Shared: spawn injects `GROK_CONFIG` `{"features":{"auto_wake":true}}`
 *   (allowlisted overlay — never rewrites `~/.grok`).
 * - App default: **off** (opt-in). Soft-respawn after change.
 */

/** Top-level config.toml key. */
export const AUTO_WAKE_CONFIG_KEY = "auto_wake_enabled";

/** `GROK_CONFIG` overlay used in shared session-data mode. */
export function autoWakeGrokConfigOverlay(
  enabled: boolean | null | undefined,
): { features: { auto_wake: boolean } } {
  return { features: { auto_wake: normalizeAutoWakeEnabled(enabled) } };
}

/**
 * Normalize the enable toggle.
 * null / undefined → false (App opt-in default; CLI default not documented).
 */
export function normalizeAutoWakeEnabled(
  raw: boolean | null | undefined,
): boolean {
  return raw === true;
}

/**
 * Config.toml assignment line for independent agent-home writes.
 * Example: `auto_wake_enabled = true`
 */
export function autoWakeConfigAssignment(
  enabled: boolean | null | undefined,
): string {
  return `${AUTO_WAKE_CONFIG_KEY} = ${normalizeAutoWakeEnabled(enabled)}`;
}

/** True when two raw toggles normalize equal (soft-respawn flip check). */
export function autoWakeEqual(
  a: boolean | null | undefined,
  b: boolean | null | undefined,
): boolean {
  return normalizeAutoWakeEnabled(a) === normalizeAutoWakeEnabled(b);
}
