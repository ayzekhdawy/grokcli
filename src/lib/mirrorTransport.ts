/**
 * Phone / browser mirror client transport — WebSocket RPC + event bus.
 *
 * @see DESIGN.md §4.3, §7, §10
 */

export type MirrorBoot = {
  token: string;
  protocol?: number;
};

declare global {
  interface Window {
    __MIRROR__?: MirrorBoot;
  }
}

function hasTauriGlobals(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/**
 * True when the SPA is loaded as a remote mirror client (not the desktop WebView).
 * Desktop Tauri always returns false (AC6).
 */
export function isMirrorClient(): boolean {
  if (typeof window === "undefined") return false;
  if (hasTauriGlobals()) return false;
  if (window.__MIRROR__?.token) return true;
  return /^\/t\/[^/]+(?:\/|$)/.test(window.location.pathname);
}

/** Active path token from injected boot config or URL prefix. */
export function mirrorToken(): string | null {
  if (typeof window === "undefined") return null;
  if (window.__MIRROR__?.token) return window.__MIRROR__.token;
  const m = window.location.pathname.match(/^\/t\/([^/]+)/);
  return m?.[1] ?? null;
}

/** Map Tauri command names → DESIGN §7.2 RPC methods. */
const CMD_TO_METHOD: Record<string, string> = {
  projects_list: "projects.list",
  sessions_list: "sessions.list",
  session_messages: "session.messages",
  session_get_state: "session.getState",
  session_connect: "session.connect",
  session_send: "session.send",
  session_stop: "session.stop",
  session_stop_report: "session.stopReport",
  session_create: "session.create",
  session_rename: "session.rename",
  session_auto_title: "session.autoTitle",
  session_resolve_permission: "session.resolvePermission",
  session_resolve_plan: "session.resolvePlan",
  session_resolve_ask_user: "session.resolveAskUser",
  account_status: "account.status",
  settings_get: "settings.get",
  models_list_available: "models.list",
  composer_prefs_resolve: "composer.prefsResolve",
  // Composer voice dictation over the mirror (phone STT). The host only ever
  // discloses a boolean availability via voice.status; audio is transcribed
  // stateless via voice.transcribe. Secrets are never exposed to the client.
  voice_status: "voice.status",
  voice_transcribe: "voice.transcribe",
};

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

type EventHandler = (payload: unknown) => void;

type TransportState = {
  ws: WebSocket | null;
  /** StrictMode: set false on each mount; cleanup only closes if still true after schedule. */
  closed: boolean;
  pending: Map<string, Pending>;
  listeners: Map<string, Set<EventHandler>>;
  connectPromise: Promise<void> | null;
  hello: unknown | null;
  gen: number;
};

const state: TransportState = {
  ws: null,
  closed: true,
  pending: new Map(),
  listeners: new Map(),
  connectPromise: null,
  hello: null,
  gen: 0,
};

function wsUrl(): string {
  const token = mirrorToken();
  if (!token) throw new Error("mirror token missing");
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  // Prefer path token (same origin under /t/{token}/)
  const base = `${proto}//${window.location.host}/t/${encodeURIComponent(token)}/ws`;
  return base;
}

function nextId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function dispatchEvent(name: string, payload: unknown) {
  const set = state.listeners.get(name);
  if (!set) return;
  for (const h of [...set]) {
    try {
      h(payload);
    } catch (e) {
      console.warn("[mirror] event handler error", name, e);
    }
  }
}

function handleMessage(raw: string) {
  let msg: {
    type?: string;
    id?: string;
    ok?: boolean;
    result?: unknown;
    code?: string;
    error?: string;
    name?: string;
    payload?: unknown;
  };
  try {
    msg = JSON.parse(raw);
  } catch {
    console.warn("[mirror] non-JSON frame");
    return;
  }

  if (msg.type === "event") {
    if (msg.name === "mirror://hello") {
      state.hello = msg.payload ?? null;
    }
    if (msg.name) {
      dispatchEvent(msg.name, msg.payload);
    }
    return;
  }

  if (msg.type === "res" && msg.id != null) {
    const p = state.pending.get(String(msg.id));
    if (!p) return;
    state.pending.delete(String(msg.id));
    if (msg.ok) {
      p.resolve(msg.result);
    } else {
      const err = new Error(msg.error || msg.code || "mirror RPC failed") as Error & {
        code?: string;
      };
      err.code = msg.code || "HOST_ERROR";
      p.reject(err);
    }
  }
}

/**
 * Open WS (idempotent). StrictMode-safe: each ensure call resets closed flag
 * so a previous effect cleanup does not leave us disconnected forever.
 */
export function mirrorEnsureTransport(): Promise<void> {
  if (!isMirrorClient()) return Promise.resolve();
  state.closed = false;
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  if (state.connectPromise) return state.connectPromise;

  const gen = ++state.gen;
  state.connectPromise = new Promise<void>((resolve, reject) => {
    let url: string;
    try {
      url = wsUrl();
    } catch (e) {
      state.connectPromise = null;
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    const ws = new WebSocket(url);
    state.ws = ws;

    const failPending = (reason: string) => {
      for (const [, p] of state.pending) {
        p.reject(new Error(reason));
      }
      state.pending.clear();
    };

    ws.onopen = () => {
      if (state.closed || gen !== state.gen) {
        ws.close();
        return;
      }
      const resumed = state.hello !== null;
      state.connectPromise = null;
      resolve();
      // A reconnect can follow a server-side lag reset. The event ring is not
      // replayable, so let the host-event hook rehydrate state/journal after
      // the transport is live again.
      dispatchEvent("mirror://reconnected", { resumed });
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") handleMessage(ev.data);
    };

    ws.onerror = () => {
      // onclose will settle
    };

    ws.onclose = () => {
      if (state.ws === ws) state.ws = null;
      state.connectPromise = null;
      failPending("mirror websocket closed");
      // Auto-reconnect if not intentionally closed (StrictMode / nav).
      if (!state.closed && isMirrorClient()) {
        window.setTimeout(() => {
          if (!state.closed) void mirrorEnsureTransport();
        }, 400);
      }
    };

    // Safety timeout for first connect
    window.setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN && gen === state.gen) {
        state.connectPromise = null;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(new Error("mirror websocket connect timeout"));
      }
    }, 15_000);
  });

  return state.connectPromise;
}

