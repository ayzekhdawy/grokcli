/**
 * Layout preferences: sidebar width, aside width, aside collapsed default.
 * Durable key in localStorage (App config later).
 *
 * Right resource pane width is chrome-safe + content-aware:
 * - Never narrower than tabs + action icons (+ window min/max/close on Win)
 * - Soft-grow toward a preferred width for the active surface (preview kind,
 *   plan, diff, tree split); never auto-shrink below the user/current width
 *   except to enforce chrome min / viewport max.
 */

export const LAYOUT_STORAGE_KEY = "grok-app.layout";

/** Mirror phone CSS drawer breakpoint (`app.css` max-width: 820px). */
export const MIRROR_DRAWER_BREAKPOINT = 820;

export interface LayoutPrefs {
  sidebarWidth: number;
  asideWidth: number;
  /** Right pane defaults collapsed per §17.1 / autoplan Design D7. */
  asideCollapsed: boolean;
  /** Left project rail collapsed (Codex-style). */
  sidebarCollapsed: boolean;
}

/**
 * Self-drawn window controls (min / max / close) — 3 × 46px.
 * Matches `padding-right: 138px` in app.css for `.main__top` / `.rp-chrome`.
 */
export const WINDOW_CONTROLS_INSET = 138;

/**
 * Minimum width for tabs strip + chrome action cluster (open-loc, plan,
 * changes, tree, close) before any window-control inset.
 * ~100px tab name + ~160px actions + 20px chrome pad ≈ 280.
 */
export const ASIDE_CHROME_CONTENT_MIN = 280;

/**
 * Absolute floor for the right pane (Side Workbench min ≥ 400px per PLAN).
 * Still below chrome-safe when window controls are present — use
 * {@link asideChromeSafeMin} for the real floor.
 */
export const ASIDE_WIDTH_MIN = 400;

/**
 * Historical soft comfort width for the right pane. **Not a hard max** —
 * aside may grow with the window as long as chat keeps
 * {@link MAIN_CHAT_MIN_WIDTH}. Prefer {@link asideWidthMax} for the real cap.
 */
export const ASIDE_WIDTH_MAX = 720;

/**
 * Minimum width for the center chat column. Aside drag / auto-size must not
 * squeeze the conversation below this (composer + bubbles become unreadable).
 * Expanded side-overlay mode does not use this split (aside covers chat).
 */
export const MAIN_CHAT_MIN_WIDTH = 360;

/**
 * Leave at least this much for the main chat column when auto-sizing the aside.
 * Alias of {@link MAIN_CHAT_MIN_WIDTH} (kept for older call sites / docs).
 */
export const ASIDE_MAIN_RESERVE = MAIN_CHAT_MIN_WIDTH;

/**
 * Default open sidebar width — matches `.sidebar { width: 268px }` in app.css.
 * Used when clamping aside so chat keeps {@link MAIN_CHAT_MIN_WIDTH}.
 */
export const SIDEBAR_DEFAULT_WIDTH = 268;

/**
 * Narrowest *open* left rail (session titles + chrome still usable).
 * The rail never paints narrower than this — dragging past it collapses live.
 */
export const SIDEBAR_WIDTH_MIN = 200;

/** Widest left rail before chat / aside become cramped. */
export const SIDEBAR_WIDTH_MAX = 420;

/**
 * Desired width below this (during drag or on release) → auto-collapse.
 * Equal to open min so the rail never enters a crushed / deformed layout.
 * Reopen via the top-left icon uses {@link SIDEBAR_WIDTH_MIN}.
 */
export const SIDEBAR_COLLAPSE_THRESHOLD = SIDEBAR_WIDTH_MIN;

export type SidebarClampOpts = {
  /** `window.innerWidth` — caps max so chat (+ open aside) stay usable. */
  viewportWidth?: number;
  /** Horizontal space taken by the open right pane (0 when collapsed). */
  asideOccupiedWidth?: number;
};

/**
 * Clamp left-rail width to [min, max], optionally leaving room for chat + aside.
 */
