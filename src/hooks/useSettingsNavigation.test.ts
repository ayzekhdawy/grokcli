/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createT } from "@/i18n";
import {
  SETTINGS_LAST_ROUTE_STORAGE_KEY,
  saveSettingsLastRoute,
} from "@/lib/settingsLastRoute";
import { useSettingsNavigation } from "./useSettingsNavigation";

function setup() {
  const onWorkbenchPane = vi.fn();
  const onMenuClose = vi.fn();
  const hook = renderHook(() =>
    useSettingsNavigation({
      tr: createT("en"),
      onWorkbenchPane,
      onMenuClose,
    }),
  );
  return { ...hook, onWorkbenchPane, onMenuClose };
}

describe("useSettingsNavigation", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
  });

  it("opens Settings at an explicit section and persists last route", () => {
    const { result, onMenuClose } = setup();
    act(() => {
      result.current.navigateSettings("runtime", "tools");
    });
    expect(result.current.settingsOpen).toBe(true);
    expect(result.current.settingsSection).toBe("runtime");
    expect(result.current.settingsTab).toBe("tools");
    expect(onMenuClose).toHaveBeenCalled();
    expect(window.location.hash).toBe("#/settings/runtime/tools");
    expect(
      window.localStorage.getItem(SETTINGS_LAST_ROUTE_STORAGE_KEY),
    ).toContain("runtime");
  });

  it("generic open restores the last route", () => {
    saveSettingsLastRoute({ section: "account", tab: "extras" });
    const { result } = setup();
    act(() => {
      result.current.navigateSettings();
    });
    expect(result.current.settingsSection).toBe("account");
    expect(result.current.settingsTab).toBe("extras");
  });

  it("closeSettings drops the overlay without a host pane callback", () => {
    const { result, onWorkbenchPane } = setup();
    act(() => {
      result.current.navigateSettings("about");
    });
    onWorkbenchPane.mockClear();
    act(() => {
      result.current.closeSettings();
    });
    expect(result.current.settingsOpen).toBe(false);
    expect(onWorkbenchPane).not.toHaveBeenCalled();
  });

  it("hash #/automations asks the host for that pane", () => {
    const { onWorkbenchPane } = setup();
    act(() => {
      window.location.hash = "#/automations";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(onWorkbenchPane).toHaveBeenCalledWith("automations");
  });
});
