/**
 * App-update simulation for sidebar / About QA.
 *
 * Gated by Settings → About → Developer mode (not only `import.meta.env.DEV`).
 *
 * UI: Settings developer tools (sim mode select).
 * Console (when developer mode is on):
 *   __grokSimAppUpdate("silent" | "manual" | "off")
 */

import {
  isDeveloperModeEnabled,
  DEVELOPER_MODE_CHANGE_EVENT,
} from "@/lib/developerModePref";

export const UPDATE_SIM_STORAGE_KEY = "grok-sim-app-update";
/** Fired after sim mode is written (detail = UpdateSimMode). */
export const UPDATE_SIM_CHANGE_EVENT = "grok-sim-app-update-change";
/** Fake version never claimed to be a real release. */
export const UPDATE_SIM_VERSION = "99.0.0-sim";

export type UpdateSimMode = "off" | "silent" | "manual";

/** Simulation is allowed only while developer mode is on. */
export function isUpdateSimAllowed(): boolean {
  return isDeveloperModeEnabled();
}

function parseSimToken(raw: string | null | undefined): UpdateSimMode {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "1" || v === "true" || v === "silent" || v === "on") return "silent";
  if (v === "manual" || v === "github") return "manual";
  if (v === "0" || v === "false" || v === "off") return "off";
  return "off";
}

/**
 * Prefer `?simUpdate=silent|manual|off` (persists when allowed), else storage.
 * Always `off` when developer mode is disabled.
 */
export function readUpdateSimMode(): UpdateSimMode {
  if (!isUpdateSimAllowed()) return "off";
  try {
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search).get("simUpdate");
      if (q != null && q !== "") {
        const fromQuery = parseSimToken(q);
        writeUpdateSimMode(fromQuery);
        return fromQuery;
      }
    }
    return parseSimToken(localStorage.getItem(UPDATE_SIM_STORAGE_KEY));
  } catch {
    return "off";
  }
}

export function isUpdateSimActive(): boolean {
  return readUpdateSimMode() !== "off";
}

function dispatchSimChange(mode: UpdateSimMode): void {
  if (
    typeof window === "undefined" ||
    typeof window.dispatchEvent !== "function"
  ) {
    return;
  }
  try {
    window.dispatchEvent(
      new CustomEvent(UPDATE_SIM_CHANGE_EVENT, { detail: mode }),
    );
  } catch {
    /* ignore */
  }
}

export function writeUpdateSimMode(mode: UpdateSimMode): void {
  // Allow clearing even if developer mode is off (cleanup on toggle-off).
  if (!isUpdateSimAllowed() && mode !== "off") return;
  try {
    if (mode === "off") {
      localStorage.removeItem(UPDATE_SIM_STORAGE_KEY);
    } else {
      localStorage.setItem(UPDATE_SIM_STORAGE_KEY, mode);
    }
  } catch {
    /* ignore quota / private mode */
  }
  dispatchSimChange(mode);
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * When developer mode is turned off, wipe any active simulation so product
 * paths resume real updater checks.
 */
export function clearUpdateSimIfDeveloperModeOff(): void {
  if (isDeveloperModeEnabled()) return;
  try {
    const had = localStorage.getItem(UPDATE_SIM_STORAGE_KEY);
    if (had != null) {
      localStorage.removeItem(UPDATE_SIM_STORAGE_KEY);
      dispatchSimChange("off");
    }
  } catch {
    /* ignore */
  }
}

/** Register `window.__grokSimAppUpdate` when developer mode is on. */
export function installUpdateSimConsoleApi(): void {
  if (typeof window === "undefined") return;
  if (!isUpdateSimAllowed()) return;

  const w = window as Window & {
    __grokSimAppUpdate?: (mode?: UpdateSimMode | "1" | "on" | "github") => void;
  };
  if (w.__grokSimAppUpdate) return;

  w.__grokSimAppUpdate = (mode = "silent") => {
    if (!isUpdateSimAllowed()) {
      console.warn(
        "[grok] Update sim requires Developer mode (Settings → About).",
      );
      return;
    }
    const next: UpdateSimMode =
      mode === "off"
        ? "off"
        : mode === "manual" || mode === "github"
          ? "manual"
          : "silent";
    writeUpdateSimMode(next);
    console.info(
      `[grok] Update sim → ${next} (v${UPDATE_SIM_VERSION}). No reload needed.`,
    );
  };

  const active = readUpdateSimMode();
  if (active !== "off") {
    console.info(
      `[grok] Update sim ACTIVE (${active}, v${UPDATE_SIM_VERSION}). ` +
        `__grokSimAppUpdate("off") to disable.`,
    );
  } else {
    console.info(
      '[grok] Update sim: __grokSimAppUpdate("silent" | "manual" | "off")',
    );
  }
}

let developerModeSimCleanupInstalled = false;

/** Listen for developer-mode off and clear sim (call once from app shell). */
export function installDeveloperModeSimCleanup(): void {
  if (typeof window === "undefined" || developerModeSimCleanupInstalled) {
    return;
  }
  developerModeSimCleanupInstalled = true;
  const onDev = () => {
    clearUpdateSimIfDeveloperModeOff();
    if (isDeveloperModeEnabled()) {
      installUpdateSimConsoleApi();
    }
  };
  window.addEventListener(DEVELOPER_MODE_CHANGE_EVENT, onDev);
}
