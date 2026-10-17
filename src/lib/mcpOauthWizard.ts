/**
 * MCP OAuth recovery wizard — pure step machine.
 *
 * Flow:
 *   intro → auth → waiting → refreshing → success | fail
 *
 * Soft-fails (never invents success):
 * - no doctor-provided URL → TUI / instructions path (`no_url` / `no_cli_helper`)
 * - open URL fails → stay on auth with `open_url_failed`
 * - doctor still reports auth needed → fail with `still_needs_auth`
 * - doctor host error → fail with `doctor_failed`
 *
 * Never logs secrets; URLs are pre-sanitized via mcpOauth helpers.
 * CLI probe (0.2.117): no headless `grok mcp oauth` — TUI `/mcps` → `i`.
 */

import {
  classifyMcpOauthFinding,
  classifyMcpOauthFromStatus,
  planMcpOauthOpen,
  redactMcpOauthText,
  sanitizeMcpAuthUrl,
  type McpOauthAction,
  type McpOauthActionKind,
  type McpOauthOpenPlan,
} from "@/lib/mcpOauth";
import {
  indexDoctorServerStatuses,
  lookupServerStatus,
  normalizeMcpDoctorFindings,
  type McpDoctorReportLike,
} from "@/lib/mcpStatus";

/** Ordered wizard steps (UI progress). */
export type McpOauthWizardStep =
  | "intro"
  | "auth"
  | "waiting"
  | "refreshing"
  | "success"
  | "fail";

/** Classified soft-fail kinds for fail / auth guidance chips. */
export type McpOauthWizardSoftFailKind =
  | "none"
  | "no_url"
  | "no_cli_helper"
  | "open_url_failed"
  | "doctor_failed"
  | "still_needs_auth";

export type McpOauthWizardState = {
  step: McpOauthWizardStep;
  server: string | null;
  kind: McpOauthActionKind;
  isRetry: boolean;
  /** Sanitized preferred auth URL (or null). */
  authUrl: string | null;
  /** Open plan for the auth step. */
  openPlan: McpOauthOpenPlan | null;
  /** Redacted doctor reason (one line). */
  reason: string | null;
  softFail: McpOauthWizardSoftFailKind;
  /**
   * Soft-fail is guidance / partial progress — UI should not treat as a hard
   * crash (e.g. no URL → TUI path; open failed but user can retry).
   */
  softFailNonBlocking: boolean;
  /** Redacted error / diagnostic for display (never secrets). */
  errorMessage: string | null;
  /** User successfully opened the browser URL this session. */
  urlOpened: boolean;
  /** Doctor refresh attempts after “I’ve authorized”. */
  refreshAttempts: number;
};

export type McpOauthWizardInitInput = {
  action: McpOauthAction;
  /** Optional status reason / finding detail (will be redacted). */
  reason?: string | null;
  preferUrl?: string | null;
};

export type McpOauthWizardEvent =
  | { type: "init"; input: McpOauthWizardInitInput }
  | { type: "continue" }
  | { type: "open_url_ok" }
  | { type: "open_url_error"; error: string }
  | { type: "i_authorized" }
  | { type: "doctor_start" }
  | {
      type: "doctor_result";
      stillNeedsAuth: boolean;
      reason?: string | null;
      doctorError?: string | null;
    }
  | { type: "retry_auth" }
  | { type: "retry_refresh" }
  | { type: "back" }
  | { type: "reset" };

/** Ordered steps for progress UI (terminal success/fail share slot 5). */
export const MCP_OAUTH_WIZARD_STEP_ORDER: readonly McpOauthWizardStep[] = [
  "intro",
  "auth",
  "waiting",
  "refreshing",
  "success",
  "fail",
] as const;

/** Soft-fail kinds that are non-blocking guidance. */
const NON_BLOCKING_SOFT: ReadonlySet<McpOauthWizardSoftFailKind> = new Set([
  "no_url",
  "no_cli_helper",
  "open_url_failed",
  "still_needs_auth",
]);

export function isMcpOauthWizardSoftFailNonBlocking(
  kind: McpOauthWizardSoftFailKind,
): boolean {
  return NON_BLOCKING_SOFT.has(kind);
}

/** Progress index 0..3 for active path; success/fail → 4. */
export function mcpOauthWizardStepIndex(step: McpOauthWizardStep): number {
  switch (step) {
    case "intro":
      return 0;
    case "auth":
      return 1;
    case "waiting":
      return 2;
    case "refreshing":
      return 3;
    case "success":
    case "fail":
      return 4;
    default:
      return 0;
  }
}

