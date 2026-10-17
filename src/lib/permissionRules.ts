/**
 * Pure helpers for Settings → Permissions rule editor.
 *
 * Grok Build compact form in config.toml:
 *   [permission]
 *   deny = ["Bash(rm -rf *)"]
 *   allow = ["Bash(git *)"]
 *   ask = ["Edit"]
 *
 * Evaluation: deny > ask > allow (see Grok user guide).
 */

export type PermissionRuleAction = "allow" | "deny" | "ask";

export type PermissionRulesLike = {
  allow: string[];
  deny: string[];
  ask: string[];
};

/** Severity order used in UI lists (deny wins first). */
export const PERMISSION_RULE_ACTIONS: PermissionRuleAction[] = [
  "deny",
  "ask",
  "allow",
];

export function normalizeRuleAction(
  raw: string | null | undefined,
): PermissionRuleAction | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "allow" || t === "deny" || t === "ask") return t;
  return null;
}

/** Trim; empty → null. */
export function normalizeRuleText(
  raw: string | null | undefined,
): string | null {
  const s = (raw ?? "").trim();
  return s ? s : null;
}

/** Dedupe preserving order (first wins). */
export function dedupeRules(rules: string[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rules ?? []) {
    const n = normalizeRuleText(r);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function normalizeRules(
  rules: Partial<PermissionRulesLike> | null | undefined,
): PermissionRulesLike {
  return {
    allow: dedupeRules(rules?.allow),
    deny: dedupeRules(rules?.deny),
    ask: dedupeRules(rules?.ask),
  };
}

export function bucketFor(
  rules: PermissionRulesLike,
  action: PermissionRuleAction,
): string[] {
  return rules[action] ?? [];
}

/** Add a rule to one bucket (no-op if duplicate). */
export function addRule(
  rules: PermissionRulesLike,
  action: string,
  rule: string,
): PermissionRulesLike | null {
  const a = normalizeRuleAction(action);
  const r = normalizeRuleText(rule);
  if (!a || !r) return null;
  const next = normalizeRules(rules);
  if (!next[a].includes(r)) next[a] = [...next[a], r];
  return next;
}

/** Remove an exact rule from one bucket. */
export function removeRule(
  rules: PermissionRulesLike,
  action: string,
  rule: string,
): PermissionRulesLike | null {
  const a = normalizeRuleAction(action);
  const r = normalizeRuleText(rule);
  if (!a || !r) return null;
  const next = normalizeRules(rules);
  next[a] = next[a].filter((x) => x !== r);
  return next;
}

/** Flat list for rendering: [{ action, rule }] in severity order. */
export function flattenRules(
  rules: PermissionRulesLike,
): Array<{ action: PermissionRuleAction; rule: string }> {
  const n = normalizeRules(rules);
  const out: Array<{ action: PermissionRuleAction; rule: string }> = [];
  for (const action of PERMISSION_RULE_ACTIONS) {
    for (const rule of n[action]) {
      out.push({ action, rule });
    }
  }
  return out;
}

export function ruleRowKey(action: string, rule: string): string {
  return `${action}:${rule}`;
}

/** Example placeholders for the add-rule field. */
export function rulePlaceholder(action: PermissionRuleAction): string {
  switch (action) {
    case "deny":
      return "Bash(rm -rf *)";
    case "ask":
      return "Edit";
    case "allow":
    default:
      return "Bash(git *)";
  }
}

/** Total rule count across buckets. */
export function rulesCount(rules: PermissionRulesLike | null | undefined): number {
  if (!rules) return 0;
  return (
    (rules.allow?.length ?? 0) +
    (rules.deny?.length ?? 0) +
    (rules.ask?.length ?? 0)
  );
}

// ─── Permission simulation (pure; no I/O) ───────────────────────────────────
//
// Approximate Grok Build compact-rule matching for Settings UI preview.
// Evaluation order: deny > ask > allow (see Grok user guide).
// Not a full reimplementation of shell segment / dangerous-command policy.

/** Parsed compact rule: `Tool` or `Tool(arg pattern)`. */
export type ParsedCompactRule = {
  /** Tool name as written (e.g. Bash, Read, MCPTool). `*` = any tool. */
  tool: string;
  /** Argument / path / command pattern inside `(...)`, or null for bare tool. */
  pattern: string | null;
};

/**
 * Decision from rule simulation.
 * `none` = no allow/deny/ask rule matched (falls through to mode / built-ins).
 */
export type SimulatedPermissionDecision = PermissionRuleAction | "none";

export type SimulatedPermissionResult = {
  decision: SimulatedPermissionDecision;
  /** First matching rule in severity order (deny bucket first, then ask, allow). */
  matchedRule: string | null;
  matchedAction: PermissionRuleAction | null;
};

/** Canonical tool class for alias matching (Read ↔ NotebookRead, etc.). */
const TOOL_CLASS: Record<string, string> = {
  bash: "bash",
  read: "read",
  notebookread: "read",
  edit: "edit",
  write: "edit",
  notebookedit: "edit",
  grep: "grep",
  glob: "grep",
  mcptool: "mcptool",
  webfetch: "webfetch",
  websearch: "websearch",
};

export function toolClass(name: string): string {
  const k = name.trim().toLowerCase();
  return TOOL_CLASS[k] ?? k;
}

/**
 * Parse compact form `Tool` or `Tool(pattern)`.
 * Balanced trailing `(...)` only; empty pattern → null.
 */
export function parseCompactRule(
  raw: string | null | undefined,
): ParsedCompactRule | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const open = s.indexOf("(");
  if (open < 0 || !s.endsWith(")")) {
    // Bare tool name (may contain `(` only if no closing `)` — treat whole string).
    if (s === "()" || !s) return null;
    return { tool: s, pattern: null };
  }
  if (open === 0) return null; // e.g. `(git *)` — no tool name
  const tool = s.slice(0, open).trim();
  if (!tool) return null;
  const inner = s.slice(open + 1, -1);
  const pattern = inner.trim() ? inner : null;
  return { tool, pattern };
}

/** Shell-style glob: `*` any run, `?` one char. Does not treat `/` specially. */
export function simpleGlobMatch(pattern: string, text: string): boolean {
  const p = pattern;
  const n = text;
  const plen = p.length;
  const nlen = n.length;
  let i = 0;
  let j = 0;
  let starP = -1;
  let starN = 0;
  while (j < nlen) {
    if (i < plen && (p[i] === "?" || p[i] === n[j])) {
      i += 1;
      j += 1;
    } else if (i < plen && p[i] === "*") {
      starP = i;
      starN = j;
      i += 1;
    } else if (starP >= 0) {
      i = starP + 1;
      starN += 1;
      j = starN;
    } else {
      return false;
    }
  }
  while (i < plen && p[i] === "*") i += 1;
  return i === plen;
}

/**
 * Path glob: `*` / `?` do not cross `/`; `**` matches across `/`.
 * Approx of Grok Read/Edit/Grep path matching.
 */
export function pathGlobMatch(pattern: string, path: string): boolean {
  // Normalize ** to a sentinel, then match segment-aware.
  // Convert glob to a regex:
  // - ** → (?:.|\n)*  (crosses /)
  // - * → [^/]*
  // - ? → [^/]
  // - literal chars escaped
  let re = "^";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === "*" && pattern[i + 1] === "*") {
      // ** or **/
      re += ".*";
      i += 2;
      // collapse trailing / after ** is optional for **/*
      continue;
    }
    if (c === "*") {
      re += "[^/]*";
      i += 1;
      continue;
    }
    if (c === "?") {
      re += "[^/]";
      i += 1;
      continue;
    }
    if ("\\.^$+()[]{}|".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
    i += 1;
  }
  re += "$";
  try {
    return new RegExp(re).test(path);
  } catch {
    return false;
  }
}

