import { describe, expect, it } from "vitest";
import {
  WINDOWS_DAYUSE_DOCS_PATH,
  WINDOWS_DAYUSE_ITEM_IDS,
  buildWindowsDayuseChecklist,
  deriveProjectSpacesProbe,
  evaluateWindowsDayuseItem,
  formatWindowsDayuseSummaryText,
  isWindowsDayuseTargetPlatform,
  normalizeWindowsDayusePlatform,
  pathContainsSpaces,
  resolveWindowsDayuseEmptyState,
  windowsDayusePlatformBadgeKey,
  windowsDayuseStatusKey,
  windowsDayuseStatusTone,
  type WindowsDayuseItemId,
} from "./windowsDayuseChecklist";

describe("normalizeWindowsDayusePlatform / isWindowsDayuseTargetPlatform", () => {
  it("normalizes win aliases", () => {
    expect(normalizeWindowsDayusePlatform("win")).toBe("win");
    expect(normalizeWindowsDayusePlatform("Windows")).toBe("win");
    expect(normalizeWindowsDayusePlatform("win32")).toBe("win");
    expect(isWindowsDayuseTargetPlatform("win")).toBe(true);
    expect(isWindowsDayuseTargetPlatform("windows")).toBe(true);
  });

  it("maps mac / linux / other", () => {
    expect(normalizeWindowsDayusePlatform("mac")).toBe("mac");
    expect(normalizeWindowsDayusePlatform("darwin")).toBe("mac");
    expect(normalizeWindowsDayusePlatform("linux")).toBe("linux");
    expect(normalizeWindowsDayusePlatform(null)).toBe("other");
    expect(normalizeWindowsDayusePlatform("")).toBe("other");
    expect(isWindowsDayuseTargetPlatform("mac")).toBe(false);
    expect(isWindowsDayuseTargetPlatform("linux")).toBe(false);
  });
});

describe("pathContainsSpaces / deriveProjectSpacesProbe", () => {
  it("detects whitespace in paths", () => {
    expect(pathContainsSpaces("C:\\Users\\me\\My Project")).toBe(true);
    expect(pathContainsSpaces("/home/me/my project")).toBe(true);
    expect(pathContainsSpaces("C:\\Users\\me\\proj")).toBe(false);
    expect(pathContainsSpaces(null)).toBe(false);
    expect(pathContainsSpaces("")).toBe(false);
  });

  it("derives trusted + spaces from project list", () => {
    expect(deriveProjectSpacesProbe([])).toEqual({
      hasTrustedProject: false,
      pathHasSpaces: false,
    });
    expect(
      deriveProjectSpacesProbe([
        { trusted: false, path: "C:\\Users\\me\\My Project" },
      ]),
    ).toEqual({ hasTrustedProject: false, pathHasSpaces: false });
    expect(
      deriveProjectSpacesProbe([
        { trusted: true, path: "C:\\Users\\me\\proj" },
      ]),
    ).toEqual({ hasTrustedProject: true, pathHasSpaces: false });
    expect(
      deriveProjectSpacesProbe([
        { trusted: true, path: "C:\\Users\\me\\My Project" },
        { trusted: true, path: "C:\\other" },
      ]),
    ).toEqual({ hasTrustedProject: true, pathHasSpaces: true });
  });
});

