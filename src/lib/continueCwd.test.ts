import { describe, expect, it } from "vitest";
import {
  canOfferContinueCwd,
  classifyContinueCwdEmptyResult,
  classifyContinueCwdError,
  continueCwdSoftFailMessageKey,
  cwdPathsMatch,
  evaluateContinueCwd,
  normalizeCwdPath,
  pickLatestCliSessionForCwd,
  resolveContinueCwdEmptyHonesty,
  resolveContinueCwdEmptyState,
  resolveContinueCwdSoftFail,
} from "./continueCwd";

describe("normalizeCwdPath", () => {
  it("trims, unifies slashes, drops trailing separator, lowercases", () => {
    expect(normalizeCwdPath("/Users/Me/Proj/")).toBe(
      normalizeCwdPath("/users/me/proj"),
    );
    expect(normalizeCwdPath("  /a/b  ")).toBe("/a/b");
    expect(normalizeCwdPath(String.raw`C:\Work\App`)).toBe("c:/work/app");
  });

  it("treats empty / whitespace as empty", () => {
    expect(normalizeCwdPath("")).toBe("");
    expect(normalizeCwdPath("   ")).toBe("");
    expect(normalizeCwdPath(null)).toBe("");
    expect(normalizeCwdPath(undefined)).toBe("");
  });
});

describe("cwdPathsMatch", () => {
  it("ignores trailing slash and case", () => {
    expect(cwdPathsMatch("/Users/me/Code", "/Users/me/Code/")).toBe(true);
    expect(cwdPathsMatch(String.raw`C:\Work\App`, "c:/work/app")).toBe(true);
  });

  it("rejects different paths and empty", () => {
    expect(cwdPathsMatch("/a/b", "/a/c")).toBe(false);
    expect(cwdPathsMatch("", "/a")).toBe(false);
    expect(cwdPathsMatch(null, "/a")).toBe(false);
  });
});

describe("pickLatestCliSessionForCwd", () => {
  const rows = [
    {
      agentSessionId: "old",
      cwd: "/Users/me/proj",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      agentSessionId: "other",
      cwd: "/Users/me/other",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      agentSessionId: "new",
      cwd: "/Users/me/proj/",
      updatedAt: "2025-06-01T12:00:00Z",
    },
  ];

  it("picks the newest matching cwd (trailing slash ok)", () => {
    const best = pickLatestCliSessionForCwd(rows, "/Users/me/proj");
    expect(best?.agentSessionId).toBe("new");
  });

  it("soft-fails when none match or path empty", () => {
    expect(pickLatestCliSessionForCwd(rows, "/missing")).toBeNull();
    expect(pickLatestCliSessionForCwd(rows, "")).toBeNull();
    expect(pickLatestCliSessionForCwd(rows, null)).toBeNull();
    expect(pickLatestCliSessionForCwd([], "/Users/me/proj")).toBeNull();
  });

  it("skips rows without cwd", () => {
    const mixed = [
      { agentSessionId: "nocwd", cwd: null, updatedAt: "2026-01-01T00:00:00Z" },
      {
        agentSessionId: "hit",
        cwd: "/p",
        updatedAt: "2025-01-01T00:00:00Z",
      },
    ];
    expect(pickLatestCliSessionForCwd(mixed, "/p")?.agentSessionId).toBe(
      "hit",
    );
  });
});

describe("canOfferContinueCwd", () => {
  it("requires a non-empty path", () => {
    expect(canOfferContinueCwd("/Users/me/proj")).toBe(true);
    expect(canOfferContinueCwd("  ")).toBe(false);
    expect(canOfferContinueCwd(null)).toBe(false);
    expect(canOfferContinueCwd(undefined)).toBe(false);
  });

  it("still offers untrusted by default (soft-fail on run)", () => {
    expect(
      canOfferContinueCwd("/Users/me/proj", { trusted: false }),
    ).toBe(true);
  });

  it("hides untrusted when hideWhenUntrusted", () => {
    expect(
      canOfferContinueCwd("/Users/me/proj", {
        trusted: false,
        hideWhenUntrusted: true,
      }),
    ).toBe(false);
    expect(
      canOfferContinueCwd("/Users/me/proj", {
        trusted: true,
        hideWhenUntrusted: true,
      }),
    ).toBe(true);
  });
});

describe("evaluateContinueCwd", () => {
  it("ok for trusted path on tauri", () => {
    expect(
      evaluateContinueCwd(
        { path: "/Users/me/proj", trusted: true },
        { isTauri: true },
      ),
    ).toEqual({ ok: true });
  });

  it("soft-fails host_only when not tauri", () => {
    expect(
      evaluateContinueCwd(
        { path: "/p", trusted: true },
        { isTauri: false },
      ),
    ).toEqual({ ok: false, kind: "host_only" });
  });

  it("soft-fails no_project when path empty", () => {
    expect(evaluateContinueCwd({ path: "  ", trusted: true })).toEqual({
      ok: false,
      kind: "no_project",
    });
    expect(evaluateContinueCwd(null)).toEqual({
      ok: false,
      kind: "no_project",
    });
  });

  it("soft-fails untrusted", () => {
    expect(
      evaluateContinueCwd({ path: "/p", trusted: false }, { isTauri: true }),
    ).toEqual({ ok: false, kind: "untrusted" });
  });

  it("soft-fails no_cli when probe known missing", () => {
    expect(
      evaluateContinueCwd(
        { path: "/p", trusted: true },
        { isTauri: true, cliFound: false },
      ),
    ).toEqual({ ok: false, kind: "no_cli" });
  });

  it("allows unknown cliFound", () => {
    expect(
      evaluateContinueCwd(
        { path: "/p", trusted: true },
        { isTauri: true, cliFound: null },
      ),
    ).toEqual({ ok: true });
  });

  it("priority: host_only before no_project", () => {
    expect(
      evaluateContinueCwd({ path: "" }, { isTauri: false }),
    ).toEqual({ ok: false, kind: "host_only" });
  });
});

