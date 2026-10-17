/**
 * Optional clock-based light/dark schedule (sub-option under Theme → System).
 * localStorage-only — does not touch Host AppSettings.
 *
 * When enabled and the user preference is not locked light/dark, the app
 * resolves light | dark from local wall-clock times instead of the OS scheme.
 *
 * Range semantics (mirrors quiet-hours style windows):
 * - lightFrom → darkFrom is the light period (end exclusive)
 * - darkFrom → lightFrom is the dark period (may wrap midnight)
 * - lightFrom === darkFrom → invalid / zero-width → DEFAULT_RESOLVED_THEME
 * - unparseable HH:mm → soft-fail → DEFAULT_RESOLVED_THEME
 */

import { DEFAULT_RESOLVED_THEME, type Theme, type ThemePreference } from "./theme";
import {
  normalizeHHmm,
  parseTimeToMinutes,
} from "./notifyQuietHours";

export type ThemeScheduleConfig = {
  enabled: boolean;
  /** Local time when light theme starts (HH:mm, 24h). */
  lightFrom: string;
  /** Local time when dark theme starts (HH:mm, 24h). */
  darkFrom: string;
};

export const THEME_SCHEDULE_STORAGE_KEY = "grok-app.themeSchedule";

/** Fired on `window` after a successful save (detail = config). */
export const THEME_SCHEDULE_CHANGE_EVENT = "grok-theme-schedule-change";

/** Default off; light 07:00 → dark 19:00. */
export const DEFAULT_THEME_SCHEDULE: ThemeScheduleConfig = {
  enabled: false,
  lightFrom: "07:00",
  darkFrom: "19:00",
};

/** How often the app re-evaluates the schedule while active. */
export const THEME_SCHEDULE_TICK_MS = 60_000;

/** Minimal storage surface so unit tests need no jsdom. */
export interface ThemeScheduleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): ThemeScheduleStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Re-export HH:mm helpers for schedule call sites (parse / normalize / validate). */
export { normalizeHHmm, parseTimeToMinutes };

/** True when raw is a valid HH:mm (or HH:mm:ss with seconds ignored). */
export function isValidThemeScheduleHHmm(raw: string): boolean {
  return parseTimeToMinutes(raw) != null;
}

/**
 * Range honesty for the two start times (ignores `enabled`).
 * - invalid: one or both times unparseable
 * - equal: zero-width window (soft-fail resolve)
 * - ok: distinct valid times (same-day or midnight-wrapping)
 */
export type ThemeScheduleRangeKind = "ok" | "equal" | "invalid";

export function themeScheduleRangeKind(
  cfg: Pick<ThemeScheduleConfig, "lightFrom" | "darkFrom">,
): ThemeScheduleRangeKind {
  const light = parseTimeToMinutes(cfg.lightFrom);
  const dark = parseTimeToMinutes(cfg.darkFrom);
  if (light == null || dark == null) return "invalid";
  if (light === dark) return "equal";
  return "ok";
}

/** Soft-fail when range is not ok (resolve falls back to DEFAULT_RESOLVED_THEME). */
export function isThemeScheduleRangeSoftFail(
  cfg: Pick<ThemeScheduleConfig, "lightFrom" | "darkFrom">,
): boolean {
  return themeScheduleRangeKind(cfg) !== "ok";
}

/**
 * Pure: which concrete theme is active at `now` given light/dark start times.
 * Does not consult `enabled` — callers decide when schedule applies.
 *
 * - light period: [lightFrom, darkFrom) (wraps midnight when lightFrom > darkFrom)
 * - otherwise dark
 * - invalid or equal times → DEFAULT_RESOLVED_THEME
 */
export function resolveThemeFromSchedule(
  now: Date,
  cfg: Pick<ThemeScheduleConfig, "lightFrom" | "darkFrom">,
): Theme {
  const light = parseTimeToMinutes(cfg.lightFrom);
  const dark = parseTimeToMinutes(cfg.darkFrom);
  if (light == null || dark == null) return DEFAULT_RESOLVED_THEME;
  if (light === dark) return DEFAULT_RESOLVED_THEME;

  const mins = now.getHours() * 60 + now.getMinutes();

  if (light < dark) {
    // Same calendar day light window, e.g. 07:00 → 19:00.
    return mins >= light && mins < dark ? "light" : "dark";
  }
  // Light wraps midnight, e.g. 20:00 → 08:00 (unusual but supported).
  return mins >= light || mins < dark ? "light" : "dark";
}

