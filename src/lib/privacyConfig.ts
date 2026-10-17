/**
 * Pure helpers for Privacy center (Grok Build 0.2.117 config.toml keys).
 * Host enforces path-scope + write gate; this validates UI drafts + patches
 * and classifies probe/load/save soft-fails for honest copy.
 *
 * Allowlist:
 * - [features] telemetry
 * - [telemetry] trace_upload / mixpanel_enabled
 * - [harness] disable_codebase_upload / disable_workspace_teleport
 *
 * Missing keys stay null — never invent CLI defaults as “off”.
 * Coding-data / training opt-in is CLI `/privacy` only (not config.toml).
 */

export type PrivacyTri = boolean | null;

export type PrivacyValues = {
  /** [features] telemetry — null when unset in config. */
  telemetry: PrivacyTri;
  /** [telemetry] trace_upload */
  traceUpload: PrivacyTri;
  /** [telemetry] mixpanel_enabled */
  mixpanelEnabled: PrivacyTri;
  /** [harness] disable_codebase_upload */
  disableCodebaseUpload: PrivacyTri;
  /** [harness] disable_workspace_teleport */
  disableWorkspaceTeleport: PrivacyTri;
};

export type PrivacyPatch = {
  telemetry?: boolean | null;
  traceUpload?: boolean | null;
  mixpanelEnabled?: boolean | null;
  disableCodebaseUpload?: boolean | null;
  disableWorkspaceTeleport?: boolean | null;
};

export type PrivacySnapshotLike = {
  telemetry?: boolean | null;
  traceUpload?: boolean | null;
  mixpanelEnabled?: boolean | null;
  disableCodebaseUpload?: boolean | null;
  disableWorkspaceTeleport?: boolean | null;
  writable?: boolean;
  mode?: string;
  fileExists?: boolean;
  path?: string;
  cliPrivacyCommand?: string;
  redactedPreview?: string;
};

/** CLI slash command for coding-data / retention / training (not a config key). */
export const CLI_PRIVACY_COMMAND = "/privacy";

/** Keys this App can write (independent agent-home only). */
export const PRIVACY_WRITABLE_KEYS = [
  "telemetry",
  "traceUpload",
  "mixpanelEnabled",
  "disableCodebaseUpload",
  "disableWorkspaceTeleport",
] as const;

export type PrivacyWritableKey = (typeof PRIVACY_WRITABLE_KEYS)[number];

function tri(v: boolean | null | undefined): PrivacyTri {
  if (v === true) return true;
  if (v === false) return false;
  return null;
}

