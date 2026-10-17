/**
 * QQ official bot pure config helpers — no I/O.
 *
 * Spec §6.11: official Gateway WebSocket (bots.qq.com / api.sgroup.qq.com).
 * Required: `app_id`, `app_secret`. Optional: `intents` (empty → product default
 * includes INTERACTION), `allow_from`.
 * Soft status never claims a live Gateway session — only credential posture.
 * Distinct from community OneBot `qq` (forward WS / NapCat).
 */

/** Product transport: official QQ bot Gateway only (no webhook / public URL). */
export type QqbotTransport = "gateway";

export type QqbotConfigValidation = {
  ok: boolean;
  /** Missing / invalid option / secret keys (never values) */
  missing: string[];
  /** Issues that do not block ready but should warn in health */
  warnings: string[];
  transport: QqbotTransport;
  /** True when options.intents is non-empty (else default INTERACTION note) */
  intentsSet: boolean;
  /**
   * Soft status code for UI / host test mapping.
   * Never claims live Gateway / identify success.
   */
  softStatus:
    | "ready_gateway"
    | "missing_app_id"
    | "missing_app_secret"
    | "invalid_app_id_format"
    | "incomplete";
};

function optionString(
  options: Record<string, unknown> | null | undefined,
  key: string,
): string {
  if (!options) return "";
  const v = options[key];
  if (v == null) return "";
  return String(v).trim();
}

/**
 * Soft App ID shape. Official QQ bots usually use a numeric AppID.
 * Also accepts common open-platform alphanumeric ids. Empty is missing, not invalid.
 */
export function isQqbotAppIdFormat(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (/\s/.test(t)) return false;
  if (t.length < 3 || t.length > 64) return false;
  // Numeric AppID (most common) or alphanumeric open-platform id
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(t);
}

/**
 * Intents option: empty means product default (includes INTERACTION).
 * Accept free-form text / bitmask string; never parses to claim live events.
 */
export function qqbotIntentsFromOptions(
  options?: Record<string, unknown> | null,
): { set: boolean; raw: string } {
  const raw = optionString(options, "intents");
  return { set: !!raw, raw };
}

/** Non-secret bind keys required for Gateway (§6.11). */
export function qqbotRequiredNonSecretKeys(): readonly string[] {
  return ["app_id"];
}

/** Secret bind keys required for Gateway (§6.11). */
export function qqbotRequiredSecretKeys(): readonly string[] {
  return ["app_secret"];
}

/** Optional advanced / ACL keys (not required for ready). */
export function qqbotOptionalKeys(): readonly string[] {
  return ["intents", "allow_from"];
}

export type ValidateQqbotConfigInput = {
  options: Record<string, unknown>;
  /**
   * Secret field keys currently non-empty in the form (never values).
   * Accepts `app_secret` / `appSecret` / `client_secret` aliases.
   */
  secretKeysFilled?: ReadonlySet<string>;
  /** Vault already has credentials for this instance */
  hasCredentials?: boolean;
  /**
   * When the form has a non-empty app_id, pass the raw value for format
   * validation only. Never logged or stored by this helper.
   * If omitted, `options.app_id` is used when present.
   */
  appIdValue?: string | null;
};

/**
 * QQ official bot bind validation (pure).
 * Does not read secret vault values — only key presence + optional format.
 */