export function clampSidebarWidth(
  w: number,
  opts?: SidebarClampOpts,
): number {
  if (!Number.isFinite(w)) return SIDEBAR_DEFAULT_WIDTH;
  let max = SIDEBAR_WIDTH_MAX;
  const vw = opts?.viewportWidth;
  if (typeof vw === "number" && Number.isFinite(vw) && vw > 0) {
    const aside = Math.max(0, opts?.asideOccupiedWidth ?? 0);
    const room = Math.floor(vw - MAIN_CHAT_MIN_WIDTH - aside);
    max = Math.min(max, Math.max(SIDEBAR_WIDTH_MIN, room));
  }
  return Math.min(max, Math.max(SIDEBAR_WIDTH_MIN, Math.round(w)));
}

/**
 * Live width while dragging — stays within open [min, max] only.
 * Callers should collapse as soon as the *desired* width is below
 * {@link SIDEBAR_COLLAPSE_THRESHOLD} (before applying this clamp).
 */
export function clampSidebarDragWidth(
  w: number,
  opts?: SidebarClampOpts,
): number {
  return clampSidebarWidth(w, opts);
}

export type SidebarDragEndResult =
  | { action: "collapse"; sidebarWidth: number }
  | { action: "open"; sidebarWidth: number };

/**
 * Resolve a drag sample (move or pointer-up).
 * - desired &lt; collapse threshold → close; store min for next open
 * - otherwise → clamp to open [min, max]
 */
export function resolveSidebarDragEnd(
  w: number,
  opts?: SidebarClampOpts,
): SidebarDragEndResult {
  const raw = Number.isFinite(w) ? Math.round(w) : SIDEBAR_DEFAULT_WIDTH;
  if (raw < SIDEBAR_COLLAPSE_THRESHOLD) {
    return { action: "collapse", sidebarWidth: SIDEBAR_WIDTH_MIN };
  }
  return { action: "open", sidebarWidth: clampSidebarWidth(raw, opts) };
}

export const DEFAULT_LAYOUT: LayoutPrefs = {
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  /** Comfortable default: tabs + actions + light preview. */
  asideWidth: 400,
  /** Right resource pane starts closed; open via top-bar files icon. */
  asideCollapsed: true,
  /** Left session rail starts open; can fully hide via top-bar panel icon. */
  sidebarCollapsed: false,
};

/** True when CSS phone drawer / phone chrome rules apply (≤ 820px). */
export function isPhoneViewport(width: number): boolean {
  return Number.isFinite(width) && width <= MIRROR_DRAWER_BREAKPOINT;
}

/**
 * Mirror client on a phone-width viewport — full phone chrome (drawer, sheets).
 * Desktop (≥ 821px) never enters this path.
 */
export function isMirrorPhoneLayout(opts: {
  isMirror: boolean;
  viewportWidth: number;
}): boolean {
  return opts.isMirror && isPhoneViewport(opts.viewportWidth);
}

/**
 * On mirror phone viewports the sidebar is a full-height drawer over chat.
 * Start collapsed so first paint shows the conversation; toggle still opens it.
 */
export function withMirrorPhoneDrawerDefault(
  layout: LayoutPrefs,
  opts: { isMirror: boolean; viewportWidth: number },
): LayoutPrefs {
  if (isMirrorPhoneLayout(opts)) {
    return { ...layout, sidebarCollapsed: true };
  }
  return layout;
}

export type AsideClampOpts = {
  /** Right inset reserved for min/max/close (Win / custom chrome). */
  windowControlsInset?: number;
  /** `window.innerWidth` — caps max so chat stays usable. */
  viewportWidth?: number;
  /**
   * Horizontal space already taken by the left sidebar (0 when collapsed).
   * Defaults to 0 so callers that omit it still reserve the chat min only.
   */
  sidebarOccupiedWidth?: number;
};

