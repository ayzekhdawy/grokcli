/**
 * FakeGrok — scripted agent for acceptance tests (no real Grok CLI).
 */

import type {
  AgentDriver,
  AgentEvent,
  AgentInput,
  AgentSessionHandle,
  SessionMeta,
} from "../core/interfaces.js";
import type { ProcessBudget } from "../runtime/budget.js";

export type FakeTurnScript = AgentEvent[] | ((input: AgentInput, meta: SessionMeta) => AgentEvent[] | Promise<AgentEvent[]>);

export interface FakeGrokOptions {
  projectId: string;
  /** Default events for any turn */
  script?: FakeTurnScript;
  /** Delay between events ms */
  eventDelayMs?: number;
  /** Simulate process slots */
  budget?: ProcessBudget;
  /** Fail openSession with budget error when budget exhausted */
  enforceBudget?: boolean;
  /** Idle reap simulation */
  idleTimeoutMs?: number;
  /** Force spawn fallback path label */
  mode?: "acp" | "spawn";
  /** When true, first open fails (ACP fail → caller may use spawn FakeGrok) */
  failAcp?: boolean;
}

export class FakeGrokDriver implements AgentDriver {
  readonly type: string;
  readonly projectId: string;
  private script: FakeTurnScript;
  private eventDelayMs: number;
  private budget?: ProcessBudget;
  private enforceBudget: boolean;
  private idleTimeoutMs: number;
  private failAcp: boolean;
  private processes = new Map<string, { lastUsed: number; acquired: boolean }>();
  private started = false;
  /** Track agent session ids issued */
  sessionsOpened: string[] = [];
  turns: Array<{ sessionId: string; text: string; projectId: string }> = [];

  constructor(opts: FakeGrokOptions) {
    this.projectId = opts.projectId;
    this.type = opts.mode === "spawn" ? "grok-spawn" : "grok";
    this.script =
      opts.script ||
      ((input) => [
        { type: "thinking", text: "thinking..." },
        { type: "text", text: `echo:${input.text.slice(0, 80)}` },
        { type: "result", text: "", sessionId: undefined },
      ]);
    this.eventDelayMs = opts.eventDelayMs ?? 0;
    this.budget = opts.budget;
    this.enforceBudget = opts.enforceBudget !== false;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 0;
    this.failAcp = Boolean(opts.failAcp);
  }

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    for (const [k, p] of this.processes) {
      if (p.acquired) this.budget?.release();
      this.processes.delete(k);
    }
    this.started = false;
  }

  stats(): { processes: number; keys: string[] } {
    this.reapIdle();
    return {
      processes: this.processes.size,
      keys: [...this.processes.keys()].map((k) => `${this.projectId}|${k}`),
    };
  }

  /** Pool key includes projectId (isolation) */
  poolKey(workDir: string, binary = "grok"): string {
    return `${this.projectId}|${workDir}|${binary}`;
  }

  private reapIdle(): void {
    if (this.idleTimeoutMs <= 0) return;
    const now = Date.now();
    for (const [k, p] of [...this.processes.entries()]) {
      if (now - p.lastUsed >= this.idleTimeoutMs) {
        if (p.acquired) this.budget?.release();
        this.processes.delete(k);
      }
    }
  }

  /** Force idle timeout for tests */
  forceIdleReap(): void {
    for (const [k, p] of [...this.processes.entries()]) {
      p.lastUsed = 0;
    }
    this.reapIdle();
  }

  async openSession(meta: SessionMeta): Promise<AgentSessionHandle> {
    if (!this.started) await this.start();
    if (this.failAcp) {
      throw new Error("ACP forced failure");
    }
    this.reapIdle();
    const key = meta.workDir;
    let slot = this.processes.get(key);
    if (!slot) {
      if (this.enforceBudget && this.budget && !this.budget.tryAcquire()) {
        throw new Error(
          `Agent process budget exhausted (max=${this.budget.maxProcesses})`,
        );
      }
      slot = { lastUsed: Date.now(), acquired: Boolean(this.budget) };
      this.processes.set(key, slot);
    } else {
      slot.lastUsed = Date.now();
    }

    const agentSessionId =
      meta.agentSessionId || `fake-${this.projectId}-${this.sessionsOpened.length + 1}`;
    this.sessionsOpened.push(agentSessionId);

    const self = this;
    return {
      agentSessionId,
      async *runTurn(input: AgentInput): AsyncIterable<AgentEvent> {
        slot!.lastUsed = Date.now();
        self.turns.push({
          sessionId: agentSessionId,
          text: input.text,
          projectId: self.projectId,
        });
        const events =
          typeof self.script === "function"
            ? await self.script(input, { ...meta, agentSessionId })
            : self.script;
        for (const ev of events) {
          if (self.eventDelayMs > 0) {
            await new Promise((r) => setTimeout(r, self.eventDelayMs));
          }
          if (ev.type === "result" && !ev.sessionId) {
            yield { ...ev, sessionId: agentSessionId };
          } else {
            yield ev;
          }
        }
      },
      async close(): Promise<void> {
        slot!.lastUsed = Date.now();
      },
    };
  }
}

/** Scripted token stream for coalesce tests */
export function tokenStreamScript(tokens: string[], thinking?: string): FakeTurnScript {
  return async function* () {
    // not used as async generator in FakeGrok — return array
  } as unknown as FakeTurnScript;
}

export function makeTokenEvents(tokens: string[], thinking = "plan"): AgentEvent[] {
  const events: AgentEvent[] = [{ type: "thinking", text: thinking }];
  for (const t of tokens) {
    events.push({ type: "text", text: t });
  }
  events.push({ type: "result", text: "" });
  return events;
}
