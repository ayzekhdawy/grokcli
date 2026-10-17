/**
 * Unified right-click / context menu (chat att-menu visual baseline).
 *
 * Solid surface, compact padding, optional leading icon, optional flyout submenus.
 * Always portaled to document.body; closes on outside mousedown + Escape.
 *
 * Usage:
 *   <ContextMenu
 *     open={!!menu}
 *     x={menu.x}
 *     y={menu.y}
 *     onClose={() => setMenu(null)}
 *     items={[
 *       { label: "…", icon: <Icon… />, onClick: () => { … } },
 *       { label: "Export", children: [{ label: "PNG", onClick: () => { … } }] },
 *     ]}
 *   />
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { IconChevronRight } from "@/components/icons";

export type ContextMenuItem = {
  id?: string;
  label?: ReactNode;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** Horizontal rule between groups (no label / action). */
  separator?: boolean;
  /** Leaf action. Optional when `children` is set (submenu parent). */
  onClick?: () => void;
  /** Flyout submenu items. When set, row acts as a parent (no close on click). */
  children?: ContextMenuItem[];
};

export type ContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  /** Extra rows after items (legacy ImageUi/VideoUi slot). */
  extra?: ReactNode;
  className?: string;
  /** Used to clamp position near viewport edges. */
  estimatedWidth?: number;
  estimatedHeight?: number;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Clamp menu anchor so the panel stays in viewport. */
export function clampContextMenuPos(
  x: number,
  y: number,
  width = 200,
  height = 220,
  viewport?: { width: number; height: number },
): { left: number; top: number } {
  const vw =
    viewport?.width ??
    (typeof window !== "undefined" ? window.innerWidth : 1024);
  const vh =
    viewport?.height ??
    (typeof window !== "undefined" ? window.innerHeight : 768);
  const margin = 8;
  const maxW = Math.max(1, vw - margin * 2);
  const maxH = Math.max(1, Math.min(height, vh - margin * 2));
  const w = Math.min(width, maxW);
  return {
    left: Math.max(margin, Math.min(x, vw - w - margin)),
    top: Math.max(margin, Math.min(y, vh - maxH - margin)),
  };
}

const FLYOUT_GAP = 4;
/** Positioning estimate only — real width comes from content (max-content). */
const FLYOUT_EST_W = 160;
const FLYOUT_EST_H = 200;

function computeFlyoutStyle(
  anchor: DOMRect,
  panelW: number,
  panelH: number,
): CSSProperties {
  const vw =
    typeof window.innerWidth === "number" ? window.innerWidth : 1024;
  const vh =
    typeof window.innerHeight === "number" ? window.innerHeight : 768;
  const margin = 8;

  let left = anchor.right + FLYOUT_GAP;
  if (left + panelW > vw - margin) {
    left = anchor.left - panelW - FLYOUT_GAP;
  }
  left = Math.max(margin, Math.min(left, vw - panelW - margin));

  let top = anchor.top;
  if (top + panelH > vh - margin) {
    top = vh - panelH - margin;
  }
  top = Math.max(margin, top);

  return {
    position: "fixed",
    left,
    top,
    width: "max-content",
    minWidth: 0,
    zIndex: 13001,
  };
}

