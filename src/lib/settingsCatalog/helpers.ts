/**
 * Settings catalog helpers — nav lookup, hash deep-links, search, invariants.
 */

import type { MessageKey } from "@/i18n";
import { SETTINGS_ENTRIES } from "./entries";
import { SETTINGS_NAV } from "./nav";
import {
  SETTINGS_SECTION_IDS,
  isSettingsSectionId,
  type SettingsLocation,
  type SettingsNavDef,
  type SettingsSearchHit,
  type SettingsSectionId,
  type SettingsTabId,
} from "./types";

export function getNavDef(section: SettingsSectionId): SettingsNavDef | undefined {
  return SETTINGS_NAV.find((n) => n.id === section);
}

export function defaultTabFor(section: SettingsSectionId): SettingsTabId | null {
  const nav = getNavDef(section);
  if (!nav || nav.tabs.length === 0) return null;
  return nav.defaultTab ?? nav.tabs[0]!.id;
}

export function isValidTab(
  section: SettingsSectionId,
  tab: string | null | undefined,
): tab is SettingsTabId {
  if (!tab) return false;
  const nav = getNavDef(section);
  return !!nav?.tabs.some((t) => t.id === tab);
}

/** Resolve tab for a section: valid tab, else default, else null. */
export function resolveTab(
  section: SettingsSectionId,
  tab?: string | null,
): SettingsTabId | null {
  // Legacy deep-link: market tab merged into plugins (no top-level Market tab).
  if (section === "extensions" && tab === "market") {
    return "plugins";
  }
  if (isValidTab(section, tab)) return tab;
  return defaultTabFor(section);
}

/**
 * Parse hash path after leading #/  e.g. "settings/extensions/mcp"
 * Also accepts "settings" alone.
 * Query strings (`?pr=42`) are ignored for section/tab resolution —
 * see `prHubDeepLink` for PR-hub query parsing.
 */
export function parseSettingsHash(raw: string): SettingsLocation | null {
  // Strip query so `#/settings/runtime/tools?pr=1` still resolves tools.
  const withoutQuery = raw.replace(/\?.*$/, "");
  const path = withoutQuery.replace(/^#\/?/, "").replace(/\/+$/, "");
  if (!path.startsWith("settings")) return null;
  const parts = path.split("/").filter(Boolean);
  // parts[0] === "settings"
  const sectionPart = parts[1];
  const tabPart = parts[2];
  const section: SettingsSectionId = isSettingsSectionId(sectionPart)
    ? sectionPart
    : "general";
  const tab = resolveTab(section, tabPart);
  return { section, tab };
}

/** Build hash without leading # — App adds # when writing location.hash. */
export function buildSettingsHash(loc: SettingsLocation): string {
  const section = isSettingsSectionId(loc.section) ? loc.section : "general";
  const tab = resolveTab(section, loc.tab);
  if (tab) return `#/settings/${section}/${tab}`;
  return `#/settings/${section}`;
}

/** Aggregate i18n keys used for section-level nav filtering (legacy search). */
export function keywordKeysForSection(section: SettingsSectionId): MessageKey[] {
  const keys = new Set<MessageKey>();
  const nav = getNavDef(section);
  if (nav) keys.add(nav.labelKey);
  for (const t of nav?.tabs ?? []) keys.add(t.labelKey);
  for (const e of SETTINGS_ENTRIES) {
    if (e.section !== section) continue;
    keys.add(e.labelKey);
    for (const k of e.descKeys ?? []) keys.add(k);
  }
  return [...keys];
}

/**
 * Search entries by query against translated label/desc + raw keywords.
 * `translate` should resolve MessageKey → string for the active locale;
 * callers typically also pass an English translator for bilingual match.
 */
export function searchSettingsEntries(
  query: string,
  translate: (key: MessageKey) => string,
  translateEn?: (key: MessageKey) => string,
): SettingsSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const en = translateEn ?? translate;
  const hits: SettingsSearchHit[] = [];
  for (const entry of SETTINGS_ENTRIES) {
    const hay: string[] = [
      entry.id,
      translate(entry.labelKey),
      en(entry.labelKey),
      ...(entry.keywords ?? []),
    ];
    for (const k of entry.descKeys ?? []) {
      hay.push(translate(k), en(k));
    }
    if (!hay.some((h) => h.toLowerCase().includes(q))) continue;
    const nav = getNavDef(entry.section);
    const tabDef = entry.tab
      ? nav?.tabs.find((t) => t.id === entry.tab)
      : undefined;
    hits.push({
      entry,
      sectionLabelKey: nav?.labelKey ?? "settings.nav.general",
      tabLabelKey: tabDef?.labelKey,
    });
  }
  return hits;
}

/** Invariant checks used by unit tests. */
export function catalogInvariants(): string[] {
  const errors: string[] = [];
  const navIds = new Set<string>();
  for (const n of SETTINGS_NAV) {
    if (navIds.has(n.id)) errors.push(`duplicate nav section: ${n.id}`);
    navIds.add(n.id);
    const tabIds = new Set<string>();
    for (const t of n.tabs) {
      if (tabIds.has(t.id)) errors.push(`duplicate tab ${t.id} in ${n.id}`);
      tabIds.add(t.id);
    }
    if (n.defaultTab && !tabIds.has(n.defaultTab)) {
      errors.push(`defaultTab ${n.defaultTab} missing in ${n.id}`);
    }
    if (n.tabs.length > 0 && !n.defaultTab) {
      errors.push(`section ${n.id} has tabs but no defaultTab`);
    }
  }
  for (const id of SETTINGS_SECTION_IDS) {
    if (!navIds.has(id)) errors.push(`section id missing from NAV: ${id}`);
  }
  const entryIds = new Set<string>();
  const anchors = new Set<string>();
  for (const e of SETTINGS_ENTRIES) {
    if (entryIds.has(e.id)) errors.push(`duplicate entry id: ${e.id}`);
    entryIds.add(e.id);
    if (anchors.has(e.anchorId)) errors.push(`duplicate anchor: ${e.anchorId}`);
    anchors.add(e.anchorId);
    if (!navIds.has(e.section)) {
      errors.push(`entry ${e.id} unknown section ${e.section}`);
    }
    if (e.tab && !isValidTab(e.section, e.tab)) {
      errors.push(`entry ${e.id} invalid tab ${e.tab} for ${e.section}`);
    }
  }
  return errors;
}
