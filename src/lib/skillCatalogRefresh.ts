/**
 * Detect skill / plugin installs during a chat turn so the App can refresh
 * `skills_list` without restarting or opening a new session.
 *
 * Grok Build reloads skills when files change on disk (CLI slash menu), but the
 * App workbench catalog is snapshot-based (`skills_list` via `grok inspect`).
 * After conversation installs (create-skill, copy into ~/.grok/skills, plugin
 * install, …) we re-run that list so composer slash / + palette picks them up.
 */

import { normalizeSkillFsPath } from "@/lib/skillEditPath";

/** Tool fields we care about from Host `session://tool` (subset). */
export type SkillCatalogToolSignal = {
  title?: string | null;
  kind?: string | null;
  status?: string | null;
  path?: string | null;
  detail?: string | null;
};

/** Statuses that mean the tool finished successfully enough to re-inspect. */
const TERMINAL_OK = new Set(["completed", "complete", "success", "succeeded"]);

/**
 * Path segments / markers that indicate a skills or plugin tree write.
 * Deliberately broad (vendor compat dirs + plugin install roots).
 */
const SKILL_PATH_MARKERS = [
  "/.grok/skills/",
  "/.agents/skills/",
  "/.claude/skills/",
  "/.cursor/skills/",
  "/.grok/commands/",
  "/.agents/commands/",
  "/.claude/commands/",
  "/.cursor/commands/",
  "/.grok/bundled/skills/",
  "/installed-plugins/",
  "/.grok/plugins/",
  "/agent-home/skills/",
] as const;

/** Shell / title patterns for install flows without a clear SKILL.md path yet. */
const INSTALL_TEXT_RE =
  /\b(?:plugin\s+install|skills?\s+add|npx\s+skills|create-skill|\/create-skill|find-skills)\b/i;

/**
 * True when a normalized path looks like a skill/plugin catalog source path.
 * Pure string heuristics — no FS access.
 */
export function pathSuggestsSkillCatalogChange(
  path: string | null | undefined,
): boolean {
  const raw = (path ?? "").trim();
  if (!raw) return false;
  const norm = normalizeSkillFsPath(raw);
  if (!norm) return false;
  const lower = norm.toLowerCase();

  // Direct SKILL.md write (any depth under a skills tree or skill dir).
  if (lower.endsWith("/skill.md") || lower === "skill.md") {
    return true;
  }

  for (const marker of SKILL_PATH_MARKERS) {
    if (lower.includes(marker)) return true;
  }

  // Project skills root itself (dir create) when path ends at …/{.grok|.agents|…}/skills
  // or …/skills/<name> under a known config segment (already covered by markers above
  // when the path includes e.g. `/.grok/skills/foo`).
  return false;
}

/**
 * True when title/detail text looks like a skill or plugin install command.
 */
export function textSuggestsSkillCatalogChange(
  ...parts: Array<string | null | undefined>
): boolean {
  const hay = parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join("\n");
  if (!hay) return false;
  return INSTALL_TEXT_RE.test(hay);
}

/**
 * Whether a Host tool event should schedule a skills catalog reload.
 *
 * - Requires a terminal success status (avoid mid-write / failed installs).
 * - Matches path under skill/plugin trees or install-like title/detail text.
 */
export function toolEventSuggestsSkillCatalogChange(
  ev: SkillCatalogToolSignal,
): boolean {
  const status = (ev.status ?? "").trim().toLowerCase();
  if (!status || !TERMINAL_OK.has(status)) {
    return false;
  }

  if (pathSuggestsSkillCatalogChange(ev.path)) {
    return true;
  }

  if (textSuggestsSkillCatalogChange(ev.title, ev.detail, ev.kind)) {
    return true;
  }

  return false;
}

/**
 * Debounced reload scheduler — multi-file skill installs fire many tool events;
 * collapse them into one `skills_list` round-trip.
 */
export function createDebouncedSkillsReload(
  reload: () => void,
  delayMs = 900,
): {
  schedule: () => void;
  cancel: () => void;
  /** Test helper: pending timer? */
  isPending: () => boolean;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const delay = Math.max(0, delayMs);

  const cancel = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = () => {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      reload();
    }, delay);
  };

  return {
    schedule,
    cancel,
    isPending: () => timer != null,
  };
}
