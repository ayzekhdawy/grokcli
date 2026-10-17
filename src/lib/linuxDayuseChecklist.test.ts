import { describe, expect, it } from "vitest";
import {
  LINUX_DAYUSE_DOCS_PATH,
  LINUX_DAYUSE_ITEM_IDS,
  buildLinuxDayuseChecklist,
  deriveProjectSpacesProbe,
  evaluateLinuxDayuseItem,
  formatLinuxDayuseSummaryText,
  isLinuxDayuseTargetPlatform,
  linuxDayusePlatformBadgeKey,
  linuxDayuseStatusKey,
  linuxDayuseStatusTone,
  normalizeDisplayServer,
  normalizeLinuxDayusePlatform,
  pathContainsSpaces,
  resolveLinuxDayuseEmptyState,
  resolveLinuxDayuseSandboxProfile,
  type LinuxDayuseItemId,
} from "./linuxDayuseChecklist";

describe("normalizeLinuxDayusePlatform / isLinuxDayuseTargetPlatform", () => {
  it("normalizes linux aliases", () => {
    expect(normalizeLinuxDayusePlatform("linux")).toBe("linux");
    expect(normalizeLinuxDayusePlatform("Linux")).toBe("linux");
    expect(normalizeLinuxDayusePlatform("android")).toBe("linux");
    expect(isLinuxDayuseTargetPlatform("linux")).toBe(true);
    expect(isLinuxDayuseTargetPlatform("LINUX")).toBe(true);
  });

  it("maps mac / win / other", () => {
    expect(normalizeLinuxDayusePlatform("mac")).toBe("mac");
    expect(normalizeLinuxDayusePlatform("darwin")).toBe("mac");
    expect(normalizeLinuxDayusePlatform("win")).toBe("win");
    expect(normalizeLinuxDayusePlatform("windows")).toBe("win");
    expect(normalizeLinuxDayusePlatform(null)).toBe("other");
    expect(normalizeLinuxDayusePlatform("")).toBe("other");
    expect(isLinuxDayuseTargetPlatform("mac")).toBe(false);
    expect(isLinuxDayuseTargetPlatform("win")).toBe(false);
  });
});

describe("pathContainsSpaces / deriveProjectSpacesProbe", () => {
  it("detects whitespace in paths", () => {
    expect(pathContainsSpaces("/home/me/My Project")).toBe(true);
    expect(pathContainsSpaces("/home/me/my project")).toBe(true);
    expect(pathContainsSpaces("/home/me/proj")).toBe(false);
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
        { trusted: false, path: "/home/me/My Project" },
      ]),
    ).toEqual({ hasTrustedProject: false, pathHasSpaces: false });
    expect(
      deriveProjectSpacesProbe([{ trusted: true, path: "/home/me/proj" }]),
    ).toEqual({ hasTrustedProject: true, pathHasSpaces: false });
    expect(
      deriveProjectSpacesProbe([
        { trusted: true, path: "/home/me/My Project" },
        { trusted: true, path: "/other" },
      ]),
    ).toEqual({ hasTrustedProject: true, pathHasSpaces: true });
  });
});

describe("resolveLinuxDayuseSandboxProfile / normalizeDisplayServer", () => {
  it("resolves known sandbox profiles", () => {
    expect(resolveLinuxDayuseSandboxProfile("off")).toBe("off");
    expect(resolveLinuxDayuseSandboxProfile("workspace")).toBe("workspace");
    expect(resolveLinuxDayuseSandboxProfile("read-only")).toBe("read-only");
    expect(resolveLinuxDayuseSandboxProfile(null)).toBe(null);
    expect(resolveLinuxDayuseSandboxProfile(undefined)).toBe(null);
    expect(resolveLinuxDayuseSandboxProfile("")).toBe(null);
  });

  it("normalizes display server strings", () => {
    expect(normalizeDisplayServer("wayland")).toBe("wayland");
    expect(normalizeDisplayServer("Wayland")).toBe("wayland");
    expect(normalizeDisplayServer("x11")).toBe("x11");
    expect(normalizeDisplayServer("xorg")).toBe("x11");
    expect(normalizeDisplayServer("")).toBe("unknown");
    expect(normalizeDisplayServer(null)).toBe("unknown");
    expect(normalizeDisplayServer("mir")).toBe("other");
  });
});