/** Human-facing step count for progress (“Step 2 of 5”). */
export const MCP_OAUTH_WIZARD_PROGRESS_TOTAL = 5;

function softFromPlan(
  plan: McpOauthOpenPlan | null,
): McpOauthWizardSoftFailKind {
  if (!plan) return "no_cli_helper";
  if (plan.mode === "open_url") return "none";
  if (plan.reason === "no_url") return "no_url";
  return "no_cli_helper";
}

function redactLine(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = redactMcpOauthText(String(raw)).trim();
  if (!t) return null;
  return t.slice(0, 280);
}

/** Build initial wizard state from a classified OAuth action. */
export function createMcpOauthWizardState(
  input: McpOauthWizardInitInput,
): McpOauthWizardState {
  const { action } = input;
  const prefer = sanitizeMcpAuthUrl(input.preferUrl ?? null);
  const plan = planMcpOauthOpen(action, { preferUrl: prefer });
  const authUrl =
    plan?.mode === "open_url"
      ? plan.url
      : prefer ?? action.preferredUrl ?? null;
  const soft = softFromPlan(plan);
  return {
    step: "intro",
    server: action.server?.trim() || null,
    kind: action.kind,
    isRetry: action.isRetry || action.kind === "retry",
    authUrl,
    openPlan: plan,
    reason: redactLine(input.reason),
    softFail: soft,
    softFailNonBlocking: isMcpOauthWizardSoftFailNonBlocking(soft),
    errorMessage: null,
    urlOpened: false,
    refreshAttempts: 0,
  };
}

/** Idle / closed placeholder (not open). */
export function emptyMcpOauthWizardState(): McpOauthWizardState {
  return {
    step: "intro",
    server: null,
    kind: "authorize",
    isRetry: false,
    authUrl: null,
    openPlan: null,
    reason: null,
    softFail: "none",
    softFailNonBlocking: false,
    errorMessage: null,
    urlOpened: false,
    refreshAttempts: 0,
  };
}

function withSoft(
  state: McpOauthWizardState,
  soft: McpOauthWizardSoftFailKind,
  errorMessage?: string | null,
): Pick<
  McpOauthWizardState,
  "softFail" | "softFailNonBlocking" | "errorMessage"
> {
  return {
    softFail: soft,
    softFailNonBlocking: isMcpOauthWizardSoftFailNonBlocking(soft),
    errorMessage:
      errorMessage === undefined
        ? state.errorMessage
        : redactLine(errorMessage),
  };
}

/**
 * Pure reducer for the OAuth recovery wizard.
 * Unknown transitions leave state unchanged.
 */
export function reduceMcpOauthWizard(
  state: McpOauthWizardState,
  event: McpOauthWizardEvent,
): McpOauthWizardState {
  switch (event.type) {
    case "init":
      return createMcpOauthWizardState(event.input);

    case "reset":
      return emptyMcpOauthWizardState();

    case "continue": {
      if (state.step === "intro") {
        return { ...state, step: "auth" };
      }
      if (state.step === "auth") {
        // Auth → waiting (user proceeds without / after opening URL).
        return { ...state, step: "waiting", errorMessage: null };
      }
      return state;
    }

    case "open_url_ok": {
      if (state.step !== "auth" && state.step !== "waiting") return state;
      return {
        ...state,
        urlOpened: true,
        ...withSoft(state, state.authUrl ? "none" : state.softFail, null),
      };
    }

    case "open_url_error": {
      if (state.step !== "auth" && state.step !== "waiting") return state;
      return {
        ...state,
        ...withSoft(state, "open_url_failed", event.error),
      };
    }

    case "i_authorized": {
      if (state.step !== "waiting" && state.step !== "auth") return state;
      // Jump to waiting first if still on auth, then parent fires doctor_start.
      return {
        ...state,
        step: "waiting",
        errorMessage: null,
      };
    }

    case "doctor_start": {
      if (
        state.step !== "waiting" &&
        state.step !== "fail" &&
        state.step !== "auth"
      ) {
        return state;
      }
      return {
        ...state,
        step: "refreshing",
        refreshAttempts: state.refreshAttempts + 1,
        ...withSoft(state, "none", null),
      };
    }

    case "doctor_result": {
      if (state.step !== "refreshing" && state.step !== "waiting") {
        return state;
      }
      const doctorErr = event.doctorError?.trim();
      if (doctorErr) {
        return {
          ...state,
          step: "fail",
          reason: redactLine(event.reason) ?? state.reason,
          ...withSoft(state, "doctor_failed", doctorErr),
        };
      }
      if (event.stillNeedsAuth) {
        return {
          ...state,
          step: "fail",
          reason: redactLine(event.reason) ?? state.reason,
          ...withSoft(
            state,
            "still_needs_auth",
            event.reason ?? "OAuth still required after refresh",
          ),
        };
      }
      return {
        ...state,
        step: "success",
        reason: redactLine(event.reason) ?? state.reason,
        ...withSoft(state, "none", null),
      };
    }

    case "retry_auth": {
      if (state.step !== "fail" && state.step !== "success") return state;
      return {
        ...state,
        step: "auth",
        errorMessage: null,
        softFail: softFromPlan(state.openPlan),
        softFailNonBlocking: isMcpOauthWizardSoftFailNonBlocking(
          softFromPlan(state.openPlan),
        ),
      };
    }

    case "retry_refresh": {
      if (state.step !== "fail") return state;
      return {
        ...state,
        step: "waiting",
        ...withSoft(state, "none", null),
      };
    }

    case "back": {
      if (state.step === "auth") {
        return { ...state, step: "intro", errorMessage: null };
      }
      if (state.step === "waiting") {
        return { ...state, step: "auth", errorMessage: null };
      }
      if (state.step === "fail") {
        return {
          ...state,
          step: "waiting",
          ...withSoft(state, "none", null),
        };
      }
      return state;
    }

    default:
      return state;
  }
}