function errText(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || err.name || "";
  if (typeof err === "object") {
    const o = err as { message?: unknown; error?: unknown; reason?: unknown };
    const parts = [o.message, o.error, o.reason]
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

/** Map host snapshot → UI draft (null = unset / missing). */
export function valuesFromPrivacySnapshot(
  snap: PrivacySnapshotLike | null | undefined,
): PrivacyValues {
  return {
    telemetry: tri(snap?.telemetry),
    traceUpload: tri(snap?.traceUpload),
    mixpanelEnabled: tri(snap?.mixpanelEnabled),
    disableCodebaseUpload: tri(snap?.disableCodebaseUpload),
    disableWorkspaceTeleport: tri(snap?.disableWorkspaceTeleport),
  };
}

/** Build a host patch from draft vs baseline (only changed fields with concrete bools). */
export function buildPrivacyPatch(
  draft: PrivacyValues,
  baseline: PrivacyValues,
): PrivacyPatch {
  const patch: PrivacyPatch = {};
  if (draft.telemetry !== baseline.telemetry && draft.telemetry !== null) {
    patch.telemetry = draft.telemetry;
  }
  if (draft.traceUpload !== baseline.traceUpload && draft.traceUpload !== null) {
    patch.traceUpload = draft.traceUpload;
  }
  if (
    draft.mixpanelEnabled !== baseline.mixpanelEnabled &&
    draft.mixpanelEnabled !== null
  ) {
    patch.mixpanelEnabled = draft.mixpanelEnabled;
  }
  if (
    draft.disableCodebaseUpload !== baseline.disableCodebaseUpload &&
    draft.disableCodebaseUpload !== null
  ) {
    patch.disableCodebaseUpload = draft.disableCodebaseUpload;
  }
  if (
    draft.disableWorkspaceTeleport !== baseline.disableWorkspaceTeleport &&
    draft.disableWorkspaceTeleport !== null
  ) {
    patch.disableWorkspaceTeleport = draft.disableWorkspaceTeleport;
  }
  return patch;
}

export function hasPrivacyChanges(patch: PrivacyPatch): boolean {
  return (
    patch.telemetry != null ||
    patch.traceUpload != null ||
    patch.mixpanelEnabled != null ||
    patch.disableCodebaseUpload != null ||
    patch.disableWorkspaceTeleport != null
  );
}

/**
 * Toggle a tri-state bool for UI:
 * - null → true (first write enables / sets the “on” side of the label)
 * - true → false
 * - false → true
 *
 * For `disable_*` keys the “on” side of the label is “disabled = true”.
 * Never jumps null → false without an intermediate true (avoids silently
 * inventing “off” as the first write from unset).
 */
export function togglePrivacyTri(current: PrivacyTri): boolean {
  if (current === null) return true;
  return !current;
}

/** Honest status label id for a tri-state value. */
export function privacyKeyPresence(
  value: PrivacyTri,
): "set_on" | "set_off" | "unset" {
  if (value === true) return "set_on";
  if (value === false) return "set_off";
  return "unset";
}

/**
 * Effective toggle checked state for UI.
 * Unset keys render as unchecked with an explicit “unset” badge (not claimed off).
 */
export function privacyToggleChecked(value: PrivacyTri): boolean {
  return value === true;
}

/** Whether writes are allowed for this snapshot (independent mode only). */
export function isPrivacyWritable(
  snap: PrivacySnapshotLike | null | undefined,
): boolean {
  return !!snap?.writable;
}

// ── Summary / clearer defaults ──────────────────────────────────────────────

export type PrivacyValuesSummary = {
  total: number;
  setCount: number;
  unsetCount: number;
  setOnCount: number;
  setOffCount: number;
  allUnset: boolean;
  allSet: boolean;
  /** True when at least one key is present as a concrete bool. */
  anySet: boolean;
};

/**
 * Count set / unset keys. Unset is never counted as off.
 */
export function summarizePrivacyValues(
  values: PrivacyValues | null | undefined,
): PrivacyValuesSummary {
  const v = values ?? valuesFromPrivacySnapshot({});
  let setOnCount = 0;
  let setOffCount = 0;
  let unsetCount = 0;
  for (const key of PRIVACY_WRITABLE_KEYS) {
    const p = privacyKeyPresence(v[key]);
    if (p === "set_on") setOnCount += 1;
    else if (p === "set_off") setOffCount += 1;
    else unsetCount += 1;
  }
  const total = PRIVACY_WRITABLE_KEYS.length;
  const setCount = setOnCount + setOffCount;
  return {
    total,
    setCount,
    unsetCount,
    setOnCount,
    setOffCount,
    allUnset: unsetCount === total,
    allSet: setCount === total,
    anySet: setCount > 0,
  };
}

/**
 * i18n key for a per-key default hint when the value is **unset**.
 * Copy must never claim a concrete CLI runtime default as “off”.
 */
export function privacyKeyDefaultHintMessageKey(
  key: PrivacyWritableKey,
): string {
  switch (key) {
    case "telemetry":
      return "settings.privacy.default.telemetry";
    case "traceUpload":
      return "settings.privacy.default.traceUpload";
    case "mixpanelEnabled":
      return "settings.privacy.default.mixpanel";
    case "disableCodebaseUpload":
      return "settings.privacy.default.disableCodebaseUpload";
    case "disableWorkspaceTeleport":
      return "settings.privacy.default.disableWorkspaceTeleport";
  }
}

/** i18n key for presence badge copy. */
export function privacyPresenceMessageKey(
  presence: "set_on" | "set_off" | "unset",
): string {
  switch (presence) {
    case "set_on":
      return "settings.privacy.presence.on";
    case "set_off":
      return "settings.privacy.presence.off";
    case "unset":
      return "settings.privacy.presence.unset";
  }
}

/**
 * Summary banner copy id for the current draft/baseline values.
 * - `all_unset` — no keys present; never claim telemetry is off
 * - `partial` — mix of set / unset
 * - `all_set` — every allowlisted key has a concrete bool
 */
export function privacySummaryKind(
  values: PrivacyValues | null | undefined,
): "all_unset" | "partial" | "all_set" {
  const s = summarizePrivacyValues(values);
  if (s.allUnset) return "all_unset";
  if (s.allSet) return "all_set";
  return "partial";
}

export function privacySummaryMessageKey(
  kind: "all_unset" | "partial" | "all_set",
): string {
  switch (kind) {
    case "all_unset":
      return "settings.privacy.summary.allUnset";
    case "partial":
      return "settings.privacy.summary.partial";
    case "all_set":
      return "settings.privacy.summary.allSet";
  }
}

// ── Probe classification ────────────────────────────────────────────────────

/**
 * Stable soft-fail kinds for privacy_config_get / privacy_config_set.
 * Host missing-file is success with empty flags — not an error kind.
 */
export type PrivacyProbeErrorKind =
  | "host_only"
  | "shared_mode"
  | "path_not_allowed"
  | "io"
  | "empty_patch"
  | "other";

/**
 * Aggregate probe / load outcome for Settings chips and banners.
 *
 * Success family (`ok_*`) never invents telemetry off:
 * - `ok_missing_file` — config.toml absent; keys all unset
 * - `ok_all_unset` — file exists, no allowlisted keys present
 * - `ok_partial` / `ok_all_set` — at least some keys present
 *
 * Failure family:
 * - `host_only` — not desktop / invoke unavailable
 * - `error` — invoke threw (see {@link PrivacyProbeErrorKind})
 */
export type PrivacyProbeOutcome =
  | "ok_missing_file"
  | "ok_all_unset"
  | "ok_partial"
  | "ok_all_set"
  | "host_only"
  | "error";

export type PrivacyProbeTone = "ok" | "warn" | "err" | "muted" | "info";

export type ClassifiedPrivacyProbe = {
  outcome: PrivacyProbeOutcome;
  tone: PrivacyProbeTone;
  errorKind: PrivacyProbeErrorKind | null;
  /** Host invoke failure text when outcome is `error` / detail for soft-fail. */
  invokeError: string | null;
  summary: PrivacyValuesSummary;
  values: PrivacyValues;
  /** Snapshot mode when available (`independent` | `shared`). */
  mode: string | null;
  writable: boolean;
  fileExists: boolean;
};

/**
 * Classify a thrown value / host error into a stable privacy probe kind.
 * Prefer known Host message fragments over free text.
 */
export function classifyPrivacyProbeError(err: unknown): PrivacyProbeErrorKind {
  if (err == null || err === "") return "other";
  const m = errText(err).toLowerCase();
  if (!m.trim()) return "other";

  if (
    m.includes("need tauri") ||
    m.includes("requires the desktop") ||
    m.includes("desktop app") ||
    m.includes("not available in browser") ||
    m.includes("host only") ||
    m.includes("host-only") ||
    m.includes("is not a function") || // web mock missing invoke
    m.includes("plugin not found") ||
    m.includes("command not found")
  ) {
    return "host_only";
  }

  if (
    m.includes("shared session mode") ||
    m.includes("shared mode") ||
    (m.includes("shared") &&
      (m.includes("not the live") ||
        m.includes("read-only") ||
        m.includes("readonly") ||
        m.includes("switch to independent") ||
        m.includes("independent to edit")))
  ) {
    return "shared_mode";
  }

  if (
    m.includes("path not allowed") ||
    m.includes("path-not-allowed") ||
    m.includes("only agent-home") ||
    m.includes("require_agent_home") ||
    m.includes("not allowed")
  ) {
    return "path_not_allowed";
  }

  if (
    m.includes("empty patch") ||
    m.includes("no changes") ||
    m.includes("nothing to write") ||
    m.includes("patch is empty")
  ) {
    return "empty_patch";
  }

  if (
    m.includes("write config") ||
    m.includes("create agent-home") ||
    m.includes("permission denied") ||
    m.includes("os error") ||
    m.includes("i/o") ||
    m.includes("io error") ||
    m.includes("failed to read") ||
    m.includes("failed to write") ||
    m.includes("no such file") ||
    m.includes("enoent") ||
    m.includes("eacces") ||
    m.includes("ebusy") ||
    m.includes("read-only file system")
  ) {
    return "io";
  }

  return "other";
}

export function privacyProbeErrorMessageKey(
  kind: PrivacyProbeErrorKind,
): string {
  switch (kind) {
    case "host_only":
      return "settings.privacy.probe.hostOnly";
    case "shared_mode":
      return "settings.privacy.probe.sharedMode";
    case "path_not_allowed":
      return "settings.privacy.probe.pathNotAllowed";
    case "io":
      return "settings.privacy.probe.io";
    case "empty_patch":
      return "settings.privacy.probe.emptyPatch";
    case "other":
      return "settings.privacy.probe.other";
  }
}

export function privacyProbeOutcomeMessageKey(
  outcome: PrivacyProbeOutcome,
): string {
  switch (outcome) {
    case "ok_missing_file":
      return "settings.privacy.probe.okMissing";
    case "ok_all_unset":
      return "settings.privacy.probe.okAllUnset";
    case "ok_partial":
      return "settings.privacy.probe.okPartial";
    case "ok_all_set":
      return "settings.privacy.probe.okAllSet";
    case "host_only":
      return "settings.privacy.probe.hostOnly";
    case "error":
      return "settings.privacy.probe.error";
  }
}

export function privacyProbeTone(
  outcome: PrivacyProbeOutcome,
): PrivacyProbeTone {
  switch (outcome) {
    case "ok_all_set":
    case "ok_partial":
      return "ok";
    case "ok_missing_file":
    case "ok_all_unset":
      return "info";
    case "host_only":
      return "muted";
    case "error":
      return "err";
  }
}

/**
 * Classify a successful host snapshot or an invoke failure for the Privacy panel.
 *
 * @param snap Host JSON when `privacy_config_get` / set succeeded
 * @param opts.invokeError set when invoke threw
 * @param opts.available false when not on desktop
 */
export function classifyPrivacyProbeResult(
  snap: PrivacySnapshotLike | null | undefined,
  opts?: {
    invokeError?: string | null;
    available?: boolean;
  },
): ClassifiedPrivacyProbe {
  const emptyValues = valuesFromPrivacySnapshot({});
  const emptySummary = summarizePrivacyValues(emptyValues);

  if (opts?.available === false) {
    return {
      outcome: "host_only",
      tone: "muted",
      errorKind: "host_only",
      invokeError: null,
      summary: emptySummary,
      values: emptyValues,
      mode: null,
      writable: false,
      fileExists: false,
    };
  }

  const invokeError = (opts?.invokeError ?? "").trim() || null;
  if (invokeError) {
    const errorKind = classifyPrivacyProbeError(invokeError);
    return {
      outcome: errorKind === "host_only" ? "host_only" : "error",
      tone: errorKind === "host_only" ? "muted" : "err",
      errorKind,
      invokeError,
      summary: emptySummary,
      values: emptyValues,
      mode: null,
      writable: false,
      fileExists: false,
    };
  }

  const values = valuesFromPrivacySnapshot(snap);
  const summary = summarizePrivacyValues(values);
  const fileExists = snap?.fileExists === true;
  const mode =
    typeof snap?.mode === "string" && snap.mode.trim()
      ? snap.mode.trim()
      : null;
  const writable = !!snap?.writable;

  let outcome: PrivacyProbeOutcome;
  if (!fileExists) {
    // Soft-success: missing file → all keys unset, never invent off.
    outcome = "ok_missing_file";
  } else if (summary.allUnset) {
    outcome = "ok_all_unset";
  } else if (summary.allSet) {
    outcome = "ok_all_set";
  } else {
    outcome = "ok_partial";
  }

  return {
    outcome,
    tone: privacyProbeTone(outcome),
    errorKind: null,
    invokeError: null,
    summary,
    values,
    mode,
    writable,
    fileExists,
  };
}

/** CSS helper class for tone chips (Settings panel). */
export function privacyProbeToneClass(tone: PrivacyProbeTone): string {
  switch (tone) {
    case "ok":
      return "is-ok";
    case "warn":
      return "is-warn";
    case "err":
      return "is-err";
    case "info":
      return "is-info";
    case "muted":
      return "is-muted";
  }
}

/**
 * Alert role for classified load/save soft-fail banners.
 * Success outcomes are status; errors are alert.
 */
export function privacyProbeAlertRole(
  outcome: PrivacyProbeOutcome,
): "alert" | "status" {
  return outcome === "error" ? "alert" : "status";
}

/**
 * Whether the panel should treat the classified result as a hard error
 * (hide toggles / show error banner). Soft host_only and success outcomes
 * keep the panel usable where possible.
 */
export function privacyProbeIsHardFail(
  result: ClassifiedPrivacyProbe,
): boolean {
  return result.outcome === "error";
}

/**
 * Resolve user-facing error copy for load/save failures.
 * Prefers classified i18n key; raw detail stays separate for debug line.
 */
export function resolvePrivacyProbeErrorCopy(input: {
  err: unknown;
  /** Optional pre-classified kind. */
  kind?: PrivacyProbeErrorKind | null;
}): {
  kind: PrivacyProbeErrorKind;
  messageKey: string;
  detail: string;
} {
  const kind = input.kind ?? classifyPrivacyProbeError(input.err);
  const detail = errText(input.err).trim();
  return {
    kind,
    messageKey: privacyProbeErrorMessageKey(kind),
    detail,
  };
}

/**
 * Apply-scope honesty keys shown after a successful save.
 */
export type PrivacyApplyScope = "saved_soft_respawn" | "independent_only";

export function privacyApplyMessageKey(scope: PrivacyApplyScope): string {
  switch (scope) {
    case "saved_soft_respawn":
      return "settings.privacy.apply.softRespawn";
    case "independent_only":
      return "settings.privacy.apply.independentOnly";
  }
}

/**
 * True when a tri-state value is still unset — UI must not claim “off”.
 * Centralized so call sites never invent telemetry off.
 */
export function privacyIsUnset(value: PrivacyTri): boolean {
  return value !== true && value !== false;
}

/**
 * App never invents a concrete CLI runtime default for an unset key.
 * Always returns null — documented helper so UI cannot “fill in” false.
 */
export function privacyInventedDefault(
  _key: PrivacyWritableKey,
): PrivacyTri {
  return null;
}