export function validateQqbotConfig(
  input: ValidateQqbotConfigInput,
): QqbotConfigValidation {
  const missing: string[] = [];
  const warnings: string[] = [];
  const secrets = input.secretKeysFilled ?? new Set<string>();
  const { set: intentsSet } = qqbotIntentsFromOptions(input.options);

  const appIdRaw =
    input.appIdValue != null && String(input.appIdValue).trim()
      ? String(input.appIdValue).trim()
      : optionString(input.options, "app_id") ||
        optionString(input.options, "appId");

  if (!appIdRaw) {
    missing.push("app_id");
  } else if (!isQqbotAppIdFormat(appIdRaw)) {
    missing.push("app_id");
  }

  const secretInForm =
    secrets.has("app_secret") ||
    secrets.has("appSecret") ||
    secrets.has("client_secret");

  if (!secretInForm && !input.hasCredentials) {
    missing.push("app_secret");
  }

  // Soft: open allow_from in options is informational (ACL also on instance)
  const allowFrom = optionString(input.options, "allow_from");
  if (allowFrom === "*") {
    warnings.push("open_acl");
  }

  // Soft: empty intents → default INTERACTION (honest product note)
  if (!intentsSet) {
    warnings.push("intents_default_interaction");
  }

  const formatInvalid = !!appIdRaw && !isQqbotAppIdFormat(appIdRaw);

  let softStatus: QqbotConfigValidation["softStatus"];
  if (formatInvalid) {
    softStatus = "invalid_app_id_format";
  } else if (missing.length === 0) {
    softStatus = "ready_gateway";
  } else if (missing.includes("app_id") && !appIdRaw) {
    softStatus = "missing_app_id";
  } else if (
    missing.includes("app_secret") &&
    !secretInForm &&
    !input.hasCredentials
  ) {
    softStatus =
      missing.length === 1 ? "missing_app_secret" : "incomplete";
  } else {
    softStatus = "incomplete";
  }

  const ok = missing.length === 0 && softStatus === "ready_gateway";

  return {
    ok,
    missing,
    warnings,
    transport: "gateway",
    intentsSet,
    softStatus,
  };
}

/** i18n hint keys for QQ official bot health card (order preserved). */
export function qqbotHealthHintKeys(
  validation: QqbotConfigValidation,
  extras?: { openAcl?: boolean },
): string[] {
  const keys: string[] = [];
  // Always state official Gateway / no public URL / not OneBot
  keys.push("settings.remoteIm.health.hint.qqbotGateway");
  keys.push("settings.remoteIm.health.hint.qqbotNoWebhook");
  keys.push("settings.remoteIm.health.hint.qqbotNotOneBot");

  if (validation.softStatus === "invalid_app_id_format") {
    keys.push("settings.remoteIm.health.hint.qqbotAppIdFormat");
  } else if (
    validation.softStatus === "missing_app_id" ||
    (validation.softStatus === "incomplete" &&
      validation.missing.includes("app_id") &&
      !validation.missing.includes("app_secret"))
  ) {
    keys.push("settings.remoteIm.health.hint.qqbotMissingAppId");
  } else if (
    validation.softStatus === "missing_app_secret" ||
    (validation.softStatus === "incomplete" &&
      validation.missing.includes("app_secret"))
  ) {
    if (validation.missing.includes("app_id")) {
      keys.push("settings.remoteIm.health.hint.qqbotMissingKeys");
    } else {
      keys.push("settings.remoteIm.health.hint.qqbotMissingSecret");
    }
  } else if (
    validation.softStatus === "incomplete" &&
    validation.missing.length > 0
  ) {
    keys.push("settings.remoteIm.health.hint.qqbotMissingKeys");
  }

  if (!validation.intentsSet) {
    keys.push("settings.remoteIm.health.hint.qqbotIntentsDefault");
  } else {
    keys.push("settings.remoteIm.health.hint.qqbotIntentsCustom");
  }

  if (extras?.openAcl) {
    keys.push("settings.remoteIm.health.hint.qqbotAcl");
  }
  return keys;
}

/** Map soft status → short host/test message code (no secrets). */
export function qqbotSoftStatusMessage(
  validation: QqbotConfigValidation,
): string {
  switch (validation.softStatus) {
    case "ready_gateway":
      return validation.intentsSet
        ? "qqbot_gateway_credentials_present"
        : "qqbot_gateway_credentials_present_default_intents";
    case "invalid_app_id_format":
      return "invalid_qqbot_app_id_format";
    case "missing_app_id":
      return "missing_qqbot_app_id";
    case "missing_app_secret":
      return "missing_qqbot_app_secret";
    case "incomplete":
      return `missing_qqbot_fields:${validation.missing.join(",") || "unknown"}`;
    default:
      return "missing_qqbot_credentials";
  }
}
