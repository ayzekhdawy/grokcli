/**
 * PERMISSION-RULES-PRO — pure helpers for Settings → Permissions
 * simulator honesty + empty states.
 *
 * Builds on `permissionRules` (deny > ask > allow). No DOM / Tauri / i18n
 * side effects — callers pass `t(key)`. Never invents a match or write.
 */

import {
  flattenRules,
  normalizeRules,
  type PermissionRuleAction,
  type PermissionRulesLike,
  type SimulatedPermissionDecision,
  type SimulatedPermissionResult,
} from "./permissionRules";

// ── Counts ───────────────────────────────────────────────────────────────────

export type PermissionRuleCounts = {
  allow: number;
  deny: number;
  ask: number;
  total: number;
};

/** Per-action + total rule counts (normalized / empty-safe). */
export function countRulesByAction(
  rules: PermissionRulesLike | null | undefined,
): PermissionRuleCounts {
  const n = normalizeRules(rules);
  const allow = n.allow.length;
  const deny = n.deny.length;
  const ask = n.ask.length;
  return { allow, deny, ask, total: allow + deny + ask };
}

// ── Filter ───────────────────────────────────────────────────────────────────

/**
 * Case-insensitive substring filter across rule text.
 * Empty / whitespace filter returns all rules (normalized).
 */
export function filterPermissionRules(
  rules: PermissionRulesLike | null | undefined,
  filter: string | null | undefined,
): PermissionRulesLike {
  const n = normalizeRules(rules);
  const q = (filter ?? "").trim().toLowerCase();
  if (!q) return n;
  const keep = (r: string) => r.toLowerCase().includes(q);
  return {
    allow: n.allow.filter(keep),
    deny: n.deny.filter(keep),
    ask: n.ask.filter(keep),
  };
}

// ── Empty honesty ────────────────────────────────────────────────────────────

export type PermissionRulesEmptyKind = "no_rules" | "filter_empty";

export type PermissionRulesEmptyPresentation = {
  kind: PermissionRulesEmptyKind;
  /** Primary empty title i18n key. */
  titleKey: string;
  /** Optional hint i18n key. */
  hintKey: string | null;
  /** Offer clear-filter CTA. */
  showClearFilter: boolean;
  /** Pre-filter bucket totals (honest inventory). */
  counts: PermissionRuleCounts;
  /** Visible after filter (always 0 when presentation is non-null). */
  visibleCount: number;
};

export type PermissionRulesEmptyInput = {
  allow: string[];
  deny: string[];
  ask: string[];
  /** Free-text filter over rule patterns. */
  filter?: string | null;
};

/**
 * Resolve which empty surface to show for the permission rules list.
 * Returns `null` when filtered rows should render.
 *
 * Priority:
 * 1. visible (post-filter) > 0 → null
 * 2. total == 0 → no_rules
 * 3. filter active + total > 0 + visible == 0 → filter_empty
 */
export function resolvePermissionRulesEmptyState(
  input: PermissionRulesEmptyInput,
): PermissionRulesEmptyPresentation | null {
  const base = normalizeRules({
    allow: input.allow,
    deny: input.deny,
    ask: input.ask,
  });
  const counts = countRulesByAction(base);
  const q = (input.filter ?? "").trim();
  const filtered = filterPermissionRules(base, q);
  const visibleCount = countRulesByAction(filtered).total;

  if (visibleCount > 0) return null;

  if (counts.total === 0) {
    return {
      kind: "no_rules",
      titleKey: "settings.permissionRulesEmpty",
      hintKey: "settings.permissionRulesEmptyHint",
      showClearFilter: false,
      counts,
      visibleCount: 0,
    };
  }

  if (q) {
    return {
      kind: "filter_empty",
      titleKey: "settings.permissionRulesFilterEmpty",
      hintKey: "settings.permissionRulesFilterEmptyHint",
      showClearFilter: true,
      counts,
      visibleCount: 0,
    };
  }

  // Total > 0 but nothing visible without filter — soft fallback.
  return {
    kind: "no_rules",
    titleKey: "settings.permissionRulesEmpty",
    hintKey: "settings.permissionRulesEmptyHint",
    showClearFilter: false,
    counts,
    visibleCount: 0,
  };
}

// ── Simulation presentation ──────────────────────────────────────────────────

/** Visual severity for result chips. */
export type SimulationSeverity = "ok" | "warn" | "err" | "info" | "idle";