/**
 * Schedule applies only when preference is not forced light/dark
 * (i.e. System path) and the user enabled the schedule.
 */
export function isThemeScheduleActive(
  preference: ThemePreference,
  cfg: ThemeScheduleConfig | null | undefined,
): boolean {
  return preference === "system" && !!cfg?.enabled;
}

/**
 * Resolve concrete theme: forced light/dark win; else schedule if active;
 * else OS system theme.
 */
export function resolveThemeWithSchedule(
  preference: ThemePreference,
  systemTheme: Theme,
  schedule: ThemeScheduleConfig,
  now: Date = new Date(),
): Theme {
  if (preference === "light" || preference === "dark") return preference;
  if (schedule.enabled) {
    return resolveThemeFromSchedule(now, schedule);
  }
  return systemTheme;
}

/** Next wall-clock flip after `now` (switch instants are lightFrom / darkFrom). */
export type ThemeScheduleNextSwitch = {
  /** Local Date at the switch (seconds/ms zeroed). */
  at: Date;
  /** Theme that becomes active at `at`. */
  toTheme: Theme;
  /** Zero-padded HH:mm of the switch. */
  atHHmm: string;
  /**
   * Calendar-day offset relative to `now`'s local date:
   * 0 = same day, 1 = next calendar day (never further for a 2-boundary day).
   */
  dayOffset: 0 | 1;
};

function dateAtLocalMinutes(base: Date, dayOffset: number, mins: number): Date {
  const d = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + dayOffset,
    Math.floor(mins / 60),
    mins % 60,
    0,
    0,
  );
  return d;
}

function localDayOffset(from: Date, to: Date): 0 | 1 {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  const days = Math.round((b - a) / 86_400_000);
  return days <= 0 ? 0 : 1;
}

/**
 * Pure: next theme flip strictly after `now`.
 * Returns null when times are invalid/equal (no meaningful boundary).
 * Does not consult `enabled` — callers decide when to show the preview.
 */