/** Soft-close used by tests; normal SPA keeps the socket for the page lifetime. */
export function mirrorCloseTransport(): void {
  state.closed = true;
  state.gen += 1;
  const ws = state.ws;
  state.ws = null;
  state.connectPromise = null;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
}

/** Last `mirror://hello` payload (account + connection summary). */
export function mirrorHello(): unknown | null {
  return state.hello;
}

/** True when the mirror WebSocket is open. */
export function mirrorWsConnected(): boolean {
  return !!state.ws && state.ws.readyState === WebSocket.OPEN;
}

/**
 * Invoke a Tauri-shaped command over mirror WS.
 * Unknown commands → Error with code `UNSUPPORTED`.
 */
export async function mirrorInvoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const method = CMD_TO_METHOD[cmd];
  if (!method) {
    const err = new Error(`UNSUPPORTED: ${cmd}`) as Error & { code?: string };
    err.code = "UNSUPPORTED";
    throw err;
  }
  return mirrorRpc<T>(method, args ?? {});
}

export async function mirrorRpc<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  await mirrorEnsureTransport();
  const ws = state.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("mirror websocket not connected");
  }
  const id = nextId();
  const frame = {
    id,
    type: "req",
    method,
    params,
  };
  return new Promise<T>((resolve, reject) => {
    state.pending.set(id, {
      resolve: (v) => resolve(v as T),
      reject,
    });
    try {
      ws.send(JSON.stringify(frame));
    } catch (e) {
      state.pending.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    window.setTimeout(() => {
      if (state.pending.has(id)) {
        state.pending.delete(id);
        reject(new Error(`mirror RPC timeout: ${method}`));
      }
    }, 120_000);
  });
}

/** Subscribe to a host event name (`session://state`, …). Returns unsubscribe. */
export function mirrorListen<T = unknown>(
  event: string,
  handler: (payload: T) => void,
): () => void {
  void mirrorEnsureTransport();
  let set = state.listeners.get(event);
  if (!set) {
    set = new Set();
    state.listeners.set(event, set);
  }
  const wrapped: EventHandler = (payload) => handler(payload as T);
  set.add(wrapped);
  return () => {
    set!.delete(wrapped);
    if (set!.size === 0) state.listeners.delete(event);
  };
}

/** @deprecated Slice 2 helper — prefer mirrorInvoke which throws with code. */
export function mirrorRpcUnsupported(method: string): never {
  const err = new Error(`UNSUPPORTED: ${method}`) as Error & { code?: string };
  err.code = "UNSUPPORTED";
  throw err;
}
