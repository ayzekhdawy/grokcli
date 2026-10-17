/**
 * Multi-window session helpers + live agent slot policy (desktop Tauri).
 *
 * Product: open a chat in a second webview via `#/session/<id>`. Secondary
 * windows participate live — send / stop / ensureConnected go through the
 * shared process Host (session-targeted).
 *
 * Host connection pool (session-keyed):
 *   live        — UI focus slot (at most one)
 *   background  — busy turns demoted off focus (stream continues)
 *   parked      — warm Ready agents for other chats
 *
 * Concurrent multi-window: connecting/sending on session B while A is mid-turn
 * demotes A to `background` (never kills / cancels A). Ready A parks warm.
 * Prompt/stop are always scoped by sessionId.
 *
 * Window labels: `main` (primary) · `session-<uuid>` (secondary).
 */

/** Primary workbench window label (matches tauri.conf.json). */
export const MAIN_WINDOW_LABEL = "main";

/** Secondary session window labels are `session-<sessionId>`. */
export const SESSION_WINDOW_LABEL_PREFIX = "session-";

/** Hash route for a focused session (`#/session/<id>`). */
export const SESSION_DEEP_LINK_PREFIX = "session/";

/** True when a Tauri window label is the primary workbench. */
export function isMainWindowLabel(label: string | null | undefined): boolean {
  return (label ?? "").trim() === MAIN_WINDOW_LABEL;
}

/**
 * Sanitize a session id for use in a Tauri window label.
 * Only ASCII alphanumeric, hyphen, underscore (UUID-safe).
 */
export function sanitizeSessionIdForLabel(
  sessionId: string | null | undefined,
): string | null {
  const id = (sessionId ?? "").trim();
  if (!id) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return id;
}

/** Build `session-<id>` window label, or null if id is invalid. */
export function sessionWindowLabel(
  sessionId: string | null | undefined,
): string | null {
  const id = sanitizeSessionIdForLabel(sessionId);
  if (!id) return null;
  return `${SESSION_WINDOW_LABEL_PREFIX}${id}`;
}

/** Parse session id from a `session-<id>` window label. */
export function parseSessionWindowLabel(
  label: string | null | undefined,
): string | null {
  const raw = (label ?? "").trim();
  if (!raw.startsWith(SESSION_WINDOW_LABEL_PREFIX)) return null;
  const id = raw.slice(SESSION_WINDOW_LABEL_PREFIX.length);
  return sanitizeSessionIdForLabel(id);
}

/** True when the window is a secondary session window. */
export function isSessionWindowLabel(label: string | null | undefined): boolean {
  return parseSessionWindowLabel(label) != null;
}

/**
 * Build hash for deep-link open (`#/session/<id>`).
 * Returns empty string when id is invalid.
 */
export function buildSessionDeepLinkHash(
  sessionId: string | null | undefined,
): string {
  const id = sanitizeSessionIdForLabel(sessionId);
  if (!id) return "";
  return `#/${SESSION_DEEP_LINK_PREFIX}${id}`;
}

/**
 * Parse `#/session/<id>` (with or without leading `#` / `/`).
 * Also accepts bare `session/<id>`.
 */
