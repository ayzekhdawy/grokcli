import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RESOLVED_THEME } from "./theme";
import {
  DEFAULT_THEME_SCHEDULE,
  THEME_SCHEDULE_CHANGE_EVENT,
  THEME_SCHEDULE_STORAGE_KEY,
  computeNextThemeSwitch,
  deriveThemeScheduleHonesty,
  isThemeScheduleActive,
  isThemeScheduleRangeSoftFail,
  isValidThemeScheduleHHmm,
  loadThemeSchedule,
  normalizeHHmm,
  parseThemeSchedule,
  parseTimeToMinutes,
  resolveThemeFromSchedule,
  resolveThemeWithSchedule,
  saveThemeSchedule,
  themeScheduleRangeKind,
  type ThemeScheduleStorage,
} from "./themeSchedule";

function memoryStorage(
  initial: Record<string, string> = {},
): ThemeScheduleStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

/** Fixed local clock (year/month irrelevant for HH:mm windows). */
function at(hours: number, minutes: number, seconds = 0): Date {
  return new Date(2026, 0, 15, hours, minutes, seconds, 0);
}

describe("parse / validate HH:mm", () => {
  it("accepts HH:mm and optional :ss; normalizes padding", () => {
    expect(isValidThemeScheduleHHmm("7:30")).toBe(true);
    expect(isValidThemeScheduleHHmm("07:30")).toBe(true);
    expect(isValidThemeScheduleHHmm("19:00:00")).toBe(true);
    expect(parseTimeToMinutes("7:30")).toBe(7 * 60 + 30);
    expect(normalizeHHmm("7:30")).toBe("07:30");
    expect(normalizeHHmm("21:05:00")).toBe("21:05");
  });

  it("rejects out-of-range and garbage", () => {
    expect(isValidThemeScheduleHHmm("")).toBe(false);
    expect(isValidThemeScheduleHHmm("24:00")).toBe(false);
    expect(isValidThemeScheduleHHmm("12:60")).toBe(false);
    expect(isValidThemeScheduleHHmm("noon")).toBe(false);
    expect(normalizeHHmm("bad")).toBeNull();
  });
});

describe("themeScheduleRangeKind / soft-fail", () => {
  it("ok for distinct valid times (same-day or wrap)", () => {
    expect(
      themeScheduleRangeKind({ lightFrom: "07:00", darkFrom: "19:00" }),
    ).toBe("ok");
    expect(
      themeScheduleRangeKind({ lightFrom: "20:00", darkFrom: "08:00" }),
    ).toBe("ok");
    expect(
      isThemeScheduleRangeSoftFail({ lightFrom: "07:00", darkFrom: "19:00" }),
    ).toBe(false);
  });

  it("equal times soft-fail", () => {
    expect(
      themeScheduleRangeKind({ lightFrom: "10:00", darkFrom: "10:00" }),
    ).toBe("equal");
    expect(
      isThemeScheduleRangeSoftFail({ lightFrom: "10:00", darkFrom: "10:00" }),
    ).toBe(true);
  });

  it("invalid times soft-fail", () => {
    expect(
      themeScheduleRangeKind({ lightFrom: "bad", darkFrom: "19:00" }),
    ).toBe("invalid");
    expect(
      themeScheduleRangeKind({ lightFrom: "07:00", darkFrom: "xx" }),
    ).toBe("invalid");
    expect(
      isThemeScheduleRangeSoftFail({ lightFrom: "bad", darkFrom: "19:00" }),
    ).toBe(true);
  });
});