/**
 * Bash command pattern match (prefix OR whole-command glob).
 * Strips trailing `:*` to a plain prefix (Grok docs).
 */
export function bashPatternMatches(pattern: string, command: string): boolean {
  const cmd = command.replace(/^\s+/, "");
  let p = pattern;
  const colonStar = p.endsWith(":*");
  if (colonStar) p = p.slice(0, -2);
  // Prefix (character-for-character, no word boundary)
  if (cmd.startsWith(p)) return true;
  if (colonStar) return false;
  // Whole-command glob (* crosses spaces and slashes)
  return simpleGlobMatch(p, cmd);
}

function toolsCompatible(ruleTool: string, callTool: string): boolean {
  if (ruleTool === "*") return true;
  return toolClass(ruleTool) === toolClass(callTool);
}

/**
 * Whether a compact rule matches a tool-call pattern (e.g. `Bash(git status)`).
 * Best-effort preview; ignores shell chaining / env wrappers / dangerous list.
 */
export function ruleMatchesToolCall(rule: string, toolCall: string): boolean {
  const rNorm = normalizeRuleText(rule);
  const cNorm = normalizeRuleText(toolCall);
  if (!rNorm || !cNorm) return false;
  if (rNorm === cNorm) return true;

  const r = parseCompactRule(rNorm);
  const c = parseCompactRule(cNorm);
  if (!r || !c) return false;

  // Bare `*` matches every tool call.
  if (r.tool === "*" && r.pattern == null) return true;

  if (!toolsCompatible(r.tool, c.tool)) return false;

  // Rule has no arg pattern → matches any call of that tool class.
  if (r.pattern == null) return true;

  // Call is bare tool name with no args → only bare rules match (handled above).
  if (c.pattern == null) return false;

  const cls = toolClass(r.tool === "*" ? c.tool : r.tool);
  const callArg = c.pattern;
  const ruleArg = r.pattern;

  if (cls === "bash") {
    return bashPatternMatches(ruleArg, callArg);
  }
  if (cls === "read" || cls === "edit" || cls === "grep") {
    return pathGlobMatch(ruleArg, callArg);
  }
  if (cls === "webfetch") {
    // domain:host — host + subdomains, case-insensitive; no wildcards inside domain:
    const dom = /^domain:(.+)$/i.exec(ruleArg);
    if (dom) {
      const host = dom[1]!.trim().toLowerCase().replace(/^www\./, "");
      // callArg may be full URL or bare host
      let callHost = callArg.trim().toLowerCase();
      try {
        if (callHost.includes("://")) {
          callHost = new URL(callHost).hostname;
        }
      } catch {
        /* keep as-is */
      }
      callHost = callHost.replace(/^www\./, "").split("/")[0] ?? callHost;
      return (
        callHost === host ||
        callHost.endsWith(`.${host}`)
      );
    }
    return simpleGlobMatch(ruleArg, callArg);
  }
  // MCPTool / WebSearch / unknown: simple glob on full arg
  return simpleGlobMatch(ruleArg, callArg);
}

/**
 * Simulate permission decision for a tool call against current compact rules.
 * Severity: first matching deny → deny; else ask; else allow; else none.
 * Does not write config or secrets.
 */
export function simulatePermissionDecision(
  rules: PermissionRulesLike | null | undefined,
  toolCall: string | null | undefined,
): SimulatedPermissionResult {
  const call = normalizeRuleText(toolCall);
  if (!call) {
    return { decision: "none", matchedRule: null, matchedAction: null };
  }
  const n = normalizeRules(rules);
  for (const action of PERMISSION_RULE_ACTIONS) {
    for (const rule of n[action]) {
      if (ruleMatchesToolCall(rule, call)) {
        return {
          decision: action,
          matchedRule: rule,
          matchedAction: action,
        };
      }
    }
  }
  return { decision: "none", matchedRule: null, matchedAction: null };
}
