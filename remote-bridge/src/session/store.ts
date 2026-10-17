import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir, sessionsDir } from "../util/paths.js";

export interface ChatSession {
  /** Scope key: project:chatType:chatId:senderId */
  scopeKey: string;
  sessionId: string;
  workDir: string;
  updatedAt: string;
  /**
   * True after at least one successful Grok turn for this sessionId.
   * Persisted so restarts use --resume instead of --session-id.
   */
  warmed: boolean;
}

export interface SessionStateFile {
  v: 2;
  sessions: Record<string, ChatSession>;
}

/**
 * Build isolation key for a chat turn.
 * Pure function — unit tested.
 */
export function buildScopeKey(parts: {
  project: string;
  chatType: string;
  chatId: string;
  senderId: string;
  /** When true, all users in a group share one session */
  shareInGroup?: boolean;
}): string {
  const project = parts.project || "default";
  const chatType = parts.chatType || "p2p";
  const chatId = parts.chatId || "unknown";
  if (chatType === "group" && parts.shareInGroup) {
    return `${project}:group:${chatId}:shared`;
  }
  const sender = parts.senderId || "unknown";
  return `${project}:${chatType}:${chatId}:${sender}`;
}

/** Deterministic UUID from scope (stable across restarts until reset). */
export function deterministicSessionId(scopeKey: string): string {
  const hash = crypto.createHash("sha256").update(`lark-grok:${scopeKey}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newSessionId(): string {
  return crypto.randomUUID();
}

function normalizeSession(raw: Partial<ChatSession> & { scopeKey: string }): ChatSession {
  return {
    scopeKey: raw.scopeKey,
    sessionId: raw.sessionId || deterministicSessionId(raw.scopeKey),
    workDir: raw.workDir || process.cwd(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
    warmed: Boolean(raw.warmed),
  };
}

export class SessionStore {
  private filePath: string;
  private state: SessionStateFile;

  constructor(dataDir?: string) {
    const dir = sessionsDir(dataDir);
    ensureDir(dir);
    this.filePath = path.join(dir, "chat-sessions.json");
    this.state = this.load();
  }

  /** Absolute path to the sessions JSON (for tests). */
  get path(): string {
    return this.filePath;
  }

  private load(): SessionStateFile {
    try {
      if (!fs.existsSync(this.filePath)) return { v: 2, sessions: {} };
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as {
        v?: number;
        sessions?: Record<string, Partial<ChatSession>>;
      };
      const sessions: Record<string, ChatSession> = {};
      if (raw.sessions && typeof raw.sessions === "object") {
        for (const [k, v] of Object.entries(raw.sessions)) {
          if (!v || typeof v !== "object") continue;
          sessions[k] = normalizeSession({
            scopeKey: (v.scopeKey as string) || k,
            sessionId: v.sessionId as string | undefined,
            workDir: v.workDir as string | undefined,
            updatedAt: v.updatedAt as string | undefined,
            // v1 files had no warmed; treat missing as false (safe: may re-create once)
            warmed: Boolean(v.warmed),
          });
        }
      }
      return { v: 2, sessions };
    } catch {
      return { v: 2, sessions: {} };
    }
  }

  private save(): void {
    ensureDir(path.dirname(this.filePath));
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  getOrCreate(scopeKey: string, workDir: string): ChatSession {
    const existing = this.state.sessions[scopeKey];
    if (existing) {
      existing.updatedAt = new Date().toISOString();
      // Keep workDir bound via /p; only fill default when empty
      if (!existing.workDir) existing.workDir = workDir;
      // ensure warmed field exists after migration
      if (typeof existing.warmed !== "boolean") existing.warmed = false;
      this.save();
      return existing;
    }
    const session: ChatSession = {
      scopeKey,
      sessionId: deterministicSessionId(scopeKey),
      workDir,
      updatedAt: new Date().toISOString(),
      warmed: false,
    };
    this.state.sessions[scopeKey] = session;
    this.save();
    return session;
  }

  /** Rotate to a fresh session id (for /new). Clears warmed. */
  reset(scopeKey: string, workDir: string): ChatSession {
    const session: ChatSession = {
      scopeKey,
      sessionId: newSessionId(),
      workDir,
      updatedAt: new Date().toISOString(),
      warmed: false,
    };
    this.state.sessions[scopeKey] = session;
    this.save();
    return session;
  }

  /** Bind project path and start a new agent session (mode=new). */
  bindProject(scopeKey: string, workDir: string): ChatSession {
    return this.reset(scopeKey, workDir);
  }

  /** Resume a prior agent session id (mode=resume). */
  resumeSession(
    scopeKey: string,
    sessionId: string,
    workDir: string,
  ): ChatSession {
    const session: ChatSession = {
      scopeKey,
      sessionId,
      workDir,
      updatedAt: new Date().toISOString(),
      warmed: true,
    };
    this.state.sessions[scopeKey] = session;
    this.save();
    return session;
  }

  /** All sessions, newest first. */
  listAll(): ChatSession[] {
    return Object.values(this.state.sessions).sort((a, b) =>
      (b.updatedAt || "").localeCompare(a.updatedAt || ""),
    );
  }

  /** Sessions under a workDir, newest first. */
  listByWorkDir(workDir: string): ChatSession[] {
    const w = workDir.replace(/\/+$/, "");
    return this.listAll().filter(
      (s) => (s.workDir || "").replace(/\/+$/, "") === w,
    );
  }

  get(scopeKey: string): ChatSession | undefined {
    return this.state.sessions[scopeKey];
  }

  /**
   * Mark session as having completed ≥1 Grok turn (persisted).
   * Subsequent turns should use --resume.
   */
  markWarmed(scopeKey: string, sessionId?: string): ChatSession | undefined {
    const s = this.state.sessions[scopeKey];
    if (!s) return undefined;
    if (sessionId) s.sessionId = sessionId;
    s.warmed = true;
    s.updatedAt = new Date().toISOString();
    this.save();
    return s;
  }

  /** Whether Grok should --resume this session id (persisted). */
  isWarmed(scopeKey: string): boolean {
    return Boolean(this.state.sessions[scopeKey]?.warmed);
  }
}

/**
 * Allowlist check: allow_from is "*" or comma-separated open_ids.
 * Pure function.
 */
export function isSenderAllowed(allowFrom: string | undefined, senderId: string): boolean {
  const raw = (allowFrom || "*").trim();
  if (!raw || raw === "*") return true;
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.includes(senderId);
}
