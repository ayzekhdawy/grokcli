/**
 * Shared navigation contract: settings 宠物 nav and the pet-window
 * 「宠物设置」 item must open the same destination.
 */

import { buildSettingsHash } from "@/lib/settingsCatalog";

export const PET_SETTINGS_SECTION = "pet" as const;

/** Canonical hash for Settings → 宠物. */
export const PET_SETTINGS_HASH = buildSettingsHash({
  section: PET_SETTINGS_SECTION,
});

export function petSettingsHash(): string {
  return PET_SETTINGS_HASH;
}
