import { spawn } from "node:child_process";
import type { GrokConfig } from "../config/types.js";
import { resolveGrokBinary } from "../util/paths.js";
import { buildGrokArgsFromConfig } from "./args.js";
import {
  extractTextFromGrokOutput,
  parseStreamingJsonLine,
  type GrokStreamEvent,
} from "./events.js";
import { log } from "../util/logger.js";
import { runGrokAcp } from "./acp/runner.js";

export interface GrokRunOptions {
  config: GrokConfig;
  prompt: string;
  sessionId?: string;
  sessionExists?: boolean;
  /** Called for each streaming text delta */
  onText?: (delta: string, full: string) => void | Promise<void>;
  onEvent?: (ev: GrokStreamEvent) => void | Promise<void>;
  /** Injectable spawn for tests */
  spawnImpl?: typeof spawn;
  /** Override binary path */
  binary?: string;
  signal?: AbortSignal;
}

export interface GrokRunResult {
  text: string;
  sessionId: string;
  error: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run one Grok turn via configured backend:
 * - acp (default): long-lived `grok agent stdio`
 * - spawn: one-shot `grok -p` (legacy)
 */
export async function runGrok(opts: GrokRunOptions): Promise<GrokRunResult> {
  const backend = opts.config.session_backend || "acp";
  if (backend === "acp") {
    try {
      return await runGrokAcp(opts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("acp backend failed, falling back to spawn", { error: msg });
      // fall through to spawn once
    }
  }
  return runGrokSpawn(opts);
}

/**
 * Run Grok Build headless once (spawn) and collect streaming output.
 */
export async function runGrokSpawn(opts: GrokRunOptions): Promise<GrokRunResult> {
  const binary = opts.binary || resolveGrokBinary(opts.config.command);
  const args = buildGrokArgsFromConfig(opts.config, opts.prompt, {
    sessionId: opts.sessionId || "",
    exists: Boolean(opts.sessionExists),
  });

  log.debug("spawning grok", { binary, args: args.map((a) => (a.length > 80 ? a.slice(0, 80) + "…" : a)) });

  const spawnFn = opts.spawnImpl || spawn;
  const child = spawnFn(binary, args, {
    cwd: opts.config.work_dir,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let accText = "";
  let sessionId = opts.sessionId || "";
  let streamError = "";
  let lineBuf = "";

  const handleChunk = async (chunk: string, isStderr: boolean) => {
    if (isStderr) {
      stderr += chunk;
      return;
    }
    stdout += chunk;
    lineBuf += chunk;
    const parts = lineBuf.split("\n");
    lineBuf = parts.pop() || "";
    for (const line of parts) {
      const ev = parseStreamingJsonLine(line);
      if (!ev) continue;
      if (opts.onEvent) await opts.onEvent(ev);
      if (ev.sessionId) sessionId = ev.sessionId;
      if (ev.type === "text" && ev.data) {
        accText += ev.data;
        if (opts.onText) await opts.onText(ev.data, accText);
      }
      if (ev.type === "end") {
        if (ev.data && !accText) {
          accText = ev.data;
          if (opts.onText) await opts.onText(ev.data, accText);
        }
        if (ev.sessionId) sessionId = ev.sessionId;
      }
      if (ev.type === "error" && ev.message) streamError = ev.message;
    }
  };

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (d: string) => {
    void handleChunk(d, false);
  });
  child.stderr?.on("data", (d: string) => {
    void handleChunk(d, true);
  });

  const timeoutMs = opts.config.timeout_ms;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const onAbort = () => {
      child.kill("SIGTERM");
      reject(new Error("aborted"));
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`grok timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    child.on("error", (err) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (timer) clearTimeout(timer);
      resolve(code);
    });
  }).catch((err: Error) => {
    if (timer) clearTimeout(timer);
    streamError = streamError || err.message;
    return null;
  });

  // Flush remaining line buffer
  if (lineBuf.trim()) {
    const ev = parseStreamingJsonLine(lineBuf);
    if (ev?.type === "text" && ev.data) accText += ev.data;
    if (ev?.sessionId) sessionId = ev.sessionId;
    if (ev?.type === "error" && ev.message) streamError = ev.message;
    if (ev?.type === "end" && ev.data && !accText) accText = ev.data;
  }

  if (!accText) {
    const extracted = extractTextFromGrokOutput(stdout);
    accText = extracted.text;
    if (extracted.sessionId) sessionId = extracted.sessionId;
    if (extracted.error) streamError = extracted.error;
  }

  return {
    text: accText.trim(),
    sessionId,
    error: streamError,
    exitCode,
    stdout,
    stderr,
  };
}

/** Async generator yielding text deltas — useful for channel.stream */
export async function* runGrokStreaming(
  opts: GrokRunOptions,
): AsyncGenerator<string, GrokRunResult, unknown> {
  const queue: string[] = [];
  let done = false;
  let result: GrokRunResult | null = null;
  let wake: (() => void) | null = null;

  const notify = () => {
    if (wake) {
      const w = wake;
      wake = null;
      w();
    }
  };

  const runPromise = runGrok({
    ...opts,
    onText: async (delta) => {
      queue.push(delta);
      notify();
      if (opts.onText) await opts.onText(delta, "");
    },
  }).then((r) => {
    result = r;
    done = true;
    notify();
    return r;
  });

  while (!done || queue.length) {
    if (!queue.length) {
      await new Promise<void>((r) => {
        wake = r;
      });
      continue;
    }
    yield queue.shift()!;
  }
  await runPromise;
  return result!;
}
