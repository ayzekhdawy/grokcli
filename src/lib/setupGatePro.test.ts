import { describe, expect, it } from "vitest";
import {
  buildAuthDeferredFlags,
  buildReadyChecklist,
  canAdvancePastRuntime,
  canEnterHome,
  classifySetupGateError,
  clampInstallPercent,
  formatCliTooOldDetail,
  isAccountStepOptional,
  isCliVersionUnsupported,
  mirrorHostFromUrl,
  resolveInitialWizardStep,
  resolveSetupGateBoot,
  resolveSetupGateError,
  setupGateErrorHintKey,
  setupGateErrorTitleKey,
  setupGateOfferUnverifiedInstall,
} from "./setupGatePro";

describe("classifySetupGateError", () => {
  it("classifies checksum missing (strict mode / CN copy)", () => {
    expect(
      classifySetupGateError(
        "No published SHA-256 for artifact; set GROK_CLI_REQUIRE_CHECKSUM=0",
      ),
    ).toBe("checksum_missing");
    expect(classifySetupGateError("checksum required")).toBe(
      "checksum_missing",
    );
    expect(classifySetupGateError("官方镜像未发布 SHA-256")).toBe(
      "checksum_missing",
    );
  });

  it("classifies checksum mismatch", () => {
    expect(
      classifySetupGateError("checksum mismatch: expected abc got def"),
    ).toBe("checksum_mismatch");
  });

  it("classifies network / mirror / download", () => {
    expect(classifySetupGateError("All mirrors failed. Last error: timeout")).toBe(
      "mirror",
    );
    expect(
      classifySetupGateError(
        "Could not resolve Grok Build version from any mirror.",
      ),
    ).toBe("mirror");
    expect(classifySetupGateError("download https://x: HTTP 403")).toBe(
      "download",
    );
    expect(classifySetupGateError("connection timed out")).toBe("network");
    expect(classifySetupGateError(new Error("ENOTFOUND api.example"))).toBe(
      "network",
    );
  });

  it("classifies platform / binary / permission / missing", () => {
    expect(
      classifySetupGateError("Unsupported OS for Grok Build auto-install"),
    ).toBe("unsupported_platform");
    expect(
      classifySetupGateError("downloaded binary --version failed: signal"),
    ).toBe("binary_invalid");
    expect(classifySetupGateError("Permission denied")).toBe("permission");
    expect(classifySetupGateError("Grok Build not found")).toBe("cli_missing");
  });

  it("classifies too-old CLI and account / cancel", () => {
    expect(
      classifySetupGateError("CLI_TOO_OLD: grok CLI 0.2.100 < required 0.2.112"),
    ).toBe("cli_too_old");
    expect(classifySetupGateError("login cancelled by user")).toBe("cancelled");
    expect(classifySetupGateError("OAuth device flow failed")).toBe("account");
  });

  it("uses explicit code when present", () => {
    expect(classifySetupGateError({ code: "checksum_missing" })).toBe(
      "checksum_missing",
    );
    expect(classifySetupGateError({ code: "cancelled", message: "x" })).toBe(
      "cancelled",
    );
  });

  it("falls back to other", () => {
    expect(classifySetupGateError("weird host boom")).toBe("other");
    expect(classifySetupGateError(null)).toBe("other");
  });
});

describe("setupGateError keys / offer unverified", () => {
  it("maps kinds to i18n title keys", () => {
    expect(setupGateErrorTitleKey("checksum_missing")).toBe(
      "setup.error.checksumMissing",
    );
    expect(setupGateErrorTitleKey("network")).toBe("setup.error.network");
    expect(setupGateErrorTitleKey("other")).toBe("setup.error");
  });

  it("offers unverified install only for checksum_missing", () => {
    expect(setupGateOfferUnverifiedInstall("checksum_missing")).toBe(true);
    expect(setupGateOfferUnverifiedInstall("checksum_mismatch")).toBe(false);
    expect(setupGateOfferUnverifiedInstall("network")).toBe(false);
  });

  it("hints network recovery for mirror/download", () => {
    expect(setupGateErrorHintKey("mirror")).toBe("setup.networkHint");
    expect(setupGateErrorHintKey("download")).toBe("setup.networkHint");
    expect(setupGateErrorHintKey("cancelled")).toBeNull();
  });

  it("resolveSetupGateError packages view", () => {
    const v = resolveSetupGateError(
      "No published SHA-256 for artifact; GROK_CLI_REQUIRE_CHECKSUM",
    );
    expect(v.kind).toBe("checksum_missing");
    expect(v.offerUnverifiedInstall).toBe(true);
    expect(v.titleKey).toBe("setup.error.checksumMissing");
    expect(v.hintKey).toBe("setup.checksumMissingHint");
    expect(v.silent).toBe(false);
    expect(v.detail.length).toBeGreaterThan(0);
  });

  it("marks cancelled silent", () => {
    const v = resolveSetupGateError("User cancelled");
    expect(v.kind).toBe("cancelled");
    expect(v.silent).toBe(true);
  });
});