/**
 * Chrome-safe minimum: tabs + action icons must not collide with window
 * controls. Platform without custom chrome uses `windowControlsInset: 0`.
 * Not capped by a fixed aside max — only floor is {@link ASIDE_WIDTH_MIN}.
 */
export function asideChromeSafeMin(opts?: AsideClampOpts): number {
  const inset = Math.max(0, opts?.windowControlsInset ?? 0);
  // Extra 40px so an active tab label remains readable beside actions.
  const min = ASIDE_CHROME_CONTENT_MIN + inset + 40;
  return Math.max(ASIDE_WIDTH_MIN, Math.round(min));
}

/**
 * Upper bound for the right pane when chat is still visible beside it.
 * Only constraint: leave ≥ {@link MAIN_CHAT_MIN_WIDTH} for the center column
 * (plus open left sidebar). No fixed 720px (or similar) hard max.
 * When viewport is unknown, returns a large number so clamp only applies min.
 * Expanded side-overlay does not use this (aside is full free area).
 */
export function asideWidthMax(opts?: AsideClampOpts): number {
  const vw = opts?.viewportWidth;
  if (typeof vw === "number" && Number.isFinite(vw) && vw > 0) {
    const sidebar = Math.max(0, opts?.sidebarOccupiedWidth ?? 0);
    // Keep chat ≥ MAIN_CHAT_MIN_WIDTH after sidebar.
    const room = Math.floor(vw - sidebar - MAIN_CHAT_MIN_WIDTH);
    // Narrow windows: room may be below chrome min — still return room so
    // clamp can prefer fitting over blowing past the chat floor.
    return Math.max(0, room);
  }
  // No viewport: do not invent a 720px ceiling.
  return Number.MAX_SAFE_INTEGER;
}

export function clampAsideWidth(w: number, opts?: AsideClampOpts): number {
  if (!Number.isFinite(w)) return DEFAULT_LAYOUT.asideWidth;
  const min = asideChromeSafeMin(opts);
  const max = asideWidthMax(opts);
  const raw = Math.round(w);
  // Squeezed frame: prefer the chat floor (max) over forcing chrome min.
  if (max < min) return Math.max(0, max);
  return Math.min(max, Math.max(min, raw));
}

/**
 * Minimum inner width to keep sidebar + chat floor + open resource pane readable.
 * Used to grow the OS window when opening a pane on a narrow frame.
 */
export function requiredWorkbenchInnerWidth(layout: {
  sidebarCollapsed?: boolean;
  sidebarWidth?: number;
  asideCollapsed?: boolean;
  asideWidth?: number;
}): number {
  const side = layout.sidebarCollapsed
    ? 0
    : Math.max(0, Math.round(layout.sidebarWidth ?? SIDEBAR_DEFAULT_WIDTH));
  const aside = layout.asideCollapsed
    ? 0
    : Math.max(
        ASIDE_WIDTH_MIN,
        Math.round(layout.asideWidth ?? DEFAULT_LAYOUT.asideWidth),
      );
  return side + MAIN_CHAT_MIN_WIDTH + aside;
}

/**
 * Active surface in the resource pane — drives preferred width.
 * Keep in sync with ResourceViewer preview / side modes.
 */
export type AsideSurface =
  | "empty"
  | "plan"
  | "diff"
  | "markdown"
  | "code"
  | "text"
  | "json"
  | "html"
  | "url"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "office"
  | "binary"
  | "unknown";

export type AsideLayoutHint = {
  surface: AsideSurface;
  /** Preview | tree split open. */
  treeVisible: boolean;
  tabCount: number;
  windowControlsInset?: number;
};

