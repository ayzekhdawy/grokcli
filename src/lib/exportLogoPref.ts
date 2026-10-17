/**
 * User-upload logo for conversation share cards (export as image).
 * localStorage-only — does not touch Host AppSettings.
 *
 * Value is a data URL (image/png|jpeg|webp|svg+xml) or empty for default brand mark.
 */

export const EXPORT_LOGO_STORAGE_KEY = "grok.exportLogoDataUrl";

/** Fired on `window` after a successful save (detail = data URL or ""). */
export const EXPORT_LOGO_CHANGE_EVENT = "grok-export-logo-change";

/** Cap stored data URL size (~1.5 MB raw → ~2 MB base64-ish). */
export const EXPORT_LOGO_MAX_DATA_URL_CHARS = 2_000_000;

/** Minimal storage surface so unit tests need no jsdom. */
export interface ExportLogoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function defaultStorage(): ExportLogoStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

/** True when `raw` looks like a safe image data URL we accept for export branding. */
export function isExportLogoDataUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  if (!s || s.length > EXPORT_LOGO_MAX_DATA_URL_CHARS) return false;
  return /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/i.test(s);
}

/** Parse stored value; invalid / empty → null (use default app logo). */
export function parseExportLogoPref(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  return isExportLogoDataUrl(s) ? s : null;
}

export function loadExportLogoPref(
  storage: ExportLogoStorage = defaultStorage(),
): string | null {
  try {
    return parseExportLogoPref(storage.getItem(EXPORT_LOGO_STORAGE_KEY));
  } catch {
    /* private mode */
    return null;
  }
}

/**
 * Persist a custom logo data URL, or clear when null/empty.
 * Dispatches {@link EXPORT_LOGO_CHANGE_EVENT} on window when available.
 */
export function saveExportLogoPref(
  dataUrl: string | null,
  storage: ExportLogoStorage = defaultStorage(),
): void {
  const next = parseExportLogoPref(dataUrl);
  try {
    if (!next) {
      if (typeof storage.removeItem === "function") {
        storage.removeItem(EXPORT_LOGO_STORAGE_KEY);
      } else {
        storage.setItem(EXPORT_LOGO_STORAGE_KEY, "");
      }
    } else {
      storage.setItem(EXPORT_LOGO_STORAGE_KEY, next);
    }
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(EXPORT_LOGO_CHANGE_EVENT, { detail: next ?? "" }),
      );
    } catch {
      /* ignore */
    }
  }
}

/** Read a File as a data URL (browser). Rejects oversized / non-image files. */
export function readImageFileAsDataUrl(
  file: File,
  maxBytes = 1_500_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("not-image"));
      return;
    }
    if (file.size > maxBytes) {
      reject(new Error("too-large"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read-failed"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!isExportLogoDataUrl(result)) {
        reject(new Error("invalid-data-url"));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}
