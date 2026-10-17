import { describe, expect, it } from "vitest";
import {
  classifyMcpOauthSource,
} from "./mcpOauth";
import {
  createMcpOauthWizardState,
  emptyMcpOauthWizardState,
  evaluateMcpOauthDoctorRefresh,
  isMcpOauthWizardSoftFailNonBlocking,
  mcpOauthWizardCanConfirmAuthorized,
  mcpOauthWizardCanContinue,
  mcpOauthWizardHasOpenableUrl,
  mcpOauthWizardSoftFailLabelKey,
  mcpOauthWizardStepIndex,
  mcpOauthWizardStepLabelKey,
  mcpOauthWizardTitleKey,
  reduceMcpOauthWizard,
  sanitizeMcpOauthWizardLog,
  type McpOauthWizardState,
} from "./mcpOauthWizard";
import type { McpDoctorReportLike } from "./mcpStatus";

function authorizeAction(detail: string, server = "cloudflare-api") {
  const action = classifyMcpOauthSource({
    detail,
    server,
    tone: "auth_required",
  });
  if (!action) throw new Error("expected oauth action");
  return action;
}

function retryAction(detail: string, server = "github") {
  const action = classifyMcpOauthSource({
    detail,
    server,
    tone: "auth_expired",
  });
  if (!action) throw new Error("expected oauth action");
  return action;
}

describe("createMcpOauthWizardState", () => {
  it("starts on intro with sanitized auth URL when present", () => {
    const action = authorizeAction(
      "OAuth authorization required — open https://login.example.com/oauth/authorize?client_id=app&access_token=SECRETOK",
    );
    const state = createMcpOauthWizardState({
      action,
      reason: "Bearer SECRETOK1234567890 needed",
    });
    expect(state.step).toBe("intro");
    expect(state.server).toBe("cloudflare-api");
    expect(state.kind).toBe("authorize");
    expect(state.isRetry).toBe(false);
    expect(state.authUrl).toBeTruthy();
    expect(state.authUrl).not.toContain("SECRETOK");
    expect(state.authUrl).not.toContain("access_token");
    expect(state.reason).not.toContain("SECRETOK1234567890");
    expect(state.openPlan?.mode).toBe("open_url");
    expect(state.softFail).toBe("none");
    expect(mcpOauthWizardHasOpenableUrl(state)).toBe(true);
  });

  it("marks no_cli_helper soft-fail when no URL (honest TUI path)", () => {
    const action = authorizeAction("OAuth authorization required");
    const state = createMcpOauthWizardState({ action });
    expect(state.authUrl).toBeNull();
    expect(state.openPlan?.mode).toBe("instructions");
    expect(state.softFail).toBe("no_cli_helper");
    expect(state.softFailNonBlocking).toBe(true);
    expect(mcpOauthWizardHasOpenableUrl(state)).toBe(false);
  });

  it("uses retry title for expired credentials", () => {
    const action = retryAction("OAuth token expired");
    const state = createMcpOauthWizardState({ action });
    expect(state.isRetry).toBe(true);
    expect(mcpOauthWizardTitleKey(state)).toBe("mcpModal.oauth.retryTitle");
  });
});