describe("classifyContinueCwdError", () => {
  it("maps explicit codes", () => {
    expect(classifyContinueCwdError({ code: "no_session" })).toBe("no_session");
    expect(classifyContinueCwdError({ code: "cli_missing" })).toBe("no_cli");
    expect(classifyContinueCwdError({ code: "CLI_NOT_FOUND" })).toBe("no_cli");
    expect(classifyContinueCwdError({ code: "untrusted" })).toBe("untrusted");
    expect(classifyContinueCwdError({ code: "need_tauri" })).toBe("host_only");
    expect(classifyContinueCwdError({ code: "import_failed" })).toBe(
      "import_failed",
    );
    expect(classifyContinueCwdError({ code: "path_not_allowed" })).toBe(
      "import_failed",
    );
    expect(classifyContinueCwdError({ code: "no_project" })).toBe("no_project");
  });

  it("maps free-text patterns", () => {
    expect(classifyContinueCwdError("Grok Build CLI not found")).toBe("no_cli");
    expect(classifyContinueCwdError(new Error("CLI_NOT_FOUND: missing"))).toBe(
      "no_cli",
    );
    expect(classifyContinueCwdError("project is not trusted")).toBe("untrusted");
    expect(
      classifyContinueCwdError("No agent session found for this project"),
    ).toBe("no_session");
    expect(
      classifyContinueCwdError("path not allowed: outside GROK_HOME/sessions"),
    ).toBe("import_failed");
    expect(classifyContinueCwdError("CLI session dir not found for abc")).toBe(
      "import_failed",
    );
    expect(classifyContinueCwdError("Select a project first")).toBe(
      "no_project",
    );
    expect(classifyContinueCwdError("requires the Tauri window")).toBe(
      "host_only",
    );
  });

  it("falls back to other", () => {
    expect(classifyContinueCwdError("weird boom")).toBe("other");
    expect(classifyContinueCwdError(null)).toBe("other");
    expect(classifyContinueCwdError("")).toBe("other");
  });
});

describe("classifyContinueCwdEmptyResult", () => {
  it("null / empty id → no_session; real id → null", () => {
    expect(classifyContinueCwdEmptyResult(null)).toBe("no_session");
    expect(classifyContinueCwdEmptyResult(undefined)).toBe("no_session");
    expect(classifyContinueCwdEmptyResult({ id: "" })).toBe("no_session");
    expect(classifyContinueCwdEmptyResult({ id: "  " })).toBe("no_session");
    expect(classifyContinueCwdEmptyResult({ id: "sess-1" })).toBeNull();
  });
});

describe("continueCwdSoftFailMessageKey / resolve", () => {
  it("maps kinds to i18n keys", () => {
    expect(continueCwdSoftFailMessageKey("no_project")).toBe(
      "project.continueCwdNoProject",
    );
    expect(continueCwdSoftFailMessageKey("no_session")).toBe(
      "project.continueCwdNone",
    );
    expect(continueCwdSoftFailMessageKey("no_cli")).toBe(
      "project.continueCwdNoCli",
    );
    expect(continueCwdSoftFailMessageKey("untrusted")).toBe(
      "project.continueCwdUntrusted",
    );
    expect(continueCwdSoftFailMessageKey("host_only")).toBe(
      "project.continueCwdHostOnly",
    );
    expect(continueCwdSoftFailMessageKey("import_failed")).toBe(
      "project.continueCwdImportFailed",
    );
    expect(continueCwdSoftFailMessageKey("other")).toBe(
      "project.continueCwdFailed",
    );
  });

  it("resolveContinueCwdSoftFail attaches detail only for other", () => {
    const other = resolveContinueCwdSoftFail(new Error("disk full xyz"));
    expect(other.kind).toBe("other");
    expect(other.messageKey).toBe("project.continueCwdFailed");
    expect(other.detail).toContain("disk full");

    const cli = resolveContinueCwdSoftFail(new Error("CLI not found"));
    expect(cli.kind).toBe("no_cli");
    expect(cli.detail).toBe("");
  });

  it("empty honesty is always no_session", () => {
    const e = resolveContinueCwdEmptyHonesty();
    expect(e.kind).toBe("no_session");
    expect(e.messageKey).toBe("project.continueCwdNone");
  });
});

describe("resolveContinueCwdEmptyState", () => {
  it("returns null when ready to attempt", () => {
    expect(
      resolveContinueCwdEmptyState({
        projectPath: "/p",
        trusted: true,
        isTauri: true,
        cliFound: true,
      }),
    ).toBeNull();
  });

  it("surfaces classified empty / blocked states", () => {
    expect(
      resolveContinueCwdEmptyState({ projectPath: "", isTauri: true }),
    ).toMatchObject({ kind: "no_project" });
    expect(
      resolveContinueCwdEmptyState({
        projectPath: "/p",
        trusted: false,
        isTauri: true,
      }),
    ).toMatchObject({ kind: "untrusted" });
    expect(
      resolveContinueCwdEmptyState({
        projectPath: "/p",
        trusted: true,
        cliFound: false,
      }),
    ).toMatchObject({ kind: "no_cli" });
    expect(
      resolveContinueCwdEmptyState({
        projectPath: "/p",
        trusted: true,
        hostEmpty: true,
      }),
    ).toMatchObject({ kind: "no_session" });
    expect(
      resolveContinueCwdEmptyState({
        projectPath: "/p",
        isTauri: false,
      }),
    ).toMatchObject({ kind: "host_only" });
  });
});
