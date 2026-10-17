import type { GrokConfig } from "../../config/types.js";
import { effectiveTuning } from "../profile.js";
import type { GrokRunOptions, GrokRunResult } from "../runner.js";
import { getAcpPool } from "./pool.js";
import { log } from "../../util/logger.js";

/**
 * Run one user turn via long-lived ACP agent (no per-message process spawn).
 */
export async function runGrokAcp(opts: GrokRunOptions): Promise<GrokRunResult> {
  const cfg = opts.config;
  const tuning = effectiveTuning({
    profile: cfg.profile,
    prompt: opts.prompt,
    maxTurns: cfg.max_turns,
    chatMaxTurns: cfg.chat_max_turns,
    rules: cfg.rules,
    disallowedTools: cfg.disallowed_tools,
    noMemory: cfg.no_memory,
    streamCoalesceMs: cfg.stream_coalesce_ms,
  });

  const pool = getAcpPool({
    maxAgentProcesses: cfg.acp_max_processes ?? 1,
    idleTimeoutMins: cfg.acp_idle_timeout_mins ?? 15,
    alwaysApprove: cfg.mode === "yolo" || cfg.mode === "bypassPermissions",
    model: cfg.model,
    binary: opts.binary,
  });

  const client = await pool.getClient(cfg.work_dir);
  const sessionId = await client.ensureSession(
    opts.sessionId,
    Boolean(opts.sessionExists && opts.sessionId),
    { rules: tuning.rules },
  );

  log.info("acp prompt", {
    sessionId,
    resume: Boolean(opts.sessionExists),
    profile: tuning.profile,
    workDir: cfg.work_dir,
  });

  let acc = "";
  const result = await client.prompt(
    sessionId,
    opts.prompt,
    {
      signal: opts.signal,
      onText: async (delta) => {
        acc += delta;
        if (opts.onText) await opts.onText(delta, acc);
      },
      onThought: async (delta) => {
        if (opts.onEvent) {
          await opts.onEvent({ type: "thought", data: delta, raw: { data: delta } });
        }
      },
      onTool: async (title) => {
        if (opts.onEvent) {
          await opts.onEvent({
            type: "unknown",
            raw: { type: "tool_call", title },
          });
        }
      },
    },
    cfg.timeout_ms > 0 ? cfg.timeout_ms : 540_000,
  );

  const text = (result.text || acc).trim();
  if (opts.onEvent) {
    await opts.onEvent({
      type: result.error ? "error" : "end",
      data: text,
      message: result.error || undefined,
      sessionId: result.sessionId,
      stopReason: result.stopReason,
      raw: { stopReason: result.stopReason },
    });
  }

  return {
    text,
    sessionId: result.sessionId,
    error: result.error,
    exitCode: result.error ? 1 : 0,
    stdout: text,
    stderr: "",
  };
}

// keep type import used
void (0 as unknown as GrokConfig);
