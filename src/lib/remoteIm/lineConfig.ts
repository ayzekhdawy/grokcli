/**
 * LINE Messaging API pure config helpers — no I/O.
 *
 * Spec §6.14: **Webhook · needs public URL**. Validation covers
 * channel_secret + channel_access_token (access_token alias), optional
 * port / callback_path shape. Soft status never claims the public
 * callback is live — only credential / local listen posture.
 */

/** Product transport: webhook only (LINE does not offer long-poll for bots). */
export type LineTransport = "webhook";

/** Default local webhook port (must match Rust `DEFAULT_WEBHOOK_PORT` + UI). */
export const LINE_DEFAULT_WEBHOOK_PORT = 8081;

/** Default callback path when options.callback_path is empty. */
export const LINE_DEFAULT_CALLBACK_PATH = "/line/callback";

export type LineConfigValidation = {
  ok: boolean;
  /** Missing / invalid option / secret keys (never values) */
  missing: string[];
  /** Issues that do not always block ready but should warn in health */
  warnings: string[];
  transport: LineTransport;
  /** LINE always needs a public HTTPS callback (tunnel helper is optional). */
  needsPublicUrl: true;
  /** Effective local listen port (default 8081 when unset/invalid shape deferred). */
  port: number;
  /** True when options.port is non-empty */
  portSet: boolean;
  /** Effective callback path (default /line/callback). */
  callbackPath: string;
  /** True when options.callback_path is non-empty */
  callbackPathSet: boolean;
  /**
   * Soft status code for UI / host test mapping.
   * Never claims live public webhook reachability.
   */
  softStatus:
    | "ready_webhook"
    | "missing_credentials"
    | "invalid_port"
    | "invalid_callback_path"
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
 * Parse a local listen port. Empty → null (use default).
 * Accepts number or digit string; rejects out-of-range / garbage.
 */
export function parseLineWebhookPort(
  raw: unknown,
): { ok: true; port: number | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, port: null };
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) return { ok: false };
    if (raw < 1 || raw > 65535) return { ok: false };
    return { ok: true, port: raw };
  }
  const t = String(raw).trim();
  if (!t) return { ok: true, port: null };
  if (!/^\d{1,5}$/.test(t)) return { ok: false };
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return { ok: false };
  return { ok: true, port: n };
}

/**
 * Callback path shape: empty is valid (default applies).
 * When set, must start with `/` and not contain whitespace or `://`.
 */
export function isLineCallbackPath(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  if (!t.startsWith("/")) return false;
  if (/\s/.test(t)) return false;
  if (t.includes("://")) return false;
  return t.length <= 256;
}

/** Normalize callback path; empty → product default. */
export function normalizeLineCallbackPath(raw: string): string {
  const t = raw.trim();
  if (!t) return LINE_DEFAULT_CALLBACK_PATH;
  return t.startsWith("/") ? t : `/${t}`;
}

/**
 * Recommended cloudflared quick-tunnel snippet (helper only — not forced).
 * Points at local webhook listen port; user still pastes the public URL into
 * LINE Developers console.
 */
export function lineCloudflaredSnippet(
  port?: number | string | null,
): string {
  const parsed = parseLineWebhookPort(port ?? "");
  const p =
    parsed.ok && parsed.port != null
      ? parsed.port
      : LINE_DEFAULT_WEBHOOK_PORT;
  return `cloudflared tunnel --url http://127.0.0.1:${p}`;
}

/** Required secret bind keys (§6.14). Canonical GUI keys. */
export function lineRequiredSecretKeys(): readonly string[] {
  return ["channel_secret", "channel_access_token"];
}

/** Optional advanced keys (not required for ready). */
export function lineOptionalKeys(): readonly string[] {
  return ["port", "callback_path", "allow_from", "access_token"];
}

export type ValidateLineConfigInput = {
  options: Record<string, unknown>;
  /**
   * Secret field keys currently non-empty in the form (never values).
   * Accepts channel_access_token / access_token aliases.
   */
  secretKeysFilled?: ReadonlySet<string>;
  /** Vault already has credentials for this instance */
  hasCredentials?: boolean;
};

/**
 * LINE webhook bind validation (pure).
 * Does not read secret values — only key presence + option shapes.
 * Never asserts that the public callback is reachable.
 */
