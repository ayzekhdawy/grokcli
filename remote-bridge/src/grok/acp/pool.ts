/**
 * Process pool for long-running Grok ACP agents.
 *
 * Resource policy (defaults tuned for personal Feishu bots):
 * - One agent process per work_dir (many Feishu chats share sessions on it)
 * - max_agent_processes caps concurrent OS processes (default 1)
 * - idle_timeout_mins kills idle processes (sessions remain on disk)
 * - Prompts are serialized per process
 */

import { AcpAgentClient } from "./client.js";
import { log } from "../../util/logger.js";
import { resolveGrokBinary } from "../../util/paths.js";

export interface AcpPoolOptions {
  /** Max concurrent agent OS processes (default 1) */
  maxAgentProcesses?: number;
  /** Kill process after this many idle minutes (default 15; 0 = never) */
  idleTimeoutMins?: number;
  /** Sweep interval seconds (default 60) */
  sweepIntervalSecs?: number;
  alwaysApprove?: boolean;
  model?: string;
  binary?: string;
}

export class AcpProcessPool {
  private clients = new Map<string, AcpAgentClient>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private readonly maxProcesses: number;
  private readonly idleMs: number;
  private readonly alwaysApprove: boolean;
  private readonly model?: string;
  private readonly binary?: string;

  constructor(opts: AcpPoolOptions = {}) {
    this.maxProcesses = Math.max(1, opts.maxAgentProcesses ?? 1);
    const idleMins = opts.idleTimeoutMins ?? 15;
    this.idleMs = idleMins > 0 ? idleMins * 60_000 : 0;
    this.alwaysApprove = opts.alwaysApprove !== false;
    this.model = opts.model;
    this.binary = opts.binary || resolveGrokBinary("grok");

    const sweepSecs = opts.sweepIntervalSecs ?? 60;
    if (this.idleMs > 0 && sweepSecs > 0) {
      this.sweepTimer = setInterval(() => {
        void this.evictIdle();
      }, sweepSecs * 1000);
      this.sweepTimer.unref?.();
    }
  }

  /** Keyed by absolute work_dir */
  async getClient(workDir: string): Promise<AcpAgentClient> {
    const key = workDir;
    let client = this.clients.get(key);
    if (client?.isAlive) {
      client.touch();
      return client;
    }
    if (client) {
      await client.dispose().catch(() => undefined);
      this.clients.delete(key);
    }

    // Evict LRU if at capacity
    while (this.clients.size >= this.maxProcesses) {
      await this.evictLru();
    }

    client = new AcpAgentClient({
      workDir,
      binary: this.binary,
      model: this.model,
      alwaysApprove: this.alwaysApprove,
    });
    this.clients.set(key, client);
    await client.ensureStarted();
    log.info("acp pool: client ready", {
      workDir,
      processes: this.clients.size,
      max: this.maxProcesses,
    });
    return client;
  }

  private async evictLru(): Promise<void> {
    let oldestKey: string | null = null;
    let oldest = Infinity;
    for (const [k, c] of this.clients) {
      if (c.lastUsed < oldest) {
        oldest = c.lastUsed;
        oldestKey = k;
      }
    }
    if (!oldestKey) return;
    log.info("acp pool: evicting LRU process", { workDir: oldestKey });
    const c = this.clients.get(oldestKey);
    this.clients.delete(oldestKey);
    await c?.dispose().catch(() => undefined);
  }

  async evictIdle(): Promise<void> {
    if (this.idleMs <= 0) return;
    const now = Date.now();
    for (const [k, c] of [...this.clients.entries()]) {
      if (now - c.lastUsed >= this.idleMs) {
        log.info("acp pool: idle timeout, stopping agent", {
          workDir: k,
          idleMs: now - c.lastUsed,
        });
        this.clients.delete(k);
        await c.dispose().catch(() => undefined);
      }
    }
  }

  stats(): { processes: number; max: number; idleTimeoutMins: number } {
    return {
      processes: this.clients.size,
      max: this.maxProcesses,
      idleTimeoutMins: this.idleMs > 0 ? this.idleMs / 60_000 : 0,
    };
  }

  async shutdown(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    const all = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(all.map((c) => c.dispose().catch(() => undefined)));
    log.info("acp pool: shutdown complete");
  }
}

/** Module singleton for the bridge process */
let globalPool: AcpProcessPool | null = null;

export function getAcpPool(opts?: AcpPoolOptions): AcpProcessPool {
  if (!globalPool) {
    globalPool = new AcpProcessPool(opts);
  }
  return globalPool;
}

export async function shutdownAcpPool(): Promise<void> {
  if (globalPool) {
    await globalPool.shutdown();
    globalPool = null;
  }
}

export function resetAcpPoolForTests(): void {
  globalPool = null;
}
