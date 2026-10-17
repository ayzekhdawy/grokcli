/**
 * Linux day-use acceptance checklist — pure honesty helpers.
 *
 * Items (Linux-specific day-use):
 *   cli_found · path_spaces · sandbox_landlock · tray_autostart ·
 *   wayland_x11 · app_update_check
 *
 * Soft rules:
 * - Never invent Landlock enforcement, tray autostart, or Wayland/X11
 *   session type without an explicit probe.
 * - Non-Linux platforms are not the target of this list (N/A honesty).
 * - `sandbox_landlock`: profile `off` → N/A; profile not off → **warn**
 *   that kernel enforcement is Landlock (unless a probe says otherwise).
 * - `tray_autostart` / `wayland_x11` stay **manual** when unprobed.
 */

import type { AppPlatform } from "./appPlatform";
import {
  normalizeSandboxProfile,
  type SandboxProfileId,
} from "./sandboxProfile";

// ─── Ids / status ───────────────────────────────────────────────────────────

/** Stable checklist item ids (Linux day-use honesty). */
export type LinuxDayuseItemId =
  | "cli_found"
  | "path_spaces"
  | "sandbox_landlock"
  | "tray_autostart"
  | "wayland_x11"
  | "app_update_check";

/**
 * Evaluation outcome.
 * - `warn` — profile not off; remind that enforcement is Landlock
 * - `na` — not applicable (non-Linux, or sandbox off for landlock row)
 */
export type LinuxDayuseStatus = "pass" | "fail" | "manual" | "warn" | "na";

/** Optional Settings deep-link target for the UI row. */
export type LinuxDayuseLinkTarget =
  | "about"
  | "setup"
  | "runtime"
  | "sandbox"
  | null;

export const LINUX_DAYUSE_ITEM_IDS: readonly LinuxDayuseItemId[] = [
  "cli_found",
  "path_spaces",
  "sandbox_landlock",
  "tray_autostart",
  "wayland_x11",
  "app_update_check",
] as const;

/** Acceptance / honesty doc (repo-relative) for the card footer. */
export const LINUX_DAYUSE_DOCS_PATH = "docs/验收/linux-dayuse-acceptance.md";

// ─── Probe input ────────────────────────────────────────────────────────────

/**
 * Probe bag for one evaluation. All fields optional — missing ⇒ manual
 * (never invent pass/fail/warn beyond documented sandbox-off / not-off rules).
 */
export type LinuxDayuseProbe = {
  /** CLI probe: resolved path found. */
  cliFound?: boolean | null;
  /** At least one trusted project exists. */
  hasTrustedProject?: boolean | null;
  /** A trusted project path contains whitespace. */
  pathHasSpaces?: boolean | null;
  /**
   * App sandbox profile (`off` | `workspace` | …).
   * When omitted, sandbox_landlock stays manual (do not assume default).
   */
  sandboxProfile?: string | null;
  /**
   * Host explicitly probed Landlock kernel enforcement.
   * Without this, a non-off profile only yields **warn** (never pass/fail).
   */
  landlockProbed?: boolean | null;
  /** True when Landlock enforcement is active (only when probed). */
  landlockEnforced?: boolean | null;
  /**
   * Host explicitly probed tray / autostart registration.
   * Without this, tray_autostart is always manual.
   */
  trayAutostartProbed?: boolean | null;
  /** True when tray autostart is enabled (only when probed). */
  trayAutostartEnabled?: boolean | null;
  /**
   * Host explicitly probed display server (Wayland / X11).
   * Without this, wayland_x11 is always manual.
   */
  displayServerProbed?: boolean | null;
  /**
   * Detected session type when probed: `wayland` | `x11` | other string.
   * Unknown / empty after probe → manual honesty.
   */
  displayServer?: string | null;
  /**
   * App can check for updates (plugin path and/or GitHub manual).
   * When unknown, item stays manual.
   */
  updateSupported?: boolean | null;
};

export type LinuxDayuseChecklistInput = LinuxDayuseProbe & {
  /** Detected platform (`linux` is the only target of this list). */
  platform: AppPlatform | string | null | undefined;
};

