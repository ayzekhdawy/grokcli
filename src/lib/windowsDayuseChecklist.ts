/**
 * Windows day-use acceptance checklist — pure honesty helpers (Top30 #27).
 *
 * Productizes `docs/验收/windows-dayuse-acceptance.md` for Doctor / Reliability:
 * install path, CLI found, project with spaces, single attachment, app update
 * check, mirror read-only. App can auto-probe some items; others stay **manual**.
 *
 * Soft rules:
 * - Never invent SmartScreen / unsigned status without an explicit probe.
 * - Non-Windows platforms are not the target of this list (N/A honesty).
 * - `single_attachment` is always manual (paste once cannot be auto-proven).
 */

import type { AppPlatform } from "./appPlatform";

// ─── Ids / status ───────────────────────────────────────────────────────────

/** Stable checklist item ids (order matches acceptance doc). */
export type WindowsDayuseItemId =
  | "install_path"
  | "cli_found"
  | "project_spaces"
  | "single_attachment"
  | "app_update_check"
  | "mirror_readonly";

/** Evaluation outcome. `na` = not applicable (non-Windows). */
export type WindowsDayuseStatus = "pass" | "fail" | "manual" | "na";

/** Optional Settings deep-link target for the UI row. */
export type WindowsDayuseLinkTarget =
  | "about"
  | "mirror"
  | "setup"
  | "runtime"
  | null;

export const WINDOWS_DAYUSE_ITEM_IDS: readonly WindowsDayuseItemId[] = [
  "install_path",
  "cli_found",
  "project_spaces",
  "single_attachment",
  "app_update_check",
  "mirror_readonly",
] as const;

/** Acceptance doc (repo-relative) for honesty / docs link. */
export const WINDOWS_DAYUSE_DOCS_PATH =
  "docs/验收/windows-dayuse-acceptance.md";

// ─── Probe input ────────────────────────────────────────────────────────────

/**
 * Probe bag for one evaluation. All fields optional — missing ⇒ manual
 * (never invent pass/fail). SmartScreen fields stay unset unless the host
 * actually probed install signature.
 */
export type WindowsDayuseProbe = {
  /** CLI probe: resolved path found. */
  cliFound?: boolean | null;
  /** At least one trusted project exists. */
  hasTrustedProject?: boolean | null;
  /** A trusted project path contains whitespace. */
  pathHasSpaces?: boolean | null;
  /**
   * Phone mirror allows writes (`readOnly === false`).
   * When false / omitted as read-only default → pass for mirror_readonly.
   */
  mirrorWriteEnabled?: boolean | null;
  /**
   * App can check for updates (plugin path and/or GitHub manual).
   * When unknown, item stays manual.
   */
  updateSupported?: boolean | null;
  /**
   * Host explicitly ran a SmartScreen / signature probe.
   * Without this, install_path is always manual — never invent unsigned status.
   */
  smartScreenProbed?: boolean | null;
  /** True when install is signed / SmartScreen-clear (only when probed). */
  installSigned?: boolean | null;
};

export type WindowsDayuseChecklistInput = WindowsDayuseProbe & {
  /** Detected platform (`win` is the only target of this list). */
  platform: AppPlatform | string | null | undefined;
};

export type WindowsDayuseChecklistItem = {
  id: WindowsDayuseItemId;
  status: WindowsDayuseStatus;
  /** i18n label key (`doctor.windowsDayuse.item.*`). */
  labelKey: string;
  /** i18n detail / hint key for current status. */
  detailKey: string;
  /** Settings deep-link hint for the UI. */
  link: WindowsDayuseLinkTarget;
};

export type WindowsDayuseCounts = {
  pass: number;
  fail: number;
  manual: number;
  na: number;
  total: number;
};

export type WindowsDayuseChecklist = {
  /** True when platform is Windows. */
  isTargetPlatform: boolean;
  platform: string;
  items: WindowsDayuseChecklistItem[];
  counts: WindowsDayuseCounts;
  /** Aggregated: any fail on target platform. */
  hasFail: boolean;
  /** Aggregated: any manual remaining on target platform. */
  hasManual: boolean;
};

