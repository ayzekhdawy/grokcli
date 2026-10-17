/**
 * Honest status about what continues for scheduled automations after quit.
 *
 * There is **no** separate background daemon in this app. The host
 * `automation_runner` only ticks while the Grok App process is alive
 * (main window or tray). Fully quitting pauses schedules until the app
 * is opened again — optionally via the OS login item ("Launch at login").
 */

export type AutomationsBackgroundSeverity = "none" | "info" | "warn";

/** Stable i18n keys returned by the pure helper (must exist in messages catalogs). */
export type AutomationsBackgroundMessageKey =
  | "automations.bg.withLoginItem"
  | "automations.bg.needsApp"
  | "automations.bg.runnerUnknown";

export type AutomationsQuitNoteKey =
  | "app.quitBusy.automationsNote"
  | "app.quitBusy.automationsNoteLogin";

export type AutomationsBackgroundStatus = {
  severity: AutomationsBackgroundSeverity;
  /** Banner body key; null when nothing to show. */
  messageKey: AutomationsBackgroundMessageKey | null;
  /** Extra note for the busy-quit confirm dialog; null when none. */
  quitNoteKey: AutomationsQuitNoteKey | null;
  /** Offer a control that deep-links to Settings → Launch at login. */
  showOpenAtLoginLink: boolean;
  /** Normalized non-negative integer count of enabled automations. */
  enabledCount: number;
};

export type AutomationsBackgroundStatusInput = {
  /** AppSettings.launchAtLogin / OS login item. */
  openAtLogin: boolean;
  /** Number of automations with enabled === true. */
  enabledCount: number;
  /**
   * True when we know the in-process host runner owns scheduling
   * (desktop Tauri). False → do not claim a detached daemon; warn honestly.
   */
  runnerKnown: boolean;
};

function normalizeCount(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/**
 * Derive banner / quit-dialog copy keys for automations after quit.
 *
 * Pure — no I/O. Callers translate `messageKey` / `quitNoteKey` via i18n.
 */
export function automationsBackgroundStatus(
  input: AutomationsBackgroundStatusInput,
): AutomationsBackgroundStatus {
  const enabledCount = normalizeCount(input.enabledCount);

  if (enabledCount <= 0) {
    return {
      severity: "none",
      messageKey: null,
      quitNoteKey: null,
      showOpenAtLoginLink: false,
      enabledCount: 0,
    };
  }

  if (!input.runnerKnown) {
    return {
      severity: "warn",
      messageKey: "automations.bg.runnerUnknown",
      quitNoteKey: "app.quitBusy.automationsNote",
      showOpenAtLoginLink: !input.openAtLogin,
      enabledCount,
    };
  }

  if (input.openAtLogin) {
    return {
      severity: "info",
      messageKey: "automations.bg.withLoginItem",
      quitNoteKey: "app.quitBusy.automationsNoteLogin",
      showOpenAtLoginLink: false,
      enabledCount,
    };
  }

  return {
    severity: "warn",
    messageKey: "automations.bg.needsApp",
    quitNoteKey: "app.quitBusy.automationsNote",
    showOpenAtLoginLink: true,
    enabledCount,
  };
}
