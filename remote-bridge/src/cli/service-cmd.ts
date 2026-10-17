/**
 * CLI: agent-connect service <install|uninstall|start|stop|status|print>
 */
import {
  installService,
  uninstallService,
  startService,
  stopService,
  serviceStatus,
} from "../service/manager.js";
import type { WindowsBackend } from "../service/manager.js";
import { CLI_NAME } from "../util/paths.js";
import { resolveCliInvocation, serviceStartDisplay } from "../service/resolve-exec.js";

export function printServiceUsage(): void {
  console.log(`${CLI_NAME} service — install OS-level auto-start (user scope)

Usage:
  agent-connect service install [--backend winsw|schtasks]
  agent-connect service uninstall [--backend winsw|schtasks]
  agent-connect service start
  agent-connect service stop
  agent-connect service status
  agent-connect service print     # print unit/plist/xml without installing

Platform defaults:
  macOS   LaunchAgent  ~/Library/LaunchAgents/com.agent-connect.bridge.plist
  Linux   systemd --user  ~/.config/systemd/user/agent-connect.service
  Windows WinSW XML under ~/.agent-connect/service/  (or --backend schtasks)

Also useful without a system service:
  agent-connect start --daemon
  agent-connect stop
  agent-connect status

See INSTALL.md for full platform notes.
`);
}

export async function runServiceCommand(argv: string[]): Promise<number> {
  const sub = (argv[0] || "status").toLowerCase();
  if (sub === "help" || sub === "-h" || sub === "--help") {
    printServiceUsage();
    return 0;
  }

  let backend: WindowsBackend = "winsw";
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--backend" && rest[i + 1]) {
      const b = rest[i + 1]!.toLowerCase();
      if (b === "schtasks" || b === "winsw") backend = b;
      i++;
    }
  }

  switch (sub) {
    case "install": {
      const r = installService({ windowsBackend: backend });
      printResult(r);
      return r.code;
    }
    case "uninstall":
    case "remove": {
      const r = uninstallService({ windowsBackend: backend });
      printResult(r);
      return r.code;
    }
    case "start": {
      const r = startService();
      printResult(r);
      return r.code;
    }
    case "stop": {
      const r = stopService();
      printResult(r);
      return r.code;
    }
    case "status": {
      const s = serviceStatus();
      console.log(`${CLI_NAME} service status`);
      console.log(`platform:  ${s.platform}`);
      console.log(`method:    ${s.method}`);
      console.log(`installed: ${s.installed ? "yes" : "no"}`);
      console.log(`active:    ${s.active ? "yes" : "no"}`);
      if (s.process) console.log(`process:   pid=${s.process.pid}`);
      for (const p of s.paths) console.log(`path:      ${p}`);
      const inv = resolveCliInvocation();
      console.log(`exec:      ${serviceStartDisplay(inv)}`);
      for (const h of s.hints) console.log(`hint:      ${h}`);
      return 0;
    }
    case "print":
    case "show": {
      const r = installService({ printOnly: true });
      if (r.details?.length) {
        for (const line of r.details) console.log(line);
      }
      console.log(r.message);
      return r.code;
    }
    default:
      console.error(`Unknown service subcommand: ${sub}\n`);
      printServiceUsage();
      return 1;
  }
}

function printResult(r: { ok: boolean; message: string; details?: string[] }): void {
  console.log(r.message);
  if (r.details?.length) {
    for (const d of r.details) console.log(d);
  }
}
