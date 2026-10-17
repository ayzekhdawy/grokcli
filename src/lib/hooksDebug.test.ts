import { afterEach, describe, expect, it } from "vitest";
import {
  __resetHookActivityStoreForTests,
  clearHookActivities,
  formatHookActivityTime,
  HOOK_ACTIVITY_MAX,
  HOOK_ACTIVITY_STORAGE_KEY,
  ingestHookLogLine,
  ingestHostHookPayload,
  ingestToolHookSignal,
  isHookRelatedText,
  listHookActivities,
  loadHookActivities,
  normalizeHookEventType,
  outcomeFromStatus,
  parseHookActivityList,
  parseHookActivityRecord,
  parseHookLogLine,
  parseHostHookPayload,
  parseToolHookSignal,
  planClearHookActivities,
  pushHookActivity,
  pushHookActivityList,
  redactHookDetail,
  saveHookActivities,
  setHookActivityMax,
  subscribeHookActivities,
  type HookActivityRecord,
  type HookActivityStorage,
} from "./hooksDebug";

afterEach(() => {
  __resetHookActivityStoreForTests();
});

function memStorage(seed?: string): HookActivityStorage {
  let val: string | null = seed ?? null;
  return {
    getItem: () => val,
    setItem: (_k, v) => {
      val = v;
    },
  };
}

const baseRec: HookActivityRecord = {
  id: "ha-1",
  type: "TryRun",
  outcome: "ok",
  atMs: 1_700_000_000_000,
  detail: "exit 0",
  source: "try",
  hookName: "demo.sh",
};

