/**
 * Pure helpers for the optional Settings → Agent profile path.
 *
 * CLI: `grok agent --agent-profile <PATH> … stdio` (agent option, not top-level).
 * Empty / invalid values omit the flag (CLI default agent definition).
 */

/**
 * Normalize a settings / UI path for spawn.
 * Returns null when the flag should be omitted.
 *
 * Pure: does not check filesystem existence (user may set a path before creating
 * the file; spawn / CLI report missing files).
 */
export function normalizeAgentProfilePath(
  raw: string | null | undefined,
): string | null {
  const path = (raw ?? "").trim();
  if (!path) return null;
  // Reject control chars that could break argv / shell-adjacent paths.
  if (/[\0\r\n]/.test(path)) return null;
  return path;
}

/** Agent-option CLI args when a profile path is set: `["--agent-profile", path]`. */
export function agentProfileSpawnCliArgs(
  raw: string | null | undefined,
): string[] | null {
  const path = normalizeAgentProfilePath(raw);
  if (!path) return null;
  return ["--agent-profile", path];
}
