import { describe, expect, it } from "vitest";
import {
  coerceFixId,
  dispositionToLevel,
  extractFixIds,
  extractSafeFacts,
  formatFactValue,
  hasAnySafeFact,
  isDestructiveDoctorFix,
  isValidDoctorFixId,
  listFixableChecks,
  listSafeAutoFixes,
  parseCliDoctorEnvelope,
  parseCliDoctorReport,
  parseFinding,
  summarizeFixPlan,
} from "./cliDoctor";

/** Minimal fixture shaped like `grok doctor --json` (schemaVersion 1). */
const FIXTURE = {
  schemaVersion: "1",
  facts: {
    terminal: {
      name: "iterm2",
      xtversion: { status: "unavailable", value: null },
    },
    multiplexer: { kind: "undetected", byobu: null },
    ssh: false,
    color: {
      level: { status: "available", value: "none" },
      availableThemes: ["groknight", "grokday"],
      totalThemes: 5,
    },
    keyboard: null,
    newline: null,
    clipboard: {
      nativeRoute: true,
      nativeTool: "pbcopy",
      nativePreflight: "local_available",
      tmuxRoute: false,
      osc52Route: false,
      osc52Capability: "supported",
      wrapSink: false,
      displayServer: "quartz",
      containerNoDisplay: false,
      dataControl: "not_applicable",
      delivery: "confirmed",
      fix: null,
    },
    voice: {
      status: "available",
      name: "MacBook Pro Microphone",
      detail: "48000 Hz, 1 ch, F32",
    },
  },
  findings: [
    {
      id: "terminal.limited-color",
      disposition: "issue",
      message: "NO_COLOR set -- themed colors disabled",
      remediation: null,
      automaticRemediation: null,
      note: "Unset NO_COLOR and restart Grok.",
    },
    {
      id: "clipboard.ok",
      disposition: "recommendation",
      message: "Prefer native clipboard when available",
      remediation: "Use pbcopy",
      automaticRemediation: null,
      note: null,
    },
    {
      id: "terminal.ssh-wrap",
      disposition: "recommendation",
      message: "Wrap ssh through grok wrap for better terminal support",
      remediation: "Add shell alias via doctor fix",
      automaticRemediation: "ssh-wrap",
      note: "Writes an interactive-shell alias to ~/.zshrc (with backup).",
    },
  ],
  probeNotes: [
    {
      probe: "runtime.fullscreen-active",
      status: "unavailable",
      message: null,
    },
  ],
  counts: {
    issues: 1,
    recommendations: 2,
    probeNotes: 1,
  },
};

describe("dispositionToLevel", () => {
  it("maps issue / recommendation / ok", () => {
    expect(dispositionToLevel("issue")).toBe("fail");
    expect(dispositionToLevel("recommendation")).toBe("warn");
    expect(dispositionToLevel("ok")).toBe("ok");
    expect(dispositionToLevel("pass")).toBe("ok");
    expect(dispositionToLevel("weird")).toBe("warn");
  });
});

describe("extractSafeFacts", () => {
  it("pulls terminal / clipboard / color without dumping nested objects", () => {
    const f = extractSafeFacts(FIXTURE.facts);
    expect(f.terminal).toBe("iterm2");
    expect(f.ssh).toBe(false);
    expect(f.clipboard).toContain("confirmed");
    expect(f.clipboard).toContain("pbcopy");
    expect(f.color).toContain("none");
    expect(f.color).toContain("5 themes");
    expect(f.voice).toContain("available");
    expect(f.multiplexer).toContain("undetected");
    expect(hasAnySafeFact(f)).toBe(true);
  });

  it("handles missing facts", () => {
    expect(extractSafeFacts(null)).toEqual({});
    expect(hasAnySafeFact({})).toBe(false);
  });
});

describe("parseFinding", () => {
  it("builds title/detail from message + note", () => {
    const row = parseFinding(FIXTURE.findings[0], 0);
    expect(row?.id).toBe("terminal.limited-color");
    expect(row?.level).toBe("fail");
    expect(row?.title).toContain("NO_COLOR");
    expect(row?.detail).toContain("Unset NO_COLOR");
    expect(row?.fixId).toBeNull();
  });

  it("surfaces automaticRemediation as fixId", () => {
    const row = parseFinding(FIXTURE.findings[2], 2);
    expect(row?.id).toBe("terminal.ssh-wrap");
    expect(row?.fixId).toBe("ssh-wrap");
    expect(row?.destructive).toBe(true);
    expect(row?.detail).toContain("fix: ssh-wrap");
  });
});

