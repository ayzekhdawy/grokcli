/**
 * Secret field display helpers — masked by default, optional reveal.
 *
 * Rules (remote-im.md §5.1 / §10):
 * - Default: password / mask — never show stored secret plaintext
 * - Show only reveals the **currently typed** form value
 * - Stored secrets: empty input + placeholder; never hydrate from vault into DOM
 */

import { maskSecretValue } from "./secretsApi";

export type SecretRevealState = Record<string, boolean>;

/** Whether a field should use secret chrome (password + show/hide). */
export function isSecretControl(opts: {
  secret?: boolean;
  control?: string;
}): boolean {
  return !!opts.secret || opts.control === "password";
}

/**
 * Input `type` for a secret field given reveal map.
 * Always "password" when not revealed — never default to text.
 */
export function secretInputType(
  fieldKey: string,
  revealed: SecretRevealState,
): "password" | "text" {
  return revealed[fieldKey] ? "text" : "password";
}

/** Toggle reveal for one field; defaults to false (masked). */
export function toggleSecretReveal(
  prev: SecretRevealState,
  fieldKey: string,
): SecretRevealState {
  return { ...prev, [fieldKey]: !prev[fieldKey] };
}

/**
 * Display value for a secret input:
 * - Always the typed form value only (may be empty)
 * - Never returns a stored vault secret
 */
export function secretFormValue(
  fieldKey: string,
  formSecrets: Record<string, string>,
): string {
  const v = formSecrets[fieldKey];
  return typeof v === "string" ? v : "";
}

/**
 * Placeholder when credentials already saved and form field empty.
 * UI should show mask placeholder, not the real secret.
 */
export function secretPlaceholderWhenStored(
  hasStoredCredentials: boolean,
  formValue: string,
  storedPlaceholder: string,
): string | undefined {
  if (hasStoredCredentials && !formValue.trim()) return storedPlaceholder;
  return undefined;
}

/**
 * Safe one-line summary for logs / doctor (last4 only).
 * Empty → empty; short → bullets; else ••••last4.
 */
export function secretSummaryForLog(value: string): string {
  return maskSecretValue(value);
}

/**
 * Whether show/hide toggle should be rendered.
 * Always for secret fields (even when empty) so users know masking is active.
 */
export function shouldShowSecretToggle(isSecret: boolean): boolean {
  return isSecret;
}

/**
 * Initial reveal map — all secret keys start masked (false / absent).
 */
export function initialSecretReveal(
  keys: readonly string[],
): SecretRevealState {
  const out: SecretRevealState = {};
  for (const k of keys) out[k] = false;
  return out;
}

/**
 * After save: clear typed secrets from form state and reset reveal to masked.
 * Prevents lingering plaintext in React state after successful put.
 */
export function clearTypedSecretsAfterSave(
  formSecrets: Record<string, string>,
  keysToClear?: readonly string[],
): Record<string, string> {
  if (!keysToClear) return {};
  const next = { ...formSecrets };
  for (const k of keysToClear) {
    delete next[k];
  }
  return next;
}