export function parseSessionDeepLinkHash(
  hash: string | null | undefined,
): string | null {
  if (hash == null) return null;
  const raw = String(hash)
    .replace(/^#\/?/, "")
    .replace(/^\//, "")
    .trim();
  if (!raw.startsWith(SESSION_DEEP_LINK_PREFIX)) return null;
  const rest = raw.slice(SESSION_DEEP_LINK_PREFIX.length);
  // Ignore trailing query-like junk; take first path segment only.
  const id = rest.split(/[/?#]/)[0] ?? "";
  return sanitizeSessionIdForLabel(id);
}

/**
 * Resolve the session this secondary window should focus.
 * Prefer explicit hash deep link; fall back to window label.
 */
export function resolveSecondarySessionId(opts: {
  hash?: string | null;
  windowLabel?: string | null;
}): string | null {
  return (
    parseSessionDeepLinkHash(opts.hash) ??
    parseSessionWindowLabel(opts.windowLabel)
  );
}

/**
 * Whether "Open session in new window" should be offered.
 * Desktop Tauri only; not from a secondary window; valid session id required.
 */
export function canOpenSessionInNewWindow(opts: {
  isDesktopHost: boolean;
  isSecondaryWindow: boolean;
  sessionId: string | null | undefined;
}): boolean {
  if (!opts.isDesktopHost) return false;
  if (opts.isSecondaryWindow) return false;
  return sanitizeSessionIdForLabel(opts.sessionId) != null;
}

// ── Live agent slot pool (session-keyed) ─────────────────────────────────────

/**
 * Where a session’s agent process currently lives in the Host pool.
 * Matches SessionManager: one live focus + background busy + parked Ready.
 */
export type LiveSlotKind = "live" | "background" | "parked" | "none";

/** Turn / connect busyness for a slot (orthogonal to kind). */
export type LiveSlotBusy =
  | "idle"
  | "connecting"
  | "streaming"
  | "awaiting_permission";

/** One entry in the session-keyed connection pool. */
export type LiveAgentSlot = {
  sessionId: string;
  kind: LiveSlotKind;
  busy: LiveSlotBusy;
};

/**
 * Stop command scope.
 * - `current` — composer / Escape Stop: the chat on screen only
 * - `all_busy` — Tasks / dashboard Stop all: every stoppable busy session
 */
export type StopScope = "current" | "all_busy";

/** Soft-fail reasons when a slot cannot be allocated / connected. */
export type LiveSlotSoftFailReason =
  | "process_limit"
  | "invalid_session"
  | "foreign_send_in_flight";

export type ConnectSlotPlan =
  | {
      action: "noop";
      reason: "already_live" | "already_background" | "already_parked_ready";
      targetSessionId: string;
    }
  | {
      action: "connect";
      targetSessionId: string;
      /** Other session that will leave the live focus slot, if any. */
      demotesSessionId: string | null;
      /**
       * True when demoting that session keeps its agent process and turn
       * (busy → background stream, Ready → parked warm). Never a silent kill.
       */
      demotePreservesAgent: boolean;
    }
  | {
      action: "soft_fail";
      reason: LiveSlotSoftFailReason;
      targetSessionId: string | null;
    };

/** Map Host / UI session state string → slot busy. */
export function liveSlotBusyFromState(
  state: string | null | undefined,
): LiveSlotBusy {
  switch ((state ?? "").trim()) {
    case "streaming":
      return "streaming";
    case "awaiting_permission":
      return "awaiting_permission";
    case "connecting":
      return "connecting";
    default:
      return "idle";
  }
}

/** True while the agent is mid-turn (must demote to background, never kill). */
export function isLiveSlotTurnBusy(busy: LiveSlotBusy): boolean {
  return (
    busy === "streaming" ||
    busy === "awaiting_permission" ||
    busy === "connecting"
  );
}

/**
 * Whether demoting `slot` off the live focus preserves the agent process.
 * Busy → background (stream continues). Ready idle → parked warm.
 * Empty / none → nothing to preserve.
 */
export function demotePreservesAgent(slot: LiveAgentSlot | null | undefined): boolean {
  if (!slot || slot.kind === "none") return true;
  // live / background / parked all keep a process under demote/park policy.
  return slot.kind === "live" || slot.kind === "background" || slot.kind === "parked";
}

/**
 * Concurrent multi-window invariant: connecting/sending for `target` while
 * `other` is mid-turn must not cancel `other`. Host demotes busy live →
 * background and parks Ready; process limit never kills busy for capacity.
 */
export function concurrentConnectPreservesOther(
  other: LiveAgentSlot | null | undefined,
): boolean {
  if (!other || other.sessionId === "") return true;
  if (other.kind === "none") return true;
  // Busy turns always demote to background — preserved.
  if (isLiveSlotTurnBusy(other.busy)) return true;
  // Idle Ready parks warm — process kept.
  if (other.kind === "live" || other.kind === "parked" || other.kind === "background") {
    return true;
  }
  return true;
}

/**
 * Plan a connect for `targetSessionId` against the current pool snapshot.
 * Pure: Host still enforces process limits at spawn time.
 */
export function planConnectToSession(opts: {
  targetSessionId: string | null | undefined;
  /** Current live focus slot (at most one). */
  live: LiveAgentSlot | null;
  /** Background busy map (sessionId → slot). */
  background?: Readonly<Record<string, LiveAgentSlot>>;
  /** Parked Ready map. */
  parked?: Readonly<Record<string, LiveAgentSlot>>;
  /**
   * Active process count (live + background + parked with alive ACP).
   * When at/over max and target needs a cold spawn, soft-fail.
   */
  activeProcessCount?: number;
  maxConcurrentAgents?: number;
  /** When true, target already has a warm process (live/bg/parked). */
  targetHasWarmProcess?: boolean;
}): ConnectSlotPlan {
  const target = sanitizeSessionIdForLabel(opts.targetSessionId);
  if (!target) {
    return {
      action: "soft_fail",
      reason: "invalid_session",
      targetSessionId: null,
    };
  }

  const bg = opts.background ?? {};
  const parked = opts.parked ?? {};
  const live = opts.live;

  if (live && live.sessionId === target && live.kind === "live") {
    return { action: "noop", reason: "already_live", targetSessionId: target };
  }
  if (bg[target]) {
    return {
      action: "noop",
      reason: "already_background",
      targetSessionId: target,
    };
  }
  if (parked[target]) {
    return {
      action: "noop",
      reason: "already_parked_ready",
      targetSessionId: target,
    };
  }

  const warm =
    opts.targetHasWarmProcess === true ||
    (live?.sessionId === target) ||
    !!bg[target] ||
    !!parked[target];

  if (!warm) {
    const active = opts.activeProcessCount ?? 0;
    const max = opts.maxConcurrentAgents ?? 8;
    // Soft capacity gate for cold spawn only. Host reclaims idle parked first;
    // this pure check is conservative when caller reports full busy pool.
    if (active >= max) {
      return {
        action: "soft_fail",
        reason: "process_limit",
        targetSessionId: target,
      };
    }
  }

  const demotes =
    live && live.sessionId && live.sessionId !== target ? live.sessionId : null;
  const demoteSlot = demotes && live?.sessionId === demotes ? live : null;

  return {
    action: "connect",
    targetSessionId: target,
    demotesSessionId: demotes,
    demotePreservesAgent: demotePreservesAgent(demoteSlot),
  };
}

/**
 * Whether two sessions can stream concurrently under the Host pool.
 * Always true when they differ: busy demotes to background; each owns an ACP.
 */
export function canStreamConcurrently(
  sessionA: string | null | undefined,
  sessionB: string | null | undefined,
): boolean {
  const a = sanitizeSessionIdForLabel(sessionA);
  const b = sanitizeSessionIdForLabel(sessionB);
  if (!a || !b) return false;
  if (a === b) return false;
  return true;
}

/**
 * Resolve which session ids a Stop action should target.
 * Soft-fails (empty list) when scope is current but no session is focused.
 */
export function resolveStopTargets(opts: {
  scope: StopScope;
  /** Viewed / composer session (current scope). */
  currentSessionId: string | null | undefined;
  /** All stoppable busy session ids (all_busy scope). */
  busySessionIds: readonly string[];
}): string[] {
  if (opts.scope === "current") {
    const id = sanitizeSessionIdForLabel(opts.currentSessionId);
    return id ? [id] : [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of opts.busySessionIds) {
    const id = sanitizeSessionIdForLabel(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Whether passive warm-connect should be skipped for this window role.
 *
 * A1 concurrent pool: secondary may warm-connect. Host demotes other busy
 * agents to background (stream continues) and parks Ready — never a silent kill.
 * Callers still defer while *this* window’s send/connect is in flight, and main
 * still defers when browsing while a foreign chat is mid-turn (see
 * `shouldDeferWarmConnectForForeignBusy`).
 */
export function shouldSkipWarmConnect(isSecondaryWindow: boolean): boolean {
  // Secondary is no longer view-only for passive connect. Argument kept so
  // call sites stay explicit; lite-era skip is retired.
  void isSecondaryWindow;
  return false;
}

/**
 * Main workbench: defer passive warm-connect while another chat is mid-turn
 * so browsing does not thrash demote/spawn. Secondary windows exist for
 * concurrent work — do not defer just because a foreign chat is streaming.
 *
 * RETIRED (process sharing + concurrent multi-session): connecting another
 * chat no longer steals the live slot from a streaming turn — the busy chat
 * demotes to background and keeps running on the same (or its own) process,
 * and the new chat reuses a warm process via session/load. Deferring left
 * viewed history chats unconnected whenever anything else was mid-turn.
 */
export function shouldDeferWarmConnectForForeignBusy(opts: {
  isSecondaryWindow: boolean;
  foreignBusy: boolean;
}): boolean {
  void opts.isSecondaryWindow;
  void opts.foreignBusy;
  return false;
}

/**
 * Whether this window may send / stop / ensureConnected for its focused session.
 * Secondary webviews share the process Host — live participation is allowed
 * (session-targeted invoke). Policy locked here so UI gates stay honest.
 */
export function canLiveParticipate(isSecondaryWindow: boolean): boolean {
  // Secondary is not view-only for send/stop. Argument kept for call-site clarity
  // and future policy tweaks (e.g. mirror/browser).
  void isSecondaryWindow;
  return true;
}

/**
 * @deprecated Prefer `shouldSkipWarmConnect` for browse and `canLiveParticipate`
 * for send/stop. Kept as warm-connect alias so older call sites stay safe.
 */
export function shouldSkipAgentSpawn(isSecondaryWindow: boolean): boolean {
  return shouldSkipWarmConnect(isSecondaryWindow);
}

/**
 * Soft-fail user message key hint for slot allocation failures.
 * App maps via i18n; pure helper stays free of locale tables.
 */
export function liveSlotSoftFailMessageKey(
  reason: LiveSlotSoftFailReason,
): string {
  switch (reason) {
    case "process_limit":
      return "agent.processLimitToast";
    case "invalid_session":
      return "session.openInNewWindowMissing";
    case "foreign_send_in_flight":
      return "session.secondaryLiveBanner";
    default:
      return "agent.processLimitToast";
  }
}

/** i18n key for stop-scope chrome (composer vs stop-all). */
export function stopScopeMessageKey(scope: StopScope): string {
  return scope === "current" ? "composer.stop" : "tasks.activity.stopAll";
}
