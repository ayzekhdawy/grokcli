/**
 * Settings overlay navigation: open/section/tab/focus, last route, hash,
 * and native WebView cover. Pref values stay with the host / display-prefs hook.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { createT } from "@/i18n";
import { acquireNativeWebviewCover } from "@/lib/nativeWebviewCover";
import { PR_HUB_ANCHOR_ID } from "@/lib/prHubDeepLink";
import { listen } from "@/lib/api/host";
import {
  buildSettingsHash,
  isSettingsSectionId,
  type SettingsSectionId,
  type SettingsTabId,
} from "@/lib/settingsCatalog";
import {
  OPEN_SETTINGS_FROM_EDITOR_EVENT,
  type OpenSettingsFromEditorPayload,
} from "@/lib/themeEditorShell";
import { buildSettingsLabels } from "@/lib/settingsLabels";
import {
  loadSettingsLastRoute,
  resolveOpenSettingsLocation,
  saveSettingsLastRoute,
} from "@/lib/settingsLastRoute";
import {
  resolveWorkbenchHash,
  type WorkbenchHashPane,
} from "@/lib/workbenchHash";

type TFn = ReturnType<typeof createT>;

function clearLocationHash(): void {
  if (typeof window === "undefined" || !window.location.hash) return;
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
}

export function useSettingsNavigation(opts: {
  tr: TFn;
  onWorkbenchPane: (pane: WorkbenchHashPane) => void;
  onMenuClose: () => void;
}) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>("general");
  const [settingsTab, setSettingsTab] = useState<SettingsTabId | null>(
    "composer",
  );
  const [settingsFocusAnchor, setSettingsFocusAnchor] = useState<string | null>(
    null,
  );
  const [prHubHighlightPr, setPrHubHighlightPr] = useState<number | null>(
    null,
  );

  const settingsNativeCoverReleaseRef = useRef<(() => void) | null>(null);
  const ensureSettingsNativeCover = useCallback(() => {
    settingsNativeCoverReleaseRef.current ??= acquireNativeWebviewCover();
  }, []);

  const settingsLabels = useMemo(
    () => buildSettingsLabels(opts.tr),
    [opts.tr],
  );

  const navigateSettings = useCallback(
    (section?: SettingsSectionId | null, tab?: string | null) => {
      const loc = resolveOpenSettingsLocation({
        section: section ?? undefined,
        tab,
        last: section == null ? loadSettingsLastRoute() : null,
      });
      ensureSettingsNativeCover();
      setSettingsSection(loc.section);
      setSettingsTab(loc.tab);
      setSettingsOpen(true);
      optsRef.current.onMenuClose();
      saveSettingsLastRoute(loc);
      if (typeof window !== "undefined") {
        const hash = buildSettingsHash({
          section: loc.section,
          tab: loc.tab,
        });
        if (window.location.hash !== hash) {
          window.location.hash = hash;
        }
      }
    },
    [ensureSettingsNativeCover],
  );

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    clearLocationHash();
  }, []);

  const openWorkflowsSettings = useCallback(() => {
    navigateSettings("runtime", "tools");
    setSettingsFocusAnchor("settings-anchor-workflows");
  }, [navigateSettings]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncFromHash = () => {
      const route = resolveWorkbenchHash(window.location.hash || "");
      if (route.kind === "settings-explicit") {
        ensureSettingsNativeCover();
        optsRef.current.onMenuClose();
        setSettingsSection(route.section);
        setSettingsTab(route.tab);
        saveSettingsLastRoute({
          section: route.section,
          tab: route.tab,
        });
        if (route.prNumber != null) {
          setPrHubHighlightPr(route.prNumber);
          setSettingsFocusAnchor(PR_HUB_ANCHOR_ID);
        }
        setSettingsOpen(true);
        return;
      }
      if (route.kind === "settings-last") {
        ensureSettingsNativeCover();
        optsRef.current.onMenuClose();
        const loc = resolveOpenSettingsLocation({
          last: loadSettingsLastRoute(),
        });
        setSettingsSection(loc.section);
        setSettingsTab(loc.tab);
        saveSettingsLastRoute(loc);
        const hash = buildSettingsHash(loc);
        if (window.location.hash !== hash) {
          window.location.hash = hash;
        }
        setSettingsOpen(true);
        return;
      }
      setSettingsOpen(false);
      optsRef.current.onWorkbenchPane(route.pane);
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [ensureSettingsNativeCover]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    void listen<OpenSettingsFromEditorPayload>(
      OPEN_SETTINGS_FROM_EDITOR_EVENT,
      (payload) => {
        const section = payload?.section;
        if (!isSettingsSectionId(section)) return;
        navigateSettings(section, payload.tab);
      },
    ).then((un) => {
      stop = un;
    });
    return () => stop?.();
  }, [navigateSettings]);

  useLayoutEffect(() => {
    if (settingsOpen) {
      ensureSettingsNativeCover();
      return;
    }
    const release = settingsNativeCoverReleaseRef.current;
    settingsNativeCoverReleaseRef.current = null;
    release?.();
  }, [settingsOpen, ensureSettingsNativeCover]);

  useEffect(
    () => () => {
      settingsNativeCoverReleaseRef.current?.();
      settingsNativeCoverReleaseRef.current = null;
    },
    [],
  );

  return {
    settingsOpen,
    settingsSection,
    settingsTab,
    settingsFocusAnchor,
    setSettingsFocusAnchor,
    prHubHighlightPr,
    setPrHubHighlightPr,
    settingsLabels,
    navigateSettings,
    closeSettings,
    openWorkflowsSettings,
  };
}
