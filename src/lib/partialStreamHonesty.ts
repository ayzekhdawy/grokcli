/**
 * Partial stream (`includePartialMessages`) apply-path honesty.
 *
 * Product truth (CLI 0.2.117+):
 * - Toggle only affects **headless** paths that pair with
 *   `--output-format streaming-messages-json` (Remote IM, diagnostics).
 * - When on + CLI ≥ 0.2.117 → format upgrade + `--include-partial-messages`
 *   for incremental `stream_event` text/thinking deltas (`active`).
 * - When on + older / unknown CLI → soft-omit flag + keep `streaming-json`
 *   so spawn does not clap-crash (`soft_omit`).
 * - When off → whole messages only; no flag (`idle_off`).
 * - In-app ACP chat is a separate path — never invent live token streaming
 *   from this toggle (`host_only` when the call site is not headless).
 *
 * Pure helpers — no I/O. UI translates returned message keys via `t()`.
 */

import {
  PARTIAL_STREAM_MIN_CLI,
  cliSupportsIncludePartialMessages,
  normalizeIncludePartialMessages,
} from "./partialStream";

/** How the Settings partial-stream toggle takes effect on a given path. */
export type PartialStreamApplyEffect =
  | "active"
  | "soft_omit"
  | "idle_off"
  | "host_only";

/** Soft-fail kinds for partial-stream spawn / runtime errors. */
export type PartialStreamErrorKind =
  | "cli_too_old"
  | "unknown_flag"
  | "unsupported_format"
  | "host_only"
  | "other";

/** Banner payload: i18n key + interpolation vars (caller runs `t()`). */
export type PartialStreamHonestyBanner = {
  effect: PartialStreamApplyEffect;
  messageKey: string;
  vars: Record<string, string>;
  /** Visual weight for Settings hint / status line. */
  severity: "none" | "info" | "warn";
};

/**
 * Resolve when `includePartialMessages` applies on a path.
 *
 * Matrix:
 * | enabled | CLI ≥ 0.2.117 | isHeadlessPath | effect    |
 * | false   | *             | *              | idle_off  |
 * | true    | no / unknown  | *              | soft_omit |
 * | true    | yes           | false          | host_only |
 * | true    | yes           | true           | active    |
 *
 * - `idle_off` — toggle off; CLI default whole messages
 * - `soft_omit` — toggle on but CLI too old/unknown; flag omitted
 * - `host_only` — toggle on + new CLI, but path is not headless SMJ
 *   (e.g. in-app ACP chat — separate streaming path)
 * - `active` — headless + supported CLI; flag + streaming-messages-json
 */
export function resolvePartialStreamApplyEffect(input: {
  enabled: boolean | null | undefined;
  cliVersion: string | null | undefined;
  isHeadlessPath: boolean;
}): PartialStreamApplyEffect {
  if (!normalizeIncludePartialMessages(input.enabled)) return "idle_off";
  // Unknown / unparseable version → soft-omit (same as spawn soft-fail).
  if (cliSupportsIncludePartialMessages(input.cliVersion) !== true) {
    return "soft_omit";
  }
  if (!input.isHeadlessPath) return "host_only";
  return "active";
}

/** Stable i18n key for a partial-stream apply effect. */
export function partialStreamApplyEffectMessageKey(
  effect: PartialStreamApplyEffect,
): string {
  switch (effect) {
    case "active":
      return "settings.includePartialMessages.active";
    case "soft_omit":
      return "settings.includePartialMessages.softOmit";
    case "idle_off":
      return "settings.includePartialMessages.idleOff";
    case "host_only":
      return "settings.includePartialMessages.hostOnly";
  }
}

/**
 * Build a Settings / status honesty banner for the partial-stream toggle.
 *
 * Defaults `isHeadlessPath` to **true** so Settings notes describe the
 * Remote IM headless apply path (product surface for this flag).
 * Pass `isHeadlessPath: false` when classifying ACP / UI-chat call sites.
 *
 * Returns `null` when the toggle is off (`idle_off`) so the UI stays quiet
 * under the default; callers that want idle copy can use
 * {@link partialStreamApplyEffectMessageKey} directly.
 */
export function resolvePartialStreamBanner(input: {
  enabled: boolean | null | undefined;
  cliVersion: string | null | undefined;
  /** Defaults true (Settings / headless IM note). */
  isHeadlessPath?: boolean;
}): PartialStreamHonestyBanner | null {
  const isHeadlessPath = input.isHeadlessPath !== false;
  const effect = resolvePartialStreamApplyEffect({
    enabled: input.enabled,
    cliVersion: input.cliVersion,
    isHeadlessPath,
  });
  if (effect === "idle_off") return null;

  const severity: PartialStreamHonestyBanner["severity"] =
    effect === "soft_omit" ? "warn" : "info";

  return {
    effect,
    messageKey: partialStreamApplyEffectMessageKey(effect),
    vars: { minCli: PARTIAL_STREAM_MIN_CLI },
    severity,
  };
}

