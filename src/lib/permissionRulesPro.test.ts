import { describe, expect, it } from "vitest";
import {
  normalizeRules,
  simulatePermissionDecision,
} from "./permissionRules";
import {
  buildMatchSummary,
  countRulesByAction,
  filterPermissionRules,
  flattenFilteredRules,
  formatSimulationResult,
  resolvePermissionRulesEmptyState,
  simulationSeverity,
  suggestSampleToolCalls,
} from "./permissionRulesPro";

describe("countRulesByAction", () => {
  it("counts buckets and total", () => {
    const c = countRulesByAction({
      allow: ["a", "b"],
      deny: ["d"],
      ask: [],
    });
    expect(c).toEqual({ allow: 2, deny: 1, ask: 0, total: 3 });
  });

  it("handles null / empty", () => {
    expect(countRulesByAction(null)).toEqual({
      allow: 0,
      deny: 0,
      ask: 0,
      total: 0,
    });
    expect(countRulesByAction(undefined).total).toBe(0);
  });
});

describe("filterPermissionRules", () => {
  const rules = normalizeRules({
    allow: ["Bash(git *)", "Read"],
    deny: ["Bash(rm -rf *)"],
    ask: ["Edit"],
  });

  it("returns all when filter empty", () => {
    expect(filterPermissionRules(rules, "  ")).toEqual(rules);
    expect(filterPermissionRules(rules, null)).toEqual(rules);
  });

  it("filters case-insensitively by substring", () => {
    const f = filterPermissionRules(rules, "bash");
    expect(f.allow).toEqual(["Bash(git *)"]);
    expect(f.deny).toEqual(["Bash(rm -rf *)"]);
    expect(f.ask).toEqual([]);
  });

  it("flattens filtered in severity order", () => {
    const flat = flattenFilteredRules(rules, "edit");
    expect(flat).toEqual([{ action: "ask", rule: "Edit" }]);
  });
});

describe("resolvePermissionRulesEmptyState", () => {
  it("returns null when rules visible", () => {
    expect(
      resolvePermissionRulesEmptyState({
        allow: ["Read"],
        deny: [],
        ask: [],
      }),
    ).toBeNull();
  });

  it("no_rules when all buckets empty", () => {
    const e = resolvePermissionRulesEmptyState({
      allow: [],
      deny: [],
      ask: [],
    });
    expect(e?.kind).toBe("no_rules");
    expect(e?.titleKey).toBe("settings.permissionRulesEmpty");
    expect(e?.hintKey).toBe("settings.permissionRulesEmptyHint");
    expect(e?.showClearFilter).toBe(false);
    expect(e?.counts.total).toBe(0);
  });

  it("filter_empty when filter hides all rules", () => {
    const e = resolvePermissionRulesEmptyState({
      allow: ["Bash(git *)"],
      deny: ["Bash(rm *)"],
      ask: ["Edit"],
      filter: "zzz-nope",
    });
    expect(e?.kind).toBe("filter_empty");
    expect(e?.titleKey).toBe("settings.permissionRulesFilterEmpty");
    expect(e?.showClearFilter).toBe(true);
    expect(e?.counts.total).toBe(3);
    expect(e?.visibleCount).toBe(0);
  });

  it("null when filter matches some rules", () => {
    expect(
      resolvePermissionRulesEmptyState({
        allow: ["Bash(git *)"],
        deny: [],
        ask: [],
        filter: "git",
      }),
    ).toBeNull();
  });
});

describe("formatSimulationResult / severity", () => {
  const rules = normalizeRules({
    allow: ["Bash(git *)"],
    deny: ["Bash(rm -rf *)"],
    ask: ["Edit"],
  });

  it("idle when no input", () => {
    const r = simulatePermissionDecision(rules, "");
    const p = formatSimulationResult(r, "");
    expect(p.hasInput).toBe(false);
    expect(p.severity).toBe("idle");
    expect(p.honestyKey).toBeNull();
    expect(p.matchSummary).toBe("");
  });

  it("deny severity err + honesty + summary", () => {
    const r = simulatePermissionDecision(rules, "Bash(rm -rf /tmp/x)");
    const p = formatSimulationResult(r, "Bash(rm -rf /tmp/x)");
    expect(p.decision).toBe("deny");
    expect(p.severity).toBe("err");
    expect(p.labelKey).toBe("settings.permissionRulesSimResult.deny");
    expect(p.honestyKey).toBe("settings.permissionRulesSimHonesty.deny");
    expect(p.matchedRule).toBe("Bash(rm -rf *)");
    expect(p.matchSummary).toContain("decision=deny");
    expect(p.matchSummary).toContain("tool_call=Bash(rm -rf /tmp/x)");
    expect(p.matchSummary).toContain("preview_only=true");
  });

  it("allow / ask / none severities", () => {
    expect(
      formatSimulationResult(
        simulatePermissionDecision(rules, "Bash(git status)"),
        "Bash(git status)",
      ).severity,
    ).toBe("ok");
    expect(
      formatSimulationResult(
        simulatePermissionDecision(rules, "Edit(src/a.ts)"),
        "Edit(src/a.ts)",
      ).severity,
    ).toBe("warn");
    expect(
      formatSimulationResult(
        simulatePermissionDecision(rules, "WebSearch(foo)"),
        "WebSearch(foo)",
      ).severity,
    ).toBe("info");
  });

  it("simulationSeverity mapping", () => {
    expect(simulationSeverity("deny")).toBe("err");
    expect(simulationSeverity("ask")).toBe("warn");
    expect(simulationSeverity("allow")).toBe("ok");
    expect(simulationSeverity("none")).toBe("info");
    expect(simulationSeverity("none", false)).toBe("idle");
  });

  it("buildMatchSummary is stable", () => {
    const s = buildMatchSummary({
      toolCall: "Bash(git status)",
      decision: "allow",
      matchedRule: "Bash(git *)",
      matchedAction: "allow",
    });
    expect(s.split("\n")).toEqual([
      "tool_call=Bash(git status)",
      "decision=allow",
      "matched_rule=Bash(git *)",
      "matched_action=allow",
      "evaluation=deny>ask>allow",
      "preview_only=true",
    ]);
  });
});

describe("suggestSampleToolCalls", () => {
  it("returns git status, rm, edit samples", () => {
    const samples = suggestSampleToolCalls();
    expect(samples.map((s) => s.id)).toEqual(["git-status", "rm", "edit"]);
    expect(samples.find((s) => s.id === "git-status")?.toolCall).toBe(
      "Bash(git status)",
    );
    expect(samples.find((s) => s.id === "rm")?.toolCall).toContain("rm");
    expect(samples.find((s) => s.id === "edit")?.toolCall).toMatch(/^Edit\(/);
    // Stable ids + non-empty labels
    for (const s of samples) {
      expect(s.label.trim().length).toBeGreaterThan(0);
      expect(s.toolCall.trim().length).toBeGreaterThan(0);
    }
  });
});
