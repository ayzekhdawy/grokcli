import { spawn, type ChildProcess } from "node:child_process";
import type { GrokConfig } from "../../config/types.js";
import { resolveGrokBinary } from "../../util/paths.js";
import { log } from "../../util/logger.js";
import {
  encodeMessage,
  parseMessageLine,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcResponse,
} from "./jsonrpc.js";

export interface AcpPromptHandlers {
  onText?: (delta: string) => void | Promise<void>;
  onThought?: (delta: string) => void | Promise<void>;
  onTool?: (title: string) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface AcpPromptResult {
  text: string;
  sessionId: string;
  stopReason: string;
  error: string;
}

type Pending = {
  resolve: (r: JsonRpcResponse) => void;
  reject: (e: Error) => void;
};

/**
 * One long-lived `grok agent stdio` process.
 * Multiple Feishu chats map to multiple ACP sessions on the same process.
 */
export class AcpAgentClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<JsonRpcId, Pending>();
  private lineBuf = "";
  private ready = false;
  private starting: Promise<void> | null = null;
  /** Serialize prompts — one active prompt per process avoids interleaving chaos. */
  private promptChain: Promise<unknown> = Promise.resolve();
  private lastUsedAt = Date.now();
  private disposed = false;
  /** Sessions already created/loaded on this live process (skip redundant session/load). */
  private openSessions = new Set<string>();

  constructor(
    private readonly opts: {
      workDir: string;
      binary?: string;
      model?: string;
      alwaysApprove?: boolean;
      /** Env overrides for lighter long-run (optional) */
      env?: NodeJS.ProcessEnv;
    },
  ) {}

  get workDir(): string {
    return this.opts.workDir;
  }

  get lastUsed(): number {
    return this.lastUsedAt;
  }

  get isAlive(): boolean {
    return Boolean(this.proc && !this.proc.killed && this.proc.exitCode == null);
  }

  touch(): void {
    this.lastUsedAt = Date.now();
  }

