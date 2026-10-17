import { describe, expect, it } from "vitest";
import {
  CLI_PERMISSION_MODES,
  CLI_TO_POLICY,
  POLICY_TO_CLI,
  alwaysApproveSpawnFlags,
  cliPermissionModeToPolicy,
  isCliPermissionMode,
  isPolicyCliOneToOne,
  permissionModeSpawnFlags,
  policyToCliPermissionMode,
  resolveCliPermissionMode,
  shouldPassAlwaysApprove,
} from "./permissionModeMap";
import { PERMISSION_POLICIES, type PermissionPolicyId } from "./grokCatalog";

describe("CLI_PERMISSION_MODES", () => {
  it("lists every official grok --permission-mode value", () => {
    expect([...CLI_PERMISSION_MODES]).toEqual([
      "default",
      "acceptEdits",
      "auto",
      "dontAsk",
      "bypassPermissions",
      "plan",
    ]);
  });
});

describe("policyToCliPermissionMode", () => {
  it("maps every product policy", () => {
    const expected: Record<PermissionPolicyId, string> = {
      ask: "default",
      accept_edits: "acceptEdits",
      allow_for_session: "default",
      auto: "auto",
      dont_ask: "dontAsk",
      always_approve: "bypassPermissions",
    };
    for (const p of PERMISSION_POLICIES) {
      expect(policyToCliPermissionMode(p.id)).toBe(expected[p.id]);
      expect(POLICY_TO_CLI[p.id]).toBe(expected[p.id]);
    }
  });

  it("accepts CLI strings and aliases", () => {
    expect(policyToCliPermissionMode("acceptEdits")).toBe("acceptEdits");
    expect(policyToCliPermissionMode("bypassPermissions")).toBe(
      "bypassPermissions",
    );
    expect(policyToCliPermissionMode("yolo")).toBe("bypassPermissions");
    expect(policyToCliPermissionMode("auto")).toBe("auto");
    expect(policyToCliPermissionMode("plan")).toBe("plan");
    expect(policyToCliPermissionMode("dont_ask")).toBe("dontAsk");
    expect(policyToCliPermissionMode("")).toBe("default");
    expect(policyToCliPermissionMode(null)).toBe("default");
    expect(policyToCliPermissionMode("unknown")).toBe("default");
  });
});

describe("cliPermissionModeToPolicy", () => {
  it("reverses primary CLI modes", () => {
    expect(cliPermissionModeToPolicy("default")).toBe("ask");
    expect(cliPermissionModeToPolicy("acceptEdits")).toBe("accept_edits");
    expect(cliPermissionModeToPolicy("auto")).toBe("auto");
    expect(cliPermissionModeToPolicy("dontAsk")).toBe("dont_ask");
    expect(cliPermissionModeToPolicy("bypassPermissions")).toBe(
      "always_approve",
    );
  });

  it("lossy-maps plan to ask (plan is product session mode)", () => {
    expect(cliPermissionModeToPolicy("plan")).toBe("ask");
    expect(CLI_TO_POLICY.plan).toBe("ask");
    expect(CLI_TO_POLICY.auto).toBe("auto");
  });
});

describe("resolveCliPermissionMode", () => {
  it("YOLO / always_approve wins over plan and policy", () => {
    expect(
      resolveCliPermissionMode({
        policy: "always_approve",
        sessionMode: "plan",
      }),
    ).toBe("bypassPermissions");
    expect(
      resolveCliPermissionMode({
        policy: "accept_edits",
        sessionMode: "plan",
        yolo: true,
      }),
    ).toBe("bypassPermissions");
    expect(
      resolveCliPermissionMode({ policy: "yolo", sessionMode: "agent" }),
    ).toBe("bypassPermissions");
  });

  it("product plan mode maps to CLI plan when not YOLO", () => {
    expect(
      resolveCliPermissionMode({ policy: "ask", sessionMode: "plan" }),
    ).toBe("plan");
    expect(
      resolveCliPermissionMode({
        policy: "accept_edits",
        sessionMode: "plan",
      }),
    ).toBe("plan");
  });

  it("falls through to policy table", () => {
    expect(
      resolveCliPermissionMode({
        policy: "accept_edits",
        sessionMode: "agent",
      }),
    ).toBe("acceptEdits");
    expect(
      resolveCliPermissionMode({ policy: "dont_ask", sessionMode: "ask" }),
    ).toBe("dontAsk");
    expect(
      resolveCliPermissionMode({
        policy: "allow_for_session",
        sessionMode: "agent",
      }),
    ).toBe("default");
  });
});

describe("spawn helpers", () => {
  it("permissionModeSpawnFlags always pins --permission-mode", () => {
    expect(
      permissionModeSpawnFlags({ policy: "ask", sessionMode: "agent" }),
    ).toEqual(["--permission-mode", "default"]);
    expect(
      permissionModeSpawnFlags({
        policy: "always_approve",
        sessionMode: "agent",
      }),
    ).toEqual(["--permission-mode", "bypassPermissions"]);
    expect(
      permissionModeSpawnFlags({ policy: "ask", sessionMode: "plan" }),
    ).toEqual(["--permission-mode", "plan"]);
  });

  it("alwaysApproveSpawnFlags only for bypassPermissions", () => {
    expect(
      alwaysApproveSpawnFlags({ policy: "always_approve" }),
    ).toEqual(["--always-approve"]);
    expect(alwaysApproveSpawnFlags({ policy: "ask" })).toEqual([]);
    expect(
      alwaysApproveSpawnFlags({ policy: "accept_edits", yolo: true }),
    ).toEqual(["--always-approve"]);
    expect(shouldPassAlwaysApprove("bypassPermissions")).toBe(true);
    expect(shouldPassAlwaysApprove("default")).toBe(false);
  });
});

describe("isPolicyCliOneToOne / isCliPermissionMode", () => {
  it("allow_for_session is not 1:1", () => {
    expect(isPolicyCliOneToOne("ask")).toBe(true);
    expect(isPolicyCliOneToOne("accept_edits")).toBe(true);
    expect(isPolicyCliOneToOne("allow_for_session")).toBe(false);
    expect(isPolicyCliOneToOne("always_approve")).toBe(true);
  });

  it("validates CLI mode tokens", () => {
    expect(isCliPermissionMode("default")).toBe(true);
    expect(isCliPermissionMode("auto")).toBe(true);
    expect(isCliPermissionMode("ask")).toBe(false);
  });
});
