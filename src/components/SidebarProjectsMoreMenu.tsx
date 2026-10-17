/**
 * L1 overflow for select / archive-older / add-project (and clear-unread).
 * Collapse-all stays a dedicated outer action.
 */
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  IconArchive,
  IconCheck,
  IconListCheck,
  IconMore,
  IconPlus,
} from "@/components/icons";
import { useFloatingMenu } from "@/lib/floatingMenu";

export type SidebarProjectsMoreKind =
  | "select"
  | "clearUnread"
  | "archiveOlder"
  | "addProject";

export type SidebarProjectsMoreItem = {
  id: SidebarProjectsMoreKind;
  label: string;
  onClick: (anchor: { x: number; y: number }) => void;
};

const ICONS: Record<SidebarProjectsMoreKind, ReactNode> = {
  select: <IconListCheck size={15} />,
  clearUnread: <IconCheck size={15} />,
  archiveOlder: <IconArchive size={15} />,
  addProject: <IconPlus size={15} />,
};

type Props = {
  label: string;
  items: readonly SidebarProjectsMoreItem[];
};

export function SidebarProjectsMoreMenu({ label, items }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const { pos, style } = useFloatingMenu({
    open,
    triggerRef,
    panelRef: popRef,
    roots: [rootRef],
    onClose: () => setOpen(false),
    placement: "down",
    align: "end",
    fitContent: true,
    minWidth: 180,
    estHeight: 12 + items.length * 32,
    gap: 4,
    deps: [items.length, open],
  });

  if (items.length === 0) return null;

  const closeAnd = (item: SidebarProjectsMoreItem) => {
    const rect = triggerRef.current?.getBoundingClientRect();
    setOpen(false);
    item.onClick({
      x: rect ? Math.round(rect.left) : 0,
      y: rect ? Math.round(rect.bottom + 4) : 0,
    });
  };

  return (
    <div ref={rootRef} className={"tree-l1-more" + (open ? " is-open" : "")}>
      <button
        ref={triggerRef}
        type="button"
        className="tree-l1__action"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <IconMore size={15} />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={popRef}
              className="menu-panel context-menu tree-l1-more__menu"
              role="menu"
              style={style}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className="context-menu__item att-menu__item"
                  onClick={() => closeAnd(item)}
                >
                  <span className="context-menu__ico att-menu__ico" aria-hidden>
                    {ICONS[item.id]}
                  </span>
                  <span className="context-menu__label">{item.label}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
