/**
 * Cross-platform service install / uninstall / start / stop / status.
 * Prefer user-level units (no root): launchd LaunchAgent, systemd --user, WinSW/schtasks.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCliInvocation, type CliInvocation } from "./resolve-exec.js";
import {
  LAUNCHD_LABEL,
  SYSTEMD_UNIT_NAME,
  WINDOWS_SERVICE_ID,
  WINDOWS_TASK_NAME,
  defaultLaunchAgentsPath,
  defaultSystemdUserUnitPath,
  renderLaunchdPlist,
  renderSystemdUserUnit,
  renderWindowsSchtasksPs1,
  renderWinswXml,
  type TemplateContext,
} from "./templates.js";
import { ensureDir, serviceDir, defaultDataDir } from "../util/paths.js";
import { getRunningInstance } from "../runtime/pid.js";

export type ServicePlatform = "darwin" | "linux" | "win32" | "other";
export type WindowsBackend = "winsw" | "schtasks";

export interface ServiceActionResult {
  ok: boolean;
  code: number;
  message: string;
  details?: string[];
}

export interface ServiceStatus {
  platform: ServicePlatform;
  installed: boolean;
  active: boolean;
  method: string;
  paths: string[];
  process?: { pid: number };
  hints: string[];
}

function platform(): ServicePlatform {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  if (process.platform === "win32") return "win32";
  return "other";
}

function homeDir(): string {
  return os.homedir();
}

function ctx(inv?: CliInvocation): TemplateContext {
  return {
    inv: inv || resolveCliInvocation(),
    home: homeDir(),
  };
}

function run(
  cmd: string,
  args: string[],
  opts?: { allowFail?: boolean },
): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    env: process.env,
  });
  const status = r.status;
  const ok = status === 0;
  if (!ok && !opts?.allowFail) {
    /* caller handles */
  }
  return {
    ok,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
    status,
  };
}

// ─── install ───────────────────────────────────────────────────────────────

export function installService(opts?: {
  windowsBackend?: WindowsBackend;
  printOnly?: boolean;
}): ServiceActionResult {
  const p = platform();
  const c = ctx();
  const details: string[] = [];

  if (opts?.printOnly) {
    return printServiceArtifacts(p, c);
  }

  if (p === "darwin") return installLaunchd(c, details);
  if (p === "linux") return installSystemdUser(c, details);
  if (p === "win32") {
    const backend = opts?.windowsBackend || "winsw";
    return backend === "schtasks" ? installSchtasks(c, details) : installWinswFiles(c, details);
  }
  return {
    ok: false,
    code: 1,
    message: `unsupported platform: ${process.platform}. Use start --daemon or see INSTALL.md`,
  };
}

function printServiceArtifacts(p: ServicePlatform, c: TemplateContext): ServiceActionResult {
  const details: string[] = [];
  if (p === "darwin" || p === "other") {
    details.push("=== launchd plist ===", renderLaunchdPlist(c));
  }
  if (p === "linux" || p === "other") {
    details.push("=== systemd user unit ===", renderSystemdUserUnit(c));
  }
  if (p === "win32" || p === "other") {
    details.push("=== WinSW XML ===", renderWinswXml(c));
    details.push("=== schtasks PowerShell ===", renderWindowsSchtasksPs1(c));
  }
  // Always write copies under ~/.agent-connect/service for inspection
  writeGeneratedFiles(c);
  return {
    ok: true,
    code: 0,
    message: "printed service definitions (also written under ~/.agent-connect/service/)",
    details,
  };
}

function writeGeneratedFiles(c: TemplateContext): string[] {
  const dir = serviceDir();
  ensureDir(dir);
  const written: string[] = [];
  const files: [string, string][] = [
    ["agent-connect.service", renderSystemdUserUnit(c)],
    [`${LAUNCHD_LABEL}.plist`, renderLaunchdPlist(c)],
    ["agent-connect-service.xml", renderWinswXml(c)],
    ["register-schtasks.ps1", renderWindowsSchtasksPs1(c)],
  ];
  for (const [name, body] of files) {
    const fp = path.join(dir, name);
    fs.writeFileSync(fp, body, "utf8");
    written.push(fp);
  }
  return written;
}

