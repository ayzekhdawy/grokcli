/**
 * Settings model context — collapses SettingsPage prop waterfall (WP-B4).
 * Routing props stay on SettingsPage; values+setters+shell helpers live here.
 * Section components under `src/components/settings/*` call useSettingsModel().
 */
import { createContext, useContext, type ReactNode } from "react";
import type { SettingsViewModel } from "@/components/settings/types";

/**
 * Settings view-model bag. Prefer SettingsViewModel; keep Record fallback for
 * gradual section typing without forcing AppWorkbench changes.
 */
export type SettingsModel = SettingsViewModel & Record<string, unknown>;

const SettingsModelContext = createContext<SettingsModel | null>(null);

export function SettingsModelProvider({
  value,
  children,
}: {
  value: SettingsModel;
  children: ReactNode;
}) {
  return (
    <SettingsModelContext.Provider value={value}>
      {children}
    </SettingsModelContext.Provider>
  );
}

export function useSettingsModel<T extends SettingsModel = SettingsModel>(): T {
  const ctx = useContext(SettingsModelContext);
  if (!ctx) {
    throw new Error("useSettingsModel must be used within SettingsModelProvider");
  }
  return ctx as T;
}