export function validateLineConfig(
  input: ValidateLineConfigInput,
): LineConfigValidation {
  const missing: string[] = [];
  const warnings: string[] = [];
  const secrets = input.secretKeysFilled ?? new Set<string>();

  const secretInForm = secrets.has("channel_secret");
  const tokenInForm =
    secrets.has("channel_access_token") || secrets.has("access_token");

  if (!secretInForm && !input.hasCredentials) {
    missing.push("channel_secret");
  }
  if (!tokenInForm && !input.hasCredentials) {
    missing.push("channel_access_token");
  }

  const portRaw = input.options.port;
  const portSet =
    portRaw !== undefined &&
    portRaw !== null &&
    String(portRaw).trim() !== "";
  const portParsed = parseLineWebhookPort(portRaw);
  let port = LINE_DEFAULT_WEBHOOK_PORT;
  if (!portParsed.ok) {
    missing.push("port");
  } else if (portParsed.port != null) {
    port = portParsed.port;
  }

  const pathRaw = optionString(input.options, "callback_path");
  const callbackPathSet = !!pathRaw;
  let callbackPath = LINE_DEFAULT_CALLBACK_PATH;
  if (callbackPathSet) {
    if (!isLineCallbackPath(pathRaw)) {
      missing.push("callback_path");
    } else {
      callbackPath = normalizeLineCallbackPath(pathRaw);
    }
  }

  // Soft: non-default path still needs the public URL to include it
  if (callbackPathSet && callbackPath !== LINE_DEFAULT_CALLBACK_PATH) {
    warnings.push("custom_callback_path");
  }

  let softStatus: LineConfigValidation["softStatus"];
  if (!portParsed.ok) {
    softStatus = "invalid_port";
  } else if (callbackPathSet && !isLineCallbackPath(pathRaw)) {
    softStatus = "invalid_callback_path";
  } else if (missing.length === 0) {
    softStatus = "ready_webhook";
  } else if (
    !input.hasCredentials &&
    !secretInForm &&
    !tokenInForm
  ) {
    softStatus = "missing_credentials";
  } else {
    softStatus = "incomplete";
  }

  const ok = missing.length === 0 && softStatus === "ready_webhook";

  return {
    ok,
    missing,
    warnings,
    transport: "webhook",
    needsPublicUrl: true,
    port,
    portSet,
    callbackPath,
    callbackPathSet,
    softStatus,
  };
}

/** i18n hint keys for LINE health card (order preserved; keep under health card cap). */
export function lineHealthHintKeys(
  validation: LineConfigValidation,
  extras?: { openAcl?: boolean },
): string[] {
  const keys: string[] = [];
  // Always state webhook + public URL / tunnel honesty (no live claim without proof)
  keys.push("settings.remoteIm.health.hint.lineWebhook");
  keys.push("settings.remoteIm.health.hint.linePublicUrl");
  keys.push("settings.remoteIm.health.hint.lineTunnel");
  keys.push("settings.remoteIm.health.hint.lineNoLiveClaim");

  if (
    validation.softStatus === "missing_credentials" ||
    (validation.softStatus === "incomplete" &&
      (validation.missing.includes("channel_secret") ||
        validation.missing.includes("channel_access_token")))
  ) {
    keys.push("settings.remoteIm.health.hint.lineMissingKeys");
  }

  if (validation.softStatus === "invalid_port") {
    keys.push("settings.remoteIm.health.hint.linePortInvalid");
  } else if (
    validation.portSet &&
    validation.port !== LINE_DEFAULT_WEBHOOK_PORT
  ) {
    keys.push("settings.remoteIm.health.hint.linePortCustom");
  }

  if (validation.softStatus === "invalid_callback_path") {
    keys.push("settings.remoteIm.health.hint.linePathInvalid");
  } else if (validation.warnings.includes("custom_callback_path")) {
    keys.push("settings.remoteIm.health.hint.linePathCustom");
  }

  if (extras?.openAcl) {
    keys.push("settings.remoteIm.health.hint.openAcl");
  }
  return keys;
}

/** Map soft status → short host/test message code (no secrets). */
export function lineSoftStatusMessage(
  validation: LineConfigValidation,
): string {
  switch (validation.softStatus) {
    case "ready_webhook":
      return validation.portSet &&
        validation.port !== LINE_DEFAULT_WEBHOOK_PORT
        ? "line_webhook_credentials_present_custom_port"
        : "line_webhook_credentials_present";
    case "invalid_port":
      return "invalid_line_port";
    case "invalid_callback_path":
      return "invalid_line_callback_path";
    case "missing_credentials":
      return "missing_line_credentials";
    case "incomplete":
      return `missing_line_fields:${validation.missing.join(",") || "unknown"}`;
    default:
      return "missing_line_credentials";
  }
}
