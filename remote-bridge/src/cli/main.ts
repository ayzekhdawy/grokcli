import path from "node:path";
import { loadConfig, getProject, listProjectNames } from "../config/load.js";
import type { AppConfig } from "../config/types.js";
import { setLogLevel, log, enableFileLog, getLogFilePath } from "../util/logger.js";
import { startBridge } from "../bridge/start.js";
import { runFeishuCommand, printFeishuUsage } from "./feishu-cmd.js";
import { runDoctor } from "./doctor.js";
import { migrateFromLarkGrok, migrateFromAgentConnect } from "./migrate.js";
import { runServiceCommand, printServiceUsage } from "./service-cmd.js";
import { runGrok } from "../grok/runner.js";
import {
  resolveGrokBinary,
  grokAuthExists,
  defaultConfigPath,
  defaultLogFilePath,
  defaultPidPath,
  CLI_NAME,
} from "../util/paths.js";
import { VERSION } from "../version.js";
import { Supervisor } from "../supervisor/index.js";
import { DEFAULT_GROK_CONFIG } from "../config/types.js";
import { acquirePidLock, releasePidLock, stopFromPidFile, getRunningInstance } from "../runtime/pid.js";
import { startDaemon } from "../runtime/daemon.js";
import { serviceStatus } from "../service/manager.js";

function printRootHelp(): void {
  console.log(`${CLI_NAME} v${VERSION} — Grok App in-app Remote IM bridge (Feishu/Lark × Grok Build ACP)

Usage:
  ${CLI_NAME} <command> [options]
  node bin/grok-remote-bridge.js <command> [options]

Commands:
  start, run          Start bridges for configured projects
  stop                Stop background / PID-tracked instance
  service             Install OS auto-start (launchd / systemd / WinSW)
  feishu              Feishu onboarding: setup | new | bind
  doctor              Check config, grok binary, auth, hub
  status              Runtime + process + service status
  migrate             Migrate legacy config (from-lark-grok / from-agent-connect)
  smoke-grok          One-shot local Grok headless prompt (no Feishu)
  version             Print version
  help                Show this help

Global options:
  --config <path>     Config file (default: ~/.grok-app/remote/bridge-data/config.toml)
  --project <name>    Project name (single-project start)
  --all               Start all projects via Supervisor
  --daemon, -d        Start in background (detached)
  --force             Replace existing PID lock (start)
  --dry-run           Load config without connecting
  --log-level <lvl>   debug | info | warn | error
  --log-file <path>   Optional log file

Examples:
  ${CLI_NAME} start --all --force --config ~/.grok-app/remote/bridge-data/config.toml
  ${CLI_NAME} stop
  ${CLI_NAME} doctor
  ${CLI_NAME} status

Note: Grok App Host spawns this bridge — do not install external agent-connect.
`);
}

/** Flags handled only at the root level (never treated as project names / positionals). */
const GLOBAL_FLAGS_WITH_VALUE = new Set(["config", "project", "log-level", "log-file"]);
const GLOBAL_FLAGS_BOOL = new Set(["help", "version", "dry-run", "all", "daemon", "force"]);

export interface ParsedGlobal {
  command: string;
  /** Non-flag positionals after the command (e.g. project name, smoke prompt words, feishu subcommand). */
  positionals: string[];
  /** Unknown flags + values to forward to subcommands (e.g. --app for feishu). */
  passthrough: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Parse root argv. Global flags are never placed in positionals.
 * Subcommand-only flags (--app, etc.) go to passthrough.
 * Exported for unit tests.
 */
export function parseGlobal(args: string[]): ParsedGlobal {
  const flags: Record<string, string | boolean> = {};
  const rawPositionals: string[] = [];
  const passthrough: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--help" || a === "-h") {
      flags.help = true;
      continue;
    }
    if (a === "--version" || a === "-V") {
      flags.version = true;
      continue;
    }
    if (a === "-d") {
      flags.daemon = true;
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (GLOBAL_FLAGS_BOOL.has(key)) {
        flags[key] = true;
        continue;
      }
      if (GLOBAL_FLAGS_WITH_VALUE.has(key)) {
        const next = args[i + 1];
        if (!next || next.startsWith("-")) {
          flags[key] = true;
        } else {
          flags[key] = next;
          i++;
        }
        continue;
      }
      // Subcommand-specific flag
      passthrough.push(a);
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        passthrough.push(next);
        i++;
      }
      continue;
    }
    if (a.startsWith("-") && a !== "-") {
      passthrough.push(a);
      continue;
    }
    rawPositionals.push(a);
  }

  const command = rawPositionals[0] || "start";
  const positionals = rawPositionals.slice(1);
  return { command, positionals, passthrough, flags };
}

