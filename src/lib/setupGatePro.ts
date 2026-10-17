/**
 * SETUP-GATE-PRO — pure helpers for the full-screen first-run setup gate.
 *
 * Honesty rules (see docs/llm-wiki/setup.md):
 * - CLI is a **hard** gate: never enter home without a found binary.
 * - Account / auth is **soft**: skippable; never invent "connected" from skip.
 * - Gate phase (loading → setup → ready) is derived from settings + probe only —
 *   never invent wizardCompleted when CLI is missing.
 * - Install / probe failures are classified into stable kinds with actionable
 *   i18n keys; raw host strings stay as detail, not as the only signal.
 *
 * No DOM / Tauri side effects.
 */

/** Wizard steps inside SetupWizard. */
export type SetupWizardStep = "runtime" | "account" | "ready";

/**
 * App-level gate after boot probe.
 * `loading` is host-owned; pure helpers resolve setup vs ready only.
 */
export type SetupAppGatePhase = "setup" | "ready";

/** Stable failure modes for install / probe / account actions. */
export type SetupGateErrorKind =
  | "cli_missing"
  | "cli_too_old"
  | "checksum_missing"
  | "checksum_mismatch"
  | "network"
  | "mirror"
  | "download"
  | "unsupported_platform"
  | "binary_invalid"
  | "permission"
  | "probe_failed"
  | "account"
  | "cancelled"
  | "other";

/** Visual tone for error / status chrome. */
export type SetupGateTone = "ok" | "warn" | "err" | "muted" | "info";

/** Inputs for the boot-time app gate decision. */
export type SetupGateBootInput = {
  /** Probe says a runnable grok binary was found. */
  cliFound: boolean;
  /** Settings: setupWizardCompleted. */
  wizardCompleted: boolean;
  /**
   * Legacy: onboardingDone || setupSkipped (pre-wizard installs).
   * When CLI is present and wizard flag is missing, migrate + enter ready.
   */
  legacyDone: boolean;
  /**
   * Phone mirror / secondary client — never hard-blocks on setup wizard.
   * When true, always ready (mirror has no install surface).
   */
  isMirror?: boolean;
};

export type SetupGateBootDecision = {
  phase: SetupAppGatePhase;
  /** True when older installs should be written as setupWizardCompleted. */
  shouldMigrateLegacy: boolean;
  /**
   * Stable machine reason for tests / diagnostics (English tokens).
   * Never a user-facing string.
   */
  reason:
    | "mirror"
    | "cli_missing"
    | "wizard_pending"
    | "legacy_migrate"
    | "wizard_done";
};

/** Ready-step checklist row (CLI hard / auth soft). */
export type SetupReadyCheckRow = {
  id: "cli" | "auth";
  /** true = hard ok, false = soft skip / missing (auth only). */
  ok: boolean;
  /** Soft row is allowed incomplete (auth). CLI is never soft-ok when missing. */
  soft: boolean;
  /** i18n key for the row label. */
  labelKey: string;
  /** Optional version / path meta (already safe; never secrets). */
  meta: string | null;
};

export type SetupReadyChecklist = {
  rows: SetupReadyCheckRow[];
  /** Hard gate: both must pass for CLI; auth may be soft. */
  canEnter: boolean;
  /** True when auth was skipped or not connected. */
  authDeferred: boolean;
};

/** Resolved install/account error presentation. */
export type SetupGateErrorView = {
  kind: SetupGateErrorKind;
  tone: SetupGateTone;
  /** Primary title i18n key. */
  titleKey: string;
  /** Optional secondary hint key (actionable recovery). */
  hintKey: string | null;
  /** Show "Install without checksum" primary when true. */
  offerUnverifiedInstall: boolean;
  /** Raw host/detail string (caller may display under the title). */
  detail: string;
  /** Cancelled OAuth / user dismiss — do not treat as hard failure toast. */
  silent: boolean;
};