function ContextMenuFlyout({
  items,
  anchorEl,
  onClose,
  onItemClick,
  onMouseEnter,
  onMouseLeave,
}: {
  items: ContextMenuItem[];
  anchorEl: HTMLElement;
  onClose: () => void;
  onItemClick: (item: ContextMenuItem) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>(() => {
    const rect = anchorEl.getBoundingClientRect();
    return computeFlyoutStyle(rect, FLYOUT_EST_W, FLYOUT_EST_H);
  });

  const updatePos = useCallback(() => {
    if (!flyoutRef.current) return;
    const rect = anchorEl.getBoundingClientRect();
    const fr = flyoutRef.current.getBoundingClientRect();
    setStyle(
      computeFlyoutStyle(
        rect,
        Math.ceil(fr.width) || FLYOUT_EST_W,
        Math.ceil(fr.height) || FLYOUT_EST_H,
      ),
    );
  }, [anchorEl]);

  useLayoutEffect(() => {
    updatePos();
  }, [updatePos, items.length]);

  useEffect(() => {
    window.addEventListener("resize", updatePos);
    return () => window.removeEventListener("resize", updatePos);
  }, [updatePos]);

  const visible = items.filter(Boolean);

  return createPortal(
    <div
      ref={flyoutRef}
      className="menu-panel context-menu context-menu--flyout att-menu"
      style={style}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {visible.map((item, i) => (
        <button
          key={item.id ?? `ctx-flyout-${i}`}
          type="button"
          className={cx(
            "context-menu__item",
            "att-menu__item",
            item.danger && "is-danger",
          )}
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            onItemClick(item);
            onClose();
          }}
        >
          {item.icon != null ? (
            <span className="context-menu__ico att-menu__ico" aria-hidden>
              {item.icon}
            </span>
          ) : null}
          <span className="context-menu__label">{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

export function ContextMenu({
  open,
  x,
  y,
  items,
  onClose,
  extra,
  className,
  estimatedWidth = 180,
  estimatedHeight = 240,
}: ContextMenuProps) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() =>
    clampContextMenuPos(x, y, estimatedWidth, estimatedHeight),
  );
  const [openSubId, setOpenSubId] = useState<string | null>(null);
  const [subAnchor, setSubAnchor] = useState<HTMLElement | null>(null);
  const closeSubTimer = useRef<number | null>(null);

  const clearCloseSubTimer = useCallback(() => {
    if (closeSubTimer.current != null) {
      window.clearTimeout(closeSubTimer.current);
      closeSubTimer.current = null;
    }
  }, []);

  const scheduleCloseSub = useCallback(() => {
    clearCloseSubTimer();
    closeSubTimer.current = window.setTimeout(() => {
      setOpenSubId(null);
      setSubAnchor(null);
    }, 180);
  }, [clearCloseSubTimer]);

  const openSub = useCallback(
    (id: string, el: HTMLElement) => {
      clearCloseSubTimer();
      setOpenSubId(id);
      setSubAnchor(el);
    },
    [clearCloseSubTimer],
  );

  useLayoutEffect(() => {
    if (!open) return;
    setPos(clampContextMenuPos(x, y, estimatedWidth, estimatedHeight));
    setOpenSubId(null);
    setSubAnchor(null);
  }, [open, x, y, estimatedWidth, estimatedHeight]);

  // After paint, re-clamp using real menu size if available.
  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    setPos(
      clampContextMenuPos(
        x,
        y,
        Math.ceil(rect.width) || estimatedWidth,
        Math.ceil(rect.height) || estimatedHeight,
      ),
    );
  }, [open, x, y, items.length, estimatedWidth, estimatedHeight]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".context-menu")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Defer so the opening contextmenu / click does not immediately dismiss.
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onDoc, true);
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setOpenSubId(null);
      setSubAnchor(null);
      clearCloseSubTimer();
    }
  }, [open, clearCloseSubTimer]);

  if (!open || typeof document === "undefined") return null;

  const visibleItems = items.filter(Boolean);
  const openSubItem =
    openSubId != null
      ? visibleItems.find(
          (it, i) => (it.id ?? `ctx-item-${i}`) === openSubId,
        )
      : null;
  const openSubChildren = openSubItem?.children?.filter(Boolean) ?? [];

  return createPortal(
    <>
      <div
        ref={rootRef}
        id={menuId}
        className={cx("menu-panel context-menu att-menu", className)}
        style={{ left: pos.left, top: pos.top }}
        role="menu"
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {visibleItems.map((item, i) => {
          const id = item.id ?? `ctx-item-${i}`;
          if (item.separator) {
            return (
              <div
                key={id}
                className="context-menu__sep open-loc-menu__sep"
                role="separator"
              />
            );
          }
          const hasChildren = (item.children?.length ?? 0) > 0;
          const isSubOpen = openSubId === id;

          if (hasChildren) {
            return (
              <button
                key={id}
                type="button"
                className={cx(
                  "context-menu__item",
                  "context-menu__item--submenu",
                  "att-menu__item",
                  isSubOpen && "is-open",
                  item.danger && "is-danger",
                )}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={isSubOpen}
                disabled={item.disabled}
                onClick={(e) => {
                  if (item.disabled) return;
                  if (isSubOpen) {
                    setOpenSubId(null);
                    setSubAnchor(null);
                  } else {
                    openSub(id, e.currentTarget);
                  }
                }}
                onMouseEnter={(e) => {
                  if (item.disabled) return;
                  openSub(id, e.currentTarget);
                }}
                onMouseLeave={scheduleCloseSub}
              >
                {item.icon != null ? (
                  <span className="context-menu__ico att-menu__ico" aria-hidden>
                    {item.icon}
                  </span>
                ) : null}
                <span className="context-menu__label">{item.label}</span>
                <IconChevronRight
                  size={14}
                  className="context-menu__sub-chev"
                  aria-hidden
                />
              </button>
            );
          }

          return (
            <button
              key={id}
              type="button"
              className={cx(
                "context-menu__item",
                "att-menu__item",
                item.danger && "is-danger",
              )}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                onClose();
                item.onClick?.();
              }}
              onMouseEnter={() => {
                // Close flyout when hovering a leaf sibling.
                if (openSubId != null) {
                  clearCloseSubTimer();
                  setOpenSubId(null);
                  setSubAnchor(null);
                }
              }}
            >
              {item.icon != null ? (
                <span className="context-menu__ico att-menu__ico" aria-hidden>
                  {item.icon}
                </span>
              ) : null}
              <span className="context-menu__label">{item.label}</span>
            </button>
          );
        })}
        {extra}
      </div>
      {openSubId && subAnchor && openSubChildren.length > 0 ? (
        <ContextMenuFlyout
          items={openSubChildren}
          anchorEl={subAnchor}
          onClose={onClose}
          onItemClick={(item) => {
            item.onClick?.();
          }}
          onMouseEnter={clearCloseSubTimer}
          onMouseLeave={scheduleCloseSub}
        />
      ) : null}
    </>,
    document.body,
  );
}