describe("evaluateLinuxDayuseItem", () => {
  it("returns na on non-Linux for every id", () => {
    for (const id of LINUX_DAYUSE_ITEM_IDS) {
      expect(evaluateLinuxDayuseItem(id, { platform: "mac" })).toBe("na");
      expect(evaluateLinuxDayuseItem(id, { platform: "win" })).toBe("na");
    }
  });

  it("cli_found pass / fail / manual", () => {
    expect(
      evaluateLinuxDayuseItem("cli_found", {
        platform: "linux",
        cliFound: true,
      }),
    ).toBe("pass");
    expect(
      evaluateLinuxDayuseItem("cli_found", {
        platform: "linux",
        cliFound: false,
      }),
    ).toBe("fail");
    expect(
      evaluateLinuxDayuseItem("cli_found", { platform: "linux" }),
    ).toBe("manual");
  });

  it("path_spaces: fail without project; pass with spaces; manual otherwise", () => {
    expect(
      evaluateLinuxDayuseItem("path_spaces", {
        platform: "linux",
        hasTrustedProject: false,
      }),
    ).toBe("fail");
    expect(
      evaluateLinuxDayuseItem("path_spaces", {
        platform: "linux",
        hasTrustedProject: true,
        pathHasSpaces: true,
      }),
    ).toBe("pass");
    expect(
      evaluateLinuxDayuseItem("path_spaces", {
        platform: "linux",
        hasTrustedProject: true,
        pathHasSpaces: false,
      }),
    ).toBe("manual");
    expect(
      evaluateLinuxDayuseItem("path_spaces", { platform: "linux" }),
    ).toBe("manual");
  });

  it("sandbox_landlock: off → na; not off → warn; never invent without probe", () => {
    expect(
      evaluateLinuxDayuseItem("sandbox_landlock", {
        platform: "linux",
        sandboxProfile: "off",
      }),
    ).toBe("na");
    expect(
      evaluateLinuxDayuseItem("sandbox_landlock", {
        platform: "linux",
        sandboxProfile: "workspace",
      }),
    ).toBe("warn");
    expect(
      evaluateLinuxDayuseItem("sandbox_landlock", {
        platform: "linux",
        sandboxProfile: "strict",
      }),
    ).toBe("warn");
    // Missing profile → manual (do not assume default off)
    expect(
      evaluateLinuxDayuseItem("sandbox_landlock", { platform: "linux" }),
    ).toBe("manual");
    // Explicit Landlock probe can pass / fail
    expect(
      evaluateLinuxDayuseItem("sandbox_landlock", {
        platform: "linux",
        sandboxProfile: "workspace",
        landlockProbed: true,
        landlockEnforced: true,
      }),
    ).toBe("pass");
    expect(
      evaluateLinuxDayuseItem("sandbox_landlock", {
        platform: "linux",
        sandboxProfile: "workspace",
        landlockProbed: true,
        landlockEnforced: false,
      }),
    ).toBe("fail");
    // landlockEnforced without landlockProbed must not invent
    expect(
      evaluateLinuxDayuseItem("sandbox_landlock", {
        platform: "linux",
        sandboxProfile: "workspace",
        landlockEnforced: false,
      }),
    ).toBe("warn");
  });

  it("tray_autostart is manual without probe", () => {
    expect(
      evaluateLinuxDayuseItem("tray_autostart", { platform: "linux" }),
    ).toBe("manual");
    expect(
      evaluateLinuxDayuseItem("tray_autostart", {
        platform: "linux",
        trayAutostartEnabled: true,
      }),
    ).toBe("manual");
    expect(
      evaluateLinuxDayuseItem("tray_autostart", {
        platform: "linux",
        trayAutostartProbed: true,
        trayAutostartEnabled: true,
      }),
    ).toBe("pass");
    expect(
      evaluateLinuxDayuseItem("tray_autostart", {
        platform: "linux",
        trayAutostartProbed: true,
        trayAutostartEnabled: false,
      }),
    ).toBe("fail");
  });

  it("wayland_x11 is manual/unknown without probe", () => {
    expect(
      evaluateLinuxDayuseItem("wayland_x11", { platform: "linux" }),
    ).toBe("manual");
    expect(
      evaluateLinuxDayuseItem("wayland_x11", {
        platform: "linux",
        displayServer: "wayland",
      }),
    ).toBe("manual");
    expect(
      evaluateLinuxDayuseItem("wayland_x11", {
        platform: "linux",
        displayServerProbed: true,
        displayServer: "wayland",
      }),
    ).toBe("pass");
    expect(
      evaluateLinuxDayuseItem("wayland_x11", {
        platform: "linux",
        displayServerProbed: true,
        displayServer: "x11",
      }),
    ).toBe("pass");
    expect(
      evaluateLinuxDayuseItem("wayland_x11", {
        platform: "linux",
        displayServerProbed: true,
        displayServer: "mir",
      }),
    ).toBe("fail");
    expect(
      evaluateLinuxDayuseItem("wayland_x11", {
        platform: "linux",
        displayServerProbed: true,
      }),
    ).toBe("manual");
  });

  it("app_update_check honors probes", () => {
    expect(
      evaluateLinuxDayuseItem("app_update_check", {
        platform: "linux",
        updateSupported: true,
      }),
    ).toBe("pass");
    expect(
      evaluateLinuxDayuseItem("app_update_check", {
        platform: "linux",
        updateSupported: false,
      }),
    ).toBe("fail");
    expect(
      evaluateLinuxDayuseItem("app_update_check", { platform: "linux" }),
    ).toBe("manual");
  });
});

