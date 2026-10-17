/**
 * Resolve absolute executable + args to re-invoke agent-connect under a service manager.
 * Supports both Node.js and Bun runtimes.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_NAME } from "../util/paths.js";

export interface CliInvocation {
  /** Program to exec (node, bun, or absolute path to standalone binary) */
  executable: string;
  /** Args before user command (e.g. path to dist/index.js or src/index.ts) */
  prefixArgs: string[];
  /** Working directory for the service */
  workDir: string;
  /** Human-readable one-liner for docs */
  display: string;
  /** Absolute path to package root when known */
  packageRoot?: string;
  /** Detected runtime */
  runtime: "node" | "bun" | "unknown";
}

export function isBunRuntime(): boolean {
  return typeof process.versions.bun === "string";
}

function which(cmd: string): string | null {
  const pathEnv = process.env.PATH || "";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(
        dir,
        process.platform === "win32" ? cmd + ext : cmd,
      );
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        /* continue */
      }
    }
    const bare = path.join(dir, cmd);
    if (fs.existsSync(bare)) return bare;
  }
  return null;
}

function findPackageRootFromHere(): string | null {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/service or src/service → package root
    let dir = here;
    for (let i = 0; i < 8; i++) {
      const pkg = path.join(dir, "package.json");
      if (fs.existsSync(pkg)) {
        try {
          const j = JSON.parse(fs.readFileSync(pkg, "utf8")) as { name?: string };
          if (
            j.name === "@ronglecat/agent-connect" ||
            j.name === "agent-connect" ||
            j.name === "lark-grok"
          ) {
            return dir;
          }
        } catch {
          /* continue */
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function resolveBunBinary(): string {
  const fromEnv = process.env.BUN_INSTALL
    ? path.join(
        process.env.BUN_INSTALL,
        "bin",
        process.platform === "win32" ? "bun.exe" : "bun",
      )
    : null;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const homeBun = path.join(
    os.homedir(),
    ".bun",
    "bin",
    process.platform === "win32" ? "bun.exe" : "bun",
  );
  if (fs.existsSync(homeBun)) return homeBun;

  const w = which("bun");
  if (w) return w;

  if (isBunRuntime() && /bun/i.test(path.basename(process.execPath))) {
    return process.execPath;
  }
  return w || "bun";
}

function resolveNodeBinary(): string {
  if (!isBunRuntime() && process.execPath) {
    return process.execPath;
  }
  const w = which("node");
  if (w) return w;
  // common names
  if (process.execPath && /node/i.test(path.basename(process.execPath))) {
    return process.execPath;
  }
  return "node";
}

/**
 * Build invocation that services / daemon should use.
 *
 * Preference:
 * 1. Same runtime as current process (node or bun) + dist/index.js when built
 * 2. Bun + src/index.ts when developing without build (Bun only)
 * 3. Current execPath alone if this process is already a standalone binary
 */
export function resolveCliInvocation(opts?: {
  packageRoot?: string;
}): CliInvocation {
  const packageRoot = opts?.packageRoot || findPackageRootFromHere() || process.cwd();
  const distEntry = path.join(packageRoot, "dist", "index.js");
  const srcEntry = path.join(packageRoot, "src", "index.ts");
  const binJs = path.join(packageRoot, "bin", "agent-connect.js");
  const bunRt = isBunRuntime();
  const runtime: CliInvocation["runtime"] = bunRt ? "bun" : "node";

  // Standalone compiled binary: argv[1] empty or not a script path
  const argv1 = process.argv[1] ? path.resolve(process.argv[1]) : "";
  const looksLikeOurEntry =
    argv1.endsWith(`${path.sep}index.js`) ||
    argv1.endsWith(`${path.sep}index.ts`) ||
    argv1.endsWith(`${path.sep}agent-connect.js`) ||
    argv1.endsWith(`${path.sep}lark-grok.js`);

  if (argv1 && !looksLikeOurEntry && fs.existsSync(argv1) && !argv1.includes("node_modules")) {
    // Possible bun --compile single file
    const base = path.basename(argv1);
    if (base === "agent-connect" || base === "agent-connect.exe") {
      return {
        executable: argv1,
        prefixArgs: [],
        workDir: packageRoot,
        display: shellQuote(argv1),
        packageRoot,
        runtime,
      };
    }
  }

  // Prefer built dist (Node + Bun)
  if (fs.existsSync(distEntry)) {
    const executable = bunRt ? ( /bun/i.test(path.basename(process.execPath)) ? process.execPath : resolveBunBinary() ) : resolveNodeBinary();
    const prefixArgs = [distEntry];
    return {
      executable,
      prefixArgs,
      workDir: packageRoot,
      display: `${shellQuote(executable)} ${shellQuote(distEntry)}`,
      packageRoot,
      runtime,
    };
  }

  // Dev: Bun can execute TypeScript sources directly
  if (bunRt && fs.existsSync(srcEntry)) {
    const executable = /bun/i.test(path.basename(process.execPath))
      ? process.execPath
      : resolveBunBinary();
    return {
      executable,
      prefixArgs: [srcEntry],
      workDir: packageRoot,
      display: `${shellQuote(executable)} ${shellQuote(srcEntry)}`,
      packageRoot,
      runtime: "bun",
    };
  }

  // Fallback: bin shim (requires dist for Node; Bun may load via launcher)
  if (fs.existsSync(binJs)) {
    const executable = bunRt ? resolveBunBinary() : resolveNodeBinary();
    return {
      executable,
      prefixArgs: [binJs],
      workDir: packageRoot,
      display: `${shellQuote(executable)} ${shellQuote(binJs)}`,
      packageRoot,
      runtime,
    };
  }

  // Last resort
  const executable = bunRt ? resolveBunBinary() : resolveNodeBinary();
  const entry = fs.existsSync(srcEntry) ? srcEntry : distEntry;
  return {
    executable,
    prefixArgs: [entry],
    workDir: packageRoot,
    display: `${shellQuote(executable)} ${shellQuote(entry)}`,
    packageRoot,
    runtime,
  };
}

export function shellQuote(s: string): string {
  if (process.platform === "win32") {
    if (!/[ \t"]/g.test(s)) return s;
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Full command array for start --all under a service */
export function serviceStartArgs(inv: CliInvocation, extra: string[] = []): string[] {
  return [...inv.prefixArgs, "start", "--all", ...extra];
}

export function serviceStartDisplay(inv: CliInvocation, extra: string[] = []): string {
  const args = serviceStartArgs(inv, extra);
  return [shellQuote(inv.executable), ...args.map(shellQuote)].join(" ");
}

export { CLI_NAME };