describe("extractFixIds", () => {
  it("extracts unique fix handles from fixture findings", () => {
    const fixes = extractFixIds(FIXTURE);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].fixId).toBe("ssh-wrap");
    expect(fixes[0].findingId).toBe("terminal.ssh-wrap");
    expect(fixes[0].destructive).toBe(true);
    expect(fixes[0].message).toContain("Wrap ssh");
  });

  it("accepts host envelope and bare findings array", () => {
    expect(
      extractFixIds({ available: true, report: FIXTURE }).map((f) => f.fixId),
    ).toEqual(["ssh-wrap"]);
    expect(
      extractFixIds(FIXTURE.findings).map((f) => f.fixId),
    ).toEqual(["ssh-wrap"]);
  });

  it("accepts canonical automaticRemediation and fixId field", () => {
    const fixes = extractFixIds({
      findings: [
        {
          id: "terminal.ssh-wrap",
          automaticRemediation: "terminal.ssh-wrap",
          message: "canonical",
        },
        {
          id: "tmux.clipboard",
          fixId: "tmux-clipboard",
          automaticRemediation: null,
          message: "via fixId",
        },
        {
          id: "bad",
          automaticRemediation: "--yes; rm -rf /",
          message: "injection",
        },
        {
          id: "obj",
          automaticRemediation: { handle: "dcs-passthrough" },
          message: "object form",
        },
      ],
    });
    expect(fixes.map((f) => f.fixId).sort()).toEqual([
      "dcs-passthrough",
      "terminal.ssh-wrap",
      "tmux-clipboard",
    ]);
  });

  it("dedupes the same fix handle", () => {
    const fixes = extractFixIds({
      findings: [
        { id: "a", automaticRemediation: "ssh-wrap" },
        { id: "b", automaticRemediation: "SSH-WRAP" },
      ],
    });
    expect(fixes).toHaveLength(1);
  });

  it("returns empty when nothing is fixable", () => {
    expect(extractFixIds(null)).toEqual([]);
    expect(extractFixIds({ findings: [] })).toEqual([]);
    expect(
      extractFixIds({
        findings: [{ id: "x", automaticRemediation: null }],
      }),
    ).toEqual([]);
  });
});

describe("coerceFixId / isValidDoctorFixId / isDestructiveDoctorFix", () => {
  it("coerces string and object forms", () => {
    expect(coerceFixId("ssh-wrap")).toBe("ssh-wrap");
    expect(coerceFixId({ handle: "ssh-wrap" })).toBe("ssh-wrap");
    expect(coerceFixId({ id: "terminal.ssh-wrap" })).toBe("terminal.ssh-wrap");
    expect(coerceFixId(null)).toBeNull();
    expect(coerceFixId("  ")).toBeNull();
  });

  it("rejects unsafe fix ids", () => {
    expect(isValidDoctorFixId("ssh-wrap")).toBe(true);
    expect(isValidDoctorFixId("terminal.ssh-wrap")).toBe(true);
    expect(isValidDoctorFixId("--yes")).toBe(false);
    expect(isValidDoctorFixId("a b")).toBe(false);
    expect(isValidDoctorFixId("../etc")).toBe(false);
    expect(isValidDoctorFixId("")).toBe(false);
  });

  it("flags shell-mutating fixes as destructive", () => {
    expect(isDestructiveDoctorFix("ssh-wrap")).toBe(true);
    expect(isDestructiveDoctorFix("terminal.ssh-wrap")).toBe(true);
    expect(isDestructiveDoctorFix("unknown-thing")).toBe(true);
    expect(isDestructiveDoctorFix("noop")).toBe(false);
  });
});

describe("parseCliDoctorReport", () => {
  it("parses fixture JSON into pass/warn/fail rows", () => {
    const view = parseCliDoctorReport(FIXTURE);
    expect(view.schemaVersion).toBe("1");
    expect(view.checks).toHaveLength(3);
    expect(view.checks[0].level).toBe("fail");
    expect(view.checks[1].level).toBe("warn");
    expect(view.checks[2].fixId).toBe("ssh-wrap");
    expect(view.summary.fail).toBe(1);
    expect(view.summary.warn).toBe(2);
    expect(view.counts?.issues).toBe(1);
    expect(view.probeNotes).toHaveLength(1);
    expect(view.facts.terminal).toBe("iterm2");
  });

  it("synthesizes an ok row when findings are empty", () => {
    const view = parseCliDoctorReport({
      schemaVersion: "1",
      facts: { terminal: { name: "xterm" } },
      findings: [],
      counts: { issues: 0, recommendations: 0, probeNotes: 0 },
    });
    expect(view.checks).toHaveLength(1);
    expect(view.checks[0].level).toBe("ok");
    expect(view.summary.ok).toBe(1);
  });
});