describe("evaluateWindowsDayuseItem", () => {
  it("returns na on non-Windows for every id", () => {
    for (const id of WINDOWS_DAYUSE_ITEM_IDS) {
      expect(evaluateWindowsDayuseItem(id, { platform: "mac" })).toBe("na");
      expect(evaluateWindowsDayuseItem(id, { platform: "linux" })).toBe("na");
    }
  });

  it("install_path never invents SmartScreen without probe", () => {
    expect(
      evaluateWindowsDayuseItem("install_path", { platform: "win" }),
    ).toBe("manual");
    expect(
      evaluateWindowsDayuseItem("install_path", {
        platform: "win",
        installSigned: false,
      }),
    ).toBe("manual");
    expect(
      evaluateWindowsDayuseItem("install_path", {
        platform: "win",
        smartScreenProbed: true,
        installSigned: true,
      }),
    ).toBe("pass");
    expect(
      evaluateWindowsDayuseItem("install_path", {
        platform: "win",
        smartScreenProbed: true,
        installSigned: false,
      }),
    ).toBe("fail");
    expect(
      evaluateWindowsDayuseItem("install_path", {
        platform: "win",
        smartScreenProbed: true,
      }),
    ).toBe("manual");
  });

  it("cli_found pass / fail / manual", () => {
    expect(
      evaluateWindowsDayuseItem("cli_found", {
        platform: "win",
        cliFound: true,
      }),
    ).toBe("pass");
    expect(
      evaluateWindowsDayuseItem("cli_found", {
        platform: "win",
        cliFound: false,
      }),
    ).toBe("fail");
    expect(
      evaluateWindowsDayuseItem("cli_found", { platform: "win" }),
    ).toBe("manual");
  });

  it("project_spaces: fail without project; pass with spaces; manual otherwise", () => {
    expect(
      evaluateWindowsDayuseItem("project_spaces", {
        platform: "win",
        hasTrustedProject: false,
      }),
    ).toBe("fail");
    expect(
      evaluateWindowsDayuseItem("project_spaces", {
        platform: "win",
        hasTrustedProject: true,
        pathHasSpaces: true,
      }),
    ).toBe("pass");
    expect(
      evaluateWindowsDayuseItem("project_spaces", {
        platform: "win",
        hasTrustedProject: true,
        pathHasSpaces: false,
      }),
    ).toBe("manual");
    expect(
      evaluateWindowsDayuseItem("project_spaces", { platform: "win" }),
    ).toBe("manual");
  });

  it("single_attachment is always manual on Windows", () => {
    expect(
      evaluateWindowsDayuseItem("single_attachment", { platform: "win" }),
    ).toBe("manual");
  });

  it("app_update_check and mirror_readonly honor probes", () => {
    expect(
      evaluateWindowsDayuseItem("app_update_check", {
        platform: "win",
        updateSupported: true,
      }),
    ).toBe("pass");
    expect(
      evaluateWindowsDayuseItem("app_update_check", {
        platform: "win",
        updateSupported: false,
      }),
    ).toBe("fail");
    expect(
      evaluateWindowsDayuseItem("app_update_check", { platform: "win" }),
    ).toBe("manual");

    expect(
      evaluateWindowsDayuseItem("mirror_readonly", {
        platform: "win",
        mirrorWriteEnabled: false,
      }),
    ).toBe("pass");
    expect(
      evaluateWindowsDayuseItem("mirror_readonly", {
        platform: "win",
        mirrorWriteEnabled: true,
      }),
    ).toBe("fail");
    expect(
      evaluateWindowsDayuseItem("mirror_readonly", { platform: "win" }),
    ).toBe("manual");
  });
});

describe("buildWindowsDayuseChecklist", () => {
  it("marks all na on macOS / Linux", () => {
    const c = buildWindowsDayuseChecklist({ platform: "mac" });
    expect(c.isTargetPlatform).toBe(false);
    expect(c.platform).toBe("mac");
    expect(c.items).toHaveLength(WINDOWS_DAYUSE_ITEM_IDS.length);
    expect(c.items.every((i) => i.status === "na")).toBe(true);
    expect(c.counts.na).toBe(WINDOWS_DAYUSE_ITEM_IDS.length);
    expect(c.hasFail).toBe(false);
    expect(c.hasManual).toBe(false);
  });

  it("builds honest Windows checklist with mixed probes", () => {
    const c = buildWindowsDayuseChecklist({
      platform: "win",
      cliFound: true,
      hasTrustedProject: true,
      pathHasSpaces: true,
      mirrorWriteEnabled: false,
      updateSupported: true,
    });
    expect(c.isTargetPlatform).toBe(true);
    expect(c.platform).toBe("win");

    const byId = Object.fromEntries(
      c.items.map((i) => [i.id, i]),
    ) as Record<WindowsDayuseItemId, (typeof c.items)[number]>;

    expect(byId.install_path.status).toBe("manual"); // no SmartScreen probe
    expect(byId.cli_found.status).toBe("pass");
    expect(byId.project_spaces.status).toBe("pass");
    expect(byId.single_attachment.status).toBe("manual");
    expect(byId.app_update_check.status).toBe("pass");
    expect(byId.mirror_readonly.status).toBe("pass");

    expect(byId.cli_found.link).toBe("setup");
    expect(byId.app_update_check.link).toBe("about");
    expect(byId.mirror_readonly.link).toBe("mirror");
    expect(byId.install_path.labelKey).toContain("installPath");
    expect(c.hasManual).toBe(true);
    expect(c.hasFail).toBe(false);
    expect(c.counts.pass).toBe(4);
    expect(c.counts.manual).toBe(2);
  });

  it("flags fail when CLI missing or mirror write on", () => {
    const c = buildWindowsDayuseChecklist({
      platform: "win",
      cliFound: false,
      hasTrustedProject: false,
      mirrorWriteEnabled: true,
      updateSupported: false,
    });
    expect(c.hasFail).toBe(true);
    const statuses = Object.fromEntries(c.items.map((i) => [i.id, i.status]));
    expect(statuses.cli_found).toBe("fail");
    expect(statuses.project_spaces).toBe("fail");
    expect(statuses.mirror_readonly).toBe("fail");
    expect(statuses.app_update_check).toBe("fail");
  });

  it("uses stable item id order from acceptance doc", () => {
    expect(WINDOWS_DAYUSE_ITEM_IDS).toEqual([
      "install_path",
      "cli_found",
      "project_spaces",
      "single_attachment",
      "app_update_check",
      "mirror_readonly",
    ]);
  });
});

