/**
 * External store for the focused session snapshot + liveHost projection.
 *
 * Structural meta (sessionId / state / agentSessionId) drives shell re-renders;
 * full snapshot subscribers (composer gates, etc.) opt in explicitly.
 */

import { IDLE_SNAPSHOT, type SessionSnapshot } from "@/lib/session";

export type SessionShellMeta = {
  sessionId: string | null;
  state: SessionSnapshot["state"];
  agentSessionId: string | null;
  title: string | null;
  /** Error code key (not full message) for structural shell chips. */
  lastErrorCode: string | null;
  /** Bumps when any structural field above changes. */
  rev: number;
};

type Listener = () => void;
type SessionReducer = (prev: SessionSnapshot) => SessionSnapshot;

function metaFrom(
  s: SessionSnapshot,
  rev: number,
): SessionShellMeta {
  return {
    sessionId: s.sessionId,
    state: s.state,
    agentSessionId: s.agentSessionId ?? null,
    title: s.title ?? null,
    lastErrorCode: s.lastError?.code ?? null,
    rev,
  };
}

function structuralEqual(
  a: SessionShellMeta,
  b: Omit<SessionShellMeta, "rev">,
): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.state === b.state &&
    a.agentSessionId === b.agentSessionId &&
    a.title === b.title &&
    a.lastErrorCode === b.lastErrorCode
  );
}

function shallowSessionEqual(a: SessionSnapshot, b: SessionSnapshot): boolean {
  // streamingMessageId churns once per turn start and is not needed for shell
  // chrome — excluding it avoids a full workbench re-render mid-stream.
  return (
    a.sessionId === b.sessionId &&
    a.state === b.state &&
    a.agentSessionId === b.agentSessionId &&
    a.title === b.title &&
    a.lastError?.code === b.lastError?.code &&
    a.lastError?.message === b.lastError?.message &&
    a.backend === b.backend &&
    a.modelId === b.modelId &&
    a.projectPath === b.projectPath
  );
}

class SessionShellStore {
  private session: SessionSnapshot = { ...IDLE_SNAPSHOT };
  private liveHost: SessionSnapshot = { ...IDLE_SNAPSHOT };
  private meta: SessionShellMeta = metaFrom(IDLE_SNAPSHOT, 0);
  private sessionListeners = new Set<Listener>();
  private liveHostListeners = new Set<Listener>();
  private metaListeners = new Set<Listener>();

  subscribeSession = (l: Listener): (() => void) => {
    this.sessionListeners.add(l);
    return () => this.sessionListeners.delete(l);
  };
  getSessionSnapshot = (): SessionSnapshot => this.session;

  subscribeLiveHost = (l: Listener): (() => void) => {
    this.liveHostListeners.add(l);
    return () => this.liveHostListeners.delete(l);
  };
  getLiveHostSnapshot = (): SessionSnapshot => this.liveHost;

  subscribeMeta = (l: Listener): (() => void) => {
    this.metaListeners.add(l);
    return () => this.metaListeners.delete(l);
  };
  getMetaSnapshot = (): SessionShellMeta => this.meta;

  getSession(): SessionSnapshot {
    return this.session;
  }

  getLiveHost(): SessionSnapshot {
    return this.liveHost;
  }

  private notifySession(): void {
    for (const l of this.sessionListeners) l();
  }
  private notifyLiveHost(): void {
    for (const l of this.liveHostListeners) l();
  }
  private notifyMeta(): void {
    for (const l of this.metaListeners) l();
  }

  setSession(next: SessionSnapshot | SessionReducer): void {
    const resolved =
      typeof next === "function" ? next(this.session) : next;
    if (shallowSessionEqual(this.session, resolved)) return;
    this.session = resolved;
    const core = metaFrom(resolved, this.meta.rev);
    if (!structuralEqual(this.meta, core)) {
      this.meta = { ...core, rev: this.meta.rev + 1 };
      this.notifyMeta();
    }
    this.notifySession();
  }

  setLiveHost(next: SessionSnapshot | SessionReducer): void {
    const resolved =
      typeof next === "function" ? next(this.liveHost) : next;
    if (shallowSessionEqual(this.liveHost, resolved)) return;
    this.liveHost = resolved;
    this.notifyLiveHost();
  }

  resetForTests(): void {
    this.session = { ...IDLE_SNAPSHOT };
    this.liveHost = { ...IDLE_SNAPSHOT };
    this.meta = metaFrom(IDLE_SNAPSHOT, 0);
  }
}

export const sessionShellStore = new SessionShellStore();