export type LinuxDayuseChecklistItem = {
  id: LinuxDayuseItemId;
  status: LinuxDayuseStatus;
  /** i18n label key (`doctor.linuxDayuse.item.*`). */
  labelKey: string;
  /** i18n detail / hint key for current status. */
  detailKey: string;
  /** Settings deep-link hint for the UI. */
  link: LinuxDayuseLinkTarget;
};

export type LinuxDayuseCounts = {
  pass: number;
  fail: number;
  manual: number;
  warn: number;
  na: number;
  total: number;
};

export type LinuxDayuseChecklist = {
  /** True when platform is Linux. */
  isTargetPlatform: boolean;
  platform: string;
  items: LinuxDayuseChecklistItem[];
  counts: LinuxDayuseCounts;
  /** Aggregated: any fail on target platform. */
  hasFail: boolean;
  /** Aggregated: any manual remaining on target platform. */
  hasManual: boolean;
  /** Aggregated: any warn on target platform. */
  hasWarn: boolean;
};

// ─── Labels / details ───────────────────────────────────────────────────────

const LABEL_KEYS: Record<LinuxDayuseItemId, string> = {
  cli_found: "doctor.linuxDayuse.item.cliFound",
  path_spaces: "doctor.linuxDayuse.item.pathSpaces",
  sandbox_landlock: "doctor.linuxDayuse.item.sandboxLandlock",
  tray_autostart: "doctor.linuxDayuse.item.trayAutostart",
  wayland_x11: "doctor.linuxDayuse.item.waylandX11",
  app_update_check: "doctor.linuxDayuse.item.appUpdateCheck",
};

const LINK_BY_ID: Record<LinuxDayuseItemId, LinuxDayuseLinkTarget> = {
  cli_found: "setup",
  path_spaces: "setup",
  sandbox_landlock: "sandbox",
  tray_autostart: null,
  wayland_x11: null,
  app_update_check: "about",
};

function detailKeyFor(
  id: LinuxDayuseItemId,
  status: LinuxDayuseStatus,
): string {
  if (status === "na") {
    if (id === "sandbox_landlock") {
      return "doctor.linuxDayuse.detail.sandboxLandlock.na";
    }
    return "doctor.linuxDayuse.detail.na";
  }
  switch (id) {
    case "cli_found":
      if (status === "pass") return "doctor.linuxDayuse.detail.cliFound.pass";
      if (status === "fail") return "doctor.linuxDayuse.detail.cliFound.fail";
      return "doctor.linuxDayuse.detail.cliFound.manual";
    case "path_spaces":
      if (status === "pass") return "doctor.linuxDayuse.detail.pathSpaces.pass";
      if (status === "fail") return "doctor.linuxDayuse.detail.pathSpaces.fail";
      return "doctor.linuxDayuse.detail.pathSpaces.manual";
    case "sandbox_landlock":
      if (status === "pass")
        return "doctor.linuxDayuse.detail.sandboxLandlock.pass";
      if (status === "fail")
        return "doctor.linuxDayuse.detail.sandboxLandlock.fail";
      if (status === "warn")
        return "doctor.linuxDayuse.detail.sandboxLandlock.warn";
      return "doctor.linuxDayuse.detail.sandboxLandlock.manual";
    case "tray_autostart":
      if (status === "pass")
        return "doctor.linuxDayuse.detail.trayAutostart.pass";
      if (status === "fail")
        return "doctor.linuxDayuse.detail.trayAutostart.fail";
      return "doctor.linuxDayuse.detail.trayAutostart.manual";
    case "wayland_x11":
      if (status === "pass") return "doctor.linuxDayuse.detail.waylandX11.pass";
      if (status === "fail") return "doctor.linuxDayuse.detail.waylandX11.fail";
      return "doctor.linuxDayuse.detail.waylandX11.manual";
    case "app_update_check":
      if (status === "pass")
        return "doctor.linuxDayuse.detail.appUpdateCheck.pass";
      if (status === "fail")
        return "doctor.linuxDayuse.detail.appUpdateCheck.fail";
      return "doctor.linuxDayuse.detail.appUpdateCheck.manual";
    default: {
      const _exhaustive: never = id;
      void _exhaustive;
      return "doctor.linuxDayuse.detail.na";
    }
  }
}