describe("resolveThemeFromSchedule", () => {
  const day: Pick<typeof DEFAULT_THEME_SCHEDULE, "lightFrom" | "darkFrom"> = {
    lightFrom: "07:00",
    darkFrom: "19:00",
  };

  it("uses light in [lightFrom, darkFrom) for same-day windows", () => {
    expect(resolveThemeFromSchedule(at(7, 0), day)).toBe("light");
    expect(resolveThemeFromSchedule(at(12, 0), day)).toBe("light");
    expect(resolveThemeFromSchedule(at(18, 59), day)).toBe("light");
    expect(resolveThemeFromSchedule(at(19, 0), day)).toBe("dark");
    expect(resolveThemeFromSchedule(at(23, 30), day)).toBe("dark");
    expect(resolveThemeFromSchedule(at(0, 0), day)).toBe("dark");
    expect(resolveThemeFromSchedule(at(6, 59), day)).toBe("dark");
  });

  it("supports light window wrapping midnight (lightFrom > darkFrom)", () => {
    const wrap = { lightFrom: "20:00", darkFrom: "08:00" };
    expect(resolveThemeFromSchedule(at(20, 0), wrap)).toBe("light");
    expect(resolveThemeFromSchedule(at(23, 0), wrap)).toBe("light");
    expect(resolveThemeFromSchedule(at(0, 0), wrap)).toBe("light");
    expect(resolveThemeFromSchedule(at(7, 59), wrap)).toBe("light");
    expect(resolveThemeFromSchedule(at(8, 0), wrap)).toBe("dark");
    expect(resolveThemeFromSchedule(at(12, 0), wrap)).toBe("dark");
    expect(resolveThemeFromSchedule(at(19, 59), wrap)).toBe("dark");
  });

  it("falls back when times equal or invalid", () => {
    expect(
      resolveThemeFromSchedule(at(12, 0), {
        lightFrom: "10:00",
        darkFrom: "10:00",
      }),
    ).toBe(DEFAULT_RESOLVED_THEME);
    expect(
      resolveThemeFromSchedule(at(12, 0), {
        lightFrom: "bad",
        darkFrom: "19:00",
      }),
    ).toBe(DEFAULT_RESOLVED_THEME);
  });

  it("is pure for a fixed clock (no Date.now dependency)", () => {
    const fixed = at(8, 30);
    expect(resolveThemeFromSchedule(fixed, day)).toBe("light");
    // Same inputs always same output.
    expect(resolveThemeFromSchedule(fixed, day)).toBe(
      resolveThemeFromSchedule(fixed, day),
    );
  });
});

describe("computeNextThemeSwitch", () => {
  const day = { lightFrom: "07:00", darkFrom: "19:00" };

  it("returns null for equal or invalid ranges", () => {
    expect(
      computeNextThemeSwitch(at(12, 0), {
        lightFrom: "10:00",
        darkFrom: "10:00",
      }),
    ).toBeNull();
    expect(
      computeNextThemeSwitch(at(12, 0), {
        lightFrom: "bad",
        darkFrom: "19:00",
      }),
    ).toBeNull();
  });

  it("next is darkFrom during light window (same day)", () => {
    const n = computeNextThemeSwitch(at(10, 0), day);
    expect(n).not.toBeNull();
    expect(n!.toTheme).toBe("dark");
    expect(n!.atHHmm).toBe("19:00");
    expect(n!.dayOffset).toBe(0);
    expect(n!.at.getHours()).toBe(19);
    expect(n!.at.getMinutes()).toBe(0);
  });

  it("next is lightFrom next morning during evening dark", () => {
    const n = computeNextThemeSwitch(at(20, 0), day);
    expect(n).not.toBeNull();
    expect(n!.toTheme).toBe("light");
    expect(n!.atHHmm).toBe("07:00");
    expect(n!.dayOffset).toBe(1);
  });

  it("next is lightFrom later same day before light starts", () => {
    const n = computeNextThemeSwitch(at(5, 0), day);
    expect(n).not.toBeNull();
    expect(n!.toTheme).toBe("light");
    expect(n!.atHHmm).toBe("07:00");
    expect(n!.dayOffset).toBe(0);
  });

  it("strictly after now — at exact darkFrom, next is lightFrom", () => {
    const n = computeNextThemeSwitch(at(19, 0), day);
    expect(n).not.toBeNull();
    expect(n!.toTheme).toBe("light");
    expect(n!.atHHmm).toBe("07:00");
    expect(n!.dayOffset).toBe(1);
  });

  it("handles midnight-wrapping light window", () => {
    const wrap = { lightFrom: "20:00", darkFrom: "08:00" };
    // 22:00 light → next dark at 08:00 tomorrow
    const evening = computeNextThemeSwitch(at(22, 0), wrap);
    expect(evening!.toTheme).toBe("dark");
    expect(evening!.atHHmm).toBe("08:00");
    expect(evening!.dayOffset).toBe(1);
    // 10:00 dark → next light at 20:00 today
    const midday = computeNextThemeSwitch(at(10, 0), wrap);
    expect(midday!.toTheme).toBe("light");
    expect(midday!.atHHmm).toBe("20:00");
    expect(midday!.dayOffset).toBe(0);
  });

  it("uses sub-minute clock so switch at :00 is still next when now has seconds past? no — after", () => {
    // at 18:59:30 → still next dark at 19:00 same day
    const n = computeNextThemeSwitch(at(18, 59, 30), day);
    expect(n!.toTheme).toBe("dark");
    expect(n!.atHHmm).toBe("19:00");
    expect(n!.dayOffset).toBe(0);
  });
});