/**
 * Resolve project name for start/run/doctor.
 * Never treats argv that starts with "-" as a name.
 * Exported for unit tests.
 */
export function resolveProjectName(
  flagsProject: string | undefined,
  positionals: string[],
  config: AppConfig,
): { name: string } | { error: string } {
  const fromFlag = (flagsProject || "").trim();
  if (fromFlag && !fromFlag.startsWith("-")) {
    return { name: fromFlag };
  }

  for (let i = 0; i < positionals.length; i++) {
    const p = positionals[i]!;
    if (!p || p.startsWith("-")) continue;
    const prev = i > 0 ? positionals[i - 1] : undefined;
    if (prev && prev.startsWith("-")) continue;
    if (p.includes("/") || p.includes("\\") || p.includes(path.sep)) continue;
    return { name: p };
  }

  const names = listProjectNames(config);
  if (names.length === 1) return { name: names[0]! };
  if (names.length === 0) {
    return {
      error:
        `No projects in config. Bind Feishu in Grok App Settings → Remote IM, or: ${CLI_NAME} feishu setup --project default`,
    };
  }
  return {
    error: `Multiple projects (${names.join(", ")}); pass --project <name> or --all`,
  };
}

/** Build feishu subcommand argv: positionals + passthrough + injected global config/project. */
export function buildFeishuArgv(
  positionals: string[],
  passthrough: string[],
  flags: Record<string, string | boolean>,
): string[] {
  const out = [...positionals, ...passthrough];
  if (typeof flags.config === "string" && flags.config) {
    out.push("--config", flags.config);
  }
  if (typeof flags.project === "string" && flags.project) {
    if (!out.includes("--project")) {
      out.push("--project", flags.project);
    }
  }
  return out;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { command, positionals, passthrough, flags } = parseGlobal(argv);

  if (flags.version || command === "version") {
    console.log(VERSION);
    return 0;
  }

  if (flags.help || command === "help") {
    if (command === "feishu") {
      printFeishuUsage();
      return 0;
    }
    if (command === "service") {
      printServiceUsage();
      return 0;
    }
    printRootHelp();
    return 0;
  }

  if (flags["log-level"]) setLogLevel(String(flags["log-level"]));

  const configPath =
    typeof flags.config === "string" ? flags.config : undefined;
  const flagsProject =
    typeof flags.project === "string" ? flags.project : undefined;

  switch (command) {
    case "feishu": {
      const feishuArgv = buildFeishuArgv(positionals, passthrough, flags);
      return runFeishuCommand(
        feishuArgv.length ? feishuArgv : flags.help ? ["help"] : [],
      );
    }

    case "service": {
      const svcArgv = [...positionals, ...passthrough];
      return runServiceCommand(svcArgv.length ? svcArgv : ["status"]);
    }

    case "stop": {
      const result = await stopFromPidFile();
      console.log(result.message);
      return result.ok ? 0 : 1;
    }

    case "doctor": {
      const { config } = loadConfig(configPath);
      const resolved = resolveProjectName(flagsProject, positionals, config);
      const name = "name" in resolved ? resolved.name : undefined;
      return runDoctor(configPath, name);
    }

    case "status": {
      return runStatus(configPath);
    }

    case "migrate": {
      const sub = positionals[0] || "from-agent-connect";
      const force = Boolean(flags.all) || Boolean(flags.force);
      let result;
      if (sub === "from-lark-grok" || sub === "from-larkgrok") {
        result = migrateFromLarkGrok({ force });
      } else if (
        sub === "from-agent-connect" ||
        sub === "from-agentconnect" ||
        sub === "agent-connect"
      ) {
        result = migrateFromAgentConnect({ force });
      } else {
        console.error(`Unknown migrate target: ${sub}`);
        console.error(
          `Usage: ${CLI_NAME} migrate from-agent-connect | from-lark-grok`,
        );
        return 1;
      }
      console.log(result.message);
      if (result.copied.length) console.log("copied:", result.copied.join(", "));
      return result.ok ? 0 : 1;
    }

    case "smoke-grok": {
      const prompt = positionals.join(" ") || "Reply with exactly: pong";
      const { config } = loadConfig(configPath);
      const resolved = resolveProjectName(flagsProject, [], config);
      const project =
        ("name" in resolved ? getProject(config, resolved.name) : undefined) ||
        config.projects[0];
      const grokCfg = project?.grok || {
        ...DEFAULT_GROK_CONFIG(),
        max_turns: 3,
        timeout_ms: 120_000,
      };
      const binary = resolveGrokBinary(grokCfg.command);
      console.log(`grok binary: ${binary}`);
      console.log(`auth: ${grokAuthExists() ? "present" : "missing"}`);
      console.log(`prompt: ${prompt}`);
      try {
        const result = await runGrok({
          config: { ...grokCfg, max_turns: Math.min(grokCfg.max_turns, 5) },
          prompt,
        });
        console.log("--- stdout text ---");
        console.log(result.text || "(empty)");
        if (result.error) console.error("error:", result.error);
        if (result.sessionId) console.log("sessionId:", result.sessionId);
        console.log("exitCode:", result.exitCode);
        return result.text ? 0 : 1;
      } catch (e) {
        console.error(e instanceof Error ? e.message : e);
        return 1;
      }
    }

    case "start":
    case "run":
    case "serve": {
      // Background: re-spawn self without --daemon and exit parent
      if (flags.daemon && !flags["dry-run"]) {
        if (flags.force) {
          const stopped = await stopFromPidFile();
          if (stopped.pid) console.log(stopped.message);
        }
        const logFileFlag =
          typeof flags["log-file"] === "string" ? flags["log-file"] : undefined;
        const childArgv = rebuildStartArgv({
          flags,
          positionals,
          passthrough,
          configPath,
          flagsProject,
        });
        const d = await startDaemon({
          childArgv,
          logFile: logFileFlag,
          force: Boolean(flags.force),
        });
        console.log(d.message);
        if (d.logFile) console.log(`logs: ${d.logFile}`);
        if (d.pidPath) console.log(`pid:  ${d.pidPath}${d.pid ? ` (${d.pid})` : ""}`);
        if (d.ok) {
          console.log(`stop: ${CLI_NAME} stop`);
        }
        return d.ok ? 0 : 1;
      }

      const { path: cfgPath, config } = loadConfig(configPath);
      setLogLevel(config.log?.level || String(flags["log-level"] || "info"));
      const logFileFlag =
        typeof flags["log-file"] === "string" ? flags["log-file"] : undefined;
      if (!flags["dry-run"] || logFileFlag) {
        const lp = enableFileLog(logFileFlag);
        console.log(`Log file: ${lp}`);
      }

      const dryRun = Boolean(flags["dry-run"]);

      // Multi-project supervisor path
      if (flags.all || (config.projects.length > 1 && !flagsProject && !positionals.length)) {
        if (dryRun) {
          console.log(`Dry-run OK — would start ${config.projects.length} project(s) via Supervisor`);
          for (const p of config.projects) {
            console.log(`  - ${p.name} app=${p.feishu.app_id} work_dir=${p.grok.work_dir}`);
          }
          return 0;
        }
        if (flags.force) await stopFromPidFile();
        const lock = acquirePidLock({ force: Boolean(flags.force) });
        if (!lock.ok) {
          console.error(lock.error);
          return 1;
        }
        try {
          const supervisor = new Supervisor({ config });
          supervisor.installSignalHandlers();
          const result = await supervisor.start();
          console.log(
            `${CLI_NAME} running projects=[${result.started.join(", ")}]. Ctrl+C to stop.`,
          );
          if (result.failed.length) {
            console.warn("partial failures:", result.failed);
          }
          await new Promise<void>((resolve) => {
            const stop = async () => {
              console.log("\nShutting down...");
              await supervisor.stop();
              resolve();
            };
            process.once("SIGINT", () => void stop());
            process.once("SIGTERM", () => void stop());
          });
          return 0;
        } catch (e) {
          console.error(`Failed to start: ${e instanceof Error ? e.message : e}`);
          return 1;
        } finally {
          releasePidLock(undefined, process.pid);
        }
      }

      const resolved = resolveProjectName(flagsProject, positionals, config);
      if ("error" in resolved) {
        console.error(resolved.error);
        console.error(`Config path: ${cfgPath}`);
        return 1;
      }
      const projectName = resolved.name;

      const project = getProject(config, projectName);
      if (!project) {
        console.error(`Project not found: ${projectName}`);
        return 1;
      }

      if (project.grok.work_dir && !path.isAbsolute(project.grok.work_dir)) {
        project.grok.work_dir = path.resolve(project.grok.work_dir);
      }

      log.info("starting grok-remote-bridge", {
        version: VERSION,
        config: cfgPath,
        project: project.name,
        dryRun,
        logFile: getLogFilePath(),
      });

      if (!dryRun) {
        if (flags.force) await stopFromPidFile();
        const lock = acquirePidLock({ force: Boolean(flags.force) });
        if (!lock.ok) {
          console.error(lock.error);
          return 1;
        }
      }

      try {
        const started = await startBridge({ config, project, dryRun });
        if (dryRun) {
          console.log("Dry-run OK — bridge would start with:");
          console.log(`  project:  ${project.name}`);
          console.log(`  app_id:   ${project.feishu.app_id}`);
          console.log(`  platform: ${project.feishu.platform}`);
          console.log(`  work_dir: ${project.grok.work_dir}`);
          console.log(`  grok:     ${resolveGrokBinary(project.grok.command)}`);
          return 0;
        }

        console.log(
          `${CLI_NAME} running as ${started.botName || "bot"} (project=${project.name}). Ctrl+C to stop.`,
        );
        if (getLogFilePath()) {
          console.log(`Logs: ${getLogFilePath()}  (or --log-level debug for more detail)`);
        }

        await new Promise<void>((resolve) => {
          const stop = async () => {
            console.log("\nShutting down...");
            await started.stop();
            resolve();
          };
          process.once("SIGINT", () => void stop());
          process.once("SIGTERM", () => void stop());
        });
        return 0;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`Failed to start: ${msg}`);
        return 1;
      } finally {
        if (!dryRun) releasePidLock(undefined, process.pid);
      }
    }

    default:
      console.error(`Unknown command: ${command}\n`);
      printRootHelp();
      return 1;
  }
}

