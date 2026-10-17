/**
 * Headless `--include-partial-messages` (Grok Build CLI 0.2.117+).
 *
 * Emits incremental `stream_event` deltas (text/thinking) alongside whole
 * messages. **Only valid with** `--output-format streaming-messages-json`
 * (CLI ignores the flag with a warning on other formats).
 *
 * Pure helpers: only emit the flag when **enabled** and **format** is
 * `streaming-messages-json`. Soft-fail older CLIs (omit flag).
 */

/** First CLI that documents/accepts `--include-partial-messages`. */
export const PARTIAL_STREAM_MIN_CLI = "0.2.117";

/** Headless format that pairs with partial stream events. */
export const STREAMING_MESSAGES_JSON = "streaming-messages-json";

/** Remote IM / ACP-native NDJSON default (no partial stream events). */
export const STREAMING_JSON = "streaming-json";

/**
 * Normalize the AppSettings toggle.
 * null / undefined / non-true → false (CLI default — whole messages only).
 */
export function normalizeIncludePartialMessages(
  raw: boolean | null | undefined,
): boolean {
  return raw === true;
}

/**
 * Normalize a headless `--output-format` token.
 * Unknown / empty → `streaming-json` (App Remote IM default).
 */
export function normalizeHeadlessOutputFormat(raw: unknown): string {
  if (raw == null) return STREAMING_JSON;
  const s = String(raw).trim().toLowerCase().replace(/_/g, "-");
  if (
    s === "plain" ||
    s === "json" ||
    s === "streaming-json" ||
    s === "stream-json" ||
    s === "streaming-messages-json" ||
    s === "streaming-message-json" ||
    s === "messages-json"
  ) {
    if (s === "stream-json") return STREAMING_JSON;
    if (s === "streaming-message-json" || s === "messages-json") {
      return STREAMING_MESSAGES_JSON;
    }
    return s;
  }
  return STREAMING_JSON;
}

/** True when format is the Anthropic Messages API NDJSON wire format. */
export function isStreamingMessagesJsonFormat(format: unknown): boolean {
  return normalizeHeadlessOutputFormat(format) === STREAMING_MESSAGES_JSON;
}

/**
 * Top-level CLI argv for partial stream events.
 * Empty unless enabled **and** format is `streaming-messages-json`.
 */
export function includePartialMessagesSpawnArgs(
  enabled: boolean | null | undefined,
  outputFormat: unknown,
): string[] {
  if (!normalizeIncludePartialMessages(enabled)) return [];
  if (!isStreamingMessagesJsonFormat(outputFormat)) return [];
  return ["--include-partial-messages"];
}

/** True when spawn would emit the flag (ignoring CLI version). */
export function includePartialMessagesNeedsFlag(
  enabled: boolean | null | undefined,
  outputFormat: unknown,
): boolean {
  return includePartialMessagesSpawnArgs(enabled, outputFormat).length > 0;
}

/**
 * Pure: does a CLI version string look new enough for the partial flag?
 * Unparseable → `null` (caller soft-fails: omit non-default flags).
 */
export function cliSupportsIncludePartialMessages(
  rawVersion: string | null | undefined,
): boolean | null {
  if (rawVersion == null) return null;
  const m = String(rawVersion)
    .trim()
    .match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (![major, minor, patch].every(Number.isFinite)) return null;
  const [rm, rn, rp] = PARTIAL_STREAM_MIN_CLI.split(".").map(Number);
  if (major > rm!) return true;
  if (major < rm!) return false;
  if (minor > rn!) return true;
  if (minor < rn!) return false;
  return patch >= rp!;
}

/**
 * Soft-fail gate: only emit the flag when the CLI is known to support it.
 *
 * - Known ≥ 0.2.117 + enabled + streaming-messages-json → flag
 * - Known older / unknown version → omit (avoid clap crash)
 * - Disabled or wrong format → empty always
 */
export function includePartialMessagesSpawnArgsSoft(
  enabled: boolean | null | undefined,
  outputFormat: unknown,
  rawCliVersion: string | null | undefined,
): string[] {
  const args = includePartialMessagesSpawnArgs(enabled, outputFormat);
  if (args.length === 0) return args;
  const ok = cliSupportsIncludePartialMessages(rawCliVersion);
  if (ok === true) return args;
  return [];
}

/**
 * Resolve headless format + partial flag for paths that want token deltas
 * when the user enables partial stream events (Remote IM, diagnostics).
 *
 * - Partial on + CLI ≥ 0.2.117 → `streaming-messages-json` + flag
 * - Otherwise → keep `streaming-json` (no flag; soft-fail older CLI)
 */
export function resolveHeadlessStreamForPartial(
  includePartial: boolean | null | undefined,
  rawCliVersion: string | null | undefined,
): { format: string; args: string[] } {
  const on = normalizeIncludePartialMessages(includePartial);
  const ok = cliSupportsIncludePartialMessages(rawCliVersion) === true;
  if (on && ok) {
    return {
      format: STREAMING_MESSAGES_JSON,
      args: ["--include-partial-messages"],
    };
  }
  return { format: STREAMING_JSON, args: [] };
}
