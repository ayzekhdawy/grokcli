import { describe, expect, it } from "vitest";
import {
  clampHooksTryTimeout,
  formatHooksTryRunOutput,
  formatHooksTryRunSummary,
  HOOKS_TRY_DEFAULT_TIMEOUT_SECS,
  HOOKS_TRY_MAX_TIMEOUT_SECS,
  HOOKS_TRY_MIN_TIMEOUT_SECS,
  HOOKS_TRY_STDIN_MAX,
  hooksTryRunActivityOutcome,
  hooksTryStdinErrorCode,
  isHookScriptTryable,
  validateHooksTryStdin,
} from "./hooksTryRun";

describe("validateHooksTryStdin", () => {
  it("allows empty / whitespace", () => {
    expect(validateHooksTryStdin(null)).toEqual({ ok: true, body: null });
    expect(validateHooksTryStdin("")).toEqual({ ok: true, body: null });
    expect(validateHooksTryStdin("  \n")).toEqual({ ok: true, body: null });
  });

  it("accepts JSON objects and arrays", () => {
    const o = validateHooksTryStdin(JSON.stringify({ hookEventName: "PreToolUse" }));
    expect(o.ok).toBe(true);
    if (o.ok) expect(o.body).toContain("PreToolUse");
    const a = validateHooksTryStdin("[1,2]");
    expect(a.ok).toBe(true);
  });

  it("rejects invalid JSON and oversize", () => {
    const bad = validateHooksTryStdin("not-json");
    expect(bad.ok).toBe(false);
    expect(hooksTryStdinErrorCode(bad)).toBe("invalid_json");
    const big = "x".repeat(HOOKS_TRY_STDIN_MAX + 1);
    const too = validateHooksTryStdin(big);
    expect(too.ok).toBe(false);
    expect(hooksTryStdinErrorCode(too)).toBe("too_large");
  });
});

describe("clampHooksTryTimeout", () => {
  it("defaults and clamps", () => {
    expect(clampHooksTryTimeout(undefined)).toBe(HOOKS_TRY_DEFAULT_TIMEOUT_SECS);
    expect(clampHooksTryTimeout(0)).toBe(HOOKS_TRY_MIN_TIMEOUT_SECS);
    expect(clampHooksTryTimeout(999)).toBe(HOOKS_TRY_MAX_TIMEOUT_SECS);
    expect(clampHooksTryTimeout(10)).toBe(10);
  });
});

describe("isHookScriptTryable", () => {
  it("allows script extensions, refuses dirs and json", () => {
    expect(isHookScriptTryable({ kind: "file", ext: "sh", name: "a.sh" })).toBe(
      true,
    );
    expect(isHookScriptTryable({ kind: "file", ext: "py", name: "x.py" })).toBe(
      true,
    );
    expect(
      isHookScriptTryable({ kind: "dir", ext: "", name: "scripts" }),
    ).toBe(false);
    expect(
      isHookScriptTryable({ kind: "file", ext: "json", name: "hooks.json" }),
    ).toBe(false);
    expect(isHookScriptTryable({ kind: "file", ext: "", name: "guard" })).toBe(
      true,
    );
  });
});

describe("formatHooksTryRunSummary / output", () => {
  it("refused / timeout / ok / fail are honest", () => {
    expect(
      formatHooksTryRunSummary({
        ok: false,
        refused: true,
        reason: "path_outside_hooks",
        message: "refused: path is outside",
      }),
    ).toMatch(/Refused/);
    expect(
      formatHooksTryRunSummary({
        ok: false,
        timedOut: true,
        timeoutSecs: 5,
      }),
    ).toMatch(/Timed out/);
    expect(
      formatHooksTryRunSummary({
        ok: true,
        exitCode: 0,
        durationMs: 12,
      }),
    ).toMatch(/Exit 0/);
    expect(
      formatHooksTryRunSummary({
        ok: false,
        exitCode: 2,
        durationMs: 3,
      }),
    ).toMatch(/Exit 2/);
  });

  it("redacts secrets in output preview", () => {
    const text = formatHooksTryRunOutput({
      ok: true,
      stdout: "token: sk-abcdefghijklmnopqrstuvwxyz0123",
      stderr: "",
    });
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });
});

describe("hooksTryRunActivityOutcome", () => {
  it("maps outcomes honestly", () => {
    expect(
      hooksTryRunActivityOutcome({ ok: false, refused: true }),
    ).toBe("skip");
    expect(
      hooksTryRunActivityOutcome({ ok: false, timedOut: true }),
    ).toBe("fail");
    expect(hooksTryRunActivityOutcome({ ok: true })).toBe("ok");
    expect(hooksTryRunActivityOutcome({ ok: false, exitCode: 1 })).toBe("fail");
  });
});