// ─── Labels / details ───────────────────────────────────────────────────────

const LABEL_KEYS: Record<WindowsDayuseItemId, string> = {
  install_path: "doctor.windowsDayuse.item.installPath",
  cli_found: "doctor.windowsDayuse.item.cliFound",
  project_spaces: "doctor.windowsDayuse.item.projectSpaces",
  single_attachment: "doctor.windowsDayuse.item.singleAttachment",
  app_update_check: "doctor.windowsDayuse.item.appUpdateCheck",
  mirror_readonly: "doctor.windowsDayuse.item.mirrorReadonly",
};

const LINK_BY_ID: Record<WindowsDayuseItemId, WindowsDayuseLinkTarget> = {
  install_path: null,
  cli_found: "setup",
  project_spaces: "setup",
  single_attachment: null,
  app_update_check: "about",
  mirror_readonly: "mirror",
};

function detailKeyFor(
  id: WindowsDayuseItemId,
  status: WindowsDayuseStatus,
): string {
  if (status === "na") return "doctor.windowsDayuse.detail.na";
  switch (id) {
    case "install_path":
      if (status === "pass") return "doctor.windowsDayuse.detail.installPath.pass";
      if (status === "fail") return "doctor.windowsDayuse.detail.installPath.fail";
      return "doctor.windowsDayuse.detail.installPath.manual";
    case "cli_found":
      if (status === "pass") return "doctor.windowsDayuse.detail.cliFound.pass";
      if (status === "fail") return "doctor.windowsDayuse.detail.cliFound.fail";
      return "doctor.windowsDayuse.detail.cliFound.manual";
    case "project_spaces":
      if (status === "pass") return "doctor.windowsDayuse.detail.projectSpaces.pass";
      if (status === "fail") return "doctor.windowsDayuse.detail.projectSpaces.fail";
      return "doctor.windowsDayuse.detail.projectSpaces.manual";
    case "single_attachment":
      return "doctor.windowsDayuse.detail.singleAttachment.manual";
    case "app_update_check":
      if (status === "pass") return "doctor.windowsDayuse.detail.appUpdateCheck.pass";
      if (status === "fail") return "doctor.windowsDayuse.detail.appUpdateCheck.fail";
      return "doctor.windowsDayuse.detail.appUpdateCheck.manual";
    case "mirror_readonly":
      if (status === "pass") return "doctor.windowsDayuse.detail.mirrorReadonly.pass";
      if (status === "fail") return "doctor.windowsDayuse.detail.mirrorReadonly.fail";
      return "doctor.windowsDayuse.detail.mirrorReadonly.manual";
    default: {
      const _exhaustive: never = id;
      void _exhaustive;
      return "doctor.windowsDayuse.detail.na";
    }
  }
}

// ─── Platform ───────────────────────────────────────────────────────────────

/** Normalize platform string → canonical AppPlatform-ish id. */
export function normalizeWindowsDayusePlatform(
  platform: AppPlatform | string | null | undefined,
): string {
  const p = String(platform ?? "")
    .trim()
    .toLowerCase();
  if (!p) return "other";
  if (p === "win" || p === "windows" || p === "win32") return "win";
  if (p === "mac" || p === "macos" || p === "darwin") return "mac";
  if (p === "linux") return "linux";
  return p;
}