describe("reduceMcpOauthWizard step machine", () => {
  function seeded(): McpOauthWizardState {
    return createMcpOauthWizardState({
      action: authorizeAction(
        "authorize at https://auth.example.com/oauth/authorize?client_id=x",
      ),
      reason: "auth required",
    });
  }

  it("intro → auth → waiting → refreshing → success", () => {
    let s = seeded();
    expect(mcpOauthWizardStepIndex(s.step)).toBe(0);
    expect(mcpOauthWizardCanContinue(s)).toBe(true);

    s = reduceMcpOauthWizard(s, { type: "continue" });
    expect(s.step).toBe("auth");
    expect(mcpOauthWizardStepIndex(s.step)).toBe(1);

    s = reduceMcpOauthWizard(s, { type: "open_url_ok" });
    expect(s.urlOpened).toBe(true);

    s = reduceMcpOauthWizard(s, { type: "continue" });
    expect(s.step).toBe("waiting");
    expect(mcpOauthWizardCanConfirmAuthorized(s)).toBe(true);

    s = reduceMcpOauthWizard(s, { type: "doctor_start" });
    expect(s.step).toBe("refreshing");
    expect(s.refreshAttempts).toBe(1);

    s = reduceMcpOauthWizard(s, {
      type: "doctor_result",
      stillNeedsAuth: false,
    });
    expect(s.step).toBe("success");
    expect(s.softFail).toBe("none");
  });

  it("open_url_error is soft-fail non-blocking on auth", () => {
    let s = seeded();
    s = reduceMcpOauthWizard(s, { type: "continue" });
    s = reduceMcpOauthWizard(s, {
      type: "open_url_error",
      error: "spawn failed access_token=leakme",
    });
    expect(s.softFail).toBe("open_url_failed");
    expect(s.softFailNonBlocking).toBe(true);
    expect(s.errorMessage).toBeTruthy();
    expect(s.errorMessage).not.toContain("leakme");
    // Can still proceed to waiting.
    s = reduceMcpOauthWizard(s, { type: "continue" });
    expect(s.step).toBe("waiting");
  });

  it("doctor still needs auth → fail with still_needs_auth", () => {
    let s = seeded();
    s = reduceMcpOauthWizard(s, { type: "continue" });
    s = reduceMcpOauthWizard(s, { type: "continue" });
    s = reduceMcpOauthWizard(s, { type: "doctor_start" });
    s = reduceMcpOauthWizard(s, {
      type: "doctor_result",
      stillNeedsAuth: true,
      reason: "OAuth authorization required",
    });
    expect(s.step).toBe("fail");
    expect(s.softFail).toBe("still_needs_auth");
    expect(isMcpOauthWizardSoftFailNonBlocking(s.softFail)).toBe(true);
  });

  it("doctor host error → fail with doctor_failed", () => {
    let s = seeded();
    s = reduceMcpOauthWizard(s, { type: "continue" });
    s = reduceMcpOauthWizard(s, { type: "continue" });
    s = reduceMcpOauthWizard(s, { type: "doctor_start" });
    s = reduceMcpOauthWizard(s, {
      type: "doctor_result",
      stillNeedsAuth: true,
      doctorError: "CLI not found",
    });
    expect(s.step).toBe("fail");
    expect(s.softFail).toBe("doctor_failed");
  });

  it("retry_auth and retry_refresh from fail", () => {
    let s = seeded();
    s = reduceMcpOauthWizard(s, { type: "continue" });
    s = reduceMcpOauthWizard(s, { type: "continue" });
    s = reduceMcpOauthWizard(s, { type: "doctor_start" });
    s = reduceMcpOauthWizard(s, {
      type: "doctor_result",
      stillNeedsAuth: true,
    });
    s = reduceMcpOauthWizard(s, { type: "retry_auth" });
    expect(s.step).toBe("auth");

    s = reduceMcpOauthWizard(s, { type: "continue" });
    s = reduceMcpOauthWizard(s, { type: "doctor_start" });
    s = reduceMcpOauthWizard(s, {
      type: "doctor_result",
      stillNeedsAuth: true,
    });
    s = reduceMcpOauthWizard(s, { type: "retry_refresh" });
    expect(s.step).toBe("waiting");
  });

  it("back navigates intro ← auth ← waiting", () => {
    let s = seeded();
    s = reduceMcpOauthWizard(s, { type: "continue" });
    s = reduceMcpOauthWizard(s, { type: "continue" });
    expect(s.step).toBe("waiting");
    s = reduceMcpOauthWizard(s, { type: "back" });
    expect(s.step).toBe("auth");
    s = reduceMcpOauthWizard(s, { type: "back" });
    expect(s.step).toBe("intro");
  });

  it("reset clears to empty", () => {
    let s = seeded();
    s = reduceMcpOauthWizard(s, { type: "reset" });
    expect(s).toEqual(emptyMcpOauthWizardState());
  });

  it("ignores invalid transitions", () => {
    const s = seeded();
    expect(reduceMcpOauthWizard(s, { type: "doctor_start" })).toEqual(s);
    expect(
      reduceMcpOauthWizard(s, {
        type: "doctor_result",
        stillNeedsAuth: false,
      }),
    ).toEqual(s);
  });
});

