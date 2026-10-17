/**
 * QQ OneBot pure config helpers — no I/O.
 *
 * Spec §6.10: forward WebSocket (user self-hosted NapCat / LLOneBot / etc.).
 * Required: `ws_url` or `url`. Optional: access `token`, `allow_from`.
 * Soft status never claims a live WS session — only URL shape / bind posture.
 * Community-bridge risk is surfaced via health hints + UI callout.
 */

/** Product transport: forward WebSocket only (user-hosted OneBot). */
export type QqTransport = "forward_ws";

export type QqConfigValidation = {
  ok: boolean;
  /** Missing / invalid option keys (never secret values) */
  missing: string[];
  /** Issues that do not block ready but should warn in health */
  warnings: string[];
  transport: QqTransport;
  /**
   * Which bind key supplied the URL (`ws_url` preferred over `url` alias).
   * Null when neither is set.
   */
  urlKey: "ws_url" | "url" | null;
  /** True when form/vault exposes a non-empty access token */
  tokenSet: boolean;
  /**
   * Soft status code for UI / host test mapping.
   * Never claims live OneBot WebSocket success.
   */
  softStatus:
    | "ready_forward_ws"
    | "missing_ws_url"
    | "invalid_ws_url"
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
 * Resolve OneBot forward-WS URL from options.
 * Prefers `ws_url`, falls back to `url` alias (cc-connect / NapCat style).
 */
export function qqWsUrlFromOptions(
  options?: Record<string, unknown> | null,
): { key: "ws_url" | "url" | null; value: string } {
  const ws = optionString(options, "ws_url");
  if (ws) return { key: "ws_url", value: ws };
  const url = optionString(options, "url");
  if (url) return { key: "url", value: url };
  return { key: null, value: "" };
}

/**
 * Forward WebSocket URL sanity: `ws://` or `wss://` with a non-empty host.
 * Empty is not "invalid format" — treated as missing by validate.
 * Never logs or stores the value.
 */
export function isQqWsUrl(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  try {
    const u = new URL(t);
    const scheme = u.protocol.replace(":", "").toLowerCase();
    if (scheme !== "ws" && scheme !== "wss") return false;
    return !!u.hostname;
  } catch {
    // Some engines are picky about ws:// — regex fallback
    return /^wss?:\/\/[^\s/]+/i.test(t);
  }
}

/** Detect scheme label when URL is parseable. */
export function qqWsScheme(raw: string): "ws" | "wss" | null {
  const t = raw.trim();
  if (!t) return null;
  const m = t.match(/^(wss?):\/\//i);
  if (!m) return null;
  const s = m[1].toLowerCase();
  return s === "ws" || s === "wss" ? s : null;
}

/**
 * Non-secret bind keys required for ready (§6.10).
 * Canonical GUI key is `ws_url`; `url` is an accepted alias.
 */
export function qqRequiredNonSecretKeys(): readonly string[] {
  return ["ws_url"];
}

/** Secret keys — token is optional for many OneBot reverse/forward setups. */
export function qqRequiredSecretKeys(): readonly string[] {
  return [];
}

/** Optional bind / ACL keys (not required for ready). */
export function qqOptionalKeys(): readonly string[] {
  return ["token", "access_token", "allow_from", "url"];
}

export type ValidateQqConfigInput = {
  options: Record<string, unknown>;
  /**
   * Secret field keys currently non-empty in the form (never values).
   * Accepts `token` / `access_token` aliases.
   */
  secretKeysFilled?: ReadonlySet<string>;
  /**
   * Vault already has credentials for this instance.
   * For QQ, vault secrets are optional (token-only); URL lives in options.
   * When true, missing URL still fails — hasCredentials alone is not enough.
   */
  hasCredentials?: boolean;
};

/**
 * QQ OneBot bind validation (pure).
 * Does not read secret vault values — only key presence + URL shape.
 */
export function validateQqConfig(
  input: ValidateQqConfigInput,
): QqConfigValidation {
  const missing: string[] = [];
  const warnings: string[] = [];
  const secrets = input.secretKeysFilled ?? new Set<string>();

  const { key: urlKey, value: urlRaw } = qqWsUrlFromOptions(input.options);
  // Form-only signal — vault may hold an optional token we cannot inspect.
  const tokenSet = secrets.has("token") || secrets.has("access_token");
  // hasCredentials is accepted for call-site symmetry with other packs; URL is
  // required in options regardless (token alone never makes QQ ready).
  void input.hasCredentials;

  if (!urlRaw) {
    missing.push("ws_url");
  } else if (!isQqWsUrl(urlRaw)) {
    missing.push("ws_url");
  }

  // Soft: open allow_from in options is informational (ACL also on instance)
  const allowFrom = optionString(input.options, "allow_from");
  if (allowFrom === "*") {
    warnings.push("open_acl");
  }

  // Soft: http(s) paste is a common NapCat mistake (HTTP API vs forward WS)
  if (urlRaw && /^https?:\/\//i.test(urlRaw.trim())) {
    warnings.push("http_url_not_ws");
  }

  const urlInvalid = !!urlRaw && !isQqWsUrl(urlRaw);

  let softStatus: QqConfigValidation["softStatus"];
  if (urlInvalid) {
    softStatus = "invalid_ws_url";
  } else if (missing.length === 0) {
    softStatus = "ready_forward_ws";
  } else if (!urlRaw) {
    softStatus = "missing_ws_url";
  } else {
    softStatus = "incomplete";
  }

  const ok = missing.length === 0 && softStatus === "ready_forward_ws";

  return {
    ok,
    missing,
    warnings,
    transport: "forward_ws",
    urlKey,
    tokenSet,
    softStatus,
  };
}

/** i18n hint keys for QQ health card (order preserved). */
export function qqHealthHintKeys(
  validation: QqConfigValidation,
  extras?: { openAcl?: boolean; tokenInForm?: boolean },
): string[] {
  const keys: string[] = [];
  // Always state forward WS / self-hosted + community risk (honest product posture)
  keys.push("settings.remoteIm.health.hint.qqForwardWs");
  keys.push("settings.remoteIm.health.hint.qqSelfHosted");
  keys.push("settings.remoteIm.health.hint.qqCommunityRisk");

  if (validation.softStatus === "invalid_ws_url") {
    keys.push("settings.remoteIm.health.hint.qqWsUrlInvalid");
  } else if (
    validation.softStatus === "missing_ws_url" ||
    (validation.softStatus === "incomplete" &&
      validation.missing.includes("ws_url"))
  ) {
    keys.push("settings.remoteIm.health.hint.qqMissingWsUrl");
  }

  if (validation.warnings.includes("http_url_not_ws")) {
    keys.push("settings.remoteIm.health.hint.qqHttpNotWs");
  }

  if (validation.softStatus === "ready_forward_ws") {
    if (extras?.tokenInForm || validation.tokenSet) {
      keys.push("settings.remoteIm.health.hint.qqTokenSet");
    } else {
      keys.push("settings.remoteIm.health.hint.qqTokenOptional");
    }
  }

  if (extras?.openAcl) {
    keys.push("settings.remoteIm.health.hint.qqAcl");
  }
  return keys;
}

/** Map soft status → short host/test message code (no secrets). */
export function qqSoftStatusMessage(
  validation: QqConfigValidation,
): string {
  switch (validation.softStatus) {
    case "ready_forward_ws":
      return validation.tokenSet
        ? "qq_forward_ws_credentials_present"
        : "qq_forward_ws_url_present";
    case "invalid_ws_url":
      return "invalid_qq_ws_url";
    case "missing_ws_url":
      return "missing_qq_ws_url";
    case "incomplete":
      return `missing_qq_fields:${validation.missing.join(",") || "unknown"}`;
    default:
      return "missing_qq_ws_url";
  }
}