describe("resolveWindowsDayuseEmptyState", () => {
  it("shows target checklist on Windows", () => {
    const s = resolveWindowsDayuseEmptyState({ platform: "win" });
    expect(s.kind).toBe("target");
    expect(s.show).toBe(true);
    expect(s.isTargetPlatform).toBe(true);
    expect(s.hintKey).toBe("doctor.windowsDayuse.lead");
  });

  it("shows N/A honesty on macOS/Linux by default", () => {
    const s = resolveWindowsDayuseEmptyState({ platform: "mac" });
    expect(s.kind).toBe("not_windows");
    expect(s.show).toBe(true);
    expect(s.isTargetPlatform).toBe(false);
    expect(s.hintKey).toBe("doctor.windowsDayuse.notTarget");
  });

  it("can hide card entirely on non-Windows", () => {
    const s = resolveWindowsDayuseEmptyState({
      platform: "linux",
      hideOnNonWindows: true,
    });
    expect(s.kind).toBe("hidden");
    expect(s.show).toBe(false);
    expect(s.isTargetPlatform).toBe(false);
  });
});

describe("formatWindowsDayuseSummaryText / status helpers", () => {
  it("formats redacted summary without inventing SmartScreen", () => {
    const c = buildWindowsDayuseChecklist({
      platform: "win",
      cliFound: true,
      mirrorWriteEnabled: false,
    });
    const text = formatWindowsDayuseSummaryText(c, {
      title: "Windows day-use",
      generatedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(text).toContain("Windows day-use");
    expect(text).toContain("Platform: win");
    expect(text).toContain("[pass] cli_found");
    expect(text).toContain("[manual] install_path");
    expect(text).toContain("[manual] single_attachment");
    expect(text).toMatch(/SmartScreen/i);
    expect(text).toContain(WINDOWS_DAYUSE_DOCS_PATH);
    expect(text).toContain("Generated: 2026-08-01T00:00:00.000Z");
    // No secrets / tokens
    expect(text).not.toMatch(/sk-|xai-|token=/i);
  });

  it("status keys and tones", () => {
    expect(windowsDayuseStatusKey("pass")).toBe(
      "doctor.windowsDayuse.status.pass",
    );
    expect(windowsDayuseStatusKey("fail")).toBe(
      "doctor.windowsDayuse.status.fail",
    );
    expect(windowsDayuseStatusKey("manual")).toBe(
      "doctor.windowsDayuse.status.manual",
    );
    expect(windowsDayuseStatusKey("na")).toBe(
      "doctor.windowsDayuse.status.na",
    );
    expect(windowsDayuseStatusTone("pass")).toBe("ok");
    expect(windowsDayuseStatusTone("fail")).toBe("fail");
    expect(windowsDayuseStatusTone("manual")).toBe("manual");
    expect(windowsDayuseStatusTone("na")).toBe("na");
  });

  it("platform badge keys", () => {
    expect(windowsDayusePlatformBadgeKey("win")).toBe(
      "doctor.windowsDayuse.platform.win",
    );
    expect(windowsDayusePlatformBadgeKey("mac")).toBe(
      "doctor.windowsDayuse.platform.mac",
    );
    expect(windowsDayusePlatformBadgeKey("linux")).toBe(
      "doctor.windowsDayuse.platform.linux",
    );
    expect(windowsDayusePlatformBadgeKey("other")).toBe(
      "doctor.windowsDayuse.platform.other",
    );
  });
});
