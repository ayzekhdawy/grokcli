/**
 * Per-session system prompt override — pure sanitize + spawn-arg helpers.
 *
 * CLI: top-level `grok --system-prompt-override <PROMPT> agent … stdio`
 * (alias `--system-prompt`; same placement class as `--rules` / `--json-schema`).
 * Replaces the agent's default system prompt for this process only.
 */

/** Soft cap so spawn argv / session index stay bounded (~32 KiB). */
export const SESSION_SYSTEM_PROMPT_MAX_CHARS = 32 * 1024;

/**
 * Trim, strip NUL bytes, and clamp session system prompt override text.
 * Empty / whitespace-only → `""` (caller treats as clear).
 */
export function sanitizeSystemPromptOverride(
  raw: string | null | undefined,
  maxLen: number = SESSION_SYSTEM_PROMPT_MAX_CHARS,
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
 * Top-level CLI args for system prompt override (before `agent`):
 * `["--system-prompt-override", text]`. Empty when none.
 *
 * Prefer the long flag name (canonical); CLI also accepts `--system-prompt`.
 */
export function systemPromptOverrideSpawnArgs(
  prompt: string | null | undefined,
): string[] {
  const s = sanitizeSystemPromptOverride(prompt);
  if (!s) return [];
  return ["--system-prompt-override", s];
}

/** True when stored override text is present after sanitize. */
export function hasSystemPromptOverride(
  raw: string | null | undefined,
): boolean {
  return sanitizeSystemPromptOverride(raw).length > 0;
}

/**
 * Safe log label — never emit the full prompt (may contain secrets / PII).
 * Returns `null` when empty, otherwise `{ chars: N }`.
 */
export function systemPromptOverrideLogMeta(
  raw: string | null | undefined,
): { chars: number } | null {
  const s = sanitizeSystemPromptOverride(raw);
  if (!s) return null;
  return { chars: s.length };
}