/**
 * Evaluate a doctor report after the user claims authorization completed.
 * Pure — never invents healthy when report is missing.
 */
export function evaluateMcpOauthDoctorRefresh(opts: {
  report?: McpDoctorReportLike | null;
  serverName?: string | null;
  doctorError?: string | null;
}): {
  stillNeedsAuth: boolean;
  reason: string | null;
  softFail: McpOauthWizardSoftFailKind;
  ok: boolean;
} {
  const err = opts.doctorError?.trim();
  if (err) {
    return {
      stillNeedsAuth: true,
      reason: redactLine(err),
      softFail: "doctor_failed",
      ok: false,
    };
  }
  const report = opts.report ?? null;
  if (!report) {
    return {
      stillNeedsAuth: true,
      reason: "Doctor report missing",
      softFail: "doctor_failed",
      ok: false,
    };
  }

  const server = opts.serverName?.trim() || null;
  const index = indexDoctorServerStatuses(report);
  const status = server ? lookupServerStatus(index, server) : null;

  if (status) {
    const action = classifyMcpOauthFromStatus(status);
    if (action) {
      return {
        stillNeedsAuth: true,
        reason: redactLine(status.reason),
        softFail: "still_needs_auth",
        ok: false,
      };
    }
    // Status present and not OAuth — success when healthy/ok/warn, else still fail soft.
    if (status.tone === "error") {
      // Non-auth error after re-auth: still not a full OAuth success, but OAuth path done.
      // Treat as success for OAuth recovery (auth cleared) only when needsAuthRefresh is false.
      if (!status.needsAuthRefresh) {
        return {
          stillNeedsAuth: false,
          reason: redactLine(status.reason),
          softFail: "none",
          ok: true,
        };
      }
    }
    return {
      stillNeedsAuth: false,
      reason: redactLine(status.reason),
      softFail: "none",
      ok: true,
    };
  }

  // No per-server status — scan findings for this server (or any OAuth if unnamed).
  const findings = normalizeMcpDoctorFindings(report, {
    server,
    includeUnscoped: !server,
  });
  for (const row of findings) {
    if (row.level === "ok") continue;
    const action = classifyMcpOauthFinding(row);
    if (action) {
      return {
        stillNeedsAuth: true,
        reason: redactLine(row.detail || row.title),
        softFail: "still_needs_auth",
        ok: false,
      };
    }
  }

  // If doctor ok flag is true, treat as success.
  if (report.ok === true) {
    return {
      stillNeedsAuth: false,
      reason: null,
      softFail: "none",
      ok: true,
    };
  }

  // Report present, no OAuth findings for this server → OAuth path cleared.
  return {
    stillNeedsAuth: false,
    reason: null,
    softFail: "none",
    ok: true,
  };
}

/** Whether primary continue is available on this step. */
export function mcpOauthWizardCanContinue(
  state: McpOauthWizardState,
): boolean {
  return state.step === "intro" || state.step === "auth";
}