  async ensureStarted(): Promise<void> {
    if (this.disposed) throw new Error("AcpAgentClient disposed");
    if (this.ready && this.isAlive) return;
    if (this.starting) return this.starting;
    this.starting = this.startProcess().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async startProcess(): Promise<void> {
    this.cleanupProc();
    this.openSessions.clear();
    const binary = this.opts.binary || resolveGrokBinary("grok");
    const args = ["agent"];
    if (this.opts.alwaysApprove !== false) args.push("--always-approve");
    if (this.opts.model) args.push("--model", this.opts.model);
    // Prefer no-leader isolation for predictable single-process ownership
    args.push("--no-leader", "stdio");

    log.info("acp: starting agent process", { binary, workDir: this.opts.workDir });

    const proc = spawn(binary, args, {
      cwd: this.opts.workDir,
      env: {
        ...process.env,
        ...this.opts.env,
        // Reduce noise / avoid nested auto-update
        GROK_DISABLE_AUTOUPDATER: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc = proc;

    proc.stdout?.setEncoding("utf8");
    proc.stderr?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => this.onStdout(chunk));
    proc.stderr?.on("data", (chunk: string) => {
      const t = String(chunk).trim();
      if (t) log.debug("acp stderr", { line: t.slice(0, 400) });
    });
    proc.on("exit", (code, signal) => {
      log.warn("acp: agent process exited", { code, signal });
      this.ready = false;
      this.failAllPending(new Error(`agent process exited code=${code} signal=${signal}`));
      this.proc = null;
    });
    proc.on("error", (err) => {
      log.error("acp: spawn error", { error: err.message });
      this.ready = false;
      this.failAllPending(err);
    });

    // initialize
    const initRes = await this.request(
      "initialize",
      {
        protocolVersion: 1,
        clientInfo: { name: "grok-remote-bridge", version: "0.1.0" },
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
      },
      30_000,
    );
    if (initRes.error) {
      throw new Error(`acp initialize failed: ${initRes.error.message}`);
    }
    this.ready = true;
    this.touch();
    log.info("acp: agent ready", {
      protocolVersion: (initRes.result as { protocolVersion?: number })?.protocolVersion,
    });
  }

  private onStdout(chunk: string): void {
    this.lineBuf += chunk;
    const parts = this.lineBuf.split("\n");
    this.lineBuf = parts.pop() || "";
    for (const line of parts) {
      const msg = parseMessageLine(line);
      if (!msg) continue;
      this.dispatch(msg);
    }
  }

  private dispatch(msg: JsonRpcMessage): void {
    // Response
    if ("id" in msg && msg.id != null && !("method" in msg && (msg as { method?: string }).method)) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        pending.resolve(msg as JsonRpcResponse);
      }
      return;
    }

    // Server request (permission etc.) — auto-approve for long-unattended bot
    if ("method" in msg && "id" in msg && (msg as { id?: unknown }).id != null) {
      const req = msg as { id: JsonRpcId; method: string; params?: unknown };
      void this.handleServerRequest(req.id, req.method, req.params);
      return;
    }

    // Notification
    if ("method" in msg) {
      // session/update handled during prompt via activePromptHandlers
      if (msg.method === "session/update" && this.activePrompt) {
        void this.activePrompt.onUpdate(msg.params);
      }
    }
  }

  private activePrompt: {
    sessionId: string;
    onUpdate: (params: unknown) => void | Promise<void>;
  } | null = null;

  private async handleServerRequest(
    id: JsonRpcId,
    method: string,
    params: unknown,
  ): Promise<void> {
    // Auto-approve common permission methods
    if (
      method.includes("permission") ||
      method === "session/request_permission" ||
      method.endsWith("/request_permission")
    ) {
      this.write({
        jsonrpc: "2.0",
        id,
        result: {
          outcome: { outcome: "selected", optionId: "allow-always" },
          // alternate shapes some agents use
          approved: true,
        },
      });
      return;
    }
    // Unknown server request — return empty ok to avoid hanging
    log.debug("acp: auto-empty response for server request", { method });
    this.write({ jsonrpc: "2.0", id, result: {} });
  }

  private write(msg: object): void {
    if (!this.proc?.stdin || this.proc.stdin.destroyed) {
      throw new Error("acp process stdin not available");
    }
    this.proc.stdin.write(encodeMessage(msg));
  }

  private request(
    method: string,
    params: unknown,
    timeoutMs = 60_000,
  ): Promise<JsonRpcResponse> {
    if (!this.proc) return Promise.reject(new Error("process not started"));
    const id = this.nextId++;
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`acp request timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
    this.activePrompt = null;
  }

  /**
   * Create a new ACP session. Returns agent sessionId.
   */
  async sessionNew(meta?: { rules?: string }): Promise<string> {
    await this.ensureStarted();
    this.touch();
    const params: Record<string, unknown> = {
      cwd: this.opts.workDir,
      mcpServers: [],
    };
    if (meta?.rules) {
      params._meta = { rules: meta.rules };
    }
    const res = await this.request("session/new", params, 60_000);
    if (res.error) throw new Error(res.error.message);
    const sid = (res.result as { sessionId?: string })?.sessionId;
    if (!sid) throw new Error("session/new missing sessionId");
    this.openSessions.add(sid);
    return sid;
  }

  /**
   * Load an existing session after process restart.
   */
  async sessionLoad(sessionId: string): Promise<boolean> {
    await this.ensureStarted();
    this.touch();
    // Already live on this process — no RPC needed
    if (this.openSessions.has(sessionId)) {
      log.debug("acp session already open, skip load", { sessionId });
      return true;
    }
    try {
      const res = await this.request(
        "session/load",
        {
          sessionId,
          cwd: this.opts.workDir,
          mcpServers: [],
        },
        60_000,
      );
      if (res.error) {
        log.warn("acp session/load failed", { sessionId, error: res.error.message });
        return false;
      }
      this.openSessions.add(sessionId);
      return true;
    } catch (e) {
      log.warn("acp session/load error", {
        sessionId,
        error: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
  }

  /**
   * Ensure we have a usable sessionId: load if possible, else create.
   * Skips session/load when the session is already open on this live process.
   */
  async ensureSession(
    preferredId: string | undefined,
    canLoad: boolean,
    meta?: { rules?: string },
  ): Promise<string> {
    await this.ensureStarted();
    if (preferredId && canLoad) {
      if (this.openSessions.has(preferredId)) {
        this.touch();
        return preferredId;
      }
      const ok = await this.sessionLoad(preferredId);
      if (ok) return preferredId;
    }
    return this.sessionNew(meta);
  }

  /**
   * Send a prompt and stream agent_message_chunk text. Serialized on this process.
   */
  async prompt(
    sessionId: string,
    text: string,
    handlers: AcpPromptHandlers = {},
    timeoutMs = 540_000,
  ): Promise<AcpPromptResult> {
    const run = async (): Promise<AcpPromptResult> => {
      await this.ensureStarted();
      this.touch();

      let acc = "";
      let stopReason = "";
      let error = "";

      const onUpdate = async (params: unknown) => {
        const p = params as {
          sessionId?: string;
          update?: {
            sessionUpdate?: string;
            content?: { type?: string; text?: string };
            title?: string;
          };
        };
        const update = p?.update;
        if (!update) return;
        const kind = update.sessionUpdate || "";
        if (kind === "agent_message_chunk") {
          const t = update.content?.text || "";
          if (t) {
            acc += t;
            if (handlers.onText) await handlers.onText(t);
          }
        } else if (kind === "agent_thought_chunk") {
          const t = update.content?.text || "";
          if (t && handlers.onThought) await handlers.onThought(t);
        } else if (kind === "tool_call") {
          if (handlers.onTool) await handlers.onTool(update.title || "tool");
        }
      };

      this.activePrompt = { sessionId, onUpdate };

      const onAbort = () => {
        // Best-effort: cannot cancel easily; mark error
        error = "aborted";
      };
      handlers.signal?.addEventListener("abort", onAbort, { once: true });

      try {
        const res = await this.request(
          "session/prompt",
          {
            sessionId,
            prompt: [{ type: "text", text }],
          },
          timeoutMs,
        );
        if (res.error) {
          error = res.error.message;
        } else {
          const result = res.result as { stopReason?: string } | undefined;
          stopReason = result?.stopReason || "end_turn";
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        handlers.signal?.removeEventListener("abort", onAbort);
        this.activePrompt = null;
        this.touch();
      }

      return {
        text: acc.trim(),
        sessionId,
        stopReason,
        error,
      };
    };

    // Serialize
    const done = this.promptChain.then(run, run);
    this.promptChain = done.then(
      () => undefined,
      () => undefined,
    );
    return done;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.ready = false;
    this.failAllPending(new Error("disposed"));
    this.cleanupProc();
  }

  private cleanupProc(): void {
    if (this.proc && !this.proc.killed) {
      try {
        this.proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      // Force kill after grace
      const p = this.proc;
      setTimeout(() => {
        try {
          if (p.exitCode == null) p.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 3000).unref?.();
    }
    this.proc = null;
  }
}

// silence unused import in some builds
void (0 as unknown as GrokConfig);