function installLaunchd(c: TemplateContext, details: string[]): ServiceActionResult {
  const dest = defaultLaunchAgentsPath(c.home);
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, renderLaunchdPlist(c), "utf8");
  details.push(`wrote ${dest}`);
  writeGeneratedFiles(c);

  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const domain = uid != null ? `gui/${uid}` : "gui/501";

  // bootout old (ignore errors), then bootstrap
  run("launchctl", ["bootout", `${domain}/${LAUNCHD_LABEL}`], { allowFail: true });
  const boot = run("launchctl", ["bootstrap", domain, dest], { allowFail: true });
  if (!boot.ok) {
    // fallback older macOS
    const load = run("launchctl", ["load", "-w", dest], { allowFail: true });
    if (!load.ok) {
      return {
        ok: false,
        code: 1,
        message: `wrote plist but failed to load: ${boot.stderr || load.stderr || "launchctl error"}`,
        details,
      };
    }
    details.push("launchctl load -w ok (legacy)");
  } else {
    details.push(`launchctl bootstrap ${domain} ok`);
    run("launchctl", ["enable", `${domain}/${LAUNCHD_LABEL}`], { allowFail: true });
    run("launchctl", ["kickstart", "-k", `${domain}/${LAUNCHD_LABEL}`], { allowFail: true });
  }

  return {
    ok: true,
    code: 0,
    message: `LaunchAgent installed: ${LAUNCHD_LABEL}`,
    details,
  };
}

function installSystemdUser(c: TemplateContext, details: string[]): ServiceActionResult {
  const dest = defaultSystemdUserUnitPath(c.home);
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, renderSystemdUserUnit(c), "utf8");
  details.push(`wrote ${dest}`);
  writeGeneratedFiles(c);

  const reload = run("systemctl", ["--user", "daemon-reload"], { allowFail: true });
  if (!reload.ok) {
    return {
      ok: false,
      code: 1,
      message: `wrote unit but systemctl --user failed: ${reload.stderr || "is systemd user session available?"}`,
      details: [
        ...details,
        "Tip: loginctl enable-linger $USER  # optional, keep user services after logout",
        `Manual: systemctl --user enable --now ${SYSTEMD_UNIT_NAME}`,
      ],
    };
  }
  const en = run("systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT_NAME], { allowFail: true });
  if (!en.ok) {
    return {
      ok: false,
      code: 1,
      message: `enable/start failed: ${en.stderr || en.stdout}`,
      details,
    };
  }
  details.push("systemctl --user enable --now ok");
  return {
    ok: true,
    code: 0,
    message: `systemd user unit installed: ${SYSTEMD_UNIT_NAME}`,
    details,
  };
}

function installWinswFiles(c: TemplateContext, details: string[]): ServiceActionResult {
  const dir = serviceDir();
  ensureDir(dir);
  const xmlPath = path.join(dir, "agent-connect-service.xml");
  fs.writeFileSync(xmlPath, renderWinswXml(c), "utf8");
  writeGeneratedFiles(c);
  details.push(`wrote ${xmlPath}`);
  details.push(
    "Next (admin PowerShell):",
    "  1. Download WinSW: https://github.com/winsw/winsw/releases",
    `  2. Copy WinSW.exe → ${path.join(dir, "agent-connect-service.exe")}`,
    `  3. cd ${dir}`,
    "  4. .\\agent-connect-service.exe install",
    "  5. .\\agent-connect-service.exe start",
    "Or: agent-connect service install --backend schtasks  (no admin / no WinSW)",
  );
  return {
    ok: true,
    code: 0,
    message: "WinSW service definition generated (manual install step required on Windows)",
    details,
  };
}

function installSchtasks(c: TemplateContext, details: string[]): ServiceActionResult {
  const dir = serviceDir();
  ensureDir(dir);
  const ps1 = path.join(dir, "register-schtasks.ps1");
  fs.writeFileSync(ps1, renderWindowsSchtasksPs1(c), "utf8");
  writeGeneratedFiles(c);
  details.push(`wrote ${ps1}`);

  const r = run(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1],
    { allowFail: true },
  );
  if (!r.ok) {
    return {
      ok: false,
      code: 1,
      message: `schtasks register failed: ${r.stderr || r.stdout}`,
      details: [...details, `Run manually: powershell -File ${ps1}`],
    };
  }
  details.push(r.stdout || "scheduled task registered");
  return {
    ok: true,
    code: 0,
    message: `Scheduled Task installed: ${WINDOWS_TASK_NAME}`,
    details,
  };
}

// ─── uninstall ─────────────────────────────────────────────────────────────