// ─── Platform ───────────────────────────────────────────────────────────────

/** Normalize platform string → canonical AppPlatform-ish id. */
export function normalizeLinuxDayusePlatform(
  platform: AppPlatform | string | null | undefined,
): string {
  const p = String(platform ?? "")
    .trim()
    .toLowerCase();
  if (!p) return "other";
  if (p === "win" || p === "windows" || p === "win32") return "win";
  if (p === "mac" || p === "macos" || p === "darwin") return "mac";
  if (p === "linux" || p === "android") return "linux";
  return p;
}

/** True when this checklist is the product target (Linux only). */
export function isLinuxDayuseTargetPlatform(
  platform: AppPlatform | string | null | undefined,
): boolean {
  return normalizeLinuxDayusePlatform(platform) === "linux";
}

// ─── Project path helpers ───────────────────────────────────────────────────

/** True when a filesystem path string contains whitespace. */
export function pathContainsSpaces(path: string | null | undefined): boolean {
  if (path == null) return false;
  return /\s/.test(String(path));
}

export type ProjectSpacesProbeInput = {
  trusted?: boolean | null;
  path?: string | null;
};

/**
 * Derive path_spaces probe fields from a project list.
 * Pure — never invents a trusted project.
 */
export function deriveProjectSpacesProbe(
  projects: readonly ProjectSpacesProbeInput[] | null | undefined,
): { hasTrustedProject: boolean; pathHasSpaces: boolean } {
  const list = projects ?? [];
  let hasTrustedProject = false;
  let pathHasSpaces = false;
  for (const p of list) {
    if (!p?.trusted) continue;
    hasTrustedProject = true;
    if (pathContainsSpaces(p.path)) pathHasSpaces = true;
  }
  return { hasTrustedProject, pathHasSpaces };
}

// ─── Sandbox / display helpers ──────────────────────────────────────────────

/**
 * Resolve sandbox profile for landlock row.
 * Returns `null` when the probe did not supply a known profile (honest manual).
 * Does **not** invent the product default `off` for missing/unknown values.
 */
export function resolveLinuxDayuseSandboxProfile(
  raw: string | null | undefined,
): SandboxProfileId | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return normalizeSandboxProfile(trimmed);
}

/** Normalize display-server probe string → wayland | x11 | other | unknown. */
export function normalizeDisplayServer(
  raw: string | null | undefined,
): "wayland" | "x11" | "other" | "unknown" {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return "unknown";
  if (s === "wayland" || s.includes("wayland")) return "wayland";
  if (s === "x11" || s === "xorg" || s.includes("x11")) return "x11";
  return "other";
}

// ─── Evaluation ─────────────────────────────────────────────────────────────

/**
 * Evaluate one checklist item against probe data.
 * Non-Linux always returns `na`. Missing probes → `manual` (honest).
 * Never invents Landlock / tray / display server without explicit probes.
 */
