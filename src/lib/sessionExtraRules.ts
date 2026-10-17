/**
 * Per-session extra rules — pure sanitize + spawn-arg helpers.
 *
 * CLI: top-level `grok --rules <RULES> agent … stdio`
 * (same placement class as `--json-schema` / `--sandbox`; not under `agent`).
 * Appends extra rules to the agent system prompt for this process only.
 */

/** Soft cap so spawn argv / session index stay bounded (~32 KiB). */
export const SESSION_EXTRA_RULES_MAX_CHARS = 32 * 1024;

/**
 * Trim, strip NUL bytes, and clamp session extra rules text.
 * Empty / whitespace-only → `""` (caller treats as clear).
 * NULs are stripped so the value cannot break argv / TOML / log lines
 * (same policy as system-prompt override).
 */
export function sanitizeExtraRules(
  raw: string | null | undefined,
  maxLen: number = SESSION_EXTRA_RULES_MAX_CHARS,
): string {
  if (typeof raw !== "string") return "";
  // Strip NULs so the value cannot break argv / TOML / log lines.
  const cleaned = raw.replace(/\0/g, "");
  const t = cleaned.trim();
  if (!t) return "";
  const cap = maxLen > 0 ? maxLen : 0;
  if (cap <= 0) return "";
  if (t.length <= cap) return t;
  return t.slice(0, cap);
}

/**
 * Safe log label — never emit the full rules body (may contain secrets / PII).
 * Returns `null` when empty, otherwise `{ chars: N }`.
 */
export function extraRulesLogMeta(
  raw: string | null | undefined,
): { chars: number } | null {
  const s = sanitizeExtraRules(raw);
  if (!s) return null;
  return { chars: s.length };
}

/**
 * Top-level CLI args for session extra rules (before `agent`):
 * `["--rules", text]`. Empty when none.
 */
export function extraRulesSpawnArgs(
  rules: string | null | undefined,
): string[] {
  const s = sanitizeExtraRules(rules);
  if (!s) return [];
  return ["--rules", s];
}

/** True when stored rules text is present after sanitize. */
export function hasExtraRules(raw: string | null | undefined): boolean {
  return sanitizeExtraRules(raw).length > 0;
}