describe("buildLinuxDayuseChecklist", () => {
  it("marks all na on macOS / Windows", () => {
    const c = buildLinuxDayuseChecklist({ platform: "mac" });
    expect(c.isTargetPlatform).toBe(false);
    expect(c.platform).toBe("mac");
    expect(c.items).toHaveLength(LINUX_DAYUSE_ITEM_IDS.length);
    expect(c.items.every((i) => i.status === "na")).toBe(true);
    expect(c.counts.na).toBe(LINUX_DAYUSE_ITEM_IDS.length);
    expect(c.hasFail).toBe(false);
    expect(c.hasManual).toBe(false);
    expect(c.hasWarn).toBe(false);
  });

  it("builds honest Linux checklist with mixed probes", () => {
    const c = buildLinuxDayuseChecklist({
      platform: "linux",
      cliFound: true,
      hasTrustedProject: true,
      pathHasSpaces: true,
      sandboxProfile: "workspace",
      updateSupported: true,
      // tray / wayland unprobed → manual
    });
    expect(c.isTargetPlatform).toBe(true);
    expect(c.platform).toBe("linux");

    const byId = Object.fromEntries(c.items.map((i) => [i.id, i])) as Record<
      LinuxDayuseItemId,
      (typeof c.items)[number]
    >;

    expect(byId.cli_found.status).toBe("pass");
    expect(byId.path_spaces.status).toBe("pass");
    expect(byId.sandbox_landlock.status).toBe("warn");
    expect(byId.tray_autostart.status).toBe("manual");
    expect(byId.wayland_x11.status).toBe("manual");
    expect(byId.app_update_check.status).toBe("pass");

    expect(byId.cli_found.link).toBe("setup");
    expect(byId.sandbox_landlock.link).toBe("sandbox");
    expect(byId.app_update_check.link).toBe("about");
    expect(byId.cli_found.labelKey).toContain("cliFound");
    expect(c.hasManual).toBe(true);
    expect(c.hasWarn).toBe(true);
    expect(c.hasFail).toBe(false);
    expect(c.counts.pass).toBe(3);
    expect(c.counts.warn).toBe(1);
    expect(c.counts.manual).toBe(2);
  });

  it("sandbox off yields n/a for landlock row", () => {
    const c = buildLinuxDayuseChecklist({
      platform: "linux",
      sandboxProfile: "off",
    });
    const landlock = c.items.find((i) => i.id === "sandbox_landlock");
    expect(landlock?.status).toBe("na");
    expect(landlock?.detailKey).toContain("sandboxLandlock.na");
  });

  it("flags fail when CLI missing", () => {
    const c = buildLinuxDayuseChecklist({
      platform: "linux",
      cliFound: false,
      hasTrustedProject: false,
      updateSupported: false,
    });
    expect(c.hasFail).toBe(true);
    const statuses = Object.fromEntries(c.items.map((i) => [i.id, i.status]));
    expect(statuses.cli_found).toBe("fail");
    expect(statuses.path_spaces).toBe("fail");
    expect(statuses.app_update_check).toBe("fail");
  });

  it("uses stable item id order", () => {
    expect(LINUX_DAYUSE_ITEM_IDS).toEqual([
      "cli_found",
      "path_spaces",
      "sandbox_landlock",
      "tray_autostart",
      "wayland_x11",
      "app_update_check",
    ]);
  });
});

