/**
 * Migrate legacy bridge data into Grok App in-app remote-bridge home.
 * Sources: ~/.lark-grok, ~/.agent-connect → ~/.grok-app/remote/bridge-data
 * (Import config only — never spawn external agent-connect.)
 */

import fs from "node:fs";
import path from "node:path";
import {
  defaultDataDir,
  legacyDataDir,
  agentConnectDataDir,
  ensureDir,
} from "../util/paths.js";

export interface MigrateResult {
  ok: boolean;
  from: string;
  to: string;
  copied: string[];
  message: string;
}

function copyDir(src: string, dest: string): void {
  ensureDir(dest);
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function migrateFrom(from: string, to: string, force?: boolean): MigrateResult {
  const copied: string[] = [];

  if (!fs.existsSync(from)) {
    return {
      ok: false,
      from,
      to,
      copied,
      message: `Legacy dir not found: ${from}`,
    };
  }

  ensureDir(to);
  const entries = ["config.toml", "sessions", "logs", "data"];
  for (const name of entries) {
    const src = path.join(from, name);
    if (!fs.existsSync(src)) continue;
    let dest: string;
    if (name === "sessions") {
      dest = path.join(to, "data", "sessions");
    } else {
      dest = path.join(to, name);
    }
    if (fs.existsSync(dest) && !force) {
      continue;
    }
    ensureDir(path.dirname(dest));
    const st = fs.statSync(src);
    if (st.isDirectory()) {
      copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
    copied.push(name);
  }

  return {
    ok: true,
    from,
    to,
    copied,
    message:
      copied.length > 0
        ? `Migrated ${copied.length} item(s) → ${to}`
        : `Nothing new to copy (use --force to overwrite). From=${from}`,
  };
}

export function migrateFromLarkGrok(opts?: {
  from?: string;
  to?: string;
  force?: boolean;
}): MigrateResult {
  return migrateFrom(
    opts?.from || legacyDataDir(),
    opts?.to || defaultDataDir(),
    opts?.force,
  );
}

/** Import external agent-connect config into in-app bridge-data (no process spawn). */
export function migrateFromAgentConnect(opts?: {
  from?: string;
  to?: string;
  force?: boolean;
}): MigrateResult {
  return migrateFrom(
    opts?.from || agentConnectDataDir(),
    opts?.to || defaultDataDir(),
    opts?.force,
  );
}
