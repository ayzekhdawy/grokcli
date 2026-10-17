/**
 * Sidebar project order helpers.
 *
 * Rules:
 * - Pinned projects always form a block at the top.
 * - Unpinned projects cannot sit above any pinned project.
 * - Drag / move only reorders within the same pin group.
 * - Array order is the persisted user order (Host pin-partitions on load/save).
 */

export type PinableProject = {
  id: string;
  pinned?: boolean;
};

export type ProjectMoveDirection = "up" | "down";

/** True when the project is in the pinned block. */
export function isProjectPinned(
  p: { pinned?: boolean } | null | undefined,
): boolean {
  return !!p?.pinned;
}

/** Whether `list` is already pin-partitioned (no unpinned before a pinned). */
function isPinPartitioned(list: readonly PinableProject[]): boolean {
  let sawUnpinned = false;
  for (const p of list) {
    if (!isProjectPinned(p)) sawUnpinned = true;
    else if (sawUnpinned) return false;
  }
  return true;
}

/**
 * Stable pin partition: pinned first, then unpinned.
 * Relative order within each group is preserved.
 * Returns the same array ref when already partitioned.
 */
export function applyProjectPinPartition<T extends PinableProject>(
  list: T[],
): T[] {
  if (list.length < 2 || isPinPartitioned(list)) return list;
  const pinned: T[] = [];
  const unpinned: T[] = [];
  for (const p of list) {
    if (isProjectPinned(p)) pinned.push(p);
    else unpinned.push(p);
  }
  return [...pinned, ...unpinned];
}

/** Bounds of the pin group containing `index` as [start, end) in a partitioned list. */
export function projectPinGroupBounds(
  list: readonly PinableProject[],
  index: number,
): { start: number; end: number } | null {
  if (index < 0 || index >= list.length) return null;
  const pinned = isProjectPinned(list[index]);
  let start = 0;
  while (start < list.length && isProjectPinned(list[start]) !== pinned) {
    start += 1;
  }
  let end = start;
  while (end < list.length && isProjectPinned(list[end]) === pinned) {
    end += 1;
  }
  return { start, end };
}

/**
 * Rebuild list from explicit ids, then pin-partition.
 * Unknown ids skipped; missing projects appended in prior relative order.
 */
export function reorderProjectsByIds<T extends PinableProject>(
  list: T[],
  orderedIds: readonly string[],
): T[] {
  if (list.length === 0) return list;
  const byId = new Map(list.map((p) => [p.id, p] as const));
  const next: T[] = [];
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (seen.has(id)) continue;
    const p = byId.get(id);
    if (!p) continue;
    seen.add(id);
    next.push(p);
  }
  for (const p of list) {
    if (!seen.has(p.id)) next.push(p);
  }
  return applyProjectPinPartition(next);
}

/**
 * Move item at `fromIndex` to `toIndex` **within the same pin group**.
 * Indices outside the group are clamped. Returns same ref when no-op.
 */
export function reorderProjectInPinGroup<T extends PinableProject>(
  list: T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (list.length < 2) return list;
  if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex)) return list;
  const from = Math.max(0, Math.min(list.length - 1, Math.trunc(fromIndex)));
  const bounds = projectPinGroupBounds(list, from);
  if (!bounds || bounds.end - bounds.start < 2) return list;
  const to = Math.max(
    bounds.start,
    Math.min(bounds.end - 1, Math.trunc(toIndex)),
  );
  if (from === to) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * Move one step up/down within the pin group. Same ref when blocked at boundary.
 */
export function moveProjectInPinGroup<T extends PinableProject>(
  list: T[],
  id: string,
  direction: ProjectMoveDirection,
): T[] {
  if (list.length < 2) return list;
  const idx = list.findIndex((p) => p.id === id);
  if (idx < 0) return list;
  const target = direction === "up" ? idx - 1 : idx + 1;
  return reorderProjectInPinGroup(list, idx, target);
}

export function canMoveProjectInPinGroup(
  list: readonly PinableProject[],
  id: string,
  direction: ProjectMoveDirection,
): boolean {
  const idx = list.findIndex((p) => p.id === id);
  if (idx < 0) return false;
  const bounds = projectPinGroupBounds(list, idx);
  if (!bounds || bounds.end - bounds.start < 2) return false;
  if (direction === "up") return idx > bounds.start;
  return idx < bounds.end - 1;
}

/**
 * Map pointer hover over a project block to a destination index
 * (for `reorderProjectInPinGroup`), clamped to the dragged item's pin group.
 *
 * `placeAfter`: pointer is in the lower half of the hovered block.
 */
export function resolveProjectDropIndex(
  list: readonly PinableProject[],
  fromIndex: number,
  hoverIndex: number,
  placeAfter: boolean,
): number {
  const bounds = projectPinGroupBounds(list, fromIndex);
  if (!bounds) return fromIndex;
  if (hoverIndex < 0 || hoverIndex >= list.length) return fromIndex;

  // Force hover into the same pin group for clamp feedback.
  const hoverClamped = Math.max(
    bounds.start,
    Math.min(bounds.end - 1, hoverIndex),
  );

  let dest: number;
  if (fromIndex === hoverClamped) {
    dest = fromIndex;
  } else if (fromIndex < hoverClamped) {
    // Dragging down: land on hover if placing after, else just above hover.
    dest = placeAfter ? hoverClamped : Math.max(bounds.start, hoverClamped - 1);
  } else {
    // Dragging up: land on hover if placing before, else just below hover.
    dest = placeAfter ? Math.min(bounds.end - 1, hoverClamped + 1) : hoverClamped;
  }
  return Math.max(bounds.start, Math.min(bounds.end - 1, dest));
}