describe("resolveLinuxDayuseEmptyState", () => {
  it("shows target checklist on Linux", () => {
    const s = resolveLinuxDayuseEmptyState({ platform: "linux" });
    expect(s.kind).toBe("target");
    expect(s.show).toBe(true);
    expect(s.isTargetPlatform).toBe(true);
    expect(s.hintKey).toBe("doctor.linuxDayuse.lead");
  });

  it("shows N/A honesty on macOS/Windows by default", () => {
    const s = resolveLinuxDayuseEmptyState({ platform: "mac" });
    expect(s.kind).toBe("not_linux");
    expect(s.show).toBe(true);
    expect(s.isTargetPlatform).toBe(false);
    expect(s.hintKey).toBe("doctor.linuxDayuse.notTarget");
  });

  it("can hide card entirely on non-Linux", () => {
    const s = resolveLinuxDayuseEmptyState({
      platform: "win",
      hideOnNonLinux: true,
    });
    expect(s.kind).toBe("hidden");
    expect(s.show).toBe(false);
    expect(s.isTargetPlatform).toBe(false);
  });
});

describe("formatLinuxDayuseSummaryText / status helpers", () => {
  it("formats redacted summary without inventing Landlock", () => {
    const c = buildLinuxDayuseChecklist({
      platform: "linux",
      cliFound: true,
      sandboxProfile: "workspace",
    });
    const text = formatLinuxDayuseSummaryText(c, {
      title: "Linux day-use",
      generatedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(text).toContain("Linux day-use");
    expect(text).toContain("Platform: linux");
    expect(text).toContain("[pass] cli_found");
    expect(text).toContain("[warn] sandbox_landlock");
    expect(text).toContain("[manual] tray_autostart");
    expect(text).toContain("[manual] wayland_x11");
    expect(text).toMatch(/Landlock/i);
    expect(text).toContain(LINUX_DAYUSE_DOCS_PATH);
    expect(text).toContain("Generated: 2026-08-01T00:00:00.000Z");
    // No secrets / tokens
    expect(text).not.toMatch(/sk-|xai-|token=/i);
  });

  it("status keys and tones", () => {
    expect(linuxDayuseStatusKey("pass")).toBe("doctor.linuxDayuse.status.pass");
    expect(linuxDayuseStatusKey("fail")).toBe("doctor.linuxDayuse.status.fail");
    expect(linuxDayuseStatusKey("manual")).toBe(
      "doctor.linuxDayuse.status.manual",
    );
    expect(linuxDayuseStatusKey("warn")).toBe("doctor.linuxDayuse.status.warn");
    expect(linuxDayuseStatusKey("na")).toBe("doctor.linuxDayuse.status.na");
    expect(linuxDayuseStatusTone("pass")).toBe("ok");
    expect(linuxDayuseStatusTone("fail")).toBe("fail");
    expect(linuxDayuseStatusTone("manual")).toBe("manual");
    expect(linuxDayuseStatusTone("warn")).toBe("warn");
    expect(linuxDayuseStatusTone("na")).toBe("na");
  });

  it("platform badge keys", () => {
    expect(linuxDayusePlatformBadgeKey("linux")).toBe(
      "doctor.linuxDayuse.platform.linux",
    );
    expect(linuxDayusePlatformBadgeKey("mac")).toBe(
      "doctor.linuxDayuse.platform.mac",
    );
    expect(linuxDayusePlatformBadgeKey("win")).toBe(
      "doctor.linuxDayuse.platform.win",
    );
    expect(linuxDayusePlatformBadgeKey("other")).toBe(
      "doctor.linuxDayuse.platform.other",
    );
  });
});
