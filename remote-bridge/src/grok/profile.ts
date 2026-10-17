/**
 * Speed profiles: chat = low-latency Feishu replies; code = full Grok Build agent.
 */

export type GrokProfile = "auto" | "chat" | "code";

export interface EffectiveGrokTuning {
  profile: "chat" | "code";
  maxTurns: number;
  /** Extra --rules text */
  rules: string;
  /** Comma-separated tool ids for --disallowed-tools */
  disallowedTools: string;
  noMemory: boolean;
  /** Coalesce Feishu stream appends (ms); 0 = every delta */
  streamCoalesceMs: number;
}

const CHAT_RULES =
  "You are a concise Feishu chat assistant. For greetings and short Q&A, reply in 1-3 short sentences in the user's language. " +
  "Do not use tools, do not scan the repo, do not run commands, unless the user clearly asks to read/edit code or run something. " +
  "Prefer a direct answer over planning.";

const CODE_RULES =
  "You are Grok Build coding agent in Feishu. Be efficient: prefer fewer tool calls when a short answer is enough.";

/** Heuristic: short social / Q&A → chat; coding intent → code. Pure. */
export function detectLightweightPrompt(prompt: string): boolean {
  const t = (prompt || "").trim();
  if (!t) return true;
  if (t.length > 120) return false;

  // explicit coding / ops intent
  if (
    /[`{}<>]|```|修复|改代码|实现|重构|编译|构建|报错|堆栈|函数|模块|提交|PR|pull request|bug|error|traceback|refactor|implement|fix\b|debug|npm |pnpm |yarn |git |cargo |docker |kubectl |pytest |jest /i.test(
      t,
    )
  ) {
    return false;
  }

  // pure greetings / short chit-chat
  if (
    /^(嘿|嗨|你好|您好|在吗|哈喽|早|早上好|晚安|谢谢|感谢|hello|hi|hey|yo|thanks|thx)[\s!！。.?？~～…]*$/i.test(
      t,
    )
  ) {
    return true;
  }

  // short questions without code markers
  if (t.length <= 40) return true;
  if (t.length <= 80 && /[？?]$/.test(t)) return true;
  return false;
}

export function resolveProfile(
  configured: GrokProfile | string | undefined,
  prompt: string,
): "chat" | "code" {
  const p = String(configured || "auto").toLowerCase();
  if (p === "chat" || p === "fast") return "chat";
  if (p === "code" || p === "full" || p === "build") return "code";
  // auto
  return detectLightweightPrompt(prompt) ? "chat" : "code";
}

export function effectiveTuning(opts: {
  profile?: GrokProfile | string;
  prompt: string;
  maxTurns: number;
  chatMaxTurns?: number;
  rules?: string;
  disallowedTools?: string;
  noMemory?: boolean;
  streamCoalesceMs?: number;
}): EffectiveGrokTuning {
  const profile = resolveProfile(opts.profile, opts.prompt);
  const chatMax = opts.chatMaxTurns && opts.chatMaxTurns > 0 ? opts.chatMaxTurns : 3;
  const codeMax = opts.maxTurns > 0 ? opts.maxTurns : 12;

  if (profile === "chat") {
    return {
      profile: "chat",
      maxTurns: Math.min(chatMax, codeMax),
      rules: [CHAT_RULES, opts.rules || ""].filter(Boolean).join(" "),
      // Block heavy tools so greetings cannot spiral into repo walks
      disallowedTools:
        opts.disallowedTools ||
        "run_terminal_cmd,search_replace,Write,write,Agent,image_gen,image_edit,image_to_video",
      // Always skip cross-session memory on chat path (major cold-start win)
      noMemory: true,
      streamCoalesceMs:
        opts.streamCoalesceMs != null && opts.streamCoalesceMs >= 0
          ? opts.streamCoalesceMs
          : 100,
    };
  }

  return {
    profile: "code",
    maxTurns: codeMax,
    rules: [CODE_RULES, opts.rules || ""].filter(Boolean).join(" "),
    disallowedTools: opts.disallowedTools || "",
    noMemory: Boolean(opts.noMemory),
    streamCoalesceMs:
      opts.streamCoalesceMs != null && opts.streamCoalesceMs >= 0
        ? opts.streamCoalesceMs
        : 80,
  };
}
