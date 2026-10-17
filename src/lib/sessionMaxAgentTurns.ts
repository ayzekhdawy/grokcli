/**
 * Per-session max agent turns — pure normalize + resolve helpers.
 *
 * CLI: top-level `grok --max-turns N agent … stdio`
 * Session override (1–200) wins over global Settings; 0 / empty / null = inherit.
 */

export const MIN_AGENT_TURNS = 1;
export const MAX_AGENT_TURNS_CAP = 200;

/**
 * Normalize a max-turns value.
 * null / undefined / "" / 0 / non-finite / ≤0 → `null` (inherit).
 * Otherwise clamp to 1–200 (same as global Settings).
 */
export function normalizeMaxAgentTurns(
  raw: number | string | null | undefined,
): number | null {
  if (raw === null || raw === undefined) return null;
  const n =
    typeof raw === "string"
      ? (() => {
          const t = raw.trim();
          if (!t) return NaN;
          return Number(t);
        })()
      : raw;
  if (!Number.isFinite(n) || n <= 0) return null;
  const rounded = Math.round(n);
  if (rounded <= 0) return null;
  return Math.min(MAX_AGENT_TURNS_CAP, Math.max(MIN_AGENT_TURNS, rounded));
}

/**
 * Session override if set; else global. Both normalized (0/empty → inherit).
 */
export function resolveMaxAgentTurns(
  session: number | string | null | undefined,
  global: number | string | null | undefined,
): number | null {
  const s = normalizeMaxAgentTurns(session);
  if (s != null) return s;
  return normalizeMaxAgentTurns(global);
}

/**
 * Top-level CLI args for max turns (before `agent`):
 * `["--max-turns", "N"]`. Empty when none (inherit / unlimited).
 */
export function maxAgentTurnsSpawnArgs(
  raw: number | string | null | undefined,
): string[] {
  const n = normalizeMaxAgentTurns(raw);
  if (n == null) return [];
  return ["--max-turns", String(n)];
}

/** True when a session-level override is present after normalize. */
export function hasSessionMaxAgentTurns(
  raw: number | string | null | undefined,
): boolean {
  return normalizeMaxAgentTurns(raw) != null;
}
