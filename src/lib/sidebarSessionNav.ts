/**
 * Pure helpers for j/k keyboard navigation across the sidebar session list.
 *
 * App builds an ordered id list that matches visual order (expanded projects
 * → date groups → orphans) and uses {@link nextSessionId} for the target.
 * Keys are only handled when focus is inside the sidebar and not in an
 * input / textarea / contenteditable (see App capture-phase keydown).
 */

export type SessionNavDir = "next" | "prev";

/**
 * Resolve the next/previous session id in an ordered list.
 *
 * - Empty list → `null`
 * - `current` missing / not in list → first (`next`) or last (`prev`)
 * - At ends → clamp (stay on first/last); caller may no-op if unchanged
 */
export function nextSessionId(
  list: readonly string[],
  current: string | null | undefined,
  dir: SessionNavDir,
): string | null {
  if (list.length === 0) return null;
  const idx =
    current == null || current === "" ? -1 : list.indexOf(current);
  if (dir === "next") {
    if (idx < 0) return list[0] ?? null;
    if (idx >= list.length - 1) return list[list.length - 1] ?? null;
    return list[idx + 1] ?? null;
  }
  // prev
  if (idx < 0) return list[list.length - 1] ?? null;
  if (idx <= 0) return list[0] ?? null;
  return list[idx - 1] ?? null;
}
