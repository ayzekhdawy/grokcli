/**
 * App UI (sans) font family (Appearance).
 * localStorage-only — no Rust AppSettings (avoids prefs schema conflicts).
 * Applied by setting --font-sans on documentElement.
 */

export const UI_FONT_FAMILY_STORAGE_KEY = "grok.uiFontFamily";

/** Empty → keep CSS token default from tokens.css. */
export const DEFAULT_UI_FONT_FAMILY = "";

export interface UiFontStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function storageOrMemory(): UiFontStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  const mem = new Map<string, string>();
  return {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => {
      mem.set(k, v);
    },
    removeItem: (k) => {
      mem.delete(k);
    },
  };
}

export function parseUiFontFamily(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_UI_FONT_FAMILY;
  return raw.trim();
}

export function loadUiFontFamily(
  storage: UiFontStorage = storageOrMemory(),
): string {
  try {
    return parseUiFontFamily(storage.getItem(UI_FONT_FAMILY_STORAGE_KEY));
  } catch {
    return DEFAULT_UI_FONT_FAMILY;
  }
}

export function saveUiFontFamily(
  family: string,
  storage: UiFontStorage = storageOrMemory(),
): void {
  try {
    const v = parseUiFontFamily(family);
    if (!v) {
      storage.removeItem?.(UI_FONT_FAMILY_STORAGE_KEY);
      if (!storage.removeItem) storage.setItem(UI_FONT_FAMILY_STORAGE_KEY, "");
      return;
    }
    storage.setItem(UI_FONT_FAMILY_STORAGE_KEY, v);
  } catch {
    /* private mode / quota */
  }
}

export interface UiFontRoot {
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}

/**
 * Apply or clear --font-sans override. Pass empty family to restore token default.
 */
export function applyUiFontFamily(
  family: string,
  root: UiFontRoot | null | undefined =
    typeof document !== "undefined" ? document.documentElement : null,
): void {
  if (!root) return;
  const c = parseUiFontFamily(family);
  if (!c) {
    root.style.removeProperty("--font-sans");
    return;
  }
  const quoted =
    /[,\s]/.test(c) && !c.startsWith('"') ? `"${c.replace(/"/g, "")}"` : c;
  root.style.setProperty(
    "--font-sans",
    `${quoted}, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`,
  );
}
