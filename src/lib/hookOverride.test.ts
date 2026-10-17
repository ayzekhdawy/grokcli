import { afterEach, describe, expect, it } from "vitest";
import {
  __resetHookActivityStoreForTests,
  listHookActivities,
} from "./hooksDebug";
import {
  HOOK_OVERRIDE_JSON_MAX,
  countHookActivityOutcomes,
  filterHookActivitiesByOutcome,
  formatHookOverridePreview,
  hookOverrideValidationMessage,
  recordHookDryRun,
  resolveHookActivityEmptyState,
  validateHookOverrideJson,
} from "./hookOverride";

afterEach(() => {
  __resetHookActivityStoreForTests();
});

describe("validateHookOverrideJson", () => {
  it("accepts a plain object", () => {
    const r = validateHookOverrideJson(
      '{"hook_event_name":"PreToolUse","tool_name":"Bash"}',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.parsed.hook_event_name).toBe("PreToolUse");
      expect(r.parsed.tool_name).toBe("Bash");
    }
  });

  it("rejects empty / whitespace", () => {
    expect(validateHookOverrideJson("").ok).toBe(false);
    expect(validateHookOverrideJson("   ").ok).toBe(false);
    expect(validateHookOverrideJson(null).ok).toBe(false);
    const r = validateHookOverrideJson("");
    if (!r.ok) expect(r.error).toBe("empty");
  });

  it("rejects arrays and primitives", () => {
    expect(validateHookOverrideJson("[]").ok).toBe(false);
    expect(validateHookOverrideJson('"hi"').ok).toBe(false);
    expect(validateHookOverrideJson("42").ok).toBe(false);
    expect(validateHookOverrideJson("null").ok).toBe(false);
    const r = validateHookOverrideJson("[1]");
    if (!r.ok) expect(r.error).toBe("not_object");
  });

  it("rejects invalid JSON", () => {
    const r = validateHookOverrideJson("{not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.startsWith("invalid_json:")).toBe(true);
  });

  it("caps size around 32KB", () => {
    const big = `{"x":"${"a".repeat(HOOK_OVERRIDE_JSON_MAX)}}`;
    expect(big.length).toBeGreaterThan(HOOK_OVERRIDE_JSON_MAX);
    const r = validateHookOverrideJson(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.startsWith("too_large:")).toBe(true);
  });

  it("accepts object at size limit boundary", () => {
    // Small valid object is fine
    const r = validateHookOverrideJson("{}");
    expect(r.ok).toBe(true);
  });
});

describe("formatHookOverridePreview", () => {
  it("summarizes object keys", () => {
    const s = formatHookOverridePreview({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
    });
    expect(s).toMatch(/hook_event_name/);
    expect(s).toMatch(/PreToolUse/);
    expect(s).toMatch(/tool_name/);
  });

  it("handles empty object", () => {
    expect(formatHookOverridePreview({})).toBe("{}");
  });

  it("redacts secrets in values", () => {
    const s = formatHookOverridePreview({
      api_key: "sk-abcdefghijklmnopqrstuvwxyz",
    });
    expect(s).toContain("[REDACTED]");
    expect(s).not.toContain("sk-abcdefghijklmnop");
  });

  it("truncates long previews", () => {
    const s = formatHookOverridePreview(
      { long: "x".repeat(500) },
      40,
    );
    expect(s.length).toBeLessThanOrEqual(40);
  });
});

describe("hookOverrideValidationMessage", () => {
  it("maps codes to labels", () => {
    expect(
      hookOverrideValidationMessage({ ok: false, error: "empty" }, {
        empty: "EMPTY",
      }),
    ).toBe("EMPTY");
    expect(
      hookOverrideValidationMessage({ ok: true, parsed: {} }, { ok: "OK" }),
    ).toBe("OK");
  });
});

describe("recordHookDryRun", () => {
  it("pushes a debug-source activity row without executing hooks", () => {
    const rec = recordHookDryRun({
      hookName: "safe-shell.sh",
      type: "PreToolUse",
      outcome: "ok",
      detail: '{ tool:"Bash" }',
    });
    expect(rec.source).toBe("debug");
    expect(rec.type).toBe("PreToolUse");
    expect(rec.outcome).toBe("ok");
    expect(rec.hookName).toBe("safe-shell.sh");
    expect(rec.detail).toMatch(/dry-run/);
    expect(listHookActivities()).toHaveLength(1);
    expect(listHookActivities()[0]!.id).toBe(rec.id);
  });

  it("normalizes event type labels", () => {
    const rec = recordHookDryRun({
      type: "pre_tool_use",
      outcome: "fail",
    });
    expect(rec.type).toBe("PreToolUse");
    expect(rec.outcome).toBe("fail");
  });
});

describe("filterHookActivitiesByOutcome", () => {
  it("filters by outcome chips", () => {
    const rows = [
      { id: "1", outcome: "ok" as const },
      { id: "2", outcome: "fail" as const },
      { id: "3", outcome: "skip" as const },
      { id: "4", outcome: "info" as const },
    ];
    expect(filterHookActivitiesByOutcome(rows, "all")).toHaveLength(4);
    expect(filterHookActivitiesByOutcome(rows, "ok").map((r) => r.id)).toEqual([
      "1",
    ]);
    expect(filterHookActivitiesByOutcome(rows, "fail").map((r) => r.id)).toEqual([
      "2",
    ]);
    expect(filterHookActivitiesByOutcome(rows, "skip").map((r) => r.id)).toEqual([
      "3",
    ]);
  });
});

describe("countHookActivityOutcomes / resolveHookActivityEmptyState", () => {
  it("counts chips (info only in all)", () => {
    const rows = [
      { outcome: "ok" as const },
      { outcome: "ok" as const },
      { outcome: "fail" as const },
      { outcome: "skip" as const },
      { outcome: "info" as const },
    ];
    expect(countHookActivityOutcomes(rows)).toEqual({
      all: 5,
      ok: 2,
      fail: 1,
      skip: 1,
    });
  });

  it("resolves empty vs filtered vs list honesty", () => {
    expect(resolveHookActivityEmptyState(0, 0)).toBe("empty");
    expect(resolveHookActivityEmptyState(3, 0)).toBe("filtered");
    expect(resolveHookActivityEmptyState(3, 2)).toBe("list");
  });
});
