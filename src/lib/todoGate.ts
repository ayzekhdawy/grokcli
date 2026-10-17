/**
 * TodoGate (CLI 0.2.117+) — pure normalize + spawn + Settings honesty helpers.
 *
 * Runtime turn-end gate: when the model tries to end a turn with pending /
 * in_progress todos, the CLI can nudge before falling through to the user.
 *
 * - CLI flag: top-level `grok --todo-gate` (session-scoped; overrides remote
 *   `todo_gate_enabled` and the built-in default `false`). **Enable only** —
 *   there is no CLI flag for max fires.
 * - Config keys (agent-home independent mode): `todo_gate_enabled`,
 *   `todo_gate_max_fires_per_prompt` (1–20). Shared mode never rewrites
 *   `~/.grok/config.toml`.
 * - Soft-respawn after Settings changes so the next agent process reloads.
 * - Gate **fire activity** is CLI-side. The App only shows counts when a host
 *   signal is present; otherwise honesty is N/A (never invent fires).
 */

import type { MessageKey } from "@/i18n";

/** Min fires per prompt when the gate is used. */
export const MIN_TODO_GATE_MAX_FIRES = 1;
/** Max fires per prompt (product clamp). */
export const MAX_TODO_GATE_MAX_FIRES = 20;
/** Default max fires when unset / invalid (CLI-aligned middle ground). */
export const DEFAULT_TODO_GATE_MAX_FIRES = 3;

/** Top-level CLI flag (before `agent`). Enable only — no max-fires flag. */
export const TODO_GATE_CLI_FLAG = "--todo-gate";

/** Top-level config.toml key for the enable toggle. */
export const TODO_GATE_ENABLED_CONFIG_KEY = "todo_gate_enabled";

/** Top-level config.toml key for max fires per prompt. */
export const TODO_GATE_MAX_FIRES_CONFIG_KEY = "todo_gate_max_fires_per_prompt";

/** First CLI that documents TodoGate (`--todo-gate` / config keys). */
export const TODO_GATE_MIN_CLI = "0.2.117";

// ── Normalize ───────────────────────────────────────────────────────────────

/**
 * Normalize the enable toggle.
 * null / undefined → false (CLI built-in default).
 */
export function normalizeTodoGateEnabled(
  raw: boolean | null | undefined,
): boolean {
  return raw === true;
}

/**
 * Normalize max fires per prompt.
 * null / undefined / "" / non-finite / ≤0 → default (3).
 * Otherwise clamp to 1–20.
 */
export function normalizeTodoGateMaxFires(
  raw: number | string | null | undefined,
): number {
  if (raw === null || raw === undefined) return DEFAULT_TODO_GATE_MAX_FIRES;
  const n =
    typeof raw === "string"
      ? (() => {
          const t = raw.trim();
          if (!t) return NaN;
          return Number(t);
        })()
      : raw;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TODO_GATE_MAX_FIRES;
  const rounded = Math.round(n);
  if (rounded <= 0) return DEFAULT_TODO_GATE_MAX_FIRES;
  return Math.min(
    MAX_TODO_GATE_MAX_FIRES,
    Math.max(MIN_TODO_GATE_MAX_FIRES, rounded),
  );
}

/**
 * True when raw max-fires input was clamped or defaulted (for UI honesty).
 * Empty / invalid → defaulted; out of 1–20 or non-integer → clamped.
 */
export function todoGateMaxFiresWasAdjusted(
  raw: number | string | null | undefined,
): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return true;
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) return true;
    const rounded = Math.round(n);
    return (
      rounded !== n ||
      rounded < MIN_TODO_GATE_MAX_FIRES ||
      rounded > MAX_TODO_GATE_MAX_FIRES
    );
  }
  if (!Number.isFinite(raw) || raw <= 0) return true;
  const rounded = Math.round(raw);
  return (
    rounded !== raw ||
    rounded < MIN_TODO_GATE_MAX_FIRES ||
    rounded > MAX_TODO_GATE_MAX_FIRES
  );
}

// ── Spawn / config ──────────────────────────────────────────────────────────

/**
 * Top-level CLI args when enabled:
 * `["--todo-gate"]`. Empty when disabled (CLI default off).
 * Max fires is **not** a CLI flag — config-only (independent agent-home).
 */
export function todoGateSpawnArgs(
  enabled: boolean | null | undefined,
): string[] {
  return normalizeTodoGateEnabled(enabled) ? [TODO_GATE_CLI_FLAG] : [];
}

/** Config.toml assignment lines for independent agent-home writes. */
export function todoGateConfigAssignments(
  enabled: boolean | null | undefined,
  maxFires: number | string | null | undefined,
): { enabled: string; maxFires: string } {
  return {
    enabled: `${TODO_GATE_ENABLED_CONFIG_KEY} = ${normalizeTodoGateEnabled(enabled)}`,
    maxFires: `${TODO_GATE_MAX_FIRES_CONFIG_KEY} = ${normalizeTodoGateMaxFires(maxFires)}`,
  };
}

