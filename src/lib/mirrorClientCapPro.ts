/**
 * MIRROR-CLIENT-CAP-PRO — pure helpers for phone-mirror client-cap honesty.
 *
 * Product rules:
 * - Cap is 1–16 (default 4); extra WebSocket upgrades soft-fail with HTTP 503.
 * - Never invent connected clients when the host is stopped.
 * - Zero connected is honest empty, not "unknown".
 * - Write is off by default; when write is on, surface a reminder alongside cap.
 *
 * Pure — no DOM / Tauri I/O. Aligns with host clamp in
 * `src-tauri/src/mirror/mod.rs` and the Connect panel.
 */

import {
  MIRROR_DEFAULT_MAX_CLIENTS,
  MIRROR_MAX_CLIENTS_CAP,
  MIRROR_MIN_CLIENTS,
} from "@/lib/mirrorWriteSurface";

export {
  MIRROR_DEFAULT_MAX_CLIENTS,
  MIRROR_MAX_CLIENTS_CAP,
  MIRROR_MIN_CLIENTS,
};

/** Capacity / honesty kind for the cap chip and banners. */
export type MirrorClientCapKind =
  | "ok"
  | "near_full"
  | "full"
  | "write_on_warn";

export type MirrorClientCapTone = "ok" | "warn" | "err" | "muted";

export type MirrorClientCapState = {
  kind: MirrorClientCapKind;
  /** Clamped connected count (≥ 0). */
  connected: number;
  /** Clamped max (1–16). */
  max: number;
  /** Slots left before 503 soft-fail. */
  remaining: number;
  /** connected / max, capped at 1. */
  ratio: number;
  /** True when connected ≥ max (extra phones get 503). */
  atLimit: boolean;
  /** True when nearly full but still accepting connections. */
  nearFull: boolean;
  writeEnabled: boolean;
  /** Soft-fail full banner (503 honesty). */
  showFullBanner: boolean;
  /** Write-on reminder (default is write-off). */
  showWriteOnWarn: boolean;
  /** Progress fill 0–100 for the cap bar. */
  fillPercent: number;
  tone: MirrorClientCapTone;
};

/**
 * Clamp max clients to the product range 1–16.
 * Non-finite / missing / blank → default 4 (same as host `normalize_max_clients`).
 */
export function clampMirrorMaxClients(raw: unknown): number {
  if (raw == null) return MIRROR_DEFAULT_MAX_CLIENTS;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return MIRROR_DEFAULT_MAX_CLIENTS;
    const n = Number(t);
    if (!Number.isFinite(n)) return MIRROR_DEFAULT_MAX_CLIENTS;
    return Math.min(
      MIRROR_MAX_CLIENTS_CAP,
      Math.max(MIRROR_MIN_CLIENTS, Math.round(n)),
    );
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return MIRROR_DEFAULT_MAX_CLIENTS;
  }
  return Math.min(
    MIRROR_MAX_CLIENTS_CAP,
    Math.max(MIRROR_MIN_CLIENTS, Math.round(raw)),
  );
}

function clampConnected(raw: unknown): number {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw)
        : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

/**
 * Near-full when at least one client is connected and either:
 * - only one slot remains, or
 * - fill is ≥ 75% (useful for larger caps).
 */
function isNearFull(connected: number, max: number, remaining: number): boolean {
  if (connected <= 0) return false;
  if (remaining <= 0) return false;
  if (remaining <= 1) return true;
  return connected / max >= 0.75;
}

/**
 * Resolve live cap honesty for the Connect panel.
 *
 * Kind priority (single primary chip):
 * 1. `full` — at limit; extra phones soft-fail 503
 * 2. `near_full` — one slot left / ≥75% filled
 * 3. `write_on_warn` — write enabled (default is write-off)
 * 4. `ok` — room available, write off
 *
 * `showWriteOnWarn` stays true whenever write is on, even under full/near_full,
 * so the write reminder is not dropped when capacity is tight.
 */
