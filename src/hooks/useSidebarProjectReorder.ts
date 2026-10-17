/**
 * Pointer-based reorder for sidebar project folders (pin-group aware).
 *
 * All drag chrome (ghost, source fade, drop line) is pure DOM — no React
 * setState during the gesture. That avoids a one-frame blank row when
 * content-visibility / VirtualList re-paint on re-render.
 */
import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  reorderProjectInPinGroup,
  resolveProjectDropIndex,
  type PinableProject,
} from "@/lib/app/projectOrder";

const DRAG_THRESHOLD_PX = 4;

const DROP_BEFORE = "tree-project--drop-before";
const DROP_AFTER = "tree-project--drop-after";
const PROJECT_DRAGGING = "tree-project--dragging";
const ROW_DRAGGING = "tree-l2--dragging";
const SIDEBAR_REORDERING = "sidebar--project-reordering";

/** Targets that must not start a reorder (row actions, menus, etc.). */
function isReorderIgnoredTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (
    target.closest(
      ".tree-l2__actions, .tree-l2__select-all, .tree-icon-btn, a, input, textarea, select, [data-no-project-reorder]",
    )
  ) {
    return true;
  }
  return false;
}

function removeGhost(ghost: HTMLElement | null) {
  if (!ghost) return;
  try {
    ghost.remove();
  } catch {
    /* ignore */
  }
}

function clearDropClasses() {
  document
    .querySelectorAll(`.${DROP_BEFORE}, .${DROP_AFTER}`)
    .forEach((el) => {
      el.classList.remove(DROP_BEFORE, DROP_AFTER);
    });
}

function clearDraggingClasses() {
  document.querySelectorAll(`.${PROJECT_DRAGGING}`).forEach((el) => {
    el.classList.remove(PROJECT_DRAGGING);
  });
  document.querySelectorAll(`.${ROW_DRAGGING}`).forEach((el) => {
    el.classList.remove(ROW_DRAGGING);
  });
  document.querySelectorAll(`.${SIDEBAR_REORDERING}`).forEach((el) => {
    el.classList.remove(SIDEBAR_REORDERING);
  });
}

function setDropIndicator(
  list: readonly PinableProject[],
  fromIndex: number,
  dropIndex: number,
) {
  clearDropClasses();
  if (dropIndex === fromIndex) return;
  const targetId = list[dropIndex]?.id;
  if (!targetId) return;
  const header = document.querySelector<HTMLElement>(
    `[data-project-reorder-id="${CSS.escape(targetId)}"]`,
  );
  const block = header?.closest(".tree-project");
  if (!block) return;
  block.classList.add(fromIndex < dropIndex ? DROP_AFTER : DROP_BEFORE);
}

/**
 * Floating ghost: plain DOM row rebuilt from source text/icons — avoid
 * cloneNode of React-managed nodes (Tip wrappers can paint blank).
 */