describe("parseCliDoctorEnvelope", () => {
  it("accepts host envelope with report", () => {
    const view = parseCliDoctorEnvelope({
      available: true,
      error: null,
      report: FIXTURE,
      exitOk: true,
    });
    expect(view.available).toBe(true);
    expect(view.error).toBeNull();
    expect(view.checks.length).toBeGreaterThan(0);
  });

  it("accepts bare CLI blob", () => {
    const view = parseCliDoctorEnvelope(FIXTURE);
    expect(view.available).toBe(true);
    expect(view.checks[0].id).toBe("terminal.limited-color");
  });

  it("surfaces CLI missing / timeout errors", () => {
    const missing = parseCliDoctorEnvelope({
      available: false,
      error: "Grok Build CLI not found",
      report: null,
    });
    expect(missing.available).toBe(false);
    expect(missing.error).toContain("not found");
    expect(missing.checks).toEqual([]);

    const timeout = parseCliDoctorEnvelope({
      available: false,
      error: "grok command timed out after 15s",
      report: null,
    });
    expect(timeout.error).toContain("timed out");
  });

  it("handles null input", () => {
    const view = parseCliDoctorEnvelope(null);
    expect(view.available).toBe(false);
    expect(view.error).toBeTruthy();
  });
});

describe("formatFactValue", () => {
  it("formats ssh booleans", () => {
    expect(formatFactValue("ssh", true)).toBe("yes");
    expect(formatFactValue("ssh", false)).toBe("no");
    expect(formatFactValue("terminal", "iterm2")).toBe("iterm2");
  });
});

describe("listFixableChecks / listSafeAutoFixes / summarizeFixPlan", () => {
  function viewWithChecks(
    checks: Array<{
      id: string;
      fixId?: string | null;
      level?: "ok" | "warn" | "fail";
      title?: string;
    }>,
  ) {
    return parseCliDoctorEnvelope({
      available: true,
      report: {
        schemaVersion: "1",
        findings: checks.map((c) => ({
          id: c.id,
          disposition:
            c.level === "fail"
              ? "issue"
              : c.level === "ok"
                ? "ok"
                : "recommendation",
          message: c.title ?? c.id,
          automaticRemediation: c.fixId ?? null,
        })),
      },
    });
  }

  it("lists checks that carry a valid fixId", () => {
    const view = viewWithChecks([
      { id: "a", fixId: "noop" },
      { id: "b", fixId: null },
      { id: "c", fixId: "ssh-wrap" },
      { id: "d", fixId: "--bad" },
    ]);
    const fixable = listFixableChecks(view);
    expect(fixable.map((c) => c.fixId)).toEqual(["noop", "ssh-wrap"]);
  });

  it("dedupes the same fixId across checks", () => {
    const view = viewWithChecks([
      { id: "a", fixId: "noop" },
      { id: "b", fixId: "NOOP" },
    ]);
    expect(listFixableChecks(view)).toHaveLength(1);
  });

  it("returns only non-destructive fixes for safe auto-apply", () => {
    const view = viewWithChecks([
      { id: "a", fixId: "noop" },
      { id: "b", fixId: "ssh-wrap" },
      { id: "c", fixId: "info" },
      { id: "d", fixId: "tmux-clipboard" },
    ]);
    const safe = listSafeAutoFixes(view);
    expect(safe.map((c) => c.fixId).sort()).toEqual(["info", "noop"]);
    for (const c of safe) {
      expect(isDestructiveDoctorFix(c.fixId!)).toBe(false);
    }
  });

  it("summarizeFixPlan counts total / safe / needsConfirm", () => {
    const view = viewWithChecks([
      { id: "a", fixId: "noop" },
      { id: "b", fixId: "ssh-wrap" },
      { id: "c", fixId: "info" },
      { id: "d" },
    ]);
    expect(summarizeFixPlan(view)).toEqual({
      total: 3,
      safe: 2,
      needsConfirm: 1,
    });
  });

  it("returns empty plan when doctor unavailable or has no fixes", () => {
    expect(listFixableChecks(null)).toEqual([]);
    expect(listSafeAutoFixes(undefined)).toEqual([]);
    expect(summarizeFixPlan(null)).toEqual({
      total: 0,
      safe: 0,
      needsConfirm: 0,
    });

    const unavailable = parseCliDoctorEnvelope({
      available: false,
      error: "missing",
      report: null,
    });
    expect(summarizeFixPlan(unavailable)).toEqual({
      total: 0,
      safe: 0,
      needsConfirm: 0,
    });

    const clean = parseCliDoctorEnvelope({
      available: true,
      report: { schemaVersion: "1", findings: [] },
    });
    expect(listFixableChecks(clean)).toEqual([]);
    expect(summarizeFixPlan(clean).total).toBe(0);
  });

  it("works on fixture view (ssh-wrap is destructive only)", () => {
    const view = parseCliDoctorEnvelope(FIXTURE);
    const plan = summarizeFixPlan(view);
    expect(plan.total).toBe(1);
    expect(plan.safe).toBe(0);
    expect(plan.needsConfirm).toBe(1);
    expect(listSafeAutoFixes(view)).toEqual([]);
    expect(listFixableChecks(view)[0]?.fixId).toBe("ssh-wrap");
  });
});