/** True when this checklist is the product target (Windows only). */
export function isWindowsDayuseTargetPlatform(
  platform: AppPlatform | string | null | undefined,
): boolean {
  return normalizeWindowsDayusePlatform(platform) === "win";
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
 * Derive project_spaces probe fields from a project list.
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

// ─── Evaluation ─────────────────────────────────────────────────────────────

/**
 * Evaluate one checklist item against probe data.
 * Non-Windows always returns `na`. Missing probes → `manual` (honest).
 * Never invents SmartScreen / unsigned without `smartScreenProbed`.
 */
export function evaluateWindowsDayuseItem(
  id: WindowsDayuseItemId,
  probe: WindowsDayuseProbe & {
    platform?: AppPlatform | string | null;
  },
): WindowsDayuseStatus {
  if (!isWindowsDayuseTargetPlatform(probe.platform)) {
    return "na";
  }

  switch (id) {
    case "install_path": {
      // Never invent SmartScreen without an explicit probe.
      if (probe.smartScreenProbed !== true) return "manual";
      if (probe.installSigned === true) return "pass";
      if (probe.installSigned === false) return "fail";
      return "manual";
    }
    case "cli_found": {
      if (probe.cliFound === true) return "pass";
      if (probe.cliFound === false) return "fail";
      return "manual";
    }
    case "project_spaces": {
      if (probe.hasTrustedProject == null) return "manual";
      if (probe.hasTrustedProject === false) return "fail";
      // Trusted project exists; spaces verified only when pathHasSpaces is true.
      if (probe.pathHasSpaces === true) return "pass";
      // Project exists but path spaces not confirmed → manual acceptance step.
      return "manual";
    }
    case "single_attachment":
      // Paste-once / single attachment cannot be auto-proven by App probes.
      return "manual";
    case "app_update_check": {
      if (probe.updateSupported === true) return "pass";
      if (probe.updateSupported === false) return "fail";
      return "manual";
    }
    case "mirror_readonly": {
      // Default product posture is read-only (write off).
      if (probe.mirrorWriteEnabled === false) return "pass";
      if (probe.mirrorWriteEnabled === true) return "fail";
      return "manual";
    }
    default: {
      const _exhaustive: never = id;
      void _exhaustive;
      return "manual";
    }
  }
}

function countItems(items: readonly WindowsDayuseChecklistItem[]): WindowsDayuseCounts {
  let pass = 0;
  let fail = 0;
  let manual = 0;
  let na = 0;
  for (const it of items) {
    if (it.status === "pass") pass += 1;
    else if (it.status === "fail") fail += 1;
    else if (it.status === "manual") manual += 1;
    else na += 1;
  }
  return { pass, fail, manual, na, total: items.length };
}

/**
 * Build the full Windows day-use checklist from platform + probes.
 * On non-Windows every item is `na` (honesty: not the target of this list).
 */
export function buildWindowsDayuseChecklist(
  input: WindowsDayuseChecklistInput,
): WindowsDayuseChecklist {
  const platform = normalizeWindowsDayusePlatform(input.platform);
  const isTarget = platform === "win";
  const probe: WindowsDayuseProbe & { platform: string } = {
    platform,
    cliFound: input.cliFound,
    hasTrustedProject: input.hasTrustedProject,
    pathHasSpaces: input.pathHasSpaces,
    mirrorWriteEnabled: input.mirrorWriteEnabled,
    updateSupported: input.updateSupported,
    smartScreenProbed: input.smartScreenProbed,
    installSigned: input.installSigned,
  };

  const items: WindowsDayuseChecklistItem[] = WINDOWS_DAYUSE_ITEM_IDS.map(
    (id) => {
      const status = evaluateWindowsDayuseItem(id, probe);
      return {
        id,
        status,
        labelKey: LABEL_KEYS[id],
        detailKey: detailKeyFor(id, status),
        link: isTarget ? LINK_BY_ID[id] : null,
      };
    },
  );

  const counts = countItems(items);
  return {
    isTargetPlatform: isTarget,
    platform,
    items,
    counts,
    hasFail: isTarget && counts.fail > 0,
    hasManual: isTarget && counts.manual > 0,
  };
}

// ─── Empty / visibility ─────────────────────────────────────────────────────

export type WindowsDayuseEmptyKind =
  | "target"
  | "not_windows"
  | "hidden";

export type WindowsDayuseEmptyState = {
  kind: WindowsDayuseEmptyKind;
  /** Whether the checklist card should render at all. */
  show: boolean;
  /** True only on Windows — rows use real probes. */
  isTargetPlatform: boolean;
  titleKey: string;
  hintKey: string | null;
};

/**
 * Resolve card empty / visibility for non-Windows honesty.
 *
 * - Windows → `target` (show full checklist)
 * - Non-Windows + hideOnNonWindows → `hidden` (do not render card)
 * - Non-Windows default → `not_windows` (show card with N/A honesty)
 */
export function resolveWindowsDayuseEmptyState(input: {
  platform: AppPlatform | string | null | undefined;
  /** When true, hide the card entirely on non-Windows. Default false. */
  hideOnNonWindows?: boolean;
}): WindowsDayuseEmptyState {
  const isTarget = isWindowsDayuseTargetPlatform(input.platform);
  if (isTarget) {
    return {
      kind: "target",
      show: true,
      isTargetPlatform: true,
      titleKey: "doctor.windowsDayuse.title",
      hintKey: "doctor.windowsDayuse.lead",
    };
  }
  if (input.hideOnNonWindows) {
    return {
      kind: "hidden",
      show: false,
      isTargetPlatform: false,
      titleKey: "doctor.windowsDayuse.title",
      hintKey: "doctor.windowsDayuse.notTarget",
    };
  }
  return {
    kind: "not_windows",
    show: true,
    isTargetPlatform: false,
    titleKey: "doctor.windowsDayuse.title",
    hintKey: "doctor.windowsDayuse.notTarget",
  };
}

// ─── Status chips / summary ─────────────────────────────────────────────────

/** i18n key for a status chip. */
export function windowsDayuseStatusKey(
  status: WindowsDayuseStatus,
): string {
  switch (status) {
    case "pass":
      return "doctor.windowsDayuse.status.pass";
    case "fail":
      return "doctor.windowsDayuse.status.fail";
    case "manual":
      return "doctor.windowsDayuse.status.manual";
    case "na":
      return "doctor.windowsDayuse.status.na";
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return "doctor.windowsDayuse.status.manual";
    }
  }
}

