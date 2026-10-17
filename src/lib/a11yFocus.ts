/**
 * Small focus helpers for dialogs / permission bars (T15).
 * No React dependency — unit-testable.
 */

const FOCUSABLE_SEL = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Visible, enabled focus targets inside `root`. */
export function listFocusable(root: ParentNode | null | undefined): HTMLElement[] {
  if (!root || typeof (root as Element).querySelectorAll !== "function") {
    return [];
  }
  const nodes = Array.from(
    (root as Element).querySelectorAll<HTMLElement>(FOCUSABLE_SEL),
  );
  return nodes.filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    // offsetParent null for display:none (except fixed); still allow fixed.
    const style =
      typeof window !== "undefined" ? window.getComputedStyle(el) : null;
    if (style && (style.visibility === "hidden" || style.display === "none")) {
      return false;
    }
    return true;
  });
}

/** Focus the first focusable control; returns it or null. */
export function focusFirst(
  root: ParentNode | null | undefined,
): HTMLElement | null {
  const list = listFocusable(root);
  const el = list[0] ?? null;
  el?.focus();
  return el;
}

/**
 * Keep Tab / Shift+Tab cycling inside `root` (basic focus trap).
 * Call from keydown when the dialog is open.
 */
export function trapTabKey(
  e: { key: string; shiftKey: boolean; preventDefault: () => void },
  root: ParentNode | null | undefined,
): void {
  if (e.key !== "Tab") return;
  const list = listFocusable(root);
  if (list.length === 0) {
    e.preventDefault();
    return;
  }
  const first = list[0]!;
  const last = list[list.length - 1]!;
  const active =
    typeof document !== "undefined"
      ? (document.activeElement as HTMLElement | null)
      : null;

  if (e.shiftKey) {
    if (!active || active === first || !rootContains(root, active)) {
      e.preventDefault();
      last.focus();
    }
  } else if (!active || active === last || !rootContains(root, active)) {
    e.preventDefault();
    first.focus();
  }
}

function rootContains(
  root: ParentNode | null | undefined,
  el: Node | null,
): boolean {
  if (!root || !el) return false;
  if (root === el) return true;
  return typeof (root as Node).contains === "function"
    ? (root as Node).contains(el)
    : false;
}

/** Prefer primary allow / solid button when focusing a permission bar. */
export function preferPermissionFocus(
  root: ParentNode | null | undefined,
): HTMLElement | null {
  if (!root || typeof (root as Element).querySelector !== "function") {
    return focusFirst(root);
  }
  const allow = (root as Element).querySelector<HTMLElement>(
    ".perm-bar__btn--allow, .perm-bar__btn--session, .btn--primary, .btn--solid",
  );
  if (allow && !allow.hasAttribute("disabled")) {
    allow.focus();
    return allow;
  }
  return focusFirst(root);
}

/**
 * True when the event target is an input surface where plain letter keys
 * should type (not trigger sidebar j/k or similar chrome shortcuts).
 */
export function isTypingTarget(el: EventTarget | null | undefined): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== "string") return false;
  const node = el as HTMLElement;
  const tag = node.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (node.isContentEditable) return true;
  // Nested editable (e.g. inside a contenteditable child).
  if (typeof node.closest === "function") {
    if (node.closest("input, textarea, select, [contenteditable='true']")) {
      return true;
    }
  }
  return false;
}

export type InstallDialogFocusOptions = {
  /** Escape closes / cancels. */
  onEscape?: () => void;
  /** Use capture-phase keydown (default true — wins over body handlers). */
  capture?: boolean;
  /**
   * Initial focus strategy after paint:
   * - `"first"` (default) — {@link focusFirst}
   * - `"none"` — caller focuses (e.g. confirm primary / prompt input)
   * - getter — focus that element when present, else first
   */
  initialFocus?: "first" | "none" | (() => HTMLElement | null | undefined);
  /** Restore previously focused element on cleanup (default true). */
  restoreFocus?: boolean;
};

/**
 * Wire a basic dialog focus lifecycle for an open panel:
 * remember previous focus → optional initial focus → Tab trap → Escape.
 *
 * Returns cleanup (remove listeners + restore focus). Call from `useEffect`
 * when the dialog is open.
 */
export function installDialogFocus(
  getRoot: () => ParentNode | null | undefined,
  opts: InstallDialogFocusOptions = {},
): () => void {
  const {
    onEscape,
    capture = true,
    initialFocus = "first",
    restoreFocus = true,
  } = opts;

  const prev =
    typeof document !== "undefined"
      ? (document.activeElement as HTMLElement | null)
      : null;

  let focusTimer: number | undefined;
  if (initialFocus !== "none" && typeof window !== "undefined") {
    focusTimer = window.setTimeout(() => {
      if (typeof initialFocus === "function") {
        const el = initialFocus();
        if (el && typeof el.focus === "function") {
          el.focus();
          return;
        }
      }
      focusFirst(getRoot());
    }, 0) as unknown as number;
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && onEscape) {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
      return;
    }
    trapTabKey(e, getRoot());
  };

  if (typeof document !== "undefined") {
    document.addEventListener("keydown", onKey, capture);
  }

  return () => {
    if (focusTimer != null && typeof window !== "undefined") {
      window.clearTimeout(focusTimer);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("keydown", onKey, capture);
    }
    if (restoreFocus && prev && typeof prev.focus === "function") {
      try {
        prev.focus();
      } catch {
        /* ignore */
      }
    }
  };
}

/**
 * Move selection among a linear list of focusable controls (settings nav,
 * radiogroup, etc.). Clamps at ends. Returns the focused element or null.
 */
export function focusRelative(
  list: readonly HTMLElement[],
  current: HTMLElement | null | undefined,
  dir: "next" | "prev",
): HTMLElement | null {
  if (list.length === 0) return null;
  const idx = current ? list.indexOf(current) : -1;
  let nextIdx: number;
  if (dir === "next") {
    nextIdx = idx < 0 ? 0 : Math.min(list.length - 1, idx + 1);
  } else {
    nextIdx = idx < 0 ? list.length - 1 : Math.max(0, idx - 1);
  }
  const el = list[nextIdx] ?? null;
  el?.focus();
  return el;
}

/**
 * Index helper for arrow-key nav in pure tests / components.
 * Same clamp semantics as {@link focusRelative}.
 */
export function nextIndex(
  length: number,
  current: number,
  dir: "next" | "prev",
): number {
  if (length <= 0) return -1;
  if (current < 0 || current >= length) {
    return dir === "next" ? 0 : length - 1;
  }
  if (dir === "next") return Math.min(length - 1, current + 1);
  return Math.max(0, current - 1);
}