export function computeNextThemeSwitch(
  now: Date,
  cfg: Pick<ThemeScheduleConfig, "lightFrom" | "darkFrom">,
): ThemeScheduleNextSwitch | null {
  const light = parseTimeToMinutes(cfg.lightFrom);
  const dark = parseTimeToMinutes(cfg.darkFrom);
  if (light == null || dark == null || light === dark) return null;

  const candidates: Array<{ at: Date; toTheme: Theme; atHHmm: string }> = [];
  for (const dayOffset of [0, 1, 2]) {
    for (const [mins, toTheme] of [
      [light, "light" as const],
      [dark, "dark" as const],
    ] as const) {
      const at = dateAtLocalMinutes(now, dayOffset, mins);
      if (at.getTime() <= now.getTime()) continue;
      const hh = Math.floor(mins / 60);
      const mm = mins % 60;
      candidates.push({
        at,
        toTheme,
        atHHmm: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
      });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
  const best = candidates[0]!;
  return {
    at: best.at,
    toTheme: best.toTheme,
    atHHmm: best.atHHmm,
    dayOffset: localDayOffset(now, best.at),
  };
}

/**
 * Settings honesty surface for the theme schedule control.
 * Pure — no I/O, no Date.now (pass `now`).
 */
export type ThemeScheduleHonestyKind =
  | "off"
  | "inactive_pref"
  | "invalid"
  | "equal"
  | "active";

export type ThemeScheduleStatusKey =
  | "settings.themeSchedule.inactivePref"
  | "settings.themeSchedule.invalidTimes"
  | "settings.themeSchedule.invalidEqual"
  | "settings.themeSchedule.nextSwitch"
  | "settings.themeSchedule.nextSwitchTomorrow";

export type ThemeScheduleHonesty = {
  kind: ThemeScheduleHonestyKind;
  /** warn = soft-fail range; info = preview / inactive pref; none = off. */
  severity: "none" | "info" | "warn";
  /** Schedule-resolved theme when kind is active; else null. */
  currentTheme: Theme | null;
  next: ThemeScheduleNextSwitch | null;
  /**
   * Primary status line key under the controls (null when off and nothing to say).
   * Callers interpolate `{time}` / `{theme}` for next-switch keys.
   */
  statusKey: ThemeScheduleStatusKey | null;
};

/**
 * Derive Settings honesty for schedule: soft-fail ranges, inactive preference,
 * and next-switch preview when the clock schedule is live.
 */
export function deriveThemeScheduleHonesty(input: {
  preference: ThemePreference;
  schedule: ThemeScheduleConfig;
  now?: Date;
}): ThemeScheduleHonesty {
  const now = input.now ?? new Date();
  const { preference, schedule } = input;

  if (!schedule.enabled) {
    return {
      kind: "off",
      severity: "none",
      currentTheme: null,
      next: null,
      statusKey: null,
    };
  }

  const range = themeScheduleRangeKind(schedule);
  if (range === "invalid") {
    return {
      kind: "invalid",
      severity: "warn",
      currentTheme: null,
      next: null,
      statusKey: "settings.themeSchedule.invalidTimes",
    };
  }
  if (range === "equal") {
    return {
      kind: "equal",
      severity: "warn",
      currentTheme: null,
      next: null,
      statusKey: "settings.themeSchedule.invalidEqual",
    };
  }

  if (preference !== "system") {
    return {
      kind: "inactive_pref",
      severity: "info",
      currentTheme: null,
      next: computeNextThemeSwitch(now, schedule),
      statusKey: "settings.themeSchedule.inactivePref",
    };
  }

  const next = computeNextThemeSwitch(now, schedule);
  const statusKey: ThemeScheduleStatusKey | null = next
    ? next.dayOffset === 0
      ? "settings.themeSchedule.nextSwitch"
      : "settings.themeSchedule.nextSwitchTomorrow"
    : null;

  return {
    kind: "active",
    severity: "info",
    currentTheme: resolveThemeFromSchedule(now, schedule),
    next,
    statusKey,
  };
}

/** Parse stored JSON / object; invalid → defaults. */
export function parseThemeSchedule(raw: unknown): ThemeScheduleConfig {
  if (raw == null || raw === "") return { ...DEFAULT_THEME_SCHEDULE };

  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as unknown;
    } catch {
      return { ...DEFAULT_THEME_SCHEDULE };
    }
  }
  if (!obj || typeof obj !== "object") {
    return { ...DEFAULT_THEME_SCHEDULE };
  }

  const rec = obj as Record<string, unknown>;
  const enabled = rec.enabled === true;
  const lightFrom =
    typeof rec.lightFrom === "string"
      ? normalizeHHmm(rec.lightFrom) ?? DEFAULT_THEME_SCHEDULE.lightFrom
      : DEFAULT_THEME_SCHEDULE.lightFrom;
  const darkFrom =
    typeof rec.darkFrom === "string"
      ? normalizeHHmm(rec.darkFrom) ?? DEFAULT_THEME_SCHEDULE.darkFrom
      : DEFAULT_THEME_SCHEDULE.darkFrom;

  return { enabled, lightFrom, darkFrom };
}

export function loadThemeSchedule(
  storage: ThemeScheduleStorage = defaultStorage(),
): ThemeScheduleConfig {
  try {
    return parseThemeSchedule(storage.getItem(THEME_SCHEDULE_STORAGE_KEY));
  } catch {
    /* private mode */
    return { ...DEFAULT_THEME_SCHEDULE };
  }
}

export function saveThemeSchedule(
  cfg: ThemeScheduleConfig,
  storage: ThemeScheduleStorage = defaultStorage(),
): void {
  const lightFrom =
    normalizeHHmm(cfg.lightFrom) ?? DEFAULT_THEME_SCHEDULE.lightFrom;
  const darkFrom =
    normalizeHHmm(cfg.darkFrom) ?? DEFAULT_THEME_SCHEDULE.darkFrom;
  const next: ThemeScheduleConfig = {
    enabled: !!cfg.enabled,
    lightFrom,
    darkFrom,
  };
  try {
    storage.setItem(THEME_SCHEDULE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(THEME_SCHEDULE_CHANGE_EVENT, { detail: next }),
      );
    } catch {
      /* ignore */
    }
  }
}