/** Map status → CSS tone class suffix. */
export function windowsDayuseStatusTone(
  status: WindowsDayuseStatus,
): "ok" | "fail" | "manual" | "na" {
  switch (status) {
    case "pass":
      return "ok";
    case "fail":
      return "fail";
    case "manual":
      return "manual";
    case "na":
      return "na";
    default:
      return "manual";
  }
}

/** Platform badge i18n key. */
export function windowsDayusePlatformBadgeKey(
  platform: AppPlatform | string | null | undefined,
): string {
  const p = normalizeWindowsDayusePlatform(platform);
  if (p === "win") return "doctor.windowsDayuse.platform.win";
  if (p === "mac") return "doctor.windowsDayuse.platform.mac";
  if (p === "linux") return "doctor.windowsDayuse.platform.linux";
  return "doctor.windowsDayuse.platform.other";
}

/**
 * Plain-text checklist summary for clipboard.
 * No secrets / paths with tokens — ids + status only.
 */
export function formatWindowsDayuseSummaryText(
  checklist: WindowsDayuseChecklist,
  opts?: { title?: string; generatedAt?: string | null },
): string {
  const lines: string[] = [];
  lines.push(opts?.title?.trim() || "Grok App — Windows day-use checklist");
  lines.push(`Platform: ${checklist.platform}`);
  lines.push(
    `Target: ${checklist.isTargetPlatform ? "yes (Windows)" : "no (not the target of this list)"}`,
  );
  lines.push(
    `Summary: ${checklist.counts.pass} pass · ${checklist.counts.fail} fail · ${checklist.counts.manual} manual · ${checklist.counts.na} n/a`,
  );
  lines.push("Items:");
  for (const item of checklist.items) {
    lines.push(`  [${item.status}] ${item.id}`);
  }
  lines.push(
    "Honesty: SmartScreen/unsigned never invented without probe; single_attachment is always manual.",
  );
  lines.push(`Doc: ${WINDOWS_DAYUSE_DOCS_PATH}`);
  if (opts?.generatedAt) {
    lines.push(`Generated: ${opts.generatedAt}`);
  }
  return lines.join("\n");
}