describe("redactHookDetail", () => {
  it("scrubs sk- tokens and collapses whitespace", () => {
    const s = redactHookDetail("hook failed  key=sk-abcdefghijklmnop\nline2");
    expect(s).toContain("[REDACTED]");
    expect(s).not.toContain("sk-abcdefghijklmnop");
    expect(s).not.toMatch(/\n/);
  });

  it("redacts key=value secret patterns", () => {
    const s = redactHookDetail('token: supersecretvalue123 password="abc12345"');
    expect(s).toContain("[REDACTED]");
    expect(s).not.toContain("supersecretvalue123");
  });

  it("truncates long detail", () => {
    const s = redactHookDetail("x".repeat(400), 40);
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("normalizeHookEventType / outcomeFromStatus", () => {
  it("maps known event names", () => {
    expect(normalizeHookEventType("pre_tool_use")).toBe("PreToolUse");
    expect(normalizeHookEventType("SessionStart")).toBe("SessionStart");
    expect(normalizeHookEventType("post-tool-use")).toBe("PostToolUse");
    expect(normalizeHookEventType("")).toBe("Hook");
  });

  it("maps status strings", () => {
    expect(outcomeFromStatus("success")).toBe("ok");
    expect(outcomeFromStatus("failed")).toBe("fail");
    expect(outcomeFromStatus("skipped")).toBe("skip");
    expect(outcomeFromStatus(undefined, true)).toBe("ok");
    expect(outcomeFromStatus(undefined, false)).toBe("fail");
    expect(outcomeFromStatus("running")).toBe("info");
  });
});

describe("parseHostHookPayload", () => {
  it("parses hook_execution with per-run entries", () => {
    const recs = parseHostHookPayload(
      {
        kind: "hook_execution",
        eventName: "PreToolUse",
        toolName: "Bash",
        hooks: [
          { name: "safe-shell.sh", status: "success" },
          {
            name: "guard",
            status: { Failed: { reason: "exit 1" } },
            detail: "exit code 1",
          },
        ],
      },
      1_700_000_000_000,
    );
    expect(recs).toHaveLength(2);
    expect(recs[0]!.type).toBe("PreToolUse");
    expect(recs[0]!.outcome).toBe("ok");
    expect(recs[0]!.hookName).toBe("safe-shell.sh");
    expect(recs[0]!.source).toBe("host");
    expect(recs[1]!.outcome).toBe("fail");
    expect(recs[1]!.detail).toMatch(/exit code 1|guard/);
  });

  it("parses nested update + annotation fail text", () => {
    const recs = parseHostHookPayload({
      sessionId: "s1",
      kind: "hook_annotation",
      update: {
        sessionUpdate: "hook_annotation",
        text: "Hook annotation: stop_failure timed out",
      },
    });
    expect(recs).toHaveLength(1);
    expect(recs[0]!.outcome).toBe("fail");
    expect(recs[0]!.detail.toLowerCase()).toMatch(/timed out|timeout|stop_failure/);
  });

  it("parses top-level ok/detail summary", () => {
    const recs = parseHostHookPayload({
      event_name: "SessionStart",
      ok: true,
      detail: "echo started",
    });
    expect(recs[0]!.type).toBe("SessionStart");
    expect(recs[0]!.outcome).toBe("ok");
    expect(recs[0]!.detail).toBe("echo started");
  });

  it("returns empty for unrelated payload", () => {
    expect(parseHostHookPayload({ foo: 1 })).toEqual([]);
    expect(parseHostHookPayload(null)).toEqual([]);
  });
});

describe("parseHookLogLine", () => {
  it("detects failed hook lines", () => {
    const rec = parseHookLogLine(
      "hook 'bin/guard.sh' failed with exit code 2 (PreToolUse)",
    );
    expect(rec).not.toBeNull();
    expect(rec!.outcome).toBe("fail");
    expect(rec!.type).toBe("PreToolUse");
    expect(rec!.hookName).toBe("bin/guard.sh");
    expect(rec!.source).toBe("stderr");
  });

  it("detects skipped / loaded lines", () => {
    expect(parseHookLogLine("hook skipped (disabled)")!.outcome).toBe("skip");
    expect(parseHookLogLine("hooks: loaded from global source")!.outcome).toBe(
      "ok",
    );
  });

  it("ignores unrelated and webhook-only lines", () => {
    expect(parseHookLogLine("connection ready")).toBeNull();
    expect(parseHookLogLine("POST /api/webhook ok")).toBeNull();
  });

  it("isHookRelatedText false for webhook alone", () => {
    expect(isHookRelatedText("webhook delivery failed")).toBe(false);
    expect(isHookRelatedText("PreToolUse hook failed")).toBe(true);
  });
});

describe("parseToolHookSignal", () => {
  it("extracts hookSpecificOutput context", () => {
    const rec = parseToolHookSignal({
      title: "Stop gate",
      status: "completed",
      detail:
        'feedback {"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"Run the linter"}}',
    });
    expect(rec).not.toBeNull();
    expect(rec!.type).toBe("Stop");
    expect(rec!.detail).toContain("linter");
    expect(rec!.source).toBe("tool");
  });

  it("marks deny decision as fail", () => {
    const rec = parseToolHookSignal({
      title: "hook deny",
      detail: '{"decision":"deny","reason":"blocked rm"}',
      status: "failed",
    });
    expect(rec!.outcome).toBe("fail");
    expect(rec!.detail).toMatch(/blocked|deny/i);
  });

  it("ignores normal tools", () => {
    expect(
      parseToolHookSignal({
        title: "Read file",
        kind: "read",
        detail: "/tmp/a.ts",
        status: "completed",
      }),
    ).toBeNull();
  });
});

describe("ring buffer store", () => {
  it("keeps newest first and caps at max", () => {
    setHookActivityMax(3);
    for (let i = 0; i < 5; i++) {
      pushHookActivity({
        id: `r-${i}`,
        type: "SessionStart",
        outcome: "ok",
        atMs: 1000 + i,
        detail: `run ${i}`,
        source: "host",
      });
    }
    const list = listHookActivities();
    expect(list).toHaveLength(3);
    expect(list[0]!.detail).toBe("run 4");
    expect(list[2]!.detail).toBe("run 2");
  });

  it("dedupes identical type+detail within 1s", () => {
    const base: HookActivityRecord = {
      id: "a",
      type: "PreToolUse",
      outcome: "fail",
      atMs: 5000,
      detail: "exit 1",
      source: "stderr",
    };
    pushHookActivity(base);
    pushHookActivity({ ...base, id: "b", atMs: 5500 });
    expect(listHookActivities()).toHaveLength(1);
  });

  it("notifies subscribers and clear works", () => {
    let n = 0;
    const unsub = subscribeHookActivities(() => {
      n += 1;
    });
    ingestHookLogLine("hooks: loaded from project source");
    expect(n).toBe(1);
    expect(listHookActivities()).toHaveLength(1);
    clearHookActivities();
    expect(listHookActivities()).toHaveLength(0);
    expect(n).toBe(2);
    unsub();
  });

  it("ingestHostHookPayload / ingestToolHookSignal push when valid", () => {
    ingestHostHookPayload({
      eventName: "Stop",
      ok: false,
      detail: "Blocked by stop hook 'verify'",
    });
    ingestToolHookSignal({
      title: "hook",
      detail: "hookSpecificOutput denied",
      status: "failed",
    });
    expect(listHookActivities().length).toBeGreaterThanOrEqual(2);
  });

  it("default max is HOOK_ACTIVITY_MAX", () => {
    expect(HOOK_ACTIVITY_MAX).toBeGreaterThanOrEqual(10);
  });
});

describe("formatHookActivityTime", () => {
  it("formats non-zero times", () => {
    const s = formatHookActivityTime(1_700_000_000_000, "en-US");
    expect(s.length).toBeGreaterThan(0);
    expect(formatHookActivityTime(0)).toBe("");
  });
});

describe("parseHookActivityRecord / list / localStorage ring", () => {
  it("accepts valid records and aliases", () => {
    const e = parseHookActivityRecord({
      id: "x",
      event_name: "PreToolUse",
      outcome: "fail",
      detail: "boom sk-abcdefghijklmnop",
      source: "try",
      hook_name: "guard.sh",
      atMs: 42,
    });
    expect(e).toMatchObject({
      id: "x",
      type: "PreToolUse",
      outcome: "fail",
      source: "try",
      hookName: "guard.sh",
      atMs: 42,
    });
    expect(e!.detail).not.toMatch(/sk-abcdefghijklmnop/);
    expect(e!.detail).toContain("[REDACTED]");
  });

  it("rejects unknown outcomes and non-objects", () => {
    expect(parseHookActivityRecord({ ...baseRec, outcome: "pending" })).toBeNull();
    expect(parseHookActivityRecord(null)).toBeNull();
    expect(parseHookActivityRecord("nope")).toBeNull();
  });

  it("soft-fails corrupt storage to empty (never invents rows)", () => {
    expect(parseHookActivityList("{not json")).toEqual([]);
    expect(parseHookActivityList(undefined)).toEqual([]);
    expect(loadHookActivities(memStorage())).toEqual([]);
    expect(HOOK_ACTIVITY_STORAGE_KEY).toMatch(/hookActivity/);
  });

  it("caps at max and keeps newest first on pure push", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      ...baseRec,
      id: `ha-${i}`,
      atMs: 1_700_000_000_000 + i,
    }));
    const list = parseHookActivityList(many, 30);
    expect(list).toHaveLength(30);
    expect(list[0]!.id).toBe("ha-0");

    let ring: HookActivityRecord[] = [];
    for (let i = 0; i < 5; i++) {
      ring = pushHookActivityList(
        ring,
        { ...baseRec, id: `p-${i}`, detail: `run ${i}`, atMs: 1000 + i },
        3,
      );
    }
    expect(ring).toHaveLength(3);
    expect(ring[0]!.detail).toBe("run 4");
  });

  it("load / save / clear plan round-trip via injectable storage", () => {
    const storage = memStorage();
    saveHookActivities(
      [
        baseRec,
        {
          ...baseRec,
          id: "ha-2",
          outcome: "fail",
          detail: "exit 1",
          atMs: baseRec.atMs + 1,
        },
      ],
      storage,
    );
    const loaded = loadHookActivities(storage);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.id).toBe("ha-1");

    const plan = planClearHookActivities(loaded);
    expect(plan).toEqual({ count: 2, empty: false });
    expect(planClearHookActivities([])).toEqual({ count: 0, empty: true });

    saveHookActivities([], storage);
    expect(loadHookActivities(storage)).toEqual([]);
  });

  it("dedupes identical type+detail within 1s on pure push", () => {
    const a = pushHookActivityList([], baseRec, 10);
    const b = pushHookActivityList(
      a,
      { ...baseRec, id: "ha-2", atMs: baseRec.atMs + 500 },
      10,
    );
    expect(b).toHaveLength(1);
  });
});
