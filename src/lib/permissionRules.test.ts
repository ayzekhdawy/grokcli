import { describe, expect, it } from "vitest";
import {
  addRule,
  bashPatternMatches,
  bucketFor,
  dedupeRules,
  flattenRules,
  normalizeRuleAction,
  normalizeRuleText,
  normalizeRules,
  parseCompactRule,
  pathGlobMatch,
  removeRule,
  ruleMatchesToolCall,
  rulePlaceholder,
  ruleRowKey,
  rulesCount,
  simpleGlobMatch,
  simulatePermissionDecision,
  toolClass,
} from "./permissionRules";

describe("normalizeRuleAction / text", () => {
  it("normalizes actions", () => {
    expect(normalizeRuleAction("ALLOW")).toBe("allow");
    expect(normalizeRuleAction(" Ask ")).toBe("ask");
    expect(normalizeRuleAction("deny")).toBe("deny");
    expect(normalizeRuleAction("maybe")).toBeNull();
    expect(normalizeRuleAction("")).toBeNull();
  });

  it("trims rule text", () => {
    expect(normalizeRuleText("  Bash(git *)  ")).toBe("Bash(git *)");
    expect(normalizeRuleText("   ")).toBeNull();
    expect(normalizeRuleText(null)).toBeNull();
  });
});

describe("dedupe / normalize", () => {
  it("dedupes preserving order", () => {
    expect(dedupeRules(["a", " a ", "b", "", "b"])).toEqual(["a", "b"]);
  });

  it("normalizes all buckets", () => {
    const n = normalizeRules({
      allow: ["Bash(git *)", " Bash(git *) "],
      deny: ["Bash(rm *)"],
      ask: [],
    });
    expect(n.allow).toEqual(["Bash(git *)"]);
    expect(n.deny).toEqual(["Bash(rm *)"]);
    expect(n.ask).toEqual([]);
  });
});

describe("addRule / removeRule", () => {
  it("adds and dedupes", () => {
    const base = normalizeRules({});
    const a = addRule(base, "deny", "Bash(rm *)");
    expect(a?.deny).toEqual(["Bash(rm *)"]);
    const a2 = addRule(a!, "deny", "Bash(rm *)");
    expect(a2?.deny).toHaveLength(1);
    expect(addRule(base, "nope", "x")).toBeNull();
    expect(addRule(base, "allow", "  ")).toBeNull();
  });

  it("removes exact rule", () => {
    const base = normalizeRules({
      allow: ["Bash(git *)"],
      deny: ["Bash(rm *)"],
    });
    const next = removeRule(base, "deny", "Bash(rm *)");
    expect(next?.deny).toEqual([]);
    expect(next?.allow).toEqual(["Bash(git *)"]);
  });
});

describe("flatten / misc", () => {
  it("flattens deny → ask → allow", () => {
    const flat = flattenRules({
      allow: ["Read"],
      deny: ["Bash(rm *)"],
      ask: ["Edit"],
    });
    expect(flat.map((r) => r.action)).toEqual(["deny", "ask", "allow"]);
    expect(flat.map((r) => r.rule)).toEqual([
      "Bash(rm *)",
      "Edit",
      "Read",
    ]);
  });

  it("bucket / key / count / placeholder", () => {
    const r = normalizeRules({ allow: ["a"], deny: ["b"], ask: ["c"] });
    expect(bucketFor(r, "allow")).toEqual(["a"]);
    expect(ruleRowKey("deny", "x")).toBe("deny:x");
    expect(rulesCount(r)).toBe(3);
    expect(rulePlaceholder("allow")).toContain("git");
    expect(rulePlaceholder("deny")).toContain("rm");
  });
});

describe("parseCompactRule / toolClass", () => {
  it("parses bare tool and Tool(pattern)", () => {
    expect(parseCompactRule("Edit")).toEqual({ tool: "Edit", pattern: null });
    expect(parseCompactRule("  Bash(git *)  ")).toEqual({
      tool: "Bash",
      pattern: "git *",
    });
    expect(parseCompactRule("Read(src/**)")).toEqual({
      tool: "Read",
      pattern: "src/**",
    });
    expect(parseCompactRule("")).toBeNull();
    expect(parseCompactRule("()")).toBeNull();
  });

  it("maps tool aliases to classes", () => {
    expect(toolClass("Write")).toBe("edit");
    expect(toolClass("NotebookRead")).toBe("read");
    expect(toolClass("Glob")).toBe("grep");
    expect(toolClass("Bash")).toBe("bash");
  });
});

