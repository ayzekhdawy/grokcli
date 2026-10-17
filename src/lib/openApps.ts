/**
 * Open-location menu helpers: which apps to show for a given workspace.
 */

/** Git desktop GUIs — only meaningful inside a git work tree. */
export const GIT_GUI_EDITOR_IDS = new Set([
  "fork",
  "sourcetree",
  "github-desktop",
]);

export function isGitGuiEditorId(id: string | null | undefined): boolean {
  const t = (id || "").trim().toLowerCase();
  return GIT_GUI_EDITOR_IDS.has(t);
}

/**
 * Drop git GUI entries when the current path is not a git work tree.
 * Editors / terminals / system targets are unchanged.
 */
export function filterEditorsForGitContext<T extends { id: string }>(
  editors: T[],
  isGitRepo: boolean,
): T[] {
  if (isGitRepo) return editors;
  return editors.filter((e) => !isGitGuiEditorId(e.id));
}

/**
 * Best-effort directory to probe for git (files → parent).
 * Does not call the host — pure path math.
 */
export function dirForGitProbe(path: string | null | undefined): string | null {
  const p = (path || "").trim().replace(/[/\\]+$/, "");
  if (!p) return null;
  // Windows drive root `C:` / `C:\`
  if (/^[A-Za-z]:$/i.test(p) || /^[A-Za-z]:[/\\]$/i.test(p + "\\")) {
    return p.length === 2 ? `${p}\\` : p;
  }
  // Unix root
  if (p === "/") return "/";
  // Heuristic: if last segment has a typical file extension, use parent.
  // Also handles no-extension files poorly — callers may pass project roots
  // (dirs) directly, which is the common open-location case.
  const base = p.split(/[/\\]/).pop() || "";
  if (base.includes(".") && !base.startsWith(".")) {
    const parent = p.replace(/[/\\][^/\\]+$/, "");
    return parent || p;
  }
  return p;
}
