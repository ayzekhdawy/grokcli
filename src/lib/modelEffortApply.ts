/**
 * Model / effort mid-session apply-path honesty.
 *
 * Product truth (Grok Build / Host):
 * - Model: spawn `--model`; after connect Host best-effort `session/set_model`.
 *   When the agent is live and set_model is supported → immediate RPC.
 *   Otherwise live → soft-respawn (next message reconnects); idle → next_message.
 * - Effort: spawn `--reasoning-effort` only. **No** `session/set_effort` RPC.
 *   Live agent → soft-respawn; idle → next_message.
 *
 * Pure helpers — no I/O. UI translates returned message keys via `t()`.
 */

/** How a composer model/effort change takes effect. */
export type ApplyEffect =
  | "next_message"
  | "soft_respawn"
  | "immediate_rpc"
  | "unsupported";

/** Which composer control the user changed. */
export type ApplyKind = "model" | "effort";

/** Soft-fail kinds for model/effort apply host errors. */
export type ModelEffortErrorKind =
  | "set_model_failed"
  | "soft_respawn_failed"
  | "invalid_model"
  | "invalid_effort"
  | "disconnected"
  | "busy"
  | "other";

/** Banner payload: i18n key + interpolation vars (caller runs `t()`). */
export type ApplyHonestyBanner = {
  messageKey: string;
  vars: Record<string, string>;
};

/**
 * Session states that mean a live ACP agent process is attached
 * (can receive set_model / is subject to soft-respawn).
 * Excludes idle / disconnected / connecting (no stable ACP yet).
 */
const LIVE_AGENT_STATES = new Set([
  "ready",
  "streaming",
  "awaiting_permission",
]);

/**
 * True when the session snapshot state indicates a live agent process.
 * Pure: accepts free-form state strings from SessionState / live map.
 */
export function sessionHasLiveAgent(
  state: string | null | undefined,
): boolean {
  if (state == null) return false;
  return LIVE_AGENT_STATES.has(String(state).trim().toLowerCase());
}

/**
 * Resolve when a **model** change applies.
 *
 * - Idle (no live agent): next spawn / next message picks up prefs → `next_message`
 * - Live + `supportsSetModel === true`: Host `session/set_model` → `immediate_rpc`
 * - Live + `supportsSetModel === false`: cannot hot-switch → `soft_respawn`
 * - Live + supports unknown (default): conservative `soft_respawn` honesty
 *   (App should pass `true` when Tauri/ACP set_model is available)
 */
export function resolveModelApplyEffect(input: {
  hasLiveAgent: boolean;
  supportsSetModel?: boolean;
}): ApplyEffect {
  if (!input.hasLiveAgent) return "next_message";
  if (input.supportsSetModel === true) return "immediate_rpc";
  if (input.supportsSetModel === false) return "soft_respawn";
  return "soft_respawn";
}

/**
 * Resolve when an **effort** change applies.
 * No mid-session set_effort RPC — live agent always soft-respawns;
 * idle prefs apply on the next connect.
 */
export function resolveEffortApplyEffect(input: {
  hasLiveAgent: boolean;
}): ApplyEffect {
  if (!input.hasLiveAgent) return "next_message";
  return "soft_respawn";
}

/**
 * Build a short honesty banner for toasts / inline chips after the user
 * changes model or effort. Never claims success when effect is unsupported.
 */
export function buildApplyHonestyBanner(input: {
  kind: ApplyKind;
  effect: ApplyEffect;
  modelId?: string;
  effortId?: string;
}): ApplyHonestyBanner {
  const vars: Record<string, string> = {};
  const model = input.modelId?.trim();
  const effort = input.effortId?.trim();
  if (model) vars.model = model;
  if (effort) vars.effort = effort;

  const { kind, effect } = input;
  switch (effect) {
    case "immediate_rpc":
      return {
        messageKey:
          kind === "model"
            ? "composer.apply.model.immediate"
            : "composer.apply.effort.immediate",
        vars,
      };
    case "soft_respawn":
      return {
        messageKey:
          kind === "model"
            ? "composer.apply.model.softRespawn"
            : "composer.apply.effort.softRespawn",
        vars,
      };
    case "next_message":
      return {
        messageKey:
          kind === "model"
            ? "composer.apply.model.nextMessage"
            : "composer.apply.effort.nextMessage",
        vars,
      };
    case "unsupported":
      return {
        messageKey:
          kind === "model"
            ? "composer.apply.model.unsupported"
            : "composer.apply.effort.unsupported",
        vars,
      };
  }
}

/**
 * Footer note under model / effort menus when a live agent is attached.
 * Null when idle (no need to warn — next message path is default).
 */
export function buildApplyFooterNote(input: {
  kind: ApplyKind;
  hasLiveAgent: boolean;
  /** For model only; default soft_respawn honesty when unknown. */
  supportsSetModel?: boolean;
}): ApplyHonestyBanner | null {
  if (!input.hasLiveAgent) return null;
  const effect =
    input.kind === "model"
      ? resolveModelApplyEffect({
          hasLiveAgent: true,
          supportsSetModel: input.supportsSetModel,
        })
      : resolveEffortApplyEffect({ hasLiveAgent: true });
  return buildApplyHonestyBanner({ kind: input.kind, effect });
}

/** Message key for a classified model/effort apply error. */
export function modelEffortErrorMessageKey(
  kind: ModelEffortErrorKind,
): string {
  switch (kind) {
    case "set_model_failed":
      return "composer.apply.error.setModelFailed";
    case "soft_respawn_failed":
      return "composer.apply.error.softRespawnFailed";
    case "invalid_model":
      return "composer.apply.error.invalidModel";
    case "invalid_effort":
      return "composer.apply.error.invalidEffort";
    case "disconnected":
      return "composer.apply.error.disconnected";
    case "busy":
      return "composer.apply.error.busy";
    case "other":
      return "composer.apply.error.other";
  }
}

/**
 * Classify free-form host / IPC errors from model or effort apply paths.
 * Soft kinds only — never invents success.
 */
export function classifyModelEffortError(err: unknown): ModelEffortErrorKind {
  const s = errText(err).toLowerCase();
  if (!s) return "other";

  if (
    /invalid\s*effort|unknown\s*effort|effort.*invalid|invalid effort/i.test(s)
  ) {
    return "invalid_effort";
  }
  if (
    /model id empty|invalid\s*model|unknown\s*model|model.*not\s*found|not a valid model/i.test(
      s,
    )
  ) {
    return "invalid_model";
  }
  if (
    /session\/set_model|set_model\b|failed to set model|set model failed/i.test(
      s,
    )
  ) {
    return "set_model_failed";
  }
  if (/soft[_\s-]?respawn|respawn failed|failed to respawn/i.test(s)) {
    return "soft_respawn_failed";
  }
  if (
    /not connected|disconnected|no (live )?session|no agent|agent (is )?gone|acp.*(missing|none)/i.test(
      s,
    )
  ) {
    return "disconnected";
  }
  if (
    /mid[_\s-]?turn|busy|streaming|awaiting.?permission|turn in progress/i.test(
      s,
    )
  ) {
    return "busy";
  }
  return "other";
}

function errText(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || String(err);
  if (typeof err === "object" && err !== null && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  try {
    return String(err);
  } catch {
    return "";
  }
}