/** True when two enable values normalize equal (soft-respawn flip check). */
export function todoGateEnabledEqual(
  a: boolean | null | undefined,
  b: boolean | null | undefined,
): boolean {
  return normalizeTodoGateEnabled(a) === normalizeTodoGateEnabled(b);
}

/** True when two max-fires values normalize equal (soft-respawn flip check). */
export function todoGateMaxFiresEqual(
  a: number | string | null | undefined,
  b: number | string | null | undefined,
): boolean {
  return normalizeTodoGateMaxFires(a) === normalizeTodoGateMaxFires(b);
}

/**
 * Soft-gate: whether the CLI is known to document TodoGate.
 * - Known ≥ 0.2.117 → true
 * - Known older → false
 * - Unknown / unparseable → null (soft-fail: still allow Settings write)
 *
 * Pure parse of `x.y.z` tokens only (no host IO).
 */
export function cliSupportsTodoGate(
  rawVersion: string | null | undefined,
): boolean | null {
  if (rawVersion == null) return null;
  const m = String(rawVersion).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3] ?? "0");
  if (![major, minor, patch].every((n) => Number.isFinite(n))) return null;
  if (major > 0) return true;
  if (major < 0) return false;
  if (minor > 2) return true;
  if (minor < 2) return false;
  return patch >= 117;
}

// ── Max-fires apply path honesty ────────────────────────────────────────────

/**
 * Where max fires actually applies.
 *
 * - `inactive` — gate off; value is stored but unused until enable
 * - `independent_config` — App writes agent-home `todo_gate_max_fires_per_prompt`
 * - `shared_app_only` — App stores the setting but never rewrites `~/.grok`;
 *   no CLI flag for max fires, so shared mode does not apply App max fires
 */
export type TodoGateMaxFiresApplyPath =
  | "inactive"
  | "independent_config"
  | "shared_app_only";

/** Session data mode: independent agent-home vs shared ~/.grok. */
export function isIndependentSessionDataMode(
  sessionDataMode: string | null | undefined,
): boolean {
  const m = (sessionDataMode ?? "").trim().toLowerCase();
  return m !== "shared";
}

/**
 * Resolve max-fires apply path from enable + session data mode.
 */
export function todoGateMaxFiresApplyPath(
  enabled: boolean | null | undefined,
  sessionDataMode: string | null | undefined,
): TodoGateMaxFiresApplyPath {
  if (!normalizeTodoGateEnabled(enabled)) return "inactive";
  return isIndependentSessionDataMode(sessionDataMode)
    ? "independent_config"
    : "shared_app_only";
}

/** Message key for max-fires apply-path honesty. */
export function todoGateMaxFiresApplyPathMessageKey(
  path: TodoGateMaxFiresApplyPath,
): MessageKey {
  switch (path) {
    case "inactive":
      return "settings.todoGateMaxFires.inactive";
    case "independent_config":
      return "settings.todoGateMaxFires.independent";
    case "shared_app_only":
      return "settings.todoGateMaxFires.shared";
  }
}

/** Message key for soft-respawn note under Todo gate Settings. */
export function todoGateSoftRespawnNoteKey(): MessageKey {
  return "settings.todoGate.softRespawnNote";
}

/** Message key for effective max-fires line (`{n}` / `{min}` / `{max}` / `{default}`). */
export function todoGateMaxFiresEffectiveKey(): MessageKey {
  return "settings.todoGateMaxFires.effective";
}

/** Message key when raw input was clamped/defaulted. */
export function todoGateMaxFiresClampedKey(): MessageKey {
  return "settings.todoGateMaxFires.clamped";
}

// ── Activity / fire status (host signal or honest N/A) ───────────────────────

/**
 * Optional host signal for TodoGate fire activity.
 * App never invents counts when this is missing / unavailable.
 */
export type TodoGateFireSignal = {
  /**
   * Fires observed for the current (or last known) prompt.
   * Null/undefined = unknown count.
   */
  firesThisPrompt?: number | null;
  /** Cap for the signal (may mirror Settings max). */
  maxFires?: number | null;
  /** Epoch ms of last fire, if known. */
  lastFiredAt?: number | null;
  /** Session the signal belongs to. */
  sessionId?: string | null;
  /**
   * Explicit host availability.
   * - `false` → probe soft-failed / unknown (not the same as “zero fires”)
   * - `true` / omitted with a numeric fires count → treat as available
   */
  available?: boolean | null;
};

export type TodoGateActivityKind =
  | "na"
  | "unavailable"
  | "idle"
  | "fired";

export type TodoGateActivityTone = "muted" | "ok" | "info" | "warn";

export type TodoGateActivityView = {
  kind: TodoGateActivityKind;
  tone: TodoGateActivityTone;
  /** Non-negative fire count when known; null for na/unavailable. */
  fires: number | null;
  maxFires: number | null;
  lastFiredAt: number | null;
  sessionId: string | null;
  messageKey: MessageKey;
  /** Interpolation vars for `t(messageKey, vars)`. */
  vars: { n?: number; max?: number };
};