export function resolveMirrorClientCapState(input: {
  connected?: number | null;
  max?: number | null;
  writeEnabled?: boolean | null;
}): MirrorClientCapState {
  const max = clampMirrorMaxClients(input.max ?? MIRROR_DEFAULT_MAX_CLIENTS);
  const connected = clampConnected(input.connected);
  const writeEnabled = input.writeEnabled === true;
  const remaining = Math.max(0, max - connected);
  const atLimit = connected >= max;
  const nearFull = !atLimit && isNearFull(connected, max, remaining);
  const ratio = max > 0 ? Math.min(1, connected / max) : 0;
  const fillPercent = Math.min(100, Math.max(0, Math.round(ratio * 100)));

  let kind: MirrorClientCapKind;
  if (atLimit) kind = "full";
  else if (nearFull) kind = "near_full";
  else if (writeEnabled) kind = "write_on_warn";
  else kind = "ok";

  let tone: MirrorClientCapTone;
  if (atLimit) tone = "warn";
  else if (nearFull || writeEnabled) tone = "warn";
  else if (connected > 0) tone = "ok";
  else tone = "muted";

  return {
    kind,
    connected,
    max,
    remaining,
    ratio,
    atLimit,
    nearFull,
    writeEnabled,
    showFullBanner: atLimit,
    showWriteOnWarn: writeEnabled,
    fillPercent,
    tone,
  };
}

/**
 * Format a live cap line. Template placeholders: `{n}` connected, `{max}` cap,
 * `{remaining}` free slots. Default matches settings `{n} / {max}` style.
 */
export function formatMirrorClientCapLine(
  state: Pick<MirrorClientCapState, "connected" | "max" | "remaining">,
  template = "{n} / {max}",
): string {
  return String(template)
    .replace(/\{n\}/g, String(state.connected))
    .replace(/\{max\}/g, String(state.max))
    .replace(/\{remaining\}/g, String(state.remaining));
}

/** Empty / honesty states for the cap strip when not showing a live fill. */
export type MirrorCapEmptyKind = "host_stopped" | "zero_clients";

export type MirrorCapEmptyState = {
  kind: MirrorCapEmptyKind;
  titleKey: string;
  hintKey: string;
};

/**
 * Resolve empty honesty for the client-cap strip.
 *
 * - Host stopped → never invent clients; show stopped empty.
 * - Host running + zero clients → honest zero (not "unknown").
 * - Host running + ≥1 client → `null` (live bar/chip is enough).
 */
export function resolveMirrorCapEmptyState(input: {
  running?: boolean | null;
  connected?: number | null;
}): MirrorCapEmptyState | null {
  if (!input.running) {
    return {
      kind: "host_stopped",
      titleKey: "mirror.cap.emptyStopped",
      hintKey: "mirror.cap.emptyStoppedHint",
    };
  }
  const connected = clampConnected(input.connected);
  if (connected === 0) {
    return {
      kind: "zero_clients",
      titleKey: "mirror.cap.emptyZero",
      hintKey: "mirror.cap.emptyZeroHint",
    };
  }
  return null;
}

/** i18n key for the primary cap-kind chip label. */
export function mirrorClientCapKindLabelKey(
  kind: MirrorClientCapKind,
): string {
  switch (kind) {
    case "full":
      return "mirror.cap.full";
    case "near_full":
      return "mirror.cap.nearFull";
    case "write_on_warn":
      return "mirror.cap.writeOnWarn";
    case "ok":
    default:
      return "mirror.cap.ok";
  }
}

/** i18n key for actionable hint under the cap bar / full banner. */
export function mirrorClientCapKindHintKey(kind: MirrorClientCapKind): string {
  switch (kind) {
    case "full":
      return "mirror.cap.fullHint";
    case "near_full":
      return "mirror.cap.nearFullHint";
    case "write_on_warn":
      return "mirror.cap.writeOnWarnHint";
    case "ok":
    default:
      return "mirror.cap.okHint";
  }
}

/** CSS modifier for the cap bar / chip from tone. */
export function mirrorClientCapToneClass(tone: MirrorClientCapTone): string {
  if (tone === "ok") return "mirror-connect__cap--ok";
  if (tone === "warn") return "mirror-connect__cap--warn";
  if (tone === "err") return "mirror-connect__cap--err";
  return "mirror-connect__cap--muted";
}
