/**
 * Pure helpers for Settings → Runtime → Agent leader fleet
 * (`grok leader list` / `info` / `kill`).
 *
 * Host returns camelCase DTOs; field names vary by CLI version — keep parsing
 * defensive. Never surface secrets (none expected on leader info).
 *
 * Honesty rules (LEADER-FLEET-PRO):
 * - Never invent "running" from socket presence alone (host already treats
 *   socket+empty-list as error / stale).
 * - Soft-fail diagnostics (old CLI, list probe fail while stopped) stay visible
 *   without claiming a hard outage when Start is still valid.
 * - useLeader honesty: do not claim agents are attached to a shared backend
 *   unless a listed process exists (or host state is running).
 */

export type LeaderProcessLike = {
  pid?: number | null;
  socketPath?: string | null;
  version?: string | null;
  classification?: string | null;
  lockPath?: string | null;
  wsUrlSuffix?: string | null;
  raw?: unknown;
};

export type LeaderInfoLike = {
  pid?: number | null;
  socketPath?: string | null;
  lockPath?: string | null;
  version?: string | null;
  protocolVersion?: string | null;
  classification?: string | null;
  uptimeMs?: number | null;
  activeToolCalls?: number | null;
  wsUrlSuffix?: string | null;
  unsupported?: boolean;
  error?: string | null;
  raw?: unknown;
};

export type LeaderDetailRow = {
  key: string;
  /** Stable i18n key for the field label (settings.leader.field.*). */
  labelKey: string;
  value: string;
};

/** Known soft-fail / error kinds for status + info presentation. */
export type LeaderErrorKind =
  | "cli_missing"
  | "unsupported"
  | "timeout"
  | "parse"
  | "socket_stale"
  | "list_failed"
  | "info_failed"
  | "unreachable"
  | "other";

/** High-level connect phase for the status pill (never invents running). */
export type LeaderConnectPhase =
  | "cli_missing"
  | "unsupported"
  | "running"
  | "stale_socket"
  | "stopped"
  | "error"
  | "soft_diagnostic";

export type LeaderConnectTone = "ok" | "warn" | "err" | "muted";

export type LeaderConnectStatus = {
  phase: LeaderConnectPhase;
  tone: LeaderConnectTone;
  /** i18n key for the status badge. */
  labelKey: string;
  fleetCount: number;
  /** Classified kind when a host/CLI message is present. */
  errorKind: LeaderErrorKind | null;
  /**
   * Soft-fail / honesty: true when the host left a diagnostic `message` that
   * should still be shown (including stopped + list soft-fail).
   */
  showDiagnostic: boolean;
  /**
   * Always false — documented honesty flag so UI never "guesses" running from
   * socket mtime alone.
   */
  socketOnlyRunningGuess: false;
};

/** Normalized classification from CLI list/info rows. */
export type LeaderClassificationKind =
  | "reachable"
  | "unreachable"
  | "stale"
  | "running"
  | "unknown";

export type LeaderUseLeaderHonesty = {
  severity: "none" | "info" | "warn";
  /** i18n body key, or null when no banner. */
  messageKey: string | null;
  showOpenUseLeader: boolean;
  /** Suggest Start when share-backend is on but no leader is listed. */
  showStartLeader: boolean;
};

/** Fleet empty-state reason (honest; never claims "stopped" when unsupported). */
export type LeaderFleetEmptyReason =
  | "unsupported"
  | "cli_missing"
  | "soft_list"
  | "none";

// ── Row keys / formatting ───────────────────────────────────────────────────

/** Stable row key for list rendering. */
export function leaderRowKey(row: LeaderProcessLike, index: number): string {
  if (row.pid != null && Number.isFinite(row.pid)) return `pid-${row.pid}`;
  const sock = (row.socketPath ?? "").trim();
  if (sock) return `sock-${sock}`;
  return `idx-${index}`;
}

