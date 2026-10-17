/**
 * Settings IA registry — single source for nav, page tabs, and search jump targets.
 *
 * Rules (see docs/llm-wiki/settings-ia.md):
 * - Every user-visible setting must be registered here (domain entry modules).
 * - Search matches labelKey + descKeys + keywords (en + active locale via createT).
 * - Deep links: #/settings/{section}[/{tab}]
 *
 * Structure:
 * - types.ts — section/tab/entry types
 * - nav.ts — SETTINGS_NAV
 * - entries/* — per-section SETTINGS_ENTRIES slices
 * - helpers.ts — hash, search, invariants
 */

export type {
  SettingsEntry,
  SettingsLocation,
  SettingsNavDef,
  SettingsNavGroup,
  SettingsNavIcon,
  SettingsSearchHit,
  SettingsSectionId,
  SettingsTabDef,
  SettingsTabId,
} from "./types";
export {
  SETTINGS_SECTION_IDS,
  isSettingsSectionId,
} from "./types";

export { SETTINGS_NAV } from "./nav";
export { SETTINGS_ENTRIES } from "./entries";

export {
  buildSettingsHash,
  catalogInvariants,
  defaultTabFor,
  getNavDef,
  isValidTab,
  keywordKeysForSection,
  parseSettingsHash,
  resolveTab,
  searchSettingsEntries,
} from "./helpers";
