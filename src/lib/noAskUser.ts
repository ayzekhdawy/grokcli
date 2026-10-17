/**
 * CLI `--no-ask-user` (top-level, CLI ≥ 0.2.117) — pure resolve + spawn helpers.
 *
 * When effective true, spawn passes `["--no-ask-user"]` so the agent does not
 * emit `ask_user_question` questionnaires for that process.
 * Session override (`boolean`) wins over global Settings; `null`/`undefined` inherits.
 */

/**
 * Session override when `boolean`; else global. Non-booleans treated as inherit.
 */
export function resolveNoAskUser(
  session: boolean | null | undefined,
  global: boolean | null | undefined,
): boolean {
  if (typeof session === "boolean") return session;
  return !!global;
}

/**
 * Top-level CLI args for no-ask-user (before `agent`):
 * `["--no-ask-user"]` when enabled; empty otherwise.
 */
export function noAskUserSpawnArgs(enabled: boolean | null | undefined): string[] {
  return enabled ? ["--no-ask-user"] : [];
}

/** True when a session-level override is present (not inherit). */
export function hasSessionNoAskUser(
  raw: boolean | null | undefined,
): boolean {
  return typeof raw === "boolean";
}