describe("glob helpers", () => {
  it("simpleGlobMatch * and ?", () => {
    expect(simpleGlobMatch("git *", "git status")).toBe(true);
    expect(simpleGlobMatch("git *", "gitleaks")).toBe(false);
    expect(simpleGlobMatch("img_???.jpg", "img_000.jpg")).toBe(true);
    expect(simpleGlobMatch("img_???.jpg", "img_00.jpg")).toBe(false);
  });

  it("pathGlobMatch * does not cross /; ** does", () => {
    expect(pathGlobMatch("src/*", "src/main.rs")).toBe(true);
    expect(pathGlobMatch("src/*", "src/nested/mod.rs")).toBe(false);
    expect(pathGlobMatch("src/**", "src/nested/mod.rs")).toBe(true);
    expect(pathGlobMatch("**/*.rs", "src/nested/mod.rs")).toBe(true);
    expect(pathGlobMatch("**/*.rs", "src/nested/mod.ts")).toBe(false);
  });

  it("bashPatternMatches prefix and glob", () => {
    expect(bashPatternMatches("git ", "git status")).toBe(true);
    expect(bashPatternMatches("git", "gitleaks")).toBe(true); // no word boundary
    expect(bashPatternMatches("git *", "git status")).toBe(true);
    expect(bashPatternMatches("git * main", "git checkout main")).toBe(true);
    expect(bashPatternMatches("git commit:*", "git commit -m x")).toBe(true);
    expect(bashPatternMatches("git commit:*", "git status")).toBe(false);
    expect(bashPatternMatches("rm -rf *", "rm -rf /tmp")).toBe(true);
  });
});

describe("ruleMatchesToolCall", () => {
  it("exact and bare tool", () => {
    expect(ruleMatchesToolCall("Bash(git *)", "Bash(git *)")).toBe(true);
    expect(ruleMatchesToolCall("Edit", "Edit")).toBe(true);
    expect(ruleMatchesToolCall("Edit", "Edit(src/a.ts)")).toBe(true);
    expect(ruleMatchesToolCall("Edit(src/**)", "Edit")).toBe(false);
  });

  it("Bash(git *) vs commands", () => {
    expect(ruleMatchesToolCall("Bash(git *)", "Bash(git status)")).toBe(true);
    expect(ruleMatchesToolCall("Bash(git *)", "Bash(git push origin main)")).toBe(
      true,
    );
    expect(ruleMatchesToolCall("Bash(git *)", "Bash(npm test)")).toBe(false);
    expect(ruleMatchesToolCall("Bash(rm -rf *)", "Bash(rm -rf /)")).toBe(true);
  });

  it("path rules and aliases", () => {
    expect(ruleMatchesToolCall("Read(src/**)", "Read(src/lib/a.ts)")).toBe(true);
    expect(ruleMatchesToolCall("Read(src/*)", "Read(src/lib/a.ts)")).toBe(false);
    expect(ruleMatchesToolCall("Edit(**/*.rs)", "Write(foo/bar.rs)")).toBe(true);
    expect(ruleMatchesToolCall("Grep", "Glob(src/**)")).toBe(true);
  });

  it("star rule and tool mismatch", () => {
    expect(ruleMatchesToolCall("*", "Bash(echo hi)")).toBe(true);
    expect(ruleMatchesToolCall("Read", "Bash(ls)")).toBe(false);
  });

  it("WebFetch domain: and MCP glob", () => {
    expect(
      ruleMatchesToolCall(
        "WebFetch(domain:example.com)",
        "WebFetch(https://api.example.com/v1)",
      ),
    ).toBe(true);
    expect(
      ruleMatchesToolCall(
        "WebFetch(domain:example.com)",
        "WebFetch(https://evil.com)",
      ),
    ).toBe(false);
    expect(
      ruleMatchesToolCall("MCPTool(linear__*)", "MCPTool(linear__list_issues)"),
    ).toBe(true);
  });
});

describe("simulatePermissionDecision", () => {
  const rules = normalizeRules({
    allow: ["Bash(git *)", "Read"],
    deny: ["Bash(rm -rf *)", "Read(/tmp/secret/**)"],
    ask: ["Edit", "Bash(npm *)"],
  });

  it("deny wins over allow", () => {
    const r = simulatePermissionDecision(rules, "Bash(rm -rf /)");
    expect(r.decision).toBe("deny");
    expect(r.matchedRule).toBe("Bash(rm -rf *)");
    expect(r.matchedAction).toBe("deny");
  });

  it("deny path wins over bare Read allow", () => {
    const r = simulatePermissionDecision(rules, "Read(/tmp/secret/keys.env)");
    expect(r.decision).toBe("deny");
    expect(r.matchedRule).toBe("Read(/tmp/secret/**)");
  });

  it("ask when only ask matches", () => {
    const r = simulatePermissionDecision(rules, "Edit(src/a.ts)");
    expect(r.decision).toBe("ask");
    expect(r.matchedRule).toBe("Edit");
  });

  it("allow when only allow matches", () => {
    const r = simulatePermissionDecision(rules, "Bash(git status)");
    expect(r.decision).toBe("allow");
    expect(r.matchedRule).toBe("Bash(git *)");
  });

  it("none when empty call or no match", () => {
    expect(simulatePermissionDecision(rules, "  ").decision).toBe("none");
    expect(simulatePermissionDecision(rules, "WebSearch(foo)").decision).toBe(
      "none",
    );
    expect(simulatePermissionDecision(null, "Bash(ls)").matchedRule).toBeNull();
  });

  it("severity order: deny before ask before allow on same call class", () => {
    const both = normalizeRules({
      allow: ["Bash(git *)"],
      deny: ["Bash(git push *)"],
      ask: ["Bash(git *)"],
    });
    // more specific deny
    expect(simulatePermissionDecision(both, "Bash(git push origin)").decision).toBe(
      "deny",
    );
    // deny empty for git status — ask and allow both match; ask wins over allow
    expect(simulatePermissionDecision(both, "Bash(git status)").decision).toBe(
      "ask",
    );
  });
});
