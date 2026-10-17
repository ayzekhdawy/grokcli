/**
 * Grok AgentDriver: ACP-first with project-scoped identity + spawn fallback.
 * Streams onText deltas as AgentEvent text events (does not discard stream).
 */

import type {
  AgentDriver,
  AgentEvent,
  AgentInput,
  AgentSessionHandle,
  SessionMeta,
} from "../../core/interfaces.js";
import type { GrokConfig } from "../../config/types.js";
import type { ProcessBudget } from "../../runtime/budget.js";
import { AcpProcessPool } from "../../grok/acp/pool.js";
import { runGrok, type GrokRunResult } from "../../grok/runner.js";
import path from "node:path";

export interface GrokDriverOptions {
  projectId: string;
  config: GrokConfig;
  budget?: ProcessBudget;
  forceSpawn?: boolean;
  runGrokImpl?: (opts: Parameters<typeof runGrok>[0]) => Promise<GrokRunResult>;
  pool?: AcpProcessPool;
}

export class GrokDriver implements AgentDriver {
  readonly type = "grok";
  readonly projectId: string;
  private config: GrokConfig;
  private budget?: ProcessBudget;
  private forceSpawn: boolean;
  private runGrokImpl: (opts: Parameters<typeof runGrok>[0]) => Promise<GrokRunResult>;
  private pool: AcpProcessPool;
  private poolKeys = new Set<string>();
  private processSlots = 0;
  private started = false;

  constructor(opts: GrokDriverOptions) {
    this.projectId = opts.projectId;
    this.config = opts.config;
    this.budget = opts.budget;
    this.forceSpawn =
      Boolean(opts.forceSpawn) || opts.config.session_backend === "spawn";
    this.runGrokImpl = opts.runGrokImpl || runGrok;
    this.pool =
      opts.pool ||
      new AcpProcessPool({
        maxAgentProcesses: opts.config.acp_max_processes ?? 1,
        idleTimeoutMins: opts.config.acp_idle_timeout_mins ?? 15,
        alwaysApprove:
          opts.config.mode === "yolo" || opts.config.mode === "bypassPermissions",
        model: opts.config.model,
        binary: opts.config.command,
      });
  }

  static poolKey(projectId: string, workDir: string, binary: string): string {
    return `${projectId}|${path.resolve(workDir)}|${binary}`;
  }

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    await this.pool.shutdown().catch(() => undefined);
    while (this.processSlots > 0) {
      this.budget?.release();
      this.processSlots--;
    }
    this.poolKeys.clear();
    this.started = false;
  }

  stats(): { processes: number; keys: string[] } {
    return {
      processes: this.pool.stats().processes || this.processSlots,
      keys: [...this.poolKeys],
    };
  }

  async openSession(meta: SessionMeta): Promise<AgentSessionHandle> {
    if (!this.started) await this.start();
    const workDir = meta.workDir || this.config.work_dir;
    const key = GrokDriver.poolKey(
      this.projectId,
      workDir,
      this.config.command || "grok",
    );
    this.poolKeys.add(key);

    if (this.processSlots === 0 && this.budget) {
      if (!this.budget.tryAcquire()) {
        throw new Error(
          `Agent process budget exhausted (max=${this.budget.maxProcesses})`,
        );
      }
      this.processSlots = 1;
    }

    const agentSessionId = meta.agentSessionId || `grok-${Date.now()}`;
    const self = this;
    const backend = this.forceSpawn ? "spawn" : this.config.session_backend || "acp";

    return {
      agentSessionId,
      async *runTurn(input: AgentInput): AsyncIterable<AgentEvent> {
        yield* streamGrokTurn({
          run: self.runGrokImpl,
          config: {
            ...self.config,
            work_dir: workDir,
            session_backend: backend as "acp" | "spawn",
          },
          prompt: input.text,
          sessionId: agentSessionId,
          sessionExists: Boolean(meta.warmed),
          signal: input.signal,
        });
      },
      async close(): Promise<void> {
        /* keep process warm */
      },
    };
  }
}

/**
 * Bridge callback-based runGrok streaming into an async iterable of AgentEvents.
 * Yields text deltas as they arrive; does not drop intermediate stream chunks.
 */
export async function* streamGrokTurn(opts: {
  run: (o: Parameters<typeof runGrok>[0]) => Promise<GrokRunResult>;
  config: GrokConfig;
  prompt: string;
  sessionId: string;
  sessionExists: boolean;
  signal?: AbortSignal;
}): AsyncGenerator<AgentEvent> {
  const queue: AgentEvent[] = [];
  let done = false;
  let wake: (() => void) | null = null;
  let streamedAny = false;
  let result: GrokRunResult | undefined;
  let runError: Error | undefined;

  const notify = () => {
    wake?.();
    wake = null;
  };

  const push = (ev: AgentEvent) => {
    queue.push(ev);
    notify();
  };

  const runPromise = opts
    .run({
      config: opts.config,
      prompt: opts.prompt,
      sessionId: opts.sessionId,
      sessionExists: opts.sessionExists,
      signal: opts.signal,
      onText: (delta) => {
        if (!delta) return;
        streamedAny = true;
        push({ type: "text", text: delta });
      },
      onEvent: (ev) => {
        if (ev.type === "thought" && typeof ev.data === "string" && ev.data) {
          push({ type: "thinking", text: ev.data });
        }
      },
    })
    .then((r) => {
      result = r;
      done = true;
      notify();
      return r;
    })
    .catch((e) => {
      runError = e instanceof Error ? e : new Error(String(e));
      done = true;
      notify();
    });

  while (!done || queue.length > 0) {
    if (queue.length > 0) {
      yield queue.shift()!;
      continue;
    }
    if (done) break;
    await new Promise<void>((r) => {
      wake = r;
    });
  }

  await runPromise;

  if (runError) {
    yield { type: "error", error: runError.message };
    yield { type: "result", sessionId: opts.sessionId };
    return;
  }

  const r = result;
  if (!r) {
    yield { type: "error", error: "empty grok result" };
    yield { type: "result", sessionId: opts.sessionId };
    return;
  }
  // If runner only returned final text without streaming callbacks, emit once
  if (!streamedAny && r.text) {
    yield { type: "text", text: r.text };
  }
  if (r.error) {
    yield { type: "error", error: r.error };
  }
  yield { type: "result", sessionId: r.sessionId || opts.sessionId };
}