describe("resolveSetupGateBoot", () => {
  it("mirror always ready (no install surface)", () => {
    expect(
      resolveSetupGateBoot({
        cliFound: false,
        wizardCompleted: false,
        legacyDone: false,
        isMirror: true,
      }),
    ).toEqual({
      phase: "ready",
      shouldMigrateLegacy: false,
      reason: "mirror",
    });
  });

  it("missing CLI always setup — never invent ready", () => {
    expect(
      resolveSetupGateBoot({
        cliFound: false,
        wizardCompleted: true,
        legacyDone: true,
      }),
    ).toMatchObject({ phase: "setup", reason: "cli_missing" });
  });

  it("CLI + incomplete wizard → setup", () => {
    expect(
      resolveSetupGateBoot({
        cliFound: true,
        wizardCompleted: false,
        legacyDone: false,
      }),
    ).toEqual({
      phase: "setup",
      shouldMigrateLegacy: false,
      reason: "wizard_pending",
    });
  });

  it("CLI + legacy done migrates and enters ready", () => {
    expect(
      resolveSetupGateBoot({
        cliFound: true,
        wizardCompleted: false,
        legacyDone: true,
      }),
    ).toEqual({
      phase: "ready",
      shouldMigrateLegacy: true,
      reason: "legacy_migrate",
    });
  });

  it("CLI + wizard completed → ready", () => {
    expect(
      resolveSetupGateBoot({
        cliFound: true,
        wizardCompleted: true,
        legacyDone: false,
      }),
    ).toEqual({
      phase: "ready",
      shouldMigrateLegacy: false,
      reason: "wizard_done",
    });
  });
});

describe("wizard step + enter home honesty", () => {
  it("initial step depends only on CLI found", () => {
    expect(resolveInitialWizardStep(false)).toBe("runtime");
    expect(resolveInitialWizardStep(true)).toBe("account");
  });

  it("canEnterHome is hard CLI gate only", () => {
    expect(canEnterHome(false)).toBe(false);
    expect(canEnterHome(true)).toBe(true);
  });

  it("cannot advance past runtime without CLI", () => {
    expect(canAdvancePastRuntime(false)).toBe(false);
    expect(canAdvancePastRuntime(true)).toBe(true);
  });

  it("account step is always optional", () => {
    expect(isAccountStepOptional()).toBe(true);
  });
});

describe("buildAuthDeferredFlags", () => {
  it("never defers when auth is ok", () => {
    expect(buildAuthDeferredFlags({ authDeferred: true, authOk: true })).toEqual(
      {
        authSetupDeferred: false,
        setupSkipped: false,
      },
    );
  });

  it("defers only when skipped and not connected", () => {
    expect(
      buildAuthDeferredFlags({ authDeferred: true, authOk: false }),
    ).toEqual({
      authSetupDeferred: true,
      setupSkipped: true,
    });
    expect(
      buildAuthDeferredFlags({ authDeferred: false, authOk: false }),
    ).toEqual({
      authSetupDeferred: false,
      setupSkipped: false,
    });
  });
});

describe("buildReadyChecklist", () => {
  it("blocks enter when CLI missing — never soft-ok CLI", () => {
    const c = buildReadyChecklist({
      cliFound: false,
      authOk: true,
    });
    expect(c.canEnter).toBe(false);
    expect(c.rows[0]).toMatchObject({
      id: "cli",
      ok: false,
      soft: false,
      labelKey: "setup.cli.missing",
    });
    // Auth may still show ok if secrets present; does not grant entry.
    expect(c.rows[1].ok).toBe(true);
  });

  it("honest auth skip vs connected", () => {
    const skipped = buildReadyChecklist({
      cliFound: true,
      cliVersion: "0.2.117",
      authOk: false,
      authDeferred: true,
    });
    expect(skipped.canEnter).toBe(true);
    expect(skipped.authDeferred).toBe(true);
    expect(skipped.rows[0].meta).toBe("0.2.117");
    expect(skipped.rows[1].labelKey).toBe("setup.ready.authSkip");

    const ok = buildReadyChecklist({
      cliFound: true,
      authOk: true,
      authDeferred: true,
    });
    expect(ok.authDeferred).toBe(false);
    expect(ok.rows[1].labelKey).toBe("setup.ready.authOk");
  });
});

describe("mirrorHostFromUrl + clampInstallPercent", () => {
  it("extracts host from valid URLs", () => {
    expect(
      mirrorHostFromUrl(
        "https://storage.googleapis.com/grok-build-public-artifacts/cli",
      ),
    ).toBe("storage.googleapis.com");
    expect(mirrorHostFromUrl("https://x.ai/cli")).toBe("x.ai");
  });

  it("falls back for non-URL strings", () => {
    expect(mirrorHostFromUrl("not a url")).toBe("not a url");
    expect(mirrorHostFromUrl(null)).toBe("");
  });

  it("clamps percent honestly", () => {
    expect(clampInstallPercent(null, true)).toBe(8);
    expect(clampInstallPercent(null, false)).toBe(0);
    expect(clampInstallPercent(150, false)).toBe(100);
    expect(clampInstallPercent(-3, false)).toBe(0);
    expect(clampInstallPercent(42.6, true)).toBe(43);
  });
});

describe("cli version unsupported", () => {
  it("only false means unsupported (null is unknown — not blocked)", () => {
    expect(isCliVersionUnsupported(false)).toBe(true);
    expect(isCliVersionUnsupported(true)).toBe(false);
    expect(isCliVersionUnsupported(null)).toBe(false);
    expect(isCliVersionUnsupported(undefined)).toBe(false);
  });

  it("formats CLI_TOO_OLD detail without inventing min", () => {
    expect(
      formatCliTooOldDetail({ version: "0.2.100", minVersion: "0.2.112" }),
    ).toBe("CLI_TOO_OLD: grok CLI 0.2.100 < required 0.2.112");
    expect(formatCliTooOldDetail({ version: null })).toContain("?");
  });
});