/** Map FsReadResult / preview kind strings onto {@link AsideSurface}. */
export function asideSurfaceFromPreviewKind(
  kind: string | null | undefined,
): AsideSurface {
  const k = (kind || "").toLowerCase().trim();
  if (!k) return "empty";
  if (k === "markdown" || k === "md") return "markdown";
  if (k === "code" || k === "css" || k === "ts" || k === "tsx" || k === "js") {
    return "code";
  }
  if (k === "text" || k === "csv" || k === "config") return "text";
  if (k === "json") return "json";
  if (k === "html") return "html";
  if (k === "image") return "image";
  if (k === "video") return "video";
  if (k === "audio") return "audio";
  if (k === "pdf") return "pdf";
  if (
    k === "docx" ||
    k === "xlsx" ||
    k === "pptx" ||
    k === "odf" ||
    k === "office"
  ) {
    return "office";
  }
  if (k === "binary") return "binary";
  if (k === "url") return "url";
  // Host may classify sources as generic text with body.
  return "unknown";
}

/**
 * Preferred aside width for the active surface.
 * Policy: comfortable preview first; tree open adds split room; always ≥ chrome min.
 */
export function suggestAsideWidth(
  hint: AsideLayoutHint,
  opts?: AsideClampOpts,
): number {
  const clampOpts: AsideClampOpts = {
    windowControlsInset:
      hint.windowControlsInset ?? opts?.windowControlsInset ?? 0,
    viewportWidth: opts?.viewportWidth,
  };

  let base: number;
  switch (hint.surface) {
    case "empty":
      base = 380;
      break;
    case "plan":
      base = 500;
      break;
    case "diff":
      base = 540;
      break;
    case "markdown":
    case "code":
    case "text":
    case "json":
      base = 500;
      break;
    case "html":
    case "url":
      base = 580;
      break;
    case "image":
      base = 460;
      break;
    case "video":
      base = 580;
      break;
    case "audio":
      base = 400;
      break;
    case "pdf":
    case "office":
      base = 580;
      break;
    case "binary":
      base = 400;
      break;
    default:
      base = 420;
  }

  // File tree / changes list is a right split (~220 default tree width).
  if (hint.treeVisible) {
    base = Math.max(base + 180, 560);
  }

  // A few tabs: give the strip a little more room so names stay visible.
  if (hint.tabCount >= 3) {
    base += 24;
  } else if (hint.tabCount >= 2) {
    base += 12;
  }

  return clampAsideWidth(base, clampOpts);
}

/**
 * Merge current width with a content suggestion.
 * - Always enforces chrome-safe min / viewport max
 * - Soft-grows to suggestion (does not auto-shrink a wider user width)
 */
export function mergeAsideWidth(
  current: number,
  suggested: number,
  opts?: AsideClampOpts,
): number {
  const min = asideChromeSafeMin(opts);
  const max = asideWidthMax(opts);
  const cur = Number.isFinite(current) ? Math.round(current) : min;
  const sug = Number.isFinite(suggested) ? Math.round(suggested) : min;
  const grown = Math.max(cur, sug, min);
  return Math.min(max, grown);
}

export function parseLayout(
  raw: unknown,
  opts?: AsideClampOpts,
): LayoutPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_LAYOUT };
  const o = raw as Record<string, unknown>;
  return {
    sidebarWidth:
      typeof o.sidebarWidth === "number"
        ? clampSidebarWidth(o.sidebarWidth, {
            viewportWidth: opts?.viewportWidth,
            asideOccupiedWidth: 0,
          })
        : DEFAULT_LAYOUT.sidebarWidth,
    asideWidth:
      typeof o.asideWidth === "number"
        ? clampAsideWidth(o.asideWidth, opts)
        : DEFAULT_LAYOUT.asideWidth,
    // Cold start always closed; open state is session-only (not restored).
    asideCollapsed: DEFAULT_LAYOUT.asideCollapsed,
    sidebarCollapsed:
      typeof o.sidebarCollapsed === "boolean"
        ? o.sidebarCollapsed
        : DEFAULT_LAYOUT.sidebarCollapsed,
  };
}

export function loadLayout(
  storage: {
    getItem(k: string): string | null;
  },
  opts?: AsideClampOpts,
): LayoutPrefs {
  try {
    const raw = storage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    return parseLayout(JSON.parse(raw), opts);
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveLayout(
  storage: { setItem(k: string, v: string): void },
  layout: LayoutPrefs,
): void {
  storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}