export type SimulationResultPresentation = {
  decision: SimulatedPermissionDecision;
  severity: SimulationSeverity;
  /** Chip label i18n key (`settings.permissionRulesSimResult.*`). */
  labelKey: string;
  /**
   * Honesty line under the chip (preview-only / falls through / matched).
   * Null when there is no tool-call input yet.
   */
  honestyKey: string | null;
  matchedRule: string | null;
  matchedAction: PermissionRuleAction | null;
  /** True when tool-call input is non-empty. */
  hasInput: boolean;
  /**
   * Plain-text match summary for clipboard (stable English keys;
   * never secrets; preview-only note included).
   */
  matchSummary: string;
};

const DECISION_LABEL_KEY: Record<SimulatedPermissionDecision, string> = {
  allow: "settings.permissionRulesSimResult.allow",
  deny: "settings.permissionRulesSimResult.deny",
  ask: "settings.permissionRulesSimResult.ask",
  none: "settings.permissionRulesSimResult.none",
};

const DECISION_HONESTY_KEY: Record<SimulatedPermissionDecision, string> = {
  allow: "settings.permissionRulesSimHonesty.allow",
  deny: "settings.permissionRulesSimHonesty.deny",
  ask: "settings.permissionRulesSimHonesty.ask",
  none: "settings.permissionRulesSimHonesty.none",
};

/** Map decision → chip severity (deny highest risk). */
export function simulationSeverity(
  decision: SimulatedPermissionDecision | null | undefined,
  hasInput = true,
): SimulationSeverity {
  if (!hasInput) return "idle";
  switch (decision) {
    case "deny":
      return "err";
    case "ask":
      return "warn";
    case "allow":
      return "ok";
    case "none":
      return "info";
    default:
      return "idle";
  }
}

/**
 * Format a simulation result into honesty labels + copyable match summary.
 * Does not re-run matching — pass output of `simulatePermissionDecision`.
 */
export function formatSimulationResult(
  result: SimulatedPermissionResult | null | undefined,
  toolCall?: string | null,
): SimulationResultPresentation {
  const call = (toolCall ?? "").trim();
  const hasInput = call.length > 0;
  const decision: SimulatedPermissionDecision = result?.decision ?? "none";
  const matchedRule = result?.matchedRule ?? null;
  const matchedAction = result?.matchedAction ?? null;

  if (!hasInput) {
    return {
      decision: "none",
      severity: "idle",
      labelKey: DECISION_LABEL_KEY.none,
      honestyKey: null,
      matchedRule: null,
      matchedAction: null,
      hasInput: false,
      matchSummary: "",
    };
  }

  return {
    decision,
    severity: simulationSeverity(decision, true),
    labelKey: DECISION_LABEL_KEY[decision],
    honestyKey: DECISION_HONESTY_KEY[decision],
    matchedRule,
    matchedAction,
    hasInput: true,
    matchSummary: buildMatchSummary({
      toolCall: call,
      decision,
      matchedRule,
      matchedAction,
    }),
  };
}

/** Stable plain-text summary for copy (English machine keys). */
export function buildMatchSummary(input: {
  toolCall: string;
  decision: SimulatedPermissionDecision;
  matchedRule: string | null;
  matchedAction: PermissionRuleAction | null;
}): string {
  const lines = [
    `tool_call=${input.toolCall}`,
    `decision=${input.decision}`,
    `matched_rule=${input.matchedRule ?? ""}`,
    `matched_action=${input.matchedAction ?? ""}`,
    "evaluation=deny>ask>allow",
    "preview_only=true",
  ];
  return lines.join("\n");
}

// ── Sample tool calls ────────────────────────────────────────────────────────

export type SampleToolCall = {
  /** Stable id for keys / tests. */
  id: string;
  /** Compact tool-call string for the simulator input. */
  toolCall: string;
  /** Short chip label (ASCII patterns; not user-locale prose). */
  label: string;
};

/**
 * Static sample tool calls for simulator chips.
 * Covers common allow (git), deny (rm), and ask (edit) paths.
 */
export function suggestSampleToolCalls(): SampleToolCall[] {
  return [
    {
      id: "git-status",
      toolCall: "Bash(git status)",
      label: "git status",
    },
    {
      id: "rm",
      toolCall: "Bash(rm -rf /tmp/x)",
      label: "rm",
    },
    {
      id: "edit",
      toolCall: "Edit(src/app.ts)",
      label: "edit",
    },
  ];
}

// ── List helpers (UI convenience) ────────────────────────────────────────────

/**
 * Flatten rules with optional filter, preserving deny → ask → allow order.
 */
export function flattenFilteredRules(
  rules: PermissionRulesLike | null | undefined,
  filter?: string | null,
): Array<{ action: PermissionRuleAction; rule: string }> {
  return flattenRules(filterPermissionRules(rules, filter));
}
