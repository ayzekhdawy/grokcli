/**
 * TRAY-NOTIFY-PRO — pure helpers for dock/tray badge + desktop
 * notification prefs honesty.
 *
 * - Dock/tray badge count is supplied by the caller (product: unread
 *   sessions after background turn end — never invents activity).
 * - Desktop notify honesty reports OS permission + prefs + quiet hours;
 *   never claims a notification will fire when the OS / prefs block it.
 * - Soft-fail closed: invalid numbers → 0; secondary windows never apply.
 */

import type { DesktopNotifyPrefs } from "./desktopNotify";
import {
  isInQuietHours,
  type NotifyQuietHoursPref,
} from "./notifyQuietHours";

// ── Busy badge ────────────────────────────────────────────────────────

/** Dock badge display cap (two digits stay readable on macOS Dock). */
export const TRAY_BUSY_BADGE_DISPLAY_CAP = 99;

/** Non-negative integer busy count; invalid → 0. */
export function normalizeBusyCount(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** Clamp for dock/tray display (cap, never negative). */
export function clampBusyBadgeDisplayCount(count: number): number {
  return Math.min(normalizeBusyCount(count), TRAY_BUSY_BADGE_DISPLAY_CAP);
}

export type ResolveTrayBusyBadgeCountInput = {
  /** User pref (`trayBusyBadgePref`); default product is on. */
  enabled: boolean;
  /**
   * Raw badge count from the caller (product: unread session count after
   * background turn end). Name kept for API stability.
   */
  busyCount: number;
  /** Secondary windows must not overwrite the main dock badge. */
  isSecondaryWindow?: boolean;
};

export type ResolveTrayBusyBadgeCountResult = {
  /** False when this window should not call `traySetBusyCount`. */
  apply: boolean;
  /** Count to send to the host (`0` clears). Always clamped. */
  count: number;
  /** True when raw busyCount exceeded the display cap. */
  capped: boolean;
};

/**
 * Resolve the dock/tray badge count for this window.
 *
 * - Secondary → do not apply (view-only panes never drive the badge).
 * - Pref off → apply `0` (clear).
 * - Pref on → clamp raw count to the display cap.
 */
export function resolveTrayBusyBadgeCount(
  input: ResolveTrayBusyBadgeCountInput,
): ResolveTrayBusyBadgeCountResult {
  if (input.isSecondaryWindow) {
    return { apply: false, count: 0, capped: false };
  }
  if (!input.enabled) {
    return { apply: true, count: 0, capped: false };
  }
  const raw = normalizeBusyCount(input.busyCount);
  const count = clampBusyBadgeDisplayCount(raw);
  return {
    apply: true,
    count,
    capped: raw > TRAY_BUSY_BADGE_DISPLAY_CAP,
  };
}

export type TrayBusyBadgeStatusKey =
  | "settings.trayBusyBadge.status.off"
  | "settings.trayBusyBadge.status.idle"
  | "settings.trayBusyBadge.status.busy"
  | "settings.trayBusyBadge.status.capped";

export type TrayBusyBadgeSurface = {
  enabled: boolean;
  busyCount: number;
  displayCount: number;
  capped: boolean;
  statusKey: TrayBusyBadgeStatusKey;
  severity: "none" | "info";
};

/** Settings status line under the dock-badge toggle (honest live count). */
export function deriveTrayBusyBadgeSurface(opts: {
  enabled: boolean;
  busyCount: number;
}): TrayBusyBadgeSurface {
  const busyCount = normalizeBusyCount(opts.busyCount);
  const displayCount = clampBusyBadgeDisplayCount(busyCount);
  const capped = busyCount > TRAY_BUSY_BADGE_DISPLAY_CAP;

  if (!opts.enabled) {
    return {
      enabled: false,
      busyCount,
      displayCount: 0,
      capped: false,
      statusKey: "settings.trayBusyBadge.status.off",
      severity: "none",
    };
  }
  if (busyCount === 0) {
    return {
      enabled: true,
      busyCount: 0,
      displayCount: 0,
      capped: false,
      statusKey: "settings.trayBusyBadge.status.idle",
      severity: "none",
    };
  }
  return {
    enabled: true,
    busyCount,
    displayCount,
    capped,
    statusKey: capped
      ? "settings.trayBusyBadge.status.capped"
      : "settings.trayBusyBadge.status.busy",
    severity: "info",
  };
}

// ── Desktop notify honesty ────────────────────────────────────────────

export type NotifyOsPermission =
  | "granted"
  | "denied"
  | "default"
  | "unsupported";

export type NotifyBlockReason =
  | "none"
  | "os_denied"
  | "os_default"
  | "os_unsupported"
  | "prefs_all_off"
  | "quiet_hours";

export type NotifyHonestyBlockReasonKey =
  | "settings.notify.honesty.ok"
  | "settings.notify.honesty.osDenied"
  | "settings.notify.honesty.osDefault"
  | "settings.notify.honesty.osUnsupported"
  | "settings.notify.honesty.prefsOff"
  | "settings.notify.honesty.quietHours";

export type NotifyPermissionLabelKey =
  | "settings.notify.permission.granted"
  | "settings.notify.permission.denied"
  | "settings.notify.permission.default"
  | "settings.notify.permission.unsupported";

export type NotifyHonestySurface = {
  permission: NotifyOsPermission;
  turnDoneEnabled: boolean;
  permissionEnabled: boolean;
  /** At least one of turn-done / permission notify prefs is on. */
  anyKindEnabled: boolean;
  soundEnabled: boolean;
  quietHoursEnabled: boolean;
  /** Pref enabled and local time is inside the quiet window. */
  quietHoursActive: boolean;
  /**
   * Desktop notifications can fire for at least one kind given OS + prefs +
   * quiet hours (ignores document focus and per-session mute).
   */
  canFireDesktop: boolean;
  blockReason: NotifyBlockReason;
  blockReasonKey: NotifyHonestyBlockReasonKey;
  permissionLabelKey: NotifyPermissionLabelKey;
  severity: "none" | "info" | "warn";
  /** Offer a "Request permission" control when OS is still `default`. */
  canRequestPermission: boolean;
};

function normalizeOsPermission(
  raw: NotifyOsPermission | null | undefined,
): NotifyOsPermission {
  if (
    raw === "granted" ||
    raw === "denied" ||
    raw === "default" ||
    raw === "unsupported"
  ) {
    return raw;
  }
  return "unsupported";
}

function blockReasonKeyFor(
  reason: NotifyBlockReason,
): NotifyHonestyBlockReasonKey {
  switch (reason) {
    case "os_denied":
      return "settings.notify.honesty.osDenied";
    case "os_default":
      return "settings.notify.honesty.osDefault";
    case "os_unsupported":
      return "settings.notify.honesty.osUnsupported";
    case "prefs_all_off":
      return "settings.notify.honesty.prefsOff";
    case "quiet_hours":
      return "settings.notify.honesty.quietHours";
    default:
      return "settings.notify.honesty.ok";
  }
}

function permissionLabelKeyFor(
  permission: NotifyOsPermission,
): NotifyPermissionLabelKey {
  switch (permission) {
    case "granted":
      return "settings.notify.permission.granted";
    case "denied":
      return "settings.notify.permission.denied";
    case "default":
      return "settings.notify.permission.default";
    default:
      return "settings.notify.permission.unsupported";
  }
}

/**
 * Derive Settings honesty surface for desktop notifications.
 *
 * Priority of block reasons (first match wins):
 * OS unsupported → denied → default → all prefs off → quiet hours active.
 * In-app toasts are never gated here (callers only use this for desktop).
 */
export function deriveNotifyHonestySurface(input: {
  permission: NotifyOsPermission | null | undefined;
  prefs: DesktopNotifyPrefs | null | undefined;
  soundEnabled?: boolean;
  quietHours?: NotifyQuietHoursPref | null;
  now?: Date;
}): NotifyHonestySurface {
  const permission = normalizeOsPermission(input.permission);
  const turnDoneEnabled = input.prefs?.notifyOnTurnDone !== false;
  const permissionEnabled = input.prefs?.notifyOnPermission !== false;
  const anyKindEnabled = turnDoneEnabled || permissionEnabled;
  const soundEnabled = !!input.soundEnabled;
  const quietHours = input.quietHours ?? null;
  const quietHoursEnabled = !!quietHours?.enabled;
  const quietHoursActive = isInQuietHours(
    input.now ?? new Date(),
    quietHours,
  );

  let blockReason: NotifyBlockReason = "none";
  if (permission === "unsupported") blockReason = "os_unsupported";
  else if (permission === "denied") blockReason = "os_denied";
  else if (permission === "default") blockReason = "os_default";
  else if (!anyKindEnabled) blockReason = "prefs_all_off";
  else if (quietHoursActive) blockReason = "quiet_hours";

  const canFireDesktop =
    permission === "granted" && anyKindEnabled && !quietHoursActive;

  const severity: NotifyHonestySurface["severity"] =
    blockReason === "os_denied" || blockReason === "os_unsupported"
      ? "warn"
      : blockReason === "none"
        ? "none"
        : "info";

  return {
    permission,
    turnDoneEnabled,
    permissionEnabled,
    anyKindEnabled,
    soundEnabled,
    quietHoursEnabled,
    quietHoursActive,
    canFireDesktop,
    blockReason,
    blockReasonKey: blockReasonKeyFor(blockReason),
    permissionLabelKey: permissionLabelKeyFor(permission),
    severity,
    // Offer "Request" for default, and also for denied so the user can retry
    // after installing the native notification plugin (Tauri polyfill can
    // clear a stale bare-WebView denial). Unsupported stays non-actionable.
    canRequestPermission:
      permission === "default" || permission === "denied",
  };
}
