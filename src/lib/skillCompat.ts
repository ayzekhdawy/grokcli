/**
 * Claude / Cursor compat skill discovery — pure helpers.
 *
 * Grok Build can load skills from `~/.claude` and `~/.cursor` unless
 * `[compat.claude] skills` / `[compat.cursor] skills` are false. The App
 * Settings list must follow that, plus an optional App overlay.
 */

export type CompatSkillKind = "claude" | "cursor";

export type SkillCompatLike = {
  source?: string | null;
  path?: string | null;
};

export type SkillDiscoverFlags = {
  /** App overlay (`extensions.json`). Missing / true → do not hide extra. */
  appPref?: boolean | null;
  /** `[compat.claude] skills` from the active GROK_HOME config.toml. */
  claudeSkills?: boolean | null;
  /** `[compat.cursor] skills` from the active GROK_HOME config.toml. */
  cursorSkills?: boolean | null;
};

function normalizeFsPath(path: string | null | undefined): string {
  return (path ?? "").trim().replace(/\\/g, "/").toLowerCase();
}

function normalizeSource(source: string | null | undefined): string {
  return (source ?? "").trim().toLowerCase();
}

/** True when source/path looks like a Claude Code compat skill. */
export function isClaudeCompatSkill(skill: SkillCompatLike): boolean {
  const source = normalizeSource(skill.source);
  if (source === "claude" || source.startsWith("claude")) return true;
  const path = normalizeFsPath(skill.path);
  if (!path) return false;
  return (
    path.includes("/.claude/skills/") ||
    path.includes("/.claude/commands/") ||
    path.endsWith("/.claude/skills") ||
    path.endsWith("/.claude/commands")
  );
}

/** True when source/path looks like a Cursor compat skill. */
export function isCursorCompatSkill(skill: SkillCompatLike): boolean {
  const source = normalizeSource(skill.source);
  if (source === "cursor" || source.startsWith("cursor")) return true;
  const path = normalizeFsPath(skill.path);
  if (!path) return false;
  return (
    path.includes("/.cursor/skills/") ||
    path.includes("/.cursor/commands/") ||
    path.endsWith("/.cursor/skills") ||
    path.endsWith("/.cursor/commands")
  );
}

export function compatSkillKind(
  skill: SkillCompatLike,
): CompatSkillKind | null {
  if (isClaudeCompatSkill(skill)) return "claude";
  if (isCursorCompatSkill(skill)) return "cursor";
  return null;
}

export function isCompatExternalSkill(skill: SkillCompatLike): boolean {
  return compatSkillKind(skill) != null;
}

export function allowClaudeDiscover(flags: SkillDiscoverFlags): boolean {
  return flags.appPref !== false && flags.claudeSkills !== false;
}

export function allowCursorDiscover(flags: SkillDiscoverFlags): boolean {
  return flags.appPref !== false && flags.cursorSkills !== false;
}

/** Both vendors allowed — catalog discovery is live. */
export function effectiveDiscoverExternal(flags: SkillDiscoverFlags): boolean {
  return allowClaudeDiscover(flags) && allowCursorDiscover(flags);
}

/**
 * Optimistic App-overlay flip. Keeps config.toml vendor flags and recomputes
 * `effective` so the honesty line does not flicker.
 */
export function withDiscoverAppPref<T extends SkillDiscoverFlags>(
  flags: T,
  appPref: boolean,
): T & { appPref: boolean; effective: boolean } {
  const next = { ...flags, appPref };
  return { ...next, effective: effectiveDiscoverExternal(next) };
}

export function shouldIncludeDiscoveredSkill(
  skill: SkillCompatLike,
  flags: SkillDiscoverFlags,
): boolean {
  const kind = compatSkillKind(skill);
  if (kind === "claude") return allowClaudeDiscover(flags);
  if (kind === "cursor") return allowCursorDiscover(flags);
  return true;
}

export function filterDiscoveredSkills<T extends SkillCompatLike>(
  skills: readonly T[],
  flags: SkillDiscoverFlags,
): T[] {
  return skills.filter((s) => shouldIncludeDiscoveredSkill(s, flags));
}

export function countHiddenCompatSkills(
  skills: readonly SkillCompatLike[],
  flags: SkillDiscoverFlags,
): number {
  return skills.reduce(
    (n, s) => n + (shouldIncludeDiscoveredSkill(s, flags) ? 0 : 1),
    0,
  );
}