export function uninstallService(opts?: { windowsBackend?: WindowsBackend }): ServiceActionResult {
  const p = platform();
  const details: string[] = [];
  if (p === "darwin") {
    const dest = defaultLaunchAgentsPath(homeDir());
    const uid = typeof process.getuid === "function" ? process.getuid() : 501;
    run("launchctl", ["bootout", `gui/${uid}/${LAUNCHD_LABEL}`], { allowFail: true });
    run("launchctl", ["unload", "-w", dest], { allowFail: true });
    if (fs.existsSync(dest)) {
      fs.unlinkSync(dest);
      details.push(`removed ${dest}`);
    }
    return { ok: true, code: 0, message: "LaunchAgent removed", details };
  }
  if (p === "linux") {
    run("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT_NAME], { allowFail: true });
    const dest = defaultSystemdUserUnitPath(homeDir());
    if (fs.existsSync(dest)) {
      fs.unlinkSync(dest);
      details.push(`removed ${dest}`);
    }
    run("systemctl", ["--user", "daemon-reload"], { allowFail: true });
    return { ok: true, code: 0, message: "systemd user unit removed", details };
  }
  if (p === "win32") {
    const backend = opts?.windowsBackend || "winsw";
    if (backend === "schtasks") {
      run("schtasks", ["/Delete", "/TN", WINDOWS_TASK_NAME, "/F"], { allowFail: true });
      return { ok: true, code: 0, message: `Scheduled Task ${WINDOWS_TASK_NAME} deleted`, details };
    }
    const exe = path.join(serviceDir(), "agent-connect-service.exe");
    if (fs.existsSync(exe)) {
      run(exe, ["stop"], { allowFail: true });
      run(exe, ["uninstall"], { allowFail: true });
      details.push("WinSW uninstall attempted");
    }
    details.push("If service remains: sc delete agent-connect (admin)");
    return { ok: true, code: 0, message: "Windows service uninstall attempted", details };
  }
  return { ok: false, code: 1, message: `unsupported platform: ${process.platform}` };
}

// ─── start / stop via service manager ──────────────────────────────────────

export function startService(): ServiceActionResult {
  const p = platform();
  if (p === "darwin") {
    const uid = typeof process.getuid === "function" ? process.getuid() : 501;
    const domain = `gui/${uid}`;
    const dest = defaultLaunchAgentsPath(homeDir());
    run("launchctl", ["enable", `${domain}/${LAUNCHD_LABEL}`], { allowFail: true });
    const printed = run("launchctl", ["print", `${domain}/${LAUNCHD_LABEL}`], { allowFail: true });
    if (!printed.ok && fs.existsSync(dest)) {
      run("launchctl", ["bootstrap", domain, dest], { allowFail: true });
    }
    const r = run("launchctl", ["kickstart", "-k", `${domain}/${LAUNCHD_LABEL}`], {
      allowFail: true,
    });
    if (!r.ok) {
      return { ok: false, code: 1, message: r.stderr || r.stdout || "launchctl kickstart failed" };
    }
    return { ok: true, code: 0, message: "launchctl kickstart ok" };
  }
  if (p === "linux") {
    const r = run("systemctl", ["--user", "start", SYSTEMD_UNIT_NAME], { allowFail: true });
    if (!r.ok) return { ok: false, code: 1, message: r.stderr || r.stdout || "systemctl start failed" };
    return { ok: true, code: 0, message: "systemctl --user start ok" };
  }
  if (p === "win32") {
    const exe = path.join(serviceDir(), "agent-connect-service.exe");
    if (fs.existsSync(exe)) {
      const r = run(exe, ["start"], { allowFail: true });
      if (r.ok) return { ok: true, code: 0, message: "WinSW start ok" };
    }
    const t = run("powershell", [
      "-NoProfile",
      "-Command",
      `Start-ScheduledTask -TaskName '${WINDOWS_TASK_NAME}'`,
    ], { allowFail: true });
    if (t.ok) return { ok: true, code: 0, message: "Scheduled Task started" };
    return {
      ok: false,
      code: 1,
      message: "no WinSW service or Scheduled Task found — run: agent-connect service install",
    };
  }
  return { ok: false, code: 1, message: "unsupported platform" };
}

export function stopService(): ServiceActionResult {
  const p = platform();
  if (p === "darwin") {
    const uid = typeof process.getuid === "function" ? process.getuid() : 501;
    // Prefer kill via bootout of process; launchctl kill SIGTERM
    run("launchctl", ["kill", "SIGTERM", `gui/${uid}/${LAUNCHD_LABEL}`], { allowFail: true });
    // Keep unit installed but not running: bootout then leave plist
    const r = run("launchctl", ["bootout", `gui/${uid}/${LAUNCHD_LABEL}`], { allowFail: true });
    // re-bootstrap without kickstart so RunAtLoad next login still works? 
    // Actually bootout unloads; user may want just stop. Use:
    // launchctl stop is deprecated. For KeepAlive true, need disable.
    run("launchctl", ["disable", `gui/${uid}/${LAUNCHD_LABEL}`], { allowFail: true });
    return {
      ok: true,
      code: 0,
      message: "LaunchAgent stopped/disabled (re-enable: agent-connect service start)",
      details: r.stderr ? [r.stderr] : undefined,
    };
  }
  if (p === "linux") {
    const r = run("systemctl", ["--user", "stop", SYSTEMD_UNIT_NAME], { allowFail: true });
    if (!r.ok) return { ok: false, code: 1, message: r.stderr || r.stdout || "systemctl stop failed" };
    return { ok: true, code: 0, message: "systemctl --user stop ok" };
  }
  if (p === "win32") {
    const exe = path.join(serviceDir(), "agent-connect-service.exe");
    if (fs.existsSync(exe)) {
      run(exe, ["stop"], { allowFail: true });
    }
    run("powershell", [
      "-NoProfile",
      "-Command",
      `Stop-ScheduledTask -TaskName '${WINDOWS_TASK_NAME}' -ErrorAction SilentlyContinue`,
    ], { allowFail: true });
    return { ok: true, code: 0, message: "Windows service/task stop attempted (also try: agent-connect stop)" };
  }
  return { ok: false, code: 1, message: "unsupported platform" };
}

export function serviceStatus(): ServiceStatus {
  const p = platform();
  const hints: string[] = [];
  const paths: string[] = [];
  let installed = false;
  let active = false;
  let method = "none";
  const proc = getRunningInstance();

  if (p === "darwin") {
    method = "launchd LaunchAgent";
    const dest = defaultLaunchAgentsPath(homeDir());
    paths.push(dest);
    installed = fs.existsSync(dest);
    const uid = typeof process.getuid === "function" ? process.getuid() : 501;
    const r = run("launchctl", ["print", `gui/${uid}/${LAUNCHD_LABEL}`], { allowFail: true });
    active = r.ok && /state\s*=\s*running/i.test(r.stdout + r.stderr);
    if (!active && proc) active = true;
    if (!installed) hints.push("agent-connect service install");
  } else if (p === "linux") {
    method = "systemd --user";
    const dest = defaultSystemdUserUnitPath(homeDir());
    paths.push(dest);
    installed = fs.existsSync(dest);
    const r = run("systemctl", ["--user", "is-active", SYSTEMD_UNIT_NAME], { allowFail: true });
    active = r.stdout.trim() === "active";
    if (!active && proc) active = true;
    if (!installed) hints.push("agent-connect service install");
    hints.push("optional linger: loginctl enable-linger $USER");
  } else if (p === "win32") {
    method = "WinSW / Scheduled Task";
    const xml = path.join(serviceDir(), "agent-connect-service.xml");
    paths.push(xml);
    installed = fs.existsSync(xml);
    const sc = run("sc", ["query", WINDOWS_SERVICE_ID], { allowFail: true });
    if (sc.ok && /RUNNING/i.test(sc.stdout)) {
      active = true;
      installed = true;
    }
    const st = run("schtasks", ["/Query", "/TN", WINDOWS_TASK_NAME], { allowFail: true });
    if (st.ok) installed = true;
    if (proc) active = true;
    if (!installed) hints.push("agent-connect service install  # or --backend schtasks");
  } else {
    method = "unsupported";
    hints.push("use: agent-connect start --daemon");
  }

  if (proc) {
    return {
      platform: p,
      installed,
      active: true,
      method,
      paths,
      process: { pid: proc.pid },
      hints,
    };
  }

  return { platform: p, installed, active, method, paths, hints };
}

/** Resolve install target paths for docs/tests */
export function servicePathsForPlatform(_plat: ServicePlatform = platform()): Record<string, string> {
  const home = homeDir();
  return {
    dataDir: defaultDataDir(),
    serviceDir: serviceDir(),
    launchd: defaultLaunchAgentsPath(home),
    systemdUser: defaultSystemdUserUnitPath(home),
    winswXml: path.join(serviceDir(), "agent-connect-service.xml"),
  };
}
