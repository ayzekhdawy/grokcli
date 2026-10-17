import { describe, expect, it } from "vitest";
import {
  buildHooksStdinValidatePresentation,
  buildHooksTryExceptionPresentation,
  buildHooksTryPreflightError,
  buildHooksTryPresentation,
  classifyHooksOverrideValidation,
  classifyHooksTryException,
  classifyHooksTryResult,
  classifyHooksTryStdinError,
  hooksValidateBadgeTone,
  hooksValidateHint,
  hooksValidateKindLabel,
  hooksValidateSeverity,
} from "./hooksValidate";
import { validateHooksTryStdin } from "./hooksTryRun";
import { validateHookOverrideJson } from "./hookOverride";

describe("classifyHooksTryResult", () => {
  it("maps ok / timeout / exit / refused reasons", () => {
    expect(classifyHooksTryResult({ ok: true, exitCode: 0 })).toBe("ok");
    expect(
      classifyHooksTryResult({ ok: false, timedOut: true, reason: "timeout" }),
    ).toBe("timeout");
    expect(
      classifyHooksTryResult({
        ok: false,
        refused: true,
        reason: "path_outside_hooks",
      }),
    ).toBe("path_outside_hooks");
    expect(
      classifyHooksTryResult({
        ok: false,
        refused: true,
        reason: "not_a_file",
      }),
    ).toBe("not_a_file");
    expect(
      classifyHooksTryResult({
        ok: false,
        refused: true,
        reason: "empty_path",
      }),
    ).toBe("empty_path");
    expect(
      classifyHooksTryResult({ ok: false, exitCode: 2 }),
    ).toBe("exit_nonzero");
    expect(
      classifyHooksTryResult({
        ok: false,
        refused: false,
        reason: "spawn_failed",
      }),
    ).toBe("spawn_failed");
    expect(
      classifyHooksTryResult({ ok: false, refused: true, reason: "mystery" }),
    ).toBe("refused");
  });

  it("handles null result as other", () => {
    expect(classifyHooksTryResult(null)).toBe("other");
    expect(classifyHooksTryResult(undefined)).toBe("other");
  });
});

describe("classifyHooksTryException", () => {
  it("detects host-only / timeout / path / json", () => {
    expect(classifyHooksTryException("Try-run requires the desktop host")).toBe(
      "host_only",
    );
    expect(classifyHooksTryException(new Error("operation timed out"))).toBe(
      "timeout",
    );
    expect(
      classifyHooksTryException("refused: path outside hooks directory"),
    ).toBe("path_outside_hooks");
    expect(classifyHooksTryException("invalid json near line 1")).toBe(
      "invalid_json",
    );
    expect(classifyHooksTryException("boom")).toBe("host_error");
  });
});

describe("classifyHooksTryStdinError / override", () => {
  it("maps try-run stdin (empty allowed)", () => {
    expect(classifyHooksTryStdinError(validateHooksTryStdin(""))).toBe(null);
    expect(classifyHooksTryStdinError(validateHooksTryStdin("{"))).toBe(
      "invalid_json",
    );
    const big = "x".repeat(32 * 1024 + 1);
    expect(classifyHooksTryStdinError(validateHooksTryStdin(big))).toBe(
      "stdin_too_large",
    );
  });

  it("maps object-only validate", () => {
    expect(classifyHooksOverrideValidation(validateHookOverrideJson(""))).toBe(
      "stdin_empty",
    );
    expect(
      classifyHooksOverrideValidation(validateHookOverrideJson("[1]")),
    ).toBe("stdin_not_object");
    expect(
      classifyHooksOverrideValidation(
        validateHookOverrideJson('{"hookEventName":"PreToolUse"}'),
      ),
    ).toBe("ok");
  });
});

describe("severity / labels / badge", () => {
  it("ok is ok; refused warn; fail err", () => {
    expect(hooksValidateSeverity("ok")).toBe("ok");
    expect(hooksValidateSeverity("path_outside_hooks")).toBe("warn");
    expect(hooksValidateSeverity("exit_nonzero")).toBe("err");
    expect(hooksValidateBadgeTone("ok")).toBe("ok");
    expect(hooksValidateBadgeTone("warn")).toBe("muted");
    expect(hooksValidateBadgeTone("err")).toBe("fail");
  });

  it("labels and hints resolve with overrides", () => {
    expect(hooksValidateKindLabel("timeout")).toMatch(/Timed out/i);
    expect(
      hooksValidateKindLabel("timeout", { timeout: "已超时" }),
    ).toBe("已超时");
    expect(hooksValidateHint("path_outside_hooks")).toMatch(/hooks/i);
  });
});

describe("buildHooksTryPresentation", () => {
  it("surfaces summary, path, output, severity", () => {
    const p = buildHooksTryPresentation({
      ok: true,
      exitCode: 0,
      durationMs: 12,
      path: "/tmp/.grok/hooks/a.sh",
      scope: "user",
      stdout: "hello",
      stderr: "",
    });
    expect(p.ok).toBe(true);
    expect(p.kind).toBe("ok");
    expect(p.severity).toBe("ok");
    expect(p.summary).toMatch(/Exit 0/);
    expect(p.path).toContain("a.sh");
    expect(p.output).toContain("hello");
    expect(p.durationMs).toBe(12);
  });

  it("refused includes redacted detail", () => {
    const p = buildHooksTryPresentation({
      ok: false,
      refused: true,
      reason: "path_outside_hooks",
      message: "refused: path is outside",
    });
    expect(p.kind).toBe("path_outside_hooks");
    expect(p.severity).toBe("warn");
    expect(p.refused).toBe(true);
    expect(p.detail).toMatch(/outside|refused/i);
  });

  it("exception presentation classifies host errors", () => {
    const p = buildHooksTryExceptionPresentation(
      new Error("not a Tauri window"),
    );
    expect(p.kind).toBe("host_only");
    expect(p.ok).toBe(false);
  });
});

describe("buildHooksStdinValidatePresentation", () => {
  it("accepts object and previews keys", () => {
    const { check, presentation } = buildHooksStdinValidatePresentation(
      '{"hookEventName":"PreToolUse","toolName":"Bash"}',
    );
    expect(check.ok).toBe(true);
    expect(presentation.ok).toBe(true);
    expect(presentation.kind).toBe("ok");
    expect(presentation.summary).toMatch(/hookEventName|PreToolUse/);
  });

  it("rejects empty / not object", () => {
    expect(buildHooksStdinValidatePresentation("").presentation.kind).toBe(
      "stdin_empty",
    );
    expect(buildHooksStdinValidatePresentation("[]").presentation.kind).toBe(
      "stdin_not_object",
    );
  });
});

describe("buildHooksTryPreflightError", () => {
  it("blocks empty path / non-tauri / bad json", () => {
    expect(
      buildHooksTryPreflightError("", "{}", { isTauri: true })?.kind,
    ).toBe("empty_path");
    expect(
      buildHooksTryPreflightError("/hooks/a.sh", "{}", { isTauri: false })
        ?.kind,
    ).toBe("host_only");
    expect(
      buildHooksTryPreflightError("/hooks/a.sh", "{", { isTauri: true })?.kind,
    ).toBe("invalid_json");
    expect(
      buildHooksTryPreflightError("/hooks/a.sh", "{}", { isTauri: true }),
    ).toBe(null);
    expect(
      buildHooksTryPreflightError("/hooks/a.sh", "  ", { isTauri: true }),
    ).toBe(null);
  });
});