export function evaluateLinuxDayuseItem(
  id: LinuxDayuseItemId,
  probe: LinuxDayuseProbe & {
    platform?: AppPlatform | string | null;
  },
): LinuxDayuseStatus {
  if (!isLinuxDayuseTargetPlatform(probe.platform)) {
    return "na";
  }

  switch (id) {
    case "cli_found": {
      if (probe.cliFound === true) return "pass";
      if (probe.cliFound === false) return "fail";
      return "manual";
    }
    case "path_spaces": {
      if (probe.hasTrustedProject == null) return "manual";
      if (probe.hasTrustedProject === false) return "fail";
      // Trusted project exists; spaces verified only when pathHasSpaces is true.
      if (probe.pathHasSpaces === true) return "pass";
      // Project exists but path spaces not confirmed → manual acceptance step.
      return "manual";
    }
    case "sandbox_landlock": {
      const profile = resolveLinuxDayuseSandboxProfile(probe.sandboxProfile);
      // No profile supplied → do not assume off/default.
      if (profile == null && probe.sandboxProfile == null) return "manual";
      // Explicit off → Landlock N/A.
      if (profile === "off") return "na";
      // Profile not off (or unknown non-empty raw): optional Landlock probe.
      if (probe.landlockProbed === true) {
        if (probe.landlockEnforced === true) return "pass";
        if (probe.landlockEnforced === false) return "fail";
        return "warn";
      }
      // Known non-off profile, or non-empty raw that did not normalize → warn.
      if (profile != null) return "warn";
      if (probe.sandboxProfile != null && String(probe.sandboxProfile).trim()) {
        return "warn";
      }
      return "manual";
    }
    case "tray_autostart": {
      // Manual unless an explicit tray/autostart probe ran.
      if (probe.trayAutostartProbed !== true) return "manual";
      if (probe.trayAutostartEnabled === true) return "pass";
      if (probe.trayAutostartEnabled === false) return "fail";
      return "manual";
    }
    case "wayland_x11": {
      // Unknown without probe — manual honesty.
      if (probe.displayServerProbed !== true) return "manual";
      const ds = normalizeDisplayServer(probe.displayServer);
      if (ds === "wayland" || ds === "x11") return "pass";
      if (ds === "other") return "fail";
      return "manual";
    }
    case "app_update_check": {
      if (probe.updateSupported === true) return "pass";
      if (probe.updateSupported === false) return "fail";
      return "manual";
    }
    default: {
      const _exhaustive: never = id;
      void _exhaustive;
      return "manual";
    }
  }
}

function countItems(items: readonly LinuxDayuseChecklistItem[]): LinuxDayuseCounts {
  let pass = 0;
  let fail = 0;
  let manual = 0;
  let warn = 0;
  let na = 0;
  for (const it of items) {
    if (it.status === "pass") pass += 1;
    else if (it.status === "fail") fail += 1;
    else if (it.status === "manual") manual += 1;
    else if (it.status === "warn") warn += 1;
    else na += 1;
  }
  return { pass, fail, manual, warn, na, total: items.length };
}

/**
 * Build the full Linux day-use checklist from platform + probes.
 * On non-Linux every item is `na` (honesty: not the target of this list).
 */
export function buildLinuxDayuseChecklist(
  input: LinuxDayuseChecklistInput,
): LinuxDayuseChecklist {
  const platform = normalizeLinuxDayusePlatform(input.platform);
  const isTarget = platform === "linux";
  const probe: LinuxDayuseProbe & { platform: string } = {
    platform,
    cliFound: input.cliFound,
    hasTrustedProject: input.hasTrustedProject,
    pathHasSpaces: input.pathHasSpaces,
    sandboxProfile: input.sandboxProfile,
    landlockProbed: input.landlockProbed,
    landlockEnforced: input.landlockEnforced,
    trayAutostartProbed: input.trayAutostartProbed,
    trayAutostartEnabled: input.trayAutostartEnabled,
    displayServerProbed: input.displayServerProbed,
    displayServer: input.displayServer,
    updateSupported: input.updateSupported,
  };

  const items: LinuxDayuseChecklistItem[] = LINUX_DAYUSE_ITEM_IDS.map((id) => {
    const status = evaluateLinuxDayuseItem(id, probe);
    return {
      id,
      status,
      labelKey: LABEL_KEYS[id],
      detailKey: detailKeyFor(id, status),
      link: isTarget ? LINK_BY_ID[id] : null,
    };
  });

  const counts = countItems(items);
  return {
    isTargetPlatform: isTarget,
    platform,
    items,
    counts,
    hasFail: isTarget && counts.fail > 0,
    hasManual: isTarget && counts.manual > 0,
    hasWarn: isTarget && counts.warn > 0,
  };
}

// ─── Empty / visibility ─────────────────────────────────────────────────────

export type LinuxDayuseEmptyKind = "target" | "not_linux" | "hidden";

export type LinuxDayuseEmptyState = {
  kind: LinuxDayuseEmptyKind;
  /** Whether the checklist card should render at all. */
  show: boolean;
  /** True only on Linux — rows use real probes. */
  isTargetPlatform: boolean;
  titleKey: string;
  hintKey: string | null;
};