/** One-line summary for a list row (PID · classification · socket). */
export function formatLeaderRowSummary(row: LeaderProcessLike): string {
  const parts: string[] = [];
  if (row.pid != null && Number.isFinite(row.pid)) {
    parts.push(`PID ${Math.trunc(row.pid)}`);
  }
  const cls = (row.classification ?? "").trim();
  if (cls) parts.push(cls);
  const ver = (row.version ?? "").trim();
  if (ver) parts.push(`v${ver}`);
  const sock = (row.socketPath ?? "").trim();
  if (sock) parts.push(sock);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/** Human-readable uptime from milliseconds. */
export function formatLeaderUptimeMs(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** i18n keys for structured leader-info fields. */
export const LEADER_DETAIL_LABEL_KEYS: Record<string, string> = {
  pid: "settings.leader.field.pid",
  socketPath: "settings.leader.field.socketPath",
  lockPath: "settings.leader.field.lockPath",
  version: "settings.leader.field.version",
  protocolVersion: "settings.leader.field.protocolVersion",
  classification: "settings.leader.field.classification",
  uptime: "settings.leader.field.uptime",
  activeToolCalls: "settings.leader.field.activeToolCalls",
  wsUrlSuffix: "settings.leader.field.wsUrlSuffix",
  raw: "settings.leader.field.raw",
};

/**
 * Flatten known leader-info fields into labeled rows for the details modal.
 * Prefer structured DTO fields; fall back to a short raw dump when empty.
 * Labels are i18n keys — callers translate via `t(row.labelKey)`.
 */
export function leaderInfoDetailRows(info: LeaderInfoLike | null | undefined): LeaderDetailRow[] {
  if (!info) return [];
  const rows: LeaderDetailRow[] = [];
  const push = (key: string, value: string | null | undefined) => {
    const v = (value ?? "").trim();
    if (!v) return;
    rows.push({
      key,
      labelKey: LEADER_DETAIL_LABEL_KEYS[key] ?? key,
      value: v,
    });
  };

  if (info.pid != null && Number.isFinite(info.pid)) {
    push("pid", String(Math.trunc(info.pid)));
  }
  push("socketPath", info.socketPath ?? undefined);
  push("lockPath", info.lockPath ?? undefined);
  push("version", info.version ?? undefined);
  push("protocolVersion", info.protocolVersion ?? undefined);
  push("classification", info.classification ?? undefined);
  const up = formatLeaderUptimeMs(info.uptimeMs ?? null);
  if (up) push("uptime", up);
  if (info.activeToolCalls != null && Number.isFinite(info.activeToolCalls)) {
    push("activeToolCalls", String(Math.trunc(info.activeToolCalls)));
  }
  const suffix = (info.wsUrlSuffix ?? "").trim();
  if (suffix) push("wsUrlSuffix", suffix);

  if (rows.length === 0 && info.raw != null) {
    try {
      const pretty = JSON.stringify(info.raw, null, 2);
      if (pretty && pretty !== "{}" && pretty !== "null") {
        rows.push({
          key: "raw",
          labelKey: LEADER_DETAIL_LABEL_KEYS.raw,
          value: pretty.slice(0, 4000),
        });
      }
    } catch {
      /* ignore */
    }
  }
  return rows;
}

/** Whether a list/status leaders array is non-empty. */
export function hasLeaderFleet(leaders: LeaderProcessLike[] | null | undefined): boolean {
  return Array.isArray(leaders) && leaders.length > 0;
}

/** Count finite PIDs in a fleet list (honest count; ignores empty shells). */
export function leaderFleetPidCount(leaders: LeaderProcessLike[] | null | undefined): number {
  if (!Array.isArray(leaders)) return 0;
  let n = 0;
  for (const row of leaders) {
    if (row?.pid != null && Number.isFinite(row.pid)) n += 1;
  }
  return n;
}

// ── Classification ──────────────────────────────────────────────────────────

/** Normalize CLI classification strings (Reachable / Unreachable / …). */
export function normalizeLeaderClassification(
  raw: string | null | undefined,
): LeaderClassificationKind {
  const c = (raw ?? "").trim().toLowerCase();
  if (!c) return "unknown";
  if (c === "reachable" || c === "alive" || c === "ok" || c === "healthy") {
    return "reachable";
  }
  if (c === "running" || c === "active" || c === "live") {
    return "running";
  }
  if (
    c === "unreachable" ||
    c === "dead" ||
    c === "down" ||
    c === "offline" ||
    c === "failed"
  ) {
    return "unreachable";
  }
  if (c === "stale" || c === "zombie" || c === "orphaned" || c.includes("stale")) {
    return "stale";
  }
  return "unknown";
}

export function leaderClassificationTone(
  kind: LeaderClassificationKind,
): LeaderConnectTone {
  switch (kind) {
    case "reachable":
    case "running":
      return "ok";
    case "stale":
      return "warn";
    case "unreachable":
      return "err";
    default:
      return "muted";
  }
}

/** i18n key for a normalized classification chip. */
export function leaderClassificationLabelKey(kind: LeaderClassificationKind): string {
  switch (kind) {
    case "reachable":
      return "settings.leader.class.reachable";
    case "running":
      return "settings.leader.class.running";
    case "unreachable":
      return "settings.leader.class.unreachable";
    case "stale":
      return "settings.leader.class.stale";
    default:
      return "settings.leader.class.unknown";
  }
}

// ── Soft-fail error classification ──────────────────────────────────────────

/**
 * Classify host / CLI messages into stable kinds for chips + hints.
 * Pure string heuristics — never invents success.
 */
export function classifyLeaderError(
  message: string | null | undefined,
  opts?: {
    unsupported?: boolean | null;
    source?: "list" | "info" | "status" | "start" | "stop" | null;
  },
): LeaderErrorKind {
  if (opts?.unsupported) return "unsupported";
  const m = (message ?? "").toLowerCase();
  if (!m.trim()) return "other";

  if (
    m.includes("cli not found") ||
    m.includes("grok build cli not found") ||
    m.includes("no such file") ||
    (m.includes("not found") && m.includes("cli"))
  ) {
    return "cli_missing";
  }

  if (
    m.includes("does not expose") ||
    m.includes("unsupported") ||
    m.includes("unrecognized") ||
    m.includes("unknown subcommand") ||
    m.includes("unknown command") ||
    m.includes("not support") ||
    m.includes("no such subcommand")
  ) {
    return "unsupported";
  }

  if (m.includes("timed out") || m.includes("timeout")) {
    return "timeout";
  }

  if (
    m.includes("invalid leader list json") ||
    m.includes("invalid leader info json") ||
    m.includes("invalid json") ||
    m.includes("empty leader info") ||
    m.includes("parse")
  ) {
    return "parse";
  }

  if (
    m.includes("socket exists") ||
    m.includes("stale socket") ||
    (m.includes("socket") && m.includes("no reachable"))
  ) {
    return "socket_stale";
  }

  if (
    m.includes("unreachable") ||
    m.includes("connection refused") ||
    m.includes("not reachable")
  ) {
    return "unreachable";
  }

  if (opts?.source === "info" || m.includes("leader info")) {
    return "info_failed";
  }
  if (
    opts?.source === "list" ||
    m.includes("leader list") ||
    m.includes("list failed")
  ) {
    return "list_failed";
  }

  return "other";
}

export function leaderErrorKindLabelKey(kind: LeaderErrorKind): string {
  switch (kind) {
    case "cli_missing":
      return "settings.leader.err.cliMissing";
    case "unsupported":
      return "settings.leader.err.unsupported";
    case "timeout":
      return "settings.leader.err.timeout";
    case "parse":
      return "settings.leader.err.parse";
    case "socket_stale":
      return "settings.leader.err.socketStale";
    case "list_failed":
      return "settings.leader.err.listFailed";
    case "info_failed":
      return "settings.leader.err.infoFailed";
    case "unreachable":
      return "settings.leader.err.unreachable";
    default:
      return "settings.leader.err.other";
  }
}

/** Actionable soft-fail hint (i18n key). */
export function leaderErrorKindHintKey(kind: LeaderErrorKind): string {
  switch (kind) {
    case "cli_missing":
      return "settings.leader.hint.cliMissing";
    case "unsupported":
      return "settings.leader.hint.unsupported";
    case "timeout":
      return "settings.leader.hint.timeout";
    case "parse":
      return "settings.leader.hint.parse";
    case "socket_stale":
      return "settings.leader.hint.socketStale";
    case "list_failed":
      return "settings.leader.hint.listFailed";
    case "info_failed":
      return "settings.leader.hint.infoFailed";
    case "unreachable":
      return "settings.leader.hint.unreachable";
    default:
      return "settings.leader.hint.other";
  }
}

export function leaderErrorKindTone(kind: LeaderErrorKind): LeaderConnectTone {
  switch (kind) {
    case "cli_missing":
    case "socket_stale":
    case "unreachable":
      return "err";
    case "unsupported":
    case "timeout":
    case "parse":
    case "list_failed":
    case "info_failed":
      return "warn";
    default:
      return "warn";
  }
}

// ── Connect status (status pill + diagnostics) ──────────────────────────────

export type DeriveLeaderConnectStatusInput = {
  state?: string | null;
  cliFound?: boolean | null;
  cliSupportsLeader?: boolean | null;
  socketExists?: boolean | null;
  leaders?: LeaderProcessLike[] | null;
  message?: string | null;
  pid?: number | null;
};

/**
 * Derive an honest connect pill + diagnostic visibility from host status.
 *
 * Does **not** invent running from socket alone: if host state is `error` with
 * a stale-socket message, phase is `stale_socket`. Soft list failures while
 * stopped surface as `soft_diagnostic` so the UI can show the message without
 * blocking Start.
 */
export function deriveLeaderConnectStatus(
  input: DeriveLeaderConnectStatusInput,
): LeaderConnectStatus {
  const fleetCount = Array.isArray(input.leaders) ? input.leaders.length : 0;
  const msg = (input.message ?? "").trim();
  const state = (input.state ?? "stopped").trim().toLowerCase();
  const cliFound = input.cliFound !== false;
  const cliSupports = input.cliSupportsLeader !== false;
  const socketExists = !!input.socketExists;

  const base = {
    fleetCount,
    socketOnlyRunningGuess: false as const,
  };

  // Capability gates first (honest unsupported / missing CLI).
  if (input.cliFound === false || state === "error" && !cliFound) {
    if (input.cliFound === false) {
      const kind = classifyLeaderError(msg || "Grok Build CLI not found");
      return {
        ...base,
        phase: "cli_missing",
        tone: "err",
        labelKey: "settings.leader.stateError",
        errorKind: kind === "other" ? "cli_missing" : kind,
        showDiagnostic: true,
      };
    }
  }

  if (
    input.cliSupportsLeader === false ||
    state === "unsupported" ||
    (!cliSupports && state !== "running")
  ) {
    if (input.cliSupportsLeader === false || state === "unsupported") {
      return {
        ...base,
        phase: "unsupported",
        tone: "err",
        labelKey: "settings.leader.stateUnsupported",
        errorKind: "unsupported",
        showDiagnostic: true,
      };
    }
  }

  if (state === "running" || (fleetCount > 0 && leaderFleetPidCount(input.leaders) > 0)) {
    // Only claim running when host says so or list has PIDs — never socket alone.
    if (state === "running" || leaderFleetPidCount(input.leaders) > 0) {
      return {
        ...base,
        phase: "running",
        tone: "ok",
        labelKey: "settings.leader.stateRunning",
        errorKind: msg ? classifyLeaderError(msg, { source: "status" }) : null,
        showDiagnostic: !!msg,
      };
    }
  }

  if (state === "error") {
    const kind = classifyLeaderError(msg, { source: "status" });
    if (kind === "socket_stale" || (socketExists && fleetCount === 0 && !msg)) {
      return {
        ...base,
        phase: "stale_socket",
        tone: "err",
        labelKey: "settings.leader.stateError",
        errorKind: kind === "other" && socketExists ? "socket_stale" : kind,
        showDiagnostic: true,
      };
    }
    if (kind === "cli_missing") {
      return {
        ...base,
        phase: "cli_missing",
        tone: "err",
        labelKey: "settings.leader.stateError",
        errorKind: kind,
        showDiagnostic: true,
      };
    }
    if (kind === "unsupported") {
      return {
        ...base,
        phase: "unsupported",
        tone: "err",
        labelKey: "settings.leader.stateUnsupported",
        errorKind: kind,
        showDiagnostic: true,
      };
    }
    return {
      ...base,
      phase: "error",
      tone: "err",
      labelKey: "settings.leader.stateError",
      errorKind: kind,
      showDiagnostic: true,
    };
  }

  // Stopped (or unknown) with optional soft-fail diagnostic from list probe.
  if (msg) {
    const kind = classifyLeaderError(msg, { source: "list" });
    return {
      ...base,
      phase: "soft_diagnostic",
      tone: leaderErrorKindTone(kind) === "err" ? "warn" : "warn",
      labelKey: "settings.leader.stateStopped",
      errorKind: kind,
      showDiagnostic: true,
    };
  }

  if (socketExists && fleetCount === 0 && state === "stopped") {
    // Host did not mark error — do not invent stale; show stopped honestly.
    return {
      ...base,
      phase: "stopped",
      tone: "muted",
      labelKey: "settings.leader.stateStopped",
      errorKind: null,
      showDiagnostic: false,
    };
  }

  return {
    ...base,
    phase: "stopped",
    tone: "muted",
    labelKey: "settings.leader.stateStopped",
    errorKind: null,
    showDiagnostic: false,
  };
}

/**
 * Honesty banner for Settings → useLeader vs actual fleet/connect phase.
 * Never claims share-backend is working without a running leader.
 */
export function deriveUseLeaderHonesty(input: {
  useLeader: boolean;
  phase: LeaderConnectPhase;
}): LeaderUseLeaderHonesty {
  const { useLeader, phase } = input;
  if (!useLeader) {
    if (phase === "running") {
      return {
        severity: "info",
        messageKey: "settings.leader.honesty.runningNoUseLeader",
        showOpenUseLeader: true,
        showStartLeader: false,
      };
    }
    return {
      severity: "none",
      messageKey: null,
      showOpenUseLeader: false,
      showStartLeader: false,
    };
  }

  if (phase === "running") {
    return {
      severity: "none",
      messageKey: null,
      showOpenUseLeader: false,
      showStartLeader: false,
    };
  }

  if (phase === "unsupported" || phase === "cli_missing") {
    return {
      severity: "warn",
      messageKey: "settings.leader.honesty.useLeaderNoCli",
      showOpenUseLeader: true,
      showStartLeader: false,
    };
  }

  if (phase === "stale_socket" || phase === "error") {
    return {
      severity: "warn",
      messageKey: "settings.leader.honesty.useLeaderNotRunning",
      showOpenUseLeader: false,
      showStartLeader: true,
    };
  }

  // stopped / soft_diagnostic
  return {
    severity: "warn",
    messageKey: "settings.leader.honesty.useLeaderNotRunning",
    showOpenUseLeader: false,
    showStartLeader: true,
  };
}

/** Why the fleet list is empty (for empty-state copy). */
export function leaderFleetEmptyReason(input: {
  phase: LeaderConnectPhase;
  errorKind?: LeaderErrorKind | null;
  fleetCount: number;
}): LeaderFleetEmptyReason {
  if (input.fleetCount > 0) return "none";
  if (input.phase === "unsupported" || input.errorKind === "unsupported") {
    return "unsupported";
  }
  if (input.phase === "cli_missing" || input.errorKind === "cli_missing") {
    return "cli_missing";
  }
  if (
    input.phase === "soft_diagnostic" ||
    input.errorKind === "list_failed" ||
    input.errorKind === "timeout" ||
    input.errorKind === "parse"
  ) {
    return "soft_list";
  }
  return "none";
}

export function leaderFleetEmptyMessageKey(reason: LeaderFleetEmptyReason): string {
  switch (reason) {
    case "unsupported":
      return "settings.leader.fleetEmptyUnsupported";
    case "cli_missing":
      return "settings.leader.fleetEmptyCliMissing";
    case "soft_list":
      return "settings.leader.fleetEmptySoft";
    default:
      return "settings.leader.fleetEmpty";
  }
}

/**
 * Whether the details modal should treat info as a soft-fail (no throw).
 * Host already returns envelopes; this maps to presentation.
 */
export function leaderInfoSoftFail(info: LeaderInfoLike | null | undefined): {
  soft: boolean;
  kind: LeaderErrorKind | null;
  unsupported: boolean;
} {
  if (!info) {
    return { soft: false, kind: null, unsupported: false };
  }
  if (info.unsupported) {
    return { soft: true, kind: "unsupported", unsupported: true };
  }
  const err = (info.error ?? "").trim();
  if (err) {
    const kind = classifyLeaderError(err, {
      unsupported: info.unsupported,
      source: "info",
    });
    return { soft: true, kind, unsupported: kind === "unsupported" };
  }
  return { soft: false, kind: null, unsupported: false };
}

/** CSS account-badge modifier for connect tone. */
export function leaderConnectBadgeClass(tone: LeaderConnectTone): string {
  if (tone === "ok") return "account-badge account-badge--ok";
  if (tone === "err") return "account-badge account-badge--warn";
  if (tone === "warn") return "account-badge account-badge--warn";
  return "account-badge account-badge--muted";
}
