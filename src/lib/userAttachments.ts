/**
 * User-message attachment strip layout helpers.
 *
 * Collapsed (default): show first N cards + a "+K" overflow chip.
 * Expanded: all cards, multi-row wrap allowed (no fan/cascade stack).
 */

/** Visible attachment cards before the +N chip when collapsed. */
export const USER_ATTACH_COLLAPSE_AT = 3;

export type UserAttachPartition<T> = {
  /** Cards to render (all when expanded or ≤ collapseAt). */
  visible: T[];
  /** Count behind the +N chip; 0 when fully shown. */
  overflow: number;
};

/**
 * Partition attachments for the user strip.
 * When `expanded` or length ≤ collapseAt, every item is visible and overflow is 0.
 */
export function partitionUserAttachments<T>(
  items: readonly T[],
  expanded: boolean,
  collapseAt: number = USER_ATTACH_COLLAPSE_AT,
): UserAttachPartition<T> {
  const list = items ?? [];
  const at = Math.max(0, collapseAt);
  if (expanded || list.length <= at) {
    return { visible: list.slice(), overflow: 0 };
  }
  return {
    visible: list.slice(0, at),
    overflow: list.length - at,
  };
}

/** Label for the overflow chip (`+3`). */
export function formatUserAttachOverflowLabel(overflow: number): string {
  const n = Math.max(0, Math.floor(overflow));
  return `+${n}`;
}
