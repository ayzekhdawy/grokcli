/**
 * Pure helpers for Grok Build CLI release channels (CLI ≥ 0.2.117).
 *
 * `grok update --check --json` may report `channel: "stable" | "alpha"`.
 * Switch via `grok update --alpha|--stable`; pin via `--version <V>`.
 * Never invent channels — unknown/missing → "unknown".
 */

export type CliReleaseChannel = "stable" | "alpha" | "unknown";

/** Switch targets the CLI actually supports as flags. */
export type CliSwitchableChannel = "stable" | "alpha";

/**
 * Normalize a raw channel string from CLI JSON or UI.
 * Only `stable` / `alpha` (case-insensitive) are recognized.
 */
export function normalizeCliChannel(
  raw: string | null | undefined,
): CliReleaseChannel {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (t === "stable") return "stable";
  if (t === "alpha") return "alpha";
  return "unknown";
}

/** Whether `target` is a different, switchable channel from `current`. */
export function canSwitchCliChannel(
  current: CliReleaseChannel | string | null | undefined,
  target: CliSwitchableChannel,
): boolean {
  const cur = normalizeCliChannel(
    typeof current === "string" || current == null ? current : String(current),
  );
  return cur !== target;
}

/**
 * Validate a version pin for `grok update --version`.
 * Semver-ish only; rejects flags, paths, and empty input.
 */
export function isValidCliVersionPin(raw: string | null | undefined): boolean {
  const t = String(raw ?? "").trim();
  if (!t || t.length > 64) return false;
  if (t.startsWith("-") || t.includes("/") || t.includes("\\") || /\s/.test(t)) {
    return false;
  }
  let hasDigit = false;
  for (const c of t) {
    if (c >= "0" && c <= "9") {
      hasDigit = true;
      continue;
    }
    if (
      (c >= "a" && c <= "z") ||
      (c >= "A" && c <= "Z") ||
      c === "." ||
      c === "-" ||
      c === "+" ||
      c === "_"
    ) {
      continue;
    }
    return false;
  }
  return hasDigit;
}

/** Display label key suffix for a channel (`stable` / `alpha` / `unknown`). */
export function cliChannelLabelKey(
  channel: CliReleaseChannel | string | null | undefined,
): "settings.cliChannel.stable" | "settings.cliChannel.alpha" | "settings.cliChannel.unknown" {
  const c = normalizeCliChannel(
    typeof channel === "string" || channel == null ? channel : String(channel),
  );
  if (c === "stable") return "settings.cliChannel.stable";
  if (c === "alpha") return "settings.cliChannel.alpha";
  return "settings.cliChannel.unknown";
}

/**
 * Summarize version + channel for status chips.
 * Never invents a channel label when JSON omitted it.
 */
export function formatCliUpdateStatus(input: {
  currentVersion?: string | null;
  latestVersion?: string | null;
  channel?: string | null;
  updateAvailable?: boolean;
}): {
  current: string;
  latest: string;
  channel: CliReleaseChannel;
  updateAvailable: boolean;
} {
  const current = String(input.currentVersion ?? "").trim() || "—";
  const latest = String(input.latestVersion ?? "").trim() || current;
  const channel = normalizeCliChannel(input.channel);
  const updateAvailable = Boolean(input.updateAvailable);
  return { current, latest, channel, updateAvailable };
}