/** Whether “I’ve authorized” is available. */
export function mcpOauthWizardCanConfirmAuthorized(
  state: McpOauthWizardState,
): boolean {
  return state.step === "waiting" || state.step === "auth";
}

/** Whether Open auth URL should be shown. */
export function mcpOauthWizardHasOpenableUrl(
  state: McpOauthWizardState,
): boolean {
  return Boolean(state.authUrl && state.openPlan?.mode === "open_url");
}

/** i18n key for the modal title. */
export function mcpOauthWizardTitleKey(
  state: McpOauthWizardState,
):
  | "mcpModal.oauth.authorizeTitle"
  | "mcpModal.oauth.retryTitle" {
  return state.isRetry
    ? "mcpModal.oauth.retryTitle"
    : "mcpModal.oauth.authorizeTitle";
}

/** i18n key for soft-fail / result chip. */
export function mcpOauthWizardSoftFailLabelKey(
  kind: McpOauthWizardSoftFailKind,
):
  | "mcpOauth.wizard.soft.none"
  | "mcpOauth.wizard.soft.noUrl"
  | "mcpOauth.wizard.soft.noCliHelper"
  | "mcpOauth.wizard.soft.openUrlFailed"
  | "mcpOauth.wizard.soft.doctorFailed"
  | "mcpOauth.wizard.soft.stillNeedsAuth" {
  switch (kind) {
    case "no_url":
      return "mcpOauth.wizard.soft.noUrl";
    case "no_cli_helper":
      return "mcpOauth.wizard.soft.noCliHelper";
    case "open_url_failed":
      return "mcpOauth.wizard.soft.openUrlFailed";
    case "doctor_failed":
      return "mcpOauth.wizard.soft.doctorFailed";
    case "still_needs_auth":
      return "mcpOauth.wizard.soft.stillNeedsAuth";
    default:
      return "mcpOauth.wizard.soft.none";
  }
}

/** i18n key for step label in progress chrome. */
export function mcpOauthWizardStepLabelKey(
  step: McpOauthWizardStep,
):
  | "mcpOauth.wizard.step.intro"
  | "mcpOauth.wizard.step.auth"
  | "mcpOauth.wizard.step.waiting"
  | "mcpOauth.wizard.step.refreshing"
  | "mcpOauth.wizard.step.success"
  | "mcpOauth.wizard.step.fail" {
  switch (step) {
    case "intro":
      return "mcpOauth.wizard.step.intro";
    case "auth":
      return "mcpOauth.wizard.step.auth";
    case "waiting":
      return "mcpOauth.wizard.step.waiting";
    case "refreshing":
      return "mcpOauth.wizard.step.refreshing";
    case "success":
      return "mcpOauth.wizard.step.success";
    case "fail":
      return "mcpOauth.wizard.step.fail";
  }
}

/**
 * Extra scrub for log fields: drop secret-bearing key names entirely so logs
 * never retain `access_token=` / `client_secret=` labels next to redactions.
 */
function scrubSecretKeyNames(text: string): string {
  return text
    .replace(
      /\b(access_token|refresh_token|id_token|client_secret|api[_-]?key|authorization|bearer)\s*[=:]\s*(\S+)/gi,
      "[REDACTED_CRED]",
    )
    .replace(/\b(access_token|refresh_token|id_token|client_secret)\b/gi, "[CRED]");
}

/**
 * Safe snapshot for logs / diagnostics — never includes raw secrets or
 * unsanitized URLs with tokens.
 */
export function sanitizeMcpOauthWizardLog(
  state: McpOauthWizardState,
): Record<string, string | number | boolean | null> {
  const url = state.authUrl ? sanitizeMcpAuthUrl(state.authUrl) : null;
  const err = state.errorMessage
    ? scrubSecretKeyNames(redactMcpOauthText(state.errorMessage)).slice(0, 160)
    : null;
  return {
    step: state.step,
    server: state.server,
    kind: state.kind,
    isRetry: state.isRetry,
    hasAuthUrl: Boolean(url),
    // Host only — path only, no query (defensive).
    authHost: url
      ? (() => {
          try {
            return new URL(url).host;
          } catch {
            return null;
          }
        })()
      : null,
    softFail: state.softFail,
    softFailNonBlocking: state.softFailNonBlocking,
    urlOpened: state.urlOpened,
    refreshAttempts: state.refreshAttempts,
    // Redacted error only; never echo raw event payloads or secret key names.
    errorMessage: err,
  };
}