function errText(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const code =
      typeof (err as Error & { code?: unknown }).code === "string"
        ? String((err as Error & { code?: string }).code)
        : "";
    return `${code} ${err.message} ${err.name}`.trim();
  }
  if (typeof err === "object") {
    const o = err as {
      code?: unknown;
      message?: unknown;
      reason?: unknown;
      error?: unknown;
    };
    const parts = [o.code, o.message, o.reason, o.error]
      .filter((x) => x != null && String(x).trim())
      .map(String);
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function errCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "string") return c.trim().toLowerCase();
    if (typeof c === "number" && Number.isFinite(c)) return String(c);
  }
  return "";
}

/** Stable i18n key for a classified partial-stream error. */
export function partialStreamErrorMessageKey(
  kind: PartialStreamErrorKind,
): string {
  switch (kind) {
    case "cli_too_old":
      return "settings.includePartialMessages.err.cliTooOld";
    case "unknown_flag":
      return "settings.includePartialMessages.err.unknownFlag";
    case "unsupported_format":
      return "settings.includePartialMessages.err.unsupportedFormat";
    case "host_only":
      return "settings.includePartialMessages.err.hostOnly";
    case "other":
      return "settings.includePartialMessages.err.other";
  }
}

/**
 * Classify free-form host / CLI errors related to partial stream flags.
 * Soft kinds only — never invents “streaming active”.
 */
export function classifyPartialStreamError(err: unknown): PartialStreamErrorKind {
  if (err == null || err === "") return "other";

  const code = errCode(err);
  if (
    code === "cli_too_old" ||
    code === "cli-too-old" ||
    code === "cli_old" ||
    code === "version_too_old"
  ) {
    return "cli_too_old";
  }
  if (
    code === "unknown_flag" ||
    code === "unknown-flag" ||
    code === "unexpected_argument" ||
    code === "unrecognized_flag"
  ) {
    return "unknown_flag";
  }
  if (
    code === "unsupported_format" ||
    code === "unsupported-format" ||
    code === "bad_format" ||
    code === "invalid_format"
  ) {
    return "unsupported_format";
  }
  if (
    code === "host_only" ||
    code === "host-only" ||
    code === "need_tauri" ||
    code === "need-tauri"
  ) {
    return "host_only";
  }

  const s = errText(err).toLowerCase();
  if (!s.trim()) return "other";

  if (
    s.includes("need tauri") ||
    s.includes("need_tauri") ||
    s.includes("host only") ||
    s.includes("host_only") ||
    s.includes("desktop only") ||
    s.includes("requires the desktop") ||
    s.includes("not available in browser")
  ) {
    return "host_only";
  }

  if (
    s.includes("include-partial-messages") &&
    (s.includes("unrecognized") ||
      s.includes("unexpected argument") ||
      s.includes("unknown flag") ||
      s.includes("unknown option") ||
      s.includes("wasn't expected") ||
      s.includes("was not expected") ||
      s.includes("not found") ||
      s.includes("invalid") ||
      s.includes("error:"))
  ) {
    return "unknown_flag";
  }

  if (
    s.includes("cli too old") ||
    s.includes("cli_too_old") ||
    s.includes("version too old") ||
    s.includes("requires cli") ||
    s.includes("need 0.2.117") ||
    s.includes("need cli 0.2.117") ||
    /cli\s*(version\s*)?(is\s*)?(too\s+old|<|older)/.test(s) ||
    /0\.2\.\d+\s*<\s*0\.2\.117/.test(s)
  ) {
    return "cli_too_old";
  }

  if (
    (s.includes("partial") || s.includes("stream_event")) &&
    (s.includes("streaming-json") ||
      s.includes("output-format") ||
      s.includes("output format") ||
      s.includes("wrong format") ||
      s.includes("unsupported format") ||
      s.includes("not supported with") ||
      s.includes("ignored") ||
      s.includes("only valid with") ||
      s.includes("streaming-messages-json"))
  ) {
    // Wrong format pairing for the flag.
    if (
      s.includes("streaming-messages-json") &&
      (s.includes("only") || s.includes("requires") || s.includes("valid with"))
    ) {
      return "unsupported_format";
    }
    if (
      s.includes("streaming-json") ||
      s.includes("plain") ||
      s.includes("wrong format") ||
      s.includes("unsupported format") ||
      s.includes("not supported with")
    ) {
      return "unsupported_format";
    }
  }

  if (
    s.includes("unrecognized") &&
    (s.includes("partial") || s.includes("include-partial"))
  ) {
    return "unknown_flag";
  }

  return "other";
}