describe("evaluateMcpOauthDoctorRefresh", () => {
  it("doctor_failed when error or missing report", () => {
    expect(
      evaluateMcpOauthDoctorRefresh({ doctorError: "timeout" }).softFail,
    ).toBe("doctor_failed");
    expect(evaluateMcpOauthDoctorRefresh({ report: null }).softFail).toBe(
      "doctor_failed",
    );
  });

  it("still_needs_auth when server status remains OAuth", () => {
    const report: McpDoctorReportLike = {
      ok: false,
      servers: [
        {
          name: "github",
          healthy: false,
          status: "OAuth token expired",
          issues: ["invalid_token — access token expired"],
        },
      ],
    };
    const r = evaluateMcpOauthDoctorRefresh({
      report,
      serverName: "github",
    });
    expect(r.stillNeedsAuth).toBe(true);
    expect(r.softFail).toBe("still_needs_auth");
    expect(r.ok).toBe(false);
  });

  it("success when server healthy after re-auth", () => {
    const report: McpDoctorReportLike = {
      ok: true,
      servers: [
        {
          name: "github",
          healthy: true,
          status: "ok",
        },
      ],
    };
    const r = evaluateMcpOauthDoctorRefresh({
      report,
      serverName: "github",
    });
    expect(r.stillNeedsAuth).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.softFail).toBe("none");
  });

  it("detects OAuth from findings when no server status map entry", () => {
    const report: McpDoctorReportLike = {
      ok: false,
      issues: [
        {
          server: "lin",
          message:
            'AuthRequired (resource_metadata="https://auth.example.com/.well-known/oauth-protected-resource")',
          level: "fail",
        },
      ],
    };
    const r = evaluateMcpOauthDoctorRefresh({
      report,
      serverName: "lin",
    });
    expect(r.stillNeedsAuth).toBe(true);
    expect(r.softFail).toBe("still_needs_auth");
  });
});

describe("labels / log sanitize", () => {
  it("maps soft-fail and step keys", () => {
    expect(mcpOauthWizardSoftFailLabelKey("no_cli_helper")).toBe(
      "mcpOauth.wizard.soft.noCliHelper",
    );
    expect(mcpOauthWizardStepLabelKey("refreshing")).toBe(
      "mcpOauth.wizard.step.refreshing",
    );
  });

  it("sanitizeMcpOauthWizardLog never includes secrets or full query tokens", () => {
    const action = authorizeAction(
      "https://login.example.com/oauth/authorize?client_id=app&state=xyz",
    );
    const state = createMcpOauthWizardState({
      action,
      reason: "Bearer supersecrettokenvalue99",
    });
    const withErr = reduceMcpOauthWizard(
      reduceMcpOauthWizard(state, { type: "continue" }),
      {
        type: "open_url_error",
        error: "failed access_token=ABCSECRET123 client_secret=xyz",
      },
    );
    const log = sanitizeMcpOauthWizardLog(withErr);
    const blob = JSON.stringify(log);
    expect(blob).not.toContain("supersecrettokenvalue99");
    expect(blob).not.toContain("ABCSECRET123");
    expect(blob).not.toContain("client_secret");
    expect(log.hasAuthUrl).toBe(true);
    expect(log.authHost).toBe("login.example.com");
    expect(log.step).toBe("auth");
    expect(log.softFail).toBe("open_url_failed");
  });
});
