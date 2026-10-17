/**
 * Pure helpers for scaffolding a new user skill (folder + SKILL.md).
 *
 * Host `skill_create` enforces the same name rules and template; this module
 * is the shared client-side validator + unit-tested template.
 */

export const SKILL_NAME_MIN = 2;
export const SKILL_NAME_MAX = 64;

/** Max description length accepted for a scaffolded SKILL.md. */
export const SKILL_DESCRIPTION_MAX = 2000;

/**
 * Sanitize and validate a skill folder / slash-command name.
 *
 * Rules (aligned with Grok `/create-skill`):
 * - lowercase a-z, digits 0-9, hyphens only
 * - spaces / underscores normalized to hyphens
 * - must start and end with alphanumeric
 * - length 2–64 after sanitization
 * - reserved names (e.g. `bundled`) rejected
 *
 * Returns the cleaned name, or `null` when invalid / empty.
 */
export function sanitizeSkillFolderName(raw: string | null | undefined): string | null {
  let s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;

  // Normalize common separators, then drop other junk.
  s = s.replace(/[\s_]+/g, "-");
  s = s.replace(/[^a-z0-9-]/g, "");
  s = s.replace(/-+/g, "-");
  s = s.replace(/^-+|-+$/g, "");

  if (s.length < SKILL_NAME_MIN || s.length > SKILL_NAME_MAX) return null;
  // Single alnum is already rejected by min length; still require alnum ends.
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s)) return null;
  if (s === "bundled") return null;
  return s;
}

/**
 * Normalize optional description for frontmatter / body.
 * Trims, collapses internal runs of whitespace/newlines lightly, caps length.
 */
export function normalizeSkillDescription(
  raw: string | null | undefined,
): string {
  let d = (raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!d) return "";
  // Collapse excessive blank lines for the body copy; frontmatter uses one line.
  d = d.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  if (d.length > SKILL_DESCRIPTION_MAX) {
    d = d.slice(0, SKILL_DESCRIPTION_MAX).trimEnd();
  }
  return d;
}

/** One-line description suitable for YAML frontmatter (no bare newlines). */
export function skillDescriptionForFrontmatter(description: string): string {
  const d = normalizeSkillDescription(description);
  if (!d) {
    return "Describe what this skill does and when to use it (include trigger phrases).";
  }
  // Single line for simple frontmatter; escape double quotes.
  return d.replace(/\s*\n+\s*/g, " ").replace(/"/g, '\\"');
}

/**
 * Default SKILL.md content: YAML frontmatter (`name`, `description`) + body stub.
 * Pure — no I/O.
 */
export function defaultSkillMdContent(
  name: string,
  description?: string | null,
): string {
  const safeName = sanitizeSkillFolderName(name) ?? name.trim().toLowerCase();
  const descLine = skillDescriptionForFrontmatter(description ?? "");
  const bodyDesc =
    normalizeSkillDescription(description) ||
    "Describe the workflow this skill should automate.";

  const title = safeName
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return [
    "---",
    `name: ${safeName}`,
    `description: ${descLine}`,
    "---",
    "",
    `# ${title || safeName}`,
    "",
    bodyDesc,
    "",
    "## Steps",
    "",
    "1. Clarify the goal with the user if anything is ambiguous.",
    "2. Perform the task following the instructions above.",
    "3. Summarize what you did and any follow-ups.",
    "",
  ].join("\n");
}