describe("deriveThemeScheduleHonesty", () => {
  const on = {
    enabled: true,
    lightFrom: "07:00",
    darkFrom: "19:00",
  };

  it("off when schedule disabled", () => {
    const h = deriveThemeScheduleHonesty({
      preference: "system",
      schedule: { ...on, enabled: false },
      now: at(12, 0),
    });
    expect(h.kind).toBe("off");
    expect(h.severity).toBe("none");
    expect(h.statusKey).toBeNull();
    expect(h.next).toBeNull();
  });

  it("warns on equal times soft-fail", () => {
    const h = deriveThemeScheduleHonesty({
      preference: "system",
      schedule: { enabled: true, lightFrom: "10:00", darkFrom: "10:00" },
      now: at(12, 0),
    });
    expect(h.kind).toBe("equal");
    expect(h.severity).toBe("warn");
    expect(h.statusKey).toBe("settings.themeSchedule.invalidEqual");
    expect(h.next).toBeNull();
  });

  it("warns on invalid times soft-fail", () => {
    const h = deriveThemeScheduleHonesty({
      preference: "system",
      schedule: { enabled: true, lightFrom: "xx", darkFrom: "19:00" },
      now: at(12, 0),
    });
    expect(h.kind).toBe("invalid");
    expect(h.severity).toBe("warn");
    expect(h.statusKey).toBe("settings.themeSchedule.invalidTimes");
  });

  it("inactive_pref when theme locked light/dark", () => {
    const h = deriveThemeScheduleHonesty({
      preference: "light",
      schedule: on,
      now: at(12, 0),
    });
    expect(h.kind).toBe("inactive_pref");
    expect(h.severity).toBe("info");
    expect(h.statusKey).toBe("settings.themeSchedule.inactivePref");
    // Still computes next for transparency, but status is inactive.
    expect(h.next?.atHHmm).toBe("19:00");
  });

  it("active with next-switch today / tomorrow keys", () => {
    const noon = deriveThemeScheduleHonesty({
      preference: "system",
      schedule: on,
      now: at(12, 0),
    });
    expect(noon.kind).toBe("active");
    expect(noon.severity).toBe("info");
    expect(noon.currentTheme).toBe("light");
    expect(noon.statusKey).toBe("settings.themeSchedule.nextSwitch");
    expect(noon.next?.toTheme).toBe("dark");
    expect(noon.next?.atHHmm).toBe("19:00");

    const night = deriveThemeScheduleHonesty({
      preference: "system",
      schedule: on,
      now: at(20, 0),
    });
    expect(night.kind).toBe("active");
    expect(night.currentTheme).toBe("dark");
    expect(night.statusKey).toBe("settings.themeSchedule.nextSwitchTomorrow");
    expect(night.next?.toTheme).toBe("light");
    expect(night.next?.atHHmm).toBe("07:00");
  });
});

