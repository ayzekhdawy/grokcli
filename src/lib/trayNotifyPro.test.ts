import { describe, expect, it } from "vitest";
import {
  TRAY_BUSY_BADGE_DISPLAY_CAP,
  clampBusyBadgeDisplayCount,
  deriveNotifyHonestySurface,
  deriveTrayBusyBadgeSurface,
  normalizeBusyCount,
  resolveTrayBusyBadgeCount,
} from "./trayNotifyPro";
import type { NotifyQuietHoursPref } from "./notifyQuietHours";

describe("normalizeBusyCount / clamp", () => {
  it("floors non-negative integers and rejects junk", () => {
    expect(normalizeBusyCount(3.9)).toBe(3);
    expect(normalizeBusyCount(0)).toBe(0);
    expect(normalizeBusyCount(-2)).toBe(0);
    expect(normalizeBusyCount(NaN)).toBe(0);
    expect(normalizeBusyCount("4")).toBe(4);
    expect(normalizeBusyCount(undefined)).toBe(0);
  });

  it("caps display count", () => {
    expect(clampBusyBadgeDisplayCount(1)).toBe(1);
    expect(clampBusyBadgeDisplayCount(TRAY_BUSY_BADGE_DISPLAY_CAP)).toBe(
      TRAY_BUSY_BADGE_DISPLAY_CAP,
    );
    expect(
      clampBusyBadgeDisplayCount(TRAY_BUSY_BADGE_DISPLAY_CAP + 50),
    ).toBe(TRAY_BUSY_BADGE_DISPLAY_CAP);
  });
});

describe("resolveTrayBusyBadgeCount", () => {
  it("does not apply from secondary windows", () => {
    expect(
      resolveTrayBusyBadgeCount({
        enabled: true,
        busyCount: 4,
        isSecondaryWindow: true,
      }),
    ).toEqual({ apply: false, count: 0, capped: false });
  });

  it("clears badge when pref is off", () => {
    expect(
      resolveTrayBusyBadgeCount({ enabled: false, busyCount: 7 }),
    ).toEqual({ apply: true, count: 0, capped: false });
  });

  it("applies clamped count when enabled", () => {
    expect(
      resolveTrayBusyBadgeCount({ enabled: true, busyCount: 3 }),
    ).toEqual({ apply: true, count: 3, capped: false });
    expect(
      resolveTrayBusyBadgeCount({
        enabled: true,
        busyCount: TRAY_BUSY_BADGE_DISPLAY_CAP + 1,
      }),
    ).toEqual({
      apply: true,
      count: TRAY_BUSY_BADGE_DISPLAY_CAP,
      capped: true,
    });
  });
});

describe("deriveTrayBusyBadgeSurface", () => {
  it("reports off / idle / busy / capped status keys", () => {
    expect(
      deriveTrayBusyBadgeSurface({ enabled: false, busyCount: 2 }).statusKey,
    ).toBe("settings.trayBusyBadge.status.off");
    expect(
      deriveTrayBusyBadgeSurface({ enabled: true, busyCount: 0 }).statusKey,
    ).toBe("settings.trayBusyBadge.status.idle");
    expect(
      deriveTrayBusyBadgeSurface({ enabled: true, busyCount: 2 }),
    ).toMatchObject({
      statusKey: "settings.trayBusyBadge.status.busy",
      displayCount: 2,
      severity: "info",
    });
    expect(
      deriveTrayBusyBadgeSurface({
        enabled: true,
        busyCount: TRAY_BUSY_BADGE_DISPLAY_CAP + 5,
      }),
    ).toMatchObject({
      statusKey: "settings.trayBusyBadge.status.capped",
      displayCount: TRAY_BUSY_BADGE_DISPLAY_CAP,
      capped: true,
    });
  });
});

describe("deriveNotifyHonestySurface", () => {
  const overnight: NotifyQuietHoursPref = {
    enabled: true,
    start: "22:00",
    end: "08:00",
  };

  it("warns when OS denied or unsupported", () => {
    const denied = deriveNotifyHonestySurface({
      permission: "denied",
      prefs: { notifyOnTurnDone: true, notifyOnPermission: true },
    });
    expect(denied.blockReason).toBe("os_denied");
    expect(denied.severity).toBe("warn");
    expect(denied.canFireDesktop).toBe(false);
    // Still offer retry — Tauri plugin polyfill can clear a stale WebView denial.
    expect(denied.canRequestPermission).toBe(true);

    const unsupported = deriveNotifyHonestySurface({
      permission: "unsupported",
      prefs: {},
    });
    expect(unsupported.blockReason).toBe("os_unsupported");
    expect(unsupported.severity).toBe("warn");
  });

  it("offers request when OS permission is default", () => {
    const s = deriveNotifyHonestySurface({
      permission: "default",
      prefs: { notifyOnTurnDone: true },
    });
    expect(s.blockReason).toBe("os_default");
    expect(s.canRequestPermission).toBe(true);
    expect(s.canFireDesktop).toBe(false);
    expect(s.severity).toBe("info");
  });

  it("reports prefs_all_off when both kinds disabled", () => {
    const s = deriveNotifyHonestySurface({
      permission: "granted",
      prefs: { notifyOnTurnDone: false, notifyOnPermission: false },
    });
    expect(s.blockReason).toBe("prefs_all_off");
    expect(s.anyKindEnabled).toBe(false);
    expect(s.canFireDesktop).toBe(false);
  });

  it("reports quiet hours when active (overnight wrap)", () => {
    // 23:30 local — inside 22:00–08:00.
    const now = new Date(2026, 0, 1, 23, 30, 0);
    const s = deriveNotifyHonestySurface({
      permission: "granted",
      prefs: { notifyOnTurnDone: true, notifyOnPermission: true },
      quietHours: overnight,
      now,
    });
    expect(s.quietHoursEnabled).toBe(true);
    expect(s.quietHoursActive).toBe(true);
    expect(s.blockReason).toBe("quiet_hours");
    expect(s.canFireDesktop).toBe(false);
    expect(s.blockReasonKey).toBe("settings.notify.honesty.quietHours");
  });

  it("ok when granted, prefs on, outside quiet hours", () => {
    // 12:00 — outside overnight window.
    const now = new Date(2026, 0, 1, 12, 0, 0);
    const s = deriveNotifyHonestySurface({
      permission: "granted",
      prefs: { notifyOnTurnDone: true, notifyOnPermission: false },
      soundEnabled: true,
      quietHours: overnight,
      now,
    });
    expect(s.blockReason).toBe("none");
    expect(s.canFireDesktop).toBe(true);
    expect(s.turnDoneEnabled).toBe(true);
    expect(s.permissionEnabled).toBe(false);
    expect(s.soundEnabled).toBe(true);
    expect(s.severity).toBe("none");
    expect(s.permissionLabelKey).toBe("settings.notify.permission.granted");
  });

  it("treats missing prefs as on (product default)", () => {
    const s = deriveNotifyHonestySurface({
      permission: "granted",
      prefs: null,
      now: new Date(2026, 0, 1, 12, 0, 0),
    });
    expect(s.turnDoneEnabled).toBe(true);
    expect(s.permissionEnabled).toBe(true);
    expect(s.canFireDesktop).toBe(true);
  });

  it("normalizes unknown permission to unsupported", () => {
    const s = deriveNotifyHonestySurface({
      permission: "maybe" as unknown as "granted",
      prefs: {},
    });
    expect(s.permission).toBe("unsupported");
    expect(s.blockReason).toBe("os_unsupported");
  });
});
