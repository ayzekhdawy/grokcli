/** Standalone appearance-editor hash — used by the `#/theme-editor` webview. */
import {
  htmlLangForLocale,
  parseLocalePreference,
  resolveLocale,
  resolveLocalePreference,
  type Locale,
} from "@/i18n";

export function isThemeEditorHash(hash: string | null | undefined): boolean {
  const h = (hash ?? "").trim();
  return h === "#/theme-editor" || h.startsWith("#/theme-editor?");
}

export const THEME_EDITOR_WINDOW_LABEL = "theme-editor";
export const OPEN_SETTINGS_FROM_EDITOR_EVENT = "grok://open-settings";

export type OpenSettingsFromEditorPayload = {
  section: string;
  tab?: string | null;
};

type BootWindow = {
  __GROK_BOOT_LOCALE__?: string;
  __GROK_BOOT_OS_LANG__?: string;
};

/**
 * Catalog locale for the editor window — same authority as the main workbench.
 * Prefer Host-injected `__GROK_BOOT_LOCALE__` (catalog id). `html lang` is a
 * BCP-47 tag (`zh-CN`) and is only a fallback.
 */
export function readThemeEditorBootLocale(
  w: BootWindow | undefined | null = typeof window !== "undefined"
    ? (window as BootWindow)
    : undefined,
  htmlLang?: string | null,
): Locale {
  const boot = w?.__GROK_BOOT_LOCALE__;
  if (typeof boot === "string" && boot.trim()) {
    const pref = parseLocalePreference(boot);
    return resolveLocalePreference(pref, w?.__GROK_BOOT_OS_LANG__);
  }
  const lang =
    htmlLang ??
    (typeof document !== "undefined" ? document.documentElement.lang : null);
  return resolveLocale(lang);
}

export function applyThemeEditorHtmlLang(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = htmlLangForLocale(locale);
}

/** True in the standalone appearance window (hash or Host boot attr). */
export function isThemeEditorDocument(
  hash: string | null | undefined = typeof window !== "undefined"
    ? window.location.hash
    : undefined,
  root: { hasAttribute?(name: string): boolean } | null | undefined =
    typeof document !== "undefined" ? document.documentElement : undefined,
): boolean {
  if (isThemeEditorHash(hash)) return true;
  return !!root?.hasAttribute?.("data-theme-editor-shell");
}
