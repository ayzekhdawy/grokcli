/**
 * Pure policy helpers for scheduled automations + tray residency.
 *
 * Honest model: host `automation_runner` only ticks while the app process is
 * alive (main window or tray). There is no separate headless daemon.
 */

/** Mirror of Rust `should_hide_to_tray_on_close` for UI copy / tests. */
export function shouldHideToTrayOnClose(input: {
  closeToTray: boolean;
  keepTrayForSchedules: boolean;
  anyEnabledAutomation: boolean;
}): boolean {
  if (input.closeToTray) return true;
  return input.keepTrayForSchedules && input.anyEnabledAutomation;
}

export type AutomationsRunnerBannerSeverity = "none" | "info" | "warn";

export type AutomationsRunnerBanner = {
  severity: AutomationsRunnerBannerSeverity;
  /** i18n key for body; null when nothing to show. */
  messageKey:
    | "automations.runner.activeTray"
    | "automations.runner.needsTray"
    | "automations.runner.quitPauses"
    | null;
  showKeepTrayToggle: boolean;
  showLaunchAgent: boolean;
};

/**
 * Banner state for the Scheduled tasks page background panel.
 */
export function automationsRunnerBanner(input: {
  enabledCount: number;
  keepTrayForSchedules: boolean;
  closeToTray: boolean;
  launchAgentSupported: boolean;
  launchAgentEnabled: boolean;
  runnerKnown: boolean;
}): AutomationsRunnerBanner {
  const n =
    typeof input.enabledCount === "number" && Number.isFinite(input.enabledCount)
      ? Math.max(0, Math.floor(input.enabledCount))
      : 0;

  if (n <= 0) {
    return {
      severity: "none",
      messageKey: null,
      showKeepTrayToggle: true,
      showLaunchAgent: input.launchAgentSupported,
    };
  }

  if (!input.runnerKnown) {
    return {
      severity: "warn",
      messageKey: "automations.runner.quitPauses",
      showKeepTrayToggle: true,
      showLaunchAgent: false,
    };
  }

  const hidesOnClose = shouldHideToTrayOnClose({
    closeToTray: input.closeToTray,
    keepTrayForSchedules: input.keepTrayForSchedules,
    anyEnabledAutomation: true,
  });

  if (hidesOnClose || input.launchAgentEnabled) {
    return {
      severity: "info",
      messageKey: "automations.runner.activeTray",
      showKeepTrayToggle: true,
      showLaunchAgent: input.launchAgentSupported,
    };
  }

  return {
    severity: "warn",
    messageKey: "automations.runner.needsTray",
    showKeepTrayToggle: true,
    showLaunchAgent: input.launchAgentSupported,
  };
}