/**
 * Resolve card empty / visibility for non-Linux honesty.
 *
 * - Linux → `target` (show full checklist)
 * - Non-Linux + hideOnNonLinux → `hidden` (do not render card)
 * - Non-Linux default → `not_linux` (show card with N/A honesty)
 */
export function resolveLinuxDayuseEmptyState(input: {
  platform: AppPlatform | string | null | undefined;
  /** When true, hide the card entirely on non-Linux. Default false. */
  hideOnNonLinux?: boolean;
}): LinuxDayuseEmptyState {
  const isTarget = isLinuxDayuseTargetPlatform(input.platform);
  if (isTarget) {
    return {
      kind: "target",
      show: true,
      isTargetPlatform: true,
      titleKey: "doctor.linuxDayuse.title",
      hintKey: "doctor.linuxDayuse.lead",
    };
  }
  if (input.hideOnNonLinux) {
    return {
      kind: "hidden",
      show: false,
      isTargetPlatform: false,
      titleKey: "doctor.linuxDayuse.title",
      hintKey: "doctor.linuxDayuse.notTarget",
    };
  }
  return {
    kind: "not_linux",
    show: true,
    isTargetPlatform: false,
    titleKey: "doctor.linuxDayuse.title",
    hintKey: "doctor.linuxDayuse.notTarget",
  };
}

// ─── Status chips / summary ─────────────────────────────────────────────────

/** i18n key for a status chip. */
export function linuxDayuseStatusKey(status: LinuxDayuseStatus): string {
  switch (status) {
    case "pass":
      return "doctor.linuxDayuse.status.pass";
    case "fail":
      return "doctor.linuxDayuse.status.fail";
    case "manual":
      return "doctor.linuxDayuse.status.manual";
    case "warn":
      return "doctor.linuxDayuse.status.warn";
    case "na":
      return "doctor.linuxDayuse.status.na";
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return "doctor.linuxDayuse.status.manual";
    }
  }
}

/** Map status → CSS tone class suffix. */
export function linuxDayuseStatusTone(
  status: LinuxDayuseStatus,
): "ok" | "fail" | "manual" | "warn" | "na" {
  switch (status) {
    case "pass":
      return "ok";
    case "fail":
      return "fail";
    case "manual":
      return "manual";
    case "warn":
      return "warn";
    case "na":
      return "na";
    default:
      return "manual";
  }
}

/** Platform badge i18n key. */
export function linuxDayusePlatformBadgeKey(
  platform: AppPlatform | string | null | undefined,
): string {
  const p = normalizeLinuxDayusePlatform(platform);
  if (p === "win") return "doctor.linuxDayuse.platform.win";
  if (p === "mac") return "doctor.linuxDayuse.platform.mac";
  if (p === "linux") return "doctor.linuxDayuse.platform.linux";
  return "doctor.linuxDayuse.platform.other";
}

/**
 * Plain-text checklist summary for clipboard.
 * No secrets / paths with tokens — ids + status only.
 */
export function formatLinuxDayuseSummaryText(
  checklist: LinuxDayuseChecklist,
  opts?: { title?: string; generatedAt?: string | null },
): string {
  const lines: string[] = [];
  lines.push(opts?.title?.trim() || "Grok App — Linux day-use checklist");
  lines.push(`Platform: ${checklist.platform}`);
  lines.push(
    `Target: ${checklist.isTargetPlatform ? "yes (Linux)" : "no (not the target of this list)"}`,
  );
  lines.push(
    `Summary: ${checklist.counts.pass} pass · ${checklist.counts.fail} fail · ${checklist.counts.warn} warn · ${checklist.counts.manual} manual · ${checklist.counts.na} n/a`,
  );
  lines.push("Items:");
  for (const item of checklist.items) {
    lines.push(`  [${item.status}] ${item.id}`);
  }
  lines.push(
    "Honesty: Landlock / tray autostart / Wayland·X11 never invented without probe; sandbox off → n/a, profile not off → warn (Landlock).",
  );
  lines.push(`Doc: ${LINUX_DAYUSE_DOCS_PATH}`);
  if (opts?.generatedAt) {
    lines.push(`Generated: ${opts.generatedAt}`);
  }
  return lines.join("\n");
}