describe("resolveThemeWithSchedule / isThemeScheduleActive", () => {
  const on = {
    enabled: true,
    lightFrom: "07:00",
    darkFrom: "19:00",
  };
  const off = { ...on, enabled: false };

  it("forced light/dark ignore schedule", () => {
    expect(resolveThemeWithSchedule("light", "dark", on, at(23, 0))).toBe(
      "light",
    );
    expect(resolveThemeWithSchedule("dark", "light", on, at(12, 0))).toBe(
      "dark",
    );
    expect(isThemeScheduleActive("light", on)).toBe(false);
    expect(isThemeScheduleActive("dark", on)).toBe(false);
  });

  it("system + schedule enabled uses wall clock", () => {
    expect(resolveThemeWithSchedule("system", "dark", on, at(10, 0))).toBe(
      "light",
    );
    expect(resolveThemeWithSchedule("system", "light", on, at(22, 0))).toBe(
      "dark",
    );
    expect(isThemeScheduleActive("system", on)).toBe(true);
  });

  it("system + schedule disabled follows OS theme", () => {
    expect(resolveThemeWithSchedule("system", "dark", off, at(10, 0))).toBe(
      "dark",
    );
    expect(resolveThemeWithSchedule("system", "light", off, at(22, 0))).toBe(
      "light",
    );
    expect(isThemeScheduleActive("system", off)).toBe(false);
  });

  it("system + equal times soft-fails to DEFAULT_RESOLVED_THEME", () => {
    const equal = {
      enabled: true,
      lightFrom: "12:00",
      darkFrom: "12:00",
    };
    expect(resolveThemeWithSchedule("system", "light", equal, at(15, 0))).toBe(
      DEFAULT_RESOLVED_THEME,
    );
  });
});

describe("load / save / parse ThemeSchedule", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults when empty or invalid", () => {
    expect(DEFAULT_THEME_SCHEDULE.enabled).toBe(false);
    expect(parseThemeSchedule(null)).toEqual(DEFAULT_THEME_SCHEDULE);
    expect(parseThemeSchedule("")).toEqual(DEFAULT_THEME_SCHEDULE);
    expect(parseThemeSchedule("not-json")).toEqual(DEFAULT_THEME_SCHEDULE);
    expect(loadThemeSchedule(memoryStorage())).toEqual(DEFAULT_THEME_SCHEDULE);
  });

  it("parses enabled + times (normalizes HH:mm)", () => {
    expect(
      parseThemeSchedule(
        JSON.stringify({
          enabled: true,
          lightFrom: "7:30",
          darkFrom: "21:05:00",
        }),
      ),
    ).toEqual({
      enabled: true,
      lightFrom: "07:30",
      darkFrom: "21:05",
    });
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveThemeSchedule(
      { enabled: true, lightFrom: "06:30", darkFrom: "18:00" },
      s,
    );
    expect(s.data[THEME_SCHEDULE_STORAGE_KEY]).toBe(
      JSON.stringify({
        enabled: true,
        lightFrom: "06:30",
        darkFrom: "18:00",
      }),
    );
    expect(loadThemeSchedule(s)).toEqual({
      enabled: true,
      lightFrom: "06:30",
      darkFrom: "18:00",
    });
  });

  it("dispatches change event on save when window exists", () => {
    const listeners = new Map<string, Set<EventListener>>();
    const stubWindow = {
      addEventListener(type: string, listener: EventListener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
      removeEventListener(type: string, listener: EventListener) {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent(ev: Event) {
        const set = listeners.get(ev.type);
        if (set) for (const fn of set) fn(ev);
        return true;
      },
    };
    vi.stubGlobal("window", stubWindow);
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent<T = unknown> extends Event {
        detail: T;
        constructor(type: string, init?: CustomEventInit<T>) {
          super(type);
          this.detail = init?.detail as T;
        }
      },
    );

    const handler = vi.fn();
    stubWindow.addEventListener(THEME_SCHEDULE_CHANGE_EVENT, handler);
    saveThemeSchedule(
      { enabled: true, lightFrom: "08:00", darkFrom: "20:00" },
      memoryStorage(),
    );
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0] as CustomEvent;
    expect(ev.detail).toEqual({
      enabled: true,
      lightFrom: "08:00",
      darkFrom: "20:00",
    });
  });
});