function errText(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const code =
      typeof (err as Error & { code?: unknown }).code === "string"
        ? String((err as Error & { code?: string }).code)
        : "";
    return `${code} ${err.message} ${err.name}`.trim();
  }
  if (typeof err === "object") {
    const o = err as {
      code?: unknown;
      message?: unknown;
      reason?: unknown;
      error?: unknown;
    };
    const parts = [o.code, o.message, o.reason, o.error]
      .filter((x) => x != null && String(x).trim())
      .map(String);
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * Classify install / probe / account failures into a stable kind.
 * Prefer explicit codes and known host phrases over free-form text.
 */
export function classifySetupGateError(err: unknown): SetupGateErrorKind {
  if (err == null || err === "") return "other";

  const codeRaw =
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string"
      ? String((err as { code: string }).code).trim().toLowerCase()
      : "";

  if (codeRaw === "cli_missing" || codeRaw === "cli-missing") return "cli_missing";
  if (codeRaw === "cli_too_old" || codeRaw === "cli-too-old") return "cli_too_old";
  if (codeRaw === "checksum_missing" || codeRaw === "checksum-missing") {
    return "checksum_missing";
  }
  if (codeRaw === "checksum_mismatch" || codeRaw === "checksum-mismatch") {
    return "checksum_mismatch";
  }
  if (codeRaw === "cancelled" || codeRaw === "cancel") return "cancelled";
  if (codeRaw === "network" || codeRaw === "timeout") return "network";
  if (codeRaw === "permission" || codeRaw === "eacces") return "permission";

  const s = errText(err).toLowerCase();
  if (!s.trim()) return "other";

  // User cancelled OAuth / device login / file picker.
  if (
    /\bcancel(led)?\b/.test(s) ||
    s.includes("user cancelled") ||
    s.includes("user canceled") ||
    s.includes("login cancelled") ||
    s.includes("login canceled")
  ) {
    return "cancelled";
  }

  // Checksum — missing sidecar (strict mode) vs mismatch.
  if (
    s.includes("no published sha-256") ||
    s.includes("no published sha256") ||
    s.includes("checksum required") ||
    s.includes("grok_cli_require_checksum") ||
    s.includes("未发布 sha-256") ||
    s.includes("未發佈 sha-256") ||
    s.includes("未发布 sha256")
  ) {
    return "checksum_missing";
  }
  if (
    s.includes("checksum mismatch") ||
    s.includes("sha-256 mismatch") ||
    s.includes("sha256 mismatch") ||
    s.includes("digest mismatch") ||
    (s.includes("checksum") && s.includes("mismatch"))
  ) {
    return "checksum_mismatch";
  }

  // Too-old CLI (App boot also surfaces CLI_TOO_OLD).
  if (
    s.includes("cli_too_old") ||
    s.includes("cli too old") ||
    (s.includes("required") && s.includes("<") && s.includes("cli")) ||
    /grok cli .+ < required/.test(s)
  ) {
    return "cli_too_old";
  }

  // Unsupported OS / arch from host install.
  if (
    s.includes("unsupported os") ||
    s.includes("unsupported cpu") ||
    s.includes("unsupported architecture") ||
    s.includes("unsupported platform")
  ) {
    return "unsupported_platform";
  }

  // Binary found but invalid after download / pick.
  if (
    s.includes("downloaded binary --version failed") ||
    s.includes("not a file") ||
    s.includes("failed to run downloaded binary") ||
    s.includes("download produced empty") ||
    s.includes("download size mismatch") ||
    s.includes("binary invalid") ||
    s.includes("exec format")
  ) {
    return "binary_invalid";
  }

  // Permission / sandbox.
  if (
    s.includes("permission denied") ||
    s.includes("operation not permitted") ||
    s.includes("eacces") ||
    s.includes("eperm") ||
    s.includes("access is denied")
  ) {
    return "permission";
  }

  // Explicit not found.
  if (
    s.includes("grok build not found") ||
    s.includes("cli not found") ||
    s.includes("grok build cli not found") ||
    s.includes("no such file") ||
    s.includes("command not found")
  ) {
    return "cli_missing";
  }

  // All mirrors / mirror host failures.
  if (
    s.includes("all mirrors failed") ||
    s.includes("could not resolve grok build version from any mirror") ||
    (s.includes("mirror") && (s.includes("fail") || s.includes("error")))
  ) {
    return "mirror";
  }

  // Download / HTTP / network / timeout.
  if (
    s.includes("download url not on allowlist") ||
    s.includes("version url not on allowlist") ||
    /http\s*[1-5]\d{2}/.test(s) ||
    s.includes("download ")
  ) {
    // Prefer network when connectivity-shaped.
    if (
      s.includes("timeout") ||
      s.includes("timed out") ||
      s.includes("network") ||
      s.includes("connection") ||
      s.includes("dns") ||
      s.includes("econn") ||
      s.includes("enotfound") ||
      s.includes("offline")
    ) {
      return "network";
    }
    return "download";
  }
  if (
    s.includes("timeout") ||
    s.includes("timed out") ||
    s.includes("network") ||
    s.includes("connection refused") ||
    s.includes("connection reset") ||
    s.includes("name or service not known") ||
    s.includes("could not resolve host") ||
    s.includes("econnreset") ||
    s.includes("enotfound") ||
    s.includes("offline")
  ) {
    return "network";
  }

  // Account / OAuth / key save soft failures.
  if (
    s.includes("oauth") ||
    s.includes("login failed") ||
    s.includes("auth failed") ||
    s.includes("unauthorized") ||
    s.includes("invalid api key") ||
    s.includes("invalid key") ||
    s.includes("relay") && s.includes("fail")
  ) {
    return "account";
  }

  // Probe-shaped generic failures.
  if (
    s.includes("probe") ||
    s.includes("failed to run") ||
    s.includes("spawn")
  ) {
    return "probe_failed";
  }

  return "other";
}

/** i18n title key for a classified setup-gate error. */
export function setupGateErrorTitleKey(kind: SetupGateErrorKind): string {
  switch (kind) {
    case "cli_missing":
      return "setup.error.cliMissing";
    case "cli_too_old":
      return "setup.error.cliTooOld";
    case "checksum_missing":
      return "setup.error.checksumMissing";
    case "checksum_mismatch":
      return "setup.error.checksumMismatch";
    case "network":
      return "setup.error.network";
    case "mirror":
      return "setup.error.mirror";
    case "download":
      return "setup.error.download";
    case "unsupported_platform":
      return "setup.error.unsupportedPlatform";
    case "binary_invalid":
      return "setup.error.binaryInvalid";
    case "permission":
      return "setup.error.permission";
    case "probe_failed":
      return "setup.error.probeFailed";
    case "account":
      return "setup.error.account";
    case "cancelled":
      return "setup.error.cancelled";
    case "other":
    default:
      return "setup.error";
  }
}

/**
 * Optional recovery hint key. Null when the title alone is enough
 * (or when silent cancel).
 */
export function setupGateErrorHintKey(
  kind: SetupGateErrorKind,
): string | null {
  switch (kind) {
    case "checksum_missing":
      return "setup.checksumMissingHint";
    case "checksum_mismatch":
      return "setup.error.checksumMismatchHint";
    case "network":
    case "mirror":
    case "download":
      return "setup.networkHint";
    case "cli_missing":
      return "setup.manualHint";
    case "cli_too_old":
      return "setup.error.cliTooOldHint";
    case "unsupported_platform":
      return "setup.error.unsupportedPlatformHint";
    case "binary_invalid":
      return "setup.error.binaryInvalidHint";
    case "permission":
      return "setup.error.permissionHint";
    case "account":
      return "setup.error.accountHint";
    case "probe_failed":
      return "setup.error.probeFailedHint";
    case "cancelled":
      return null;
    case "other":
    default:
      return "setup.networkHint";
  }
}

/** True when the UI should offer "Install without checksum". */
export function setupGateOfferUnverifiedInstall(
  kind: SetupGateErrorKind,
): boolean {
  return kind === "checksum_missing";
}

export function setupGateErrorSilent(kind: SetupGateErrorKind): boolean {
  return kind === "cancelled";
}

export function setupGateErrorTone(kind: SetupGateErrorKind): SetupGateTone {
  if (kind === "cancelled") return "muted";
  if (kind === "checksum_missing" || kind === "cli_too_old") return "warn";
  if (kind === "account") return "warn";
  return "err";
}

/**
 * Resolve presentation for a thrown / host error.
 * Never invents success; cancelled stays silent for callers that toast.
 */
export function resolveSetupGateError(err: unknown): SetupGateErrorView {
  const kind = classifySetupGateError(err);
  const raw = errText(err).trim();
  let detail = "";
  if (raw && raw.length < 280) {
    // Strip redundant "Error:" prefix; keep host message for support.
    detail = raw.replace(/^Error:\s*/i, "").trim();
  }
  // When the title already names the kind, avoid repeating a near-empty detail.
  if (
    kind !== "other" &&
    detail &&
    detail.length < 8 &&
    !/[/:\\]/.test(detail)
  ) {
    detail = "";
  }
  return {
    kind,
    tone: setupGateErrorTone(kind),
    titleKey: setupGateErrorTitleKey(kind),
    hintKey: setupGateErrorHintKey(kind),
    offerUnverifiedInstall: setupGateOfferUnverifiedInstall(kind),
    detail,
    silent: setupGateErrorSilent(kind),
  };
}

/**
 * Boot-time gate: CLI hard-required, account never blocks home.
 *
 * Decision table:
 * | CLI | wizardCompleted | legacyDone | result |
 * |-----|-----------------|------------|--------|
 * | mirror client | * | * | ready |
 * | no  | * | * | setup |
 * | yes | no | yes | ready + migrate |
 * | yes | no | no | setup |
 * | yes | yes | * | ready |
 */
export function resolveSetupGateBoot(
  input: SetupGateBootInput,
): SetupGateBootDecision {
  if (input.isMirror) {
    return {
      phase: "ready",
      shouldMigrateLegacy: false,
      reason: "mirror",
    };
  }
  if (!input.cliFound) {
    return {
      phase: "setup",
      shouldMigrateLegacy: false,
      reason: "cli_missing",
    };
  }
  if (!input.wizardCompleted && input.legacyDone) {
    return {
      phase: "ready",
      shouldMigrateLegacy: true,
      reason: "legacy_migrate",
    };
  }
  if (!input.wizardCompleted) {
    return {
      phase: "setup",
      shouldMigrateLegacy: false,
      reason: "wizard_pending",
    };
  }
  return {
    phase: "ready",
    shouldMigrateLegacy: false,
    reason: "wizard_done",
  };
}

/** Initial wizard step: no CLI → runtime; CLI present → account (skippable). */
export function resolveInitialWizardStep(cliFound: boolean): SetupWizardStep {
  return cliFound ? "account" : "runtime";
}

/**
 * Hard enter-home gate. Account state never grants entry without CLI.
 * Documented honesty: returns false when `cliFound` is falsey.
 */
export function canEnterHome(cliFound: boolean): boolean {
  return !!cliFound;
}

/**
 * Settings flags after finish. Never marks auth deferred when auth is ok.
 * `authDeferred` only sticks when the user skipped **and** is not connected.
 */
export function buildAuthDeferredFlags(opts: {
  authDeferred: boolean;
  authOk: boolean;
}): { authSetupDeferred: boolean; setupSkipped: boolean } {
  const deferred = !!opts.authDeferred && !opts.authOk;
  return {
    authSetupDeferred: deferred,
    setupSkipped: deferred,
  };
}

/**
 * Ready-step checklist. Never claims CLI ok without found; auth is soft.
 */
export function buildReadyChecklist(opts: {
  cliFound: boolean;
  cliVersion?: string | null;
  authOk: boolean;
  /**
   * User chose skip (or left without connecting). Ignored when authOk —
   * never claim deferred while connected.
   */
  authDeferred?: boolean;
}): SetupReadyChecklist {
  const cliFound = !!opts.cliFound;
  const authOk = !!opts.authOk;
  // Soft gate honesty: not connected ⇒ deferred for checklist copy.
  // Explicit authDeferred=false still shows "later" when !authOk (user continued).
  const authDeferred = !authOk;

  const version =
    typeof opts.cliVersion === "string" && opts.cliVersion.trim()
      ? opts.cliVersion.trim()
      : null;

  const rows: SetupReadyCheckRow[] = [
    {
      id: "cli",
      ok: cliFound,
      soft: false,
      labelKey: cliFound ? "setup.ready.cliOk" : "setup.cli.missing",
      meta: cliFound ? version : null,
    },
    {
      id: "auth",
      ok: authOk,
      soft: true,
      labelKey: authOk ? "setup.ready.authOk" : "setup.ready.authSkip",
      meta: null,
    },
  ];

  return {
    rows,
    canEnter: canEnterHome(cliFound),
    authDeferred,
  };
}

/** Extract hostname from a mirror URL for progress chrome. */
export function mirrorHostFromUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] || url;
  }
}