/** Rebuild argv for daemon child from parsed flags. */
export function rebuildStartArgv(opts: {
  flags: Record<string, string | boolean>;
  positionals: string[];
  passthrough: string[];
  configPath?: string;
  flagsProject?: string;
}): string[] {
  const out: string[] = ["start"];
  if (opts.flags.all) out.push("--all");
  if (opts.configPath) out.push("--config", opts.configPath);
  if (opts.flagsProject) out.push("--project", opts.flagsProject);
  if (opts.flags["log-level"]) out.push("--log-level", String(opts.flags["log-level"]));
  if (typeof opts.flags["log-file"] === "string") {
    out.push("--log-file", opts.flags["log-file"]);
  }
  if (opts.flags.force) out.push("--force");
  // single-project positional name when not using --project
  for (const p of opts.positionals) {
    if (p && !p.startsWith("-")) out.push(p);
  }
  out.push(...opts.passthrough);
  return out;
}

function runStatus(configPath?: string): number {
  const { path: cfgPath, config } = loadConfig(configPath);
  console.log(`${CLI_NAME} status`);
  console.log(`config: ${cfgPath}`);
  console.log(`projects: ${config.projects.length}`);
  for (const p of config.projects) {
    console.log(
      `  - ${p.name}: app_id=${p.feishu.app_id || "(none)"} work_dir=${p.grok.work_dir} backend=${p.grok.session_backend || "acp"}`,
    );
  }
  console.log(`default config path: ${defaultConfigPath()}`);
  console.log(`pid file: ${defaultPidPath()}`);
  console.log(`log file: ${defaultLogFilePath()}`);

  const running = getRunningInstance();
  if (running) {
    console.log(`process: running pid=${running.pid}`);
  } else {
    console.log(`process: not running`);
  }

  try {
    const svc = serviceStatus();
    console.log(`service: method=${svc.method} installed=${svc.installed ? "yes" : "no"} active=${svc.active ? "yes" : "no"}`);
  } catch {
    console.log(`service: (unavailable)`);
  }
  return 0;
}