function createProjectDragGhost(
  source: HTMLElement,
  clientX: number,
  clientY: number,
): { ghost: HTMLElement; offsetX: number; offsetY: number } {
  const rect = source.getBoundingClientRect();
  const offsetX = clientX - rect.left;
  const offsetY = clientY - rect.top;

  const ghost = document.createElement("div");
  ghost.className = "tree-l2 tree-l2--drag-ghost";
  ghost.setAttribute("aria-hidden", "true");

  // Prefer cloning structure but strip Tip/portal-sensitive bits by
  // rebuilding from visible text + folder icon markup.
  const icon = source.querySelector(".tree-l2__icon");
  const colorDot = source.querySelector(".tree-l2__color-dot");
  const name = source.querySelector(".tree-l2__name");
  const badge = source.querySelector(".project-row__badge");

  if (icon) ghost.appendChild(icon.cloneNode(true));
  if (colorDot) ghost.appendChild(colorDot.cloneNode(true));
  if (name) {
    const nameClone = name.cloneNode(true) as HTMLElement;
    // Tip may leave empty accessibility wrappers; force text content.
    if (!(nameClone.textContent || "").trim()) {
      nameClone.textContent =
        (name as HTMLElement).innerText ||
        (name as HTMLElement).textContent ||
        "";
    }
    ghost.appendChild(nameClone);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "tree-l2__name";
    fallback.textContent = (source.innerText || "").trim();
    ghost.appendChild(fallback);
  }
  if (badge) ghost.appendChild(badge.cloneNode(true));

  const cs = window.getComputedStyle(source);
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${Math.max(rect.width, 120)}px`,
    height: `${Math.max(rect.height, 32)}px`,
    margin: "0",
    zIndex: "10060",
    pointerEvents: "none",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: cs.gap || "8px",
    padding: cs.padding || "0 6px 0 8px",
    borderRadius: cs.borderRadius || "8px",
    fontSize: cs.fontSize || "13px",
    fontWeight: cs.fontWeight || "500",
    color: cs.color,
  });

  document.body.appendChild(ghost);
  return { ghost, offsetX, offsetY };
}

function moveGhost(
  ghost: HTMLElement,
  clientX: number,
  clientY: number,
  offsetX: number,
  offsetY: number,
) {
  ghost.style.left = `${clientX - offsetX}px`;
  ghost.style.top = `${clientY - offsetY}px`;
}

export type SidebarProjectReorderApi = {
  enabled: boolean;
  /**
   * True after a completed drag past threshold until the next click is
   * consumed — use to skip expand/collapse on the trailing click.
   */
  suppressNextClick: () => boolean;
  /** Bind to the project header row (`.tree-l2`). */
  bindRow: (projectId: string) => {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  };
};

export function useSidebarProjectReorder<T extends PinableProject>(opts: {
  projects: T[];
  enabled: boolean;
  onReorder: (next: T[]) => void;
}): SidebarProjectReorderApi {
  const { projects, enabled, onReorder } = opts;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const sessionRef = useRef<{
    id: string;
    fromIndex: number;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    dropIndex: number;
    captureEl: HTMLElement | null;
    ghost: HTMLElement | null;
    ghostOffsetX: number;
    ghostOffsetY: number;
  } | null>(null);

  const cleanupWindow = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);

  const endSession = useCallback((commit: boolean) => {
    const s = sessionRef.current;
    sessionRef.current = null;
    cleanupWindow.current?.();
    cleanupWindow.current = null;
    removeGhost(s?.ghost ?? null);
    clearDropClasses();
    clearDraggingClasses();
    if (s?.captureEl) {
      try {
        if (s.captureEl.hasPointerCapture?.(s.pointerId)) {
          s.captureEl.releasePointerCapture(s.pointerId);
        }
      } catch {
        /* ignore */
      }
    }
    if (!commit || !s?.active) return;
    suppressClickRef.current = true;
    const list = projectsRef.current;
    const from = list.findIndex((p) => p.id === s.id);
    if (from < 0) return;
    const next = reorderProjectInPinGroup(list, from, s.dropIndex);
    if (next !== list) onReorderRef.current(next);
  }, []);

  useEffect(() => () => endSession(false), [endSession]);

  const suppressNextClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  const startOnPointerDown = useCallback(
    (projectId: string, e: ReactPointerEvent<HTMLElement>) => {
      if (!enabledRef.current) return;
      if (e.button !== 0 && e.pointerType !== "touch") return;
      if (isReorderIgnoredTarget(e.target)) return;
      if (sessionRef.current) return;

      e.stopPropagation();

      const list = projectsRef.current;
      const fromIndex = list.findIndex((p) => p.id === projectId);
      if (fromIndex < 0) return;

      const el = e.currentTarget;
      const pointerId = e.pointerId;
      try {
        el.setPointerCapture?.(pointerId);
      } catch {
        /* older WebView */
      }

      // Arm content-visibility bypass immediately (before threshold),
      // so the first paint after press never flashes blank rows.
      el.closest(".sidebar")?.classList.add(SIDEBAR_REORDERING);

      sessionRef.current = {
        id: projectId,
        fromIndex,
        pointerId,
        startX: e.clientX,
        startY: e.clientY,
        active: false,
        dropIndex: fromIndex,
        captureEl: el,
        ghost: null,
        ghostOffsetX: 0,
        ghostOffsetY: 0,
      };

      const onMove = (ev: PointerEvent) => {
        const s = sessionRef.current;
        if (!s || ev.pointerId !== s.pointerId) return;
        const dx = ev.clientX - s.startX;
        const dy = ev.clientY - s.startY;
        if (!s.active) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          s.active = true;
          try {
            ev.preventDefault();
          } catch {
            /* ignore */
          }

          try {
            const built = createProjectDragGhost(el, ev.clientX, ev.clientY);
            s.ghost = built.ghost;
            s.ghostOffsetX = built.offsetX;
            s.ghostOffsetY = built.offsetY;
          } catch {
            s.ghost = null;
          }

          const block = el.closest(".tree-project");
          block?.classList.add(PROJECT_DRAGGING);
          el.classList.add(ROW_DRAGGING);
          // No React setState here — keeps VirtualList / Tip trees stable.
        } else {
          try {
            ev.preventDefault();
          } catch {
            /* ignore */
          }
          if (s.ghost) {
            moveGhost(
              s.ghost,
              ev.clientX,
              ev.clientY,
              s.ghostOffsetX,
              s.ghostOffsetY,
            );
          }
        }

        const blocks = document.querySelectorAll<HTMLElement>(
          "[data-project-reorder-id]",
        );
        const listNow = projectsRef.current;
        let hoverIndex = s.fromIndex;
        let placeAfter = false;
        for (let i = 0; i < blocks.length; i++) {
          const node = blocks[i]!;
          if (node.classList.contains("tree-l2--drag-ghost")) continue;
          const id = node.dataset.projectReorderId;
          if (!id) continue;
          const idx = listNow.findIndex((p) => p.id === id);
          if (idx < 0) continue;
          const block = node.closest(".tree-project") ?? node;
          const rect = block.getBoundingClientRect();
          if (ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
            hoverIndex = idx;
            placeAfter = ev.clientY > rect.top + rect.height / 2;
            break;
          }
          if (ev.clientY < rect.top) {
            hoverIndex = idx;
            placeAfter = false;
            break;
          }
          hoverIndex = idx;
          placeAfter = true;
        }

        const dest = resolveProjectDropIndex(
          listNow,
          s.fromIndex,
          hoverIndex,
          placeAfter,
        );
        if (dest !== s.dropIndex) {
          s.dropIndex = dest;
          setDropIndicator(listNow, s.fromIndex, dest);
        }
      };

      const onUp = (ev: PointerEvent) => {
        const s = sessionRef.current;
        if (!s || ev.pointerId !== s.pointerId) return;
        endSession(true);
      };

      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      cleanupWindow.current = () => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
    },
    [endSession],
  );

  const bindRow = useCallback(
    (projectId: string) => ({
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        startOnPointerDown(projectId, e);
      },
    }),
    [startOnPointerDown],
  );

  return {
    enabled,
    suppressNextClick,
    bindRow,
  };
}