/**
 * Clamp install progress percent for the bar.
 * When installing with no percent, show a soft 8% so the bar is not empty
 * (honest "started", not "done").
 */
export function clampInstallPercent(
  percent: number | null | undefined,
  installing: boolean,
): number {
  if (percent == null || Number.isNaN(Number(percent))) {
    return installing ? 8 : 0;
  }
  return Math.max(0, Math.min(100, Math.round(Number(percent))));
}

/**
 * Whether a CLI probe with `versionSupported === false` should surface
 * as a soft warning (still found — not a hard install block).
 */
export function isCliVersionUnsupported(
  versionSupported: boolean | null | undefined,
): boolean {
  return versionSupported === false;
}

/**
 * Build the short CLI_TOO_OLD style detail used at boot (no secrets).
 */
export function formatCliTooOldDetail(opts: {
  version?: string | null;
  minVersion?: string | null;
}): string {
  const v = (opts.version ?? "?").trim() || "?";
  const min = (opts.minVersion ?? "").trim();
  if (min) return `CLI_TOO_OLD: grok CLI ${v} < required ${min}`;
  return `CLI_TOO_OLD: grok CLI ${v}`;
}

/**
 * Auth is always optional for the gate. Pure constant for callers / tests
 * so UI never hard-blocks on missing account.
 */
export function isAccountStepOptional(): true {
  return true;
}

/**
 * Whether the runtime step may advance to account.
 * Only when CLI is found — never advance on skip.
 */
export function canAdvancePastRuntime(cliFound: boolean): boolean {
  return !!cliFound;
}
