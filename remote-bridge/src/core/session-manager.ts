/**
 * Per-project session manager: busy lock + disk persistence.
 * Never share one SessionManager across projects.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../util/paths.js";

export interface LocalSession {
  id: string;
  agentSessionId: string;
  agentType: string;
  lastUserActivity: number;
  updatedAt: number;
  warmed: boolean;
  workDir: string;
  history?: string[];
}

export interface SessionFileState {
  v: 1;
  projectId: string;
  sessions: Record<string, LocalSession>;
}

export interface SessionManagerOptions {
  projectId: string;
  /** Absolute path to sessions JSON file */
  filePath: string;
  agentType?: string;
}

function newAgentSessionId(): string {
  return crypto.randomUUID();
}

function deterministicAgentSessionId(projectId: string, sessionKey: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`agent-connect:${projectId}:${sessionKey}`)
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class SessionManager {
  readonly projectId: string;
  readonly filePath: string;
  private agentType: string;
  private state: SessionFileState;
  /** In-memory busy locks keyed by sessionKey */
  private locks = new Map<string, { held: boolean; waiters: Array<() => void> }>();

  constructor(opts: SessionManagerOptions) {
    this.projectId = opts.projectId;
    this.filePath = opts.filePath;
    this.agentType = opts.agentType || "grok";
    ensureDir(path.dirname(this.filePath));
    this.state = this.load();
  }

  private load(): SessionFileState {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { v: 1, projectId: this.projectId, sessions: {} };
      }
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as SessionFileState;
      if (!raw.sessions || typeof raw.sessions !== "object") {
        return { v: 1, projectId: this.projectId, sessions: {} };
      }
      return {
        v: 1,
        projectId: this.projectId,
        sessions: raw.sessions,
      };
    } catch {
      return { v: 1, projectId: this.projectId, sessions: {} };
    }
  }

  private save(): void {
    ensureDir(path.dirname(this.filePath));
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  get(sessionKey: string): LocalSession | undefined {
    return this.state.sessions[sessionKey];
  }

  getOrCreate(sessionKey: string, workDir: string): LocalSession {
    const existing = this.state.sessions[sessionKey];
    if (existing) {
      existing.workDir = workDir;
      existing.updatedAt = Date.now();
      this.save();
      return existing;
    }
    const now = Date.now();
    const session: LocalSession = {
      id: sessionKey,
      agentSessionId: deterministicAgentSessionId(this.projectId, sessionKey),
      agentType: this.agentType,
      lastUserActivity: now,
      updatedAt: now,
      warmed: false,
      workDir,
    };
    this.state.sessions[sessionKey] = session;
    this.save();
    return session;
  }

  /** /new — rotate agent session id */
  reset(sessionKey: string, workDir: string): LocalSession {
    const now = Date.now();
    const session: LocalSession = {
      id: sessionKey,
      agentSessionId: newAgentSessionId(),
      agentType: this.agentType,
      lastUserActivity: now,
      updatedAt: now,
      warmed: false,
      workDir,
    };
    this.state.sessions[sessionKey] = session;
    this.save();
    return session;
  }

  markWarmed(sessionKey: string, agentSessionId?: string): void {
    const s = this.state.sessions[sessionKey];
    if (!s) return;
    s.warmed = true;
    if (agentSessionId) s.agentSessionId = agentSessionId;
    s.updatedAt = Date.now();
    this.save();
  }

  /** Only call on real user messages (not stream patches). */
  touchUserActivity(sessionKey: string): void {
    const s = this.state.sessions[sessionKey];
    if (!s) return;
    s.lastUserActivity = Date.now();
    s.updatedAt = s.lastUserActivity;
    this.save();
  }

  count(): number {
    return Object.keys(this.state.sessions).length;
  }

  listKeys(): string[] {
    return Object.keys(this.state.sessions);
  }

  /**
   * TryLock: if free, hold and return release().
   * If busy, return null (caller sends busy notice).
   */
  tryLock(sessionKey: string): (() => void) | null {
    let entry = this.locks.get(sessionKey);
    if (!entry) {
      entry = { held: false, waiters: [] };
      this.locks.set(sessionKey, entry);
    }
    if (entry.held) return null;
    entry.held = true;
    return () => {
      entry!.held = false;
      const next = entry!.waiters.shift();
      if (next) next();
      else if (entry!.waiters.length === 0 && !entry!.held) {
        this.locks.delete(sessionKey);
      }
    };
  }

  isBusy(sessionKey: string): boolean {
    return Boolean(this.locks.get(sessionKey)?.held);
  }

  busyKeys(): string[] {
    return [...this.locks.entries()].filter(([, v]) => v.held).map(([k]) => k);
  }

  async dispose(): Promise<void> {
    this.locks.clear();
  }
}

/**
 * Session file path per architecture:
 * ~/.agent-connect/data/sessions/{project}__{workdirHash}.json
 */
export function sessionFilePath(
  dataDir: string,
  projectId: string,
  workDir: string,
): string {
  const hash = crypto
    .createHash("sha256")
    .update(path.resolve(workDir))
    .digest("hex")
    .slice(0, 12);
  const safeProject = projectId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return path.join(dataDir, "data", "sessions", `${safeProject}__${hash}.json`);
}

export function mediaStageDir(dataDir: string, projectId: string): string {
  const safeProject = projectId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return path.join(dataDir, "data", "projects", safeProject, "media-stage");
}