function asNonNegInt(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * Resolve gate-fire activity for Settings / status line.
 * Missing signal → honest N/A (never invents 0 fires as “idle” without a host).
 */
export function resolveTodoGateActivity(
  signal: TodoGateFireSignal | null | undefined,
  fallbackMaxFires?: number | string | null,
): TodoGateActivityView {
  const defaultMax = normalizeTodoGateMaxFires(fallbackMaxFires);

  if (signal == null) {
    return {
      kind: "na",
      tone: "muted",
      fires: null,
      maxFires: null,
      lastFiredAt: null,
      sessionId: null,
      messageKey: "settings.todoGate.activity.na",
      vars: {},
    };
  }

  if (signal.available === false) {
    return {
      kind: "unavailable",
      tone: "warn",
      fires: null,
      maxFires: asNonNegInt(signal.maxFires) ?? defaultMax,
      lastFiredAt: null,
      sessionId:
        typeof signal.sessionId === "string" && signal.sessionId.trim()
          ? signal.sessionId.trim()
          : null,
      messageKey: "settings.todoGate.activity.unavailable",
      vars: {},
    };
  }

  const fires = asNonNegInt(signal.firesThisPrompt);
  // No explicit count and available not true → still N/A (presence-only object).
  if (fires == null && signal.available !== true) {
    return {
      kind: "na",
      tone: "muted",
      fires: null,
      maxFires: asNonNegInt(signal.maxFires),
      lastFiredAt: null,
      sessionId:
        typeof signal.sessionId === "string" && signal.sessionId.trim()
          ? signal.sessionId.trim()
          : null,
      messageKey: "settings.todoGate.activity.na",
      vars: {},
    };
  }

  const maxFires = asNonNegInt(signal.maxFires) ?? defaultMax;
  const lastFiredAt =
    signal.lastFiredAt != null &&
    Number.isFinite(signal.lastFiredAt) &&
    signal.lastFiredAt > 0
      ? Math.floor(signal.lastFiredAt)
      : null;
  const sessionId =
    typeof signal.sessionId === "string" && signal.sessionId.trim()
      ? signal.sessionId.trim()
      : null;
  const count = fires ?? 0;

  if (count <= 0) {
    return {
      kind: "idle",
      tone: "ok",
      fires: 0,
      maxFires,
      lastFiredAt,
      sessionId,
      messageKey: "settings.todoGate.activity.idle",
      vars: { max: maxFires },
    };
  }

  return {
    kind: "fired",
    tone: count >= maxFires ? "warn" : "info",
    fires: count,
    maxFires,
    lastFiredAt,
    sessionId,
    messageKey: "settings.todoGate.activity.fired",
    vars: { n: count, max: maxFires },
  };
}

// ── Combined Settings presentation ──────────────────────────────────────────

export type TodoGateSettingsView = {
  enabled: boolean;
  maxFires: number;
  maxFiresAdjusted: boolean;
  applyPath: TodoGateMaxFiresApplyPath;
  applyPathKey: MessageKey;
  softRespawnKey: MessageKey;
  effectiveKey: MessageKey;
  clampedKey: MessageKey | null;
  activity: TodoGateActivityView;
  /** Soft-fail banner when CLI is known older than 0.2.117. */
  cliTooOld: boolean;
  cliSupport: boolean | null;
  cliSoftFailKey: MessageKey | null;
};

/**
 * Build a pure Settings view model for Todo gate pro honesty.
 */
export function describeTodoGateSettings(input: {
  enabled?: boolean | null;
  maxFires?: number | string | null;
  /** Raw max-fires before normalize (for clamp honesty). */
  maxFiresRaw?: number | string | null;
  sessionDataMode?: string | null;
  cliVersion?: string | null;
  fireSignal?: TodoGateFireSignal | null;
}): TodoGateSettingsView {
  const enabled = normalizeTodoGateEnabled(input.enabled);
  const rawForAdjust =
    input.maxFiresRaw !== undefined ? input.maxFiresRaw : input.maxFires;
  const maxFires = normalizeTodoGateMaxFires(input.maxFires);
  const maxFiresAdjusted = todoGateMaxFiresWasAdjusted(rawForAdjust);
  const applyPath = todoGateMaxFiresApplyPath(enabled, input.sessionDataMode);
  const cliSupport = cliSupportsTodoGate(input.cliVersion);
  const cliTooOld = cliSupport === false;

  return {
    enabled,
    maxFires,
    maxFiresAdjusted,
    applyPath,
    applyPathKey: todoGateMaxFiresApplyPathMessageKey(applyPath),
    softRespawnKey: todoGateSoftRespawnNoteKey(),
    effectiveKey: todoGateMaxFiresEffectiveKey(),
    clampedKey: maxFiresAdjusted ? todoGateMaxFiresClampedKey() : null,
    activity: resolveTodoGateActivity(input.fireSignal, maxFires),
    cliTooOld,
    cliSupport,
    cliSoftFailKey: cliTooOld ? "settings.todoGate.cliTooOld" : null,
  };
}
