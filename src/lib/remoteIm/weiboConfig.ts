/**
 * Weibo pure config helpers — no I/O.
 *
 * Spec §6.13: WebSocket private-message transport (no public URL).
 * Required: app_id + app_secret. Advanced: token_endpoint, ws_endpoint.
 * Soft status never claims a live WebSocket — only credential / endpoint posture.
 * Primary bind is paste-first (optional guided setup still GUI).
 */

/** Product transport: Weibo subscription-style WebSocket (no public webhook). */
export type WeiboTransport = "websocket";

export type WeiboConfigValidation = {
  ok: boolean;
  /** Missing / invalid option / secret keys (never values) */
  missing: string[];
  /** Issues that do not block vault reuse but should warn in health */
  warnings: string[];
  transport: WeiboTransport;
  /** WebSocket never needs a public HTTPS callback */
  needsPublicUrl: false;
  /** True when options.token_endpoint is non-empty */
  customTokenEndpoint: boolean;
  /** True when options.ws_endpoint (or ws_url) is non-empty */
  customWsEndpoint: boolean;
  /**
   * Soft status code for UI / host test mapping.
   * Never claims live WebSocket connectivity — only credential posture.
   */
  softStatus:
    | "ready_ws"
    | "missing_credentials"
    | "invalid_app_id_format"
    | "invalid_token_endpoint"
    | "invalid_ws_endpoint"
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
 * Soft App ID / App Key shape check. Weibo open-platform ids are typically
 * numeric or alphanumeric. Empty is "missing", not invalid.
 */
export function isWeiboAppIdFormat(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (/\s/.test(t)) return false;
  if (t.length < 3 || t.length > 128) return false;
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{2,127}$/.test(t);
}

/**
 * Token HTTP endpoint sanity: empty is valid (platform default).
 * When set, must be absolute http(s) with a host.
 */
export function isWeiboTokenEndpointUrl(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  try {
    const u = new URL(t);
    const scheme = u.protocol.replace(":", "").toLowerCase();
    if (scheme !== "http" && scheme !== "https") return false;
    return !!u.hostname;
  } catch {
    return false;
  }
}

/**
 * WebSocket endpoint sanity: empty is valid (platform default).
 * When set, accept ws(s) or http(s) with a host (http(s) may upgrade at runtime).
 */
export function isWeiboWsEndpointUrl(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  try {
    const u = new URL(t);
    const scheme = u.protocol.replace(":", "").toLowerCase();
    if (!["ws", "wss", "http", "https"].includes(scheme)) return false;
    return !!u.hostname;
  } catch {
    return false;
  }
}

/** Non-secret bind keys required for WS (§6.13). */
export function weiboRequiredNonSecretKeys(): readonly string[] {
  return ["app_id"];
}

/** Secret bind keys required for WS (§6.13). */
export function weiboRequiredSecretKeys(): readonly string[] {
  return ["app_secret"];
}

/** Optional advanced / ACL keys (not required for ready). */
export function weiboOptionalKeys(): readonly string[] {
  return ["allow_from", "token_endpoint", "ws_endpoint", "ws_url"];
}

export type ValidateWeiboConfigInput = {
  options: Record<string, unknown>;
  /**
   * Secret field keys currently non-empty in the form (never values).
   * Accepts app_secret / appSecret / secret aliases.
   */
  secretKeysFilled?: ReadonlySet<string>;
  /** Vault already has credentials for this instance */
  hasCredentials?: boolean;
  /**
   * When the form has a non-empty app_id, pass for format check only.
   * Never logged or stored by this helper.
   */
  appIdValue?: string | null;
};

/**
 * Weibo bind validation (pure).
 * Does not read secret vault values — only key presence + option shapes.
 */
export function validateWeiboConfig(
  input: ValidateWeiboConfigInput,
): WeiboConfigValidation {
  const missing: string[] = [];
  const warnings: string[] = [];
  const secrets = input.secretKeysFilled ?? new Set<string>();

  const appIdFromOptions =
    optionString(input.options, "app_id") ||
    optionString(input.options, "app_key") ||
    optionString(input.options, "appId");
  const appIdRaw =
    (input.appIdValue != null && String(input.appIdValue).trim()
      ? String(input.appIdValue).trim()
      : "") || appIdFromOptions;

  if (!appIdRaw) {
    missing.push("app_id");
  }

  const secretFilled =
    secrets.has("app_secret") ||
    secrets.has("appSecret") ||
    secrets.has("secret");
  if (!secretFilled && !input.hasCredentials) {
    missing.push("app_secret");
  }

  const formatInvalid = !!appIdRaw && !isWeiboAppIdFormat(appIdRaw);
  if (formatInvalid && !missing.includes("app_id")) {
    missing.push("app_id");
  }

  const tokenEndpoint = optionString(input.options, "token_endpoint");
  const customTokenEndpoint = !!tokenEndpoint;
  if (customTokenEndpoint && !isWeiboTokenEndpointUrl(tokenEndpoint)) {
    missing.push("token_endpoint");
  }

  const wsEndpoint =
    optionString(input.options, "ws_endpoint") ||
    optionString(input.options, "ws_url");
  const customWsEndpoint = !!wsEndpoint;
  if (customWsEndpoint && !isWeiboWsEndpointUrl(wsEndpoint)) {
    missing.push("ws_endpoint");
  }

  // Soft: open allow_from in options is informational only
  const allowFrom = optionString(input.options, "allow_from");
  if (allowFrom === "*") {
    warnings.push("open_acl");
  }

  let softStatus: WeiboConfigValidation["softStatus"];
  if (formatInvalid) {
    softStatus = "invalid_app_id_format";
  } else if (customTokenEndpoint && !isWeiboTokenEndpointUrl(tokenEndpoint)) {
    softStatus = "invalid_token_endpoint";
  } else if (customWsEndpoint && !isWeiboWsEndpointUrl(wsEndpoint)) {
    softStatus = "invalid_ws_endpoint";
  } else if (missing.length === 0) {
    softStatus = "ready_ws";
  } else if (!input.hasCredentials && !secretFilled && !appIdRaw) {
    softStatus = "missing_credentials";
  } else if (
    !input.hasCredentials &&
    !secretFilled &&
    missing.includes("app_secret") &&
    missing.length === 1
  ) {
    softStatus = "missing_credentials";
  } else if (
    !input.hasCredentials &&
    !appIdRaw &&
    secretFilled &&
    missing.includes("app_id")
  ) {
    softStatus = "missing_credentials";
  } else {
    softStatus = "incomplete";
  }

  const ok = missing.length === 0 && softStatus === "ready_ws";

  return {
    ok,
    missing,
    warnings,
    transport: "websocket",
    needsPublicUrl: false,
    customTokenEndpoint,
    customWsEndpoint,
    softStatus,
  };
}

/** i18n hint keys for Weibo health card (order preserved). */
export function weiboHealthHintKeys(
  validation: WeiboConfigValidation,
  extras?: { openAcl?: boolean },
): string[] {
  const keys: string[] = [];
  // Always state WS / no public URL (honest vs webhook products)
  keys.push("settings.remoteIm.health.hint.weiboWs");
  keys.push("settings.remoteIm.health.hint.weiboNoPublicUrl");
  keys.push("settings.remoteIm.health.hint.weiboPasteFirst");

  if (validation.softStatus === "invalid_app_id_format") {
    keys.push("settings.remoteIm.health.hint.weiboAppIdFormat");
  } else if (validation.softStatus === "invalid_token_endpoint") {
    keys.push("settings.remoteIm.health.hint.weiboTokenEndpointInvalid");
  } else if (validation.softStatus === "invalid_ws_endpoint") {
    keys.push("settings.remoteIm.health.hint.weiboWsEndpointInvalid");
  } else if (
    validation.softStatus === "incomplete" ||
    validation.softStatus === "missing_credentials"
  ) {
    keys.push("settings.remoteIm.health.hint.weiboMissingKeys");
  }

  if (
    validation.customTokenEndpoint &&
    validation.softStatus !== "invalid_token_endpoint"
  ) {
    keys.push("settings.remoteIm.health.hint.weiboTokenEndpoint");
  }
  if (
    validation.customWsEndpoint &&
    validation.softStatus !== "invalid_ws_endpoint"
  ) {
    keys.push("settings.remoteIm.health.hint.weiboWsEndpoint");
  }

  if (extras?.openAcl) {
    keys.push("settings.remoteIm.health.hint.openAcl");
  }
  return keys;
}

/** Map soft status → short host/test message code (no secrets). */
export function weiboSoftStatusMessage(
  validation: WeiboConfigValidation,
): string {
  switch (validation.softStatus) {
    case "ready_ws":
      return "weibo_ws_credentials_present";
    case "invalid_app_id_format":
      return "invalid_weibo_app_id_format";
    case "invalid_token_endpoint":
      return "invalid_weibo_token_endpoint";
    case "invalid_ws_endpoint":
      return "invalid_weibo_ws_endpoint";
    case "missing_credentials":
      return "missing_weibo_credentials";
    case "incomplete":
      return `missing_weibo_fields:${validation.missing.join(",") || "unknown"}`;
    default:
      return "missing_weibo_credentials";
  }
}
