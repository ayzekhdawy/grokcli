import type { GrokConfig, GrokMode } from "../config/types.js";
import { effectiveTuning } from "./profile.js";

export interface BuildGrokArgsOptions {
  prompt: string;
  cwd: string;
  sessionId?: string;
  sessionExists?: boolean;
  maxTurns?: number;
  model?: string;
  mode?: GrokMode;
  /** Override full template JSON array from config */
  argsJson?: string;
  memoryEnabled?: boolean;
  rules?: string;
  disallowedTools?: string;
}

const DEFAULT_TEMPLATE = [
  "--no-auto-update",
  "--always-approve",
  "--permission-mode",
  "bypassPermissions",
  "--max-turns",
  "12",
  "--cwd",
  "{{cwd}}",
  "--output-format",
  "streaming-json",
  "-p",
  "{{prompt}}",
];

/** Map high-level mode to Grok CLI permission-mode value. */
export function mapPermissionMode(mode: GrokMode | string | undefined): string {
  switch (mode) {
    case "yolo":
    case "bypassPermissions":
      return "bypassPermissions";
    case "acceptEdits":
      return "acceptEdits";
    case "plan":
      return "plan";
    case "dontAsk":
      return "dontAsk";
    case "default":
    default:
      return "default";
  }
}

/**
 * Build argv for headless Grok (without the binary path).
 * Pure function — unit tested.
 */
export function buildGrokArgs(opts: BuildGrokArgsOptions): string[] {
  let template: string[];
  if (opts.argsJson) {
    try {
      const parsed = JSON.parse(opts.argsJson) as unknown;
      if (!Array.isArray(parsed)) throw new Error("not array");
      template = parsed.map(String);
    } catch {
      template = [...DEFAULT_TEMPLATE];
    }
  } else {
    template = [...DEFAULT_TEMPLATE];
  }

  const maxTurns = opts.maxTurns != null ? String(opts.maxTurns) : null;
  const mode = mapPermissionMode(opts.mode);
  const useAlwaysApprove = mode === "bypassPermissions";

  const resolved = template.map((token) => {
    if (token === "{{cwd}}") return opts.cwd;
    if (token === "{{prompt}}") return opts.prompt;
    if (token === "{{session}}") return opts.sessionId || "";
    return token;
  });

  // Inject/adjust max-turns
  if (maxTurns) {
    const idx = resolved.indexOf("--max-turns");
    if (idx >= 0 && idx + 1 < resolved.length) {
      resolved[idx + 1] = maxTurns;
    } else {
      resolved.unshift("--max-turns", maxTurns);
    }
  }

  // Adjust permission-mode
  const permIdx = resolved.indexOf("--permission-mode");
  if (permIdx >= 0 && permIdx + 1 < resolved.length) {
    resolved[permIdx + 1] = mode;
  } else {
    resolved.unshift("--permission-mode", mode);
  }

  // always-approve only for yolo/bypass
  const aaIdx = resolved.indexOf("--always-approve");
  if (useAlwaysApprove) {
    if (aaIdx < 0) resolved.unshift("--always-approve");
  } else if (aaIdx >= 0) {
    resolved.splice(aaIdx, 1);
  }

  // model
  if (opts.model) {
    const mIdx = resolved.indexOf("--model");
    if (mIdx >= 0 && mIdx + 1 < resolved.length) {
      resolved[mIdx + 1] = opts.model;
    } else {
      resolved.unshift("--model", opts.model);
    }
  }

  // session resume / create
  if (opts.sessionId) {
    if (opts.sessionExists) {
      resolved.unshift("--resume", opts.sessionId);
    } else {
      resolved.unshift("--session-id", opts.sessionId);
    }
  }

  // memory flag
  if (opts.memoryEnabled === false) {
    if (!resolved.includes("--no-memory")) resolved.push("--no-memory");
  }

  // rules
  if (opts.rules && opts.rules.trim()) {
    const rIdx = resolved.indexOf("--rules");
    if (rIdx >= 0 && rIdx + 1 < resolved.length) {
      resolved[rIdx + 1] = opts.rules;
    } else {
      resolved.push("--rules", opts.rules);
    }
  }

  // disallowed tools
  if (opts.disallowedTools && opts.disallowedTools.trim()) {
    const dIdx = resolved.indexOf("--disallowed-tools");
    if (dIdx >= 0 && dIdx + 1 < resolved.length) {
      resolved[dIdx + 1] = opts.disallowedTools;
    } else {
      resolved.push("--disallowed-tools", opts.disallowedTools);
    }
  }

  // ensure output-format streaming-json for bridge
  const ofIdx = resolved.indexOf("--output-format");
  if (ofIdx < 0) {
    resolved.push("--output-format", "streaming-json");
  }

  return resolved;
}

export function buildGrokArgsFromConfig(
  config: GrokConfig,
  prompt: string,
  session?: { sessionId: string; exists: boolean },
): string[] {
  const tuning = effectiveTuning({
    profile: config.profile,
    prompt,
    maxTurns: config.max_turns,
    chatMaxTurns: config.chat_max_turns,
    rules: config.rules,
    disallowedTools: config.disallowed_tools,
    noMemory: config.no_memory,
    streamCoalesceMs: config.stream_coalesce_ms,
  });

  return buildGrokArgs({
    prompt,
    cwd: config.work_dir,
    sessionId: session?.sessionId,
    sessionExists: session?.exists,
    maxTurns: tuning.maxTurns,
    model: config.model,
    mode: config.mode,
    argsJson: config.args_json,
    memoryEnabled: !tuning.noMemory,
    rules: tuning.rules,
    disallowedTools: tuning.disallowedTools,
  });
}
