/**
 * External OpenTelemetry dual opt-in honesty (enterprise).
 *
 * Grok Build CLI exports a content-free usage schema to a *customer-owned*
 * OTLP collector only when both:
 *   1. Master switch is on — `GROK_EXTERNAL_OTEL=1` / `[telemetry] otel_enabled`
 *   2. At least one exporter is selected — `OTEL_METRICS_EXPORTER` /
 *      `OTEL_LOGS_EXPORTER` (or config peers) is `otlp` | `console`
 *
 * Either half alone enables **nothing**. Unset/missing evidence must stay
 * `unknown` — this App never invents “off” when keys/env are absent.
 *
 * App does **not** write OTEL secrets (collector auth is env-only
 * `OTEL_EXPORTER_OTLP_HEADERS`). Pure helpers only — no I/O.
 */

/** Dual-opt-in status for chips and banners. */
export type ExternalOtelStatus =
  | "off"
  | "incomplete"
  | "ready"
  | "unknown"
  | "host_only";

export type ExternalOtelTone = "ok" | "warn" | "info" | "muted" | "err";

/**
 * Evidence known to the caller. All fields optional; missing ⇒ unset/unknown.
 * Never invent CLI runtime defaults as concrete booleans.
 */
export type ExternalOtelResolveInput = {
  /**
   * Master switch (`GROK_EXTERNAL_OTEL` / `otel_enabled`).
   * `true` / `false` when known; `null` / `undefined` when unset/unknown.
   */
  masterEnv?: boolean | null;
  /**
   * At least one non-`none` exporter configured (metrics or logs).
   * `null` / `undefined` when unset/unknown.
   */
  exportersConfigured?: boolean | null;
  /**
   * Soft flag: any external-OTEL related config/env evidence was observed.
   * Does not alone imply on or off.
   */
  configPresent?: boolean | null;
  /** `false` when not on desktop / host probe unavailable. */
  available?: boolean;
};

/** Checklist step for dual opt-in honesty UI. */
export type ExternalOtelChecklistStepId =
  | "master"
  | "exporter"
  | "content_free"
  | "no_app_secrets"
  | "independent_stream";

export type ExternalOtelChecklistStep = {
  id: ExternalOtelChecklistStepId;
  /**
   * `true` / `false` when known; `null` when unset/unknown
   * (UI must not claim “done” or “missing” as invented off).
   */
  done: boolean | null;
  /** i18n message key for the step label. */
  messageKey: string;
};

/** Known master env var name. */
export const EXTERNAL_OTEL_MASTER_ENV = "GROK_EXTERNAL_OTEL";

/** Exporter env vars that count toward dual opt-in. */
export const EXTERNAL_OTEL_EXPORTER_ENVS = [
  "OTEL_METRICS_EXPORTER",
  "OTEL_LOGS_EXPORTER",
] as const;

/** Content-gate env vars (default off / content-free). */
export const EXTERNAL_OTEL_CONTENT_GATE_ENVS = [
  "OTEL_LOG_USER_PROMPTS",
  "OTEL_LOG_TOOL_DETAILS",
] as const;

/** Collector auth — never store in App config.toml. */
export const EXTERNAL_OTEL_HEADERS_ENV = "OTEL_EXPORTER_OTLP_HEADERS";

function triBool(v: boolean | null | undefined): boolean | null {
  if (v === true) return true;
  if (v === false) return false;
  return null;
}

/**
 * Parse a master-switch string (`1` / `true` / `yes` / `on` → true;
 * `0` / `false` / `no` / `off` → false; empty/unknown → null).
 * Never invents off for empty.
 */
export function parseExternalOtelMasterValue(
  raw: string | null | undefined,
): boolean | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return null;
}

/**
 * True when an exporter value is an active selection (`otlp` | `console`).
 * `none` / empty / unknown → not configured (empty stays null via caller).
 */
export function isActiveOtelExporter(
  raw: string | null | undefined,
): boolean | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s === "otlp" || s === "console") return true;
  if (s === "none") return false;
  return null;
}

/**
 * Derive dual-opt-in evidence from a plain env map (no I/O).
 * Missing keys stay null — never invent off.
 */
export function evidenceFromExternalOtelEnv(
  env: Record<string, string | undefined> | null | undefined,
): ExternalOtelResolveInput {
  if (!env) {
    return {
      masterEnv: null,
      exportersConfigured: null,
      configPresent: null,
    };
  }

  const masterRaw = env[EXTERNAL_OTEL_MASTER_ENV];
  const masterEnv = parseExternalOtelMasterValue(masterRaw);

  const metrics = isActiveOtelExporter(env.OTEL_METRICS_EXPORTER);
  const logs = isActiveOtelExporter(env.OTEL_LOGS_EXPORTER);

  let exportersConfigured: boolean | null = null;
  if (metrics === true || logs === true) {
    exportersConfigured = true;
  } else if (metrics === false || logs === false) {
    // At least one exporter key present as none, and none active.
    // If both missing, leave null.
    const anyExporterKey =
      env.OTEL_METRICS_EXPORTER != null || env.OTEL_LOGS_EXPORTER != null;
    exportersConfigured = anyExporterKey ? false : null;
  }

  const configPresent =
    masterRaw != null ||
    env.OTEL_METRICS_EXPORTER != null ||
    env.OTEL_LOGS_EXPORTER != null ||
    env.OTEL_EXPORTER_OTLP_ENDPOINT != null ||
    env[EXTERNAL_OTEL_HEADERS_ENV] != null
      ? true
      : null;

  return { masterEnv, exportersConfigured, configPresent };
}

/**
 * Soft-parse redacted config.toml text for `[telemetry] otel_*` peers.
 * Missing keys stay null — never invent off.
 */
export function evidenceFromExternalOtelConfigText(
  text: string | null | undefined,
): ExternalOtelResolveInput {
  if (text == null || !String(text).trim()) {
    return {
      masterEnv: null,
      exportersConfigured: null,
      configPresent: null,
    };
  }
  const body = String(text);

  let masterEnv: boolean | null = null;
  const enabled = body.match(
    /^\s*otel_enabled\s*=\s*(true|false)\s*(?:#.*)?$/im,
  );
  if (enabled) {
    masterEnv = enabled[1].toLowerCase() === "true";
  }

  const metricsM = body.match(
    /^\s*otel_metrics_exporter\s*=\s*["']?([a-zA-Z_/]+)["']?\s*(?:#.*)?$/im,
  );
  const logsM = body.match(
    /^\s*otel_logs_exporter\s*=\s*["']?([a-zA-Z_/]+)["']?\s*(?:#.*)?$/im,
  );
  const metrics = metricsM ? isActiveOtelExporter(metricsM[1]) : null;
  const logs = logsM ? isActiveOtelExporter(logsM[1]) : null;

  let exportersConfigured: boolean | null = null;
  if (metrics === true || logs === true) exportersConfigured = true;
  else if (metrics === false || logs === false) exportersConfigured = false;

  const configPresent =
    /otel_enabled|otel_metrics_exporter|otel_logs_exporter|otel_endpoint|otel_protocol/i.test(
      body,
    )
      ? true
      : null;

  return { masterEnv, exportersConfigured, configPresent };
}

/**
 * Merge env + config evidence. Concrete bools win over null;
 * `true` for exporters/master wins over `false` when combining sources
 * (either source can complete dual opt-in).
 */
export function mergeExternalOtelEvidence(
  ...parts: Array<ExternalOtelResolveInput | null | undefined>
): ExternalOtelResolveInput {
  let masterEnv: boolean | null = null;
  let exportersConfigured: boolean | null = null;
  let configPresent: boolean | null = null;
  let available: boolean | undefined;

  for (const p of parts) {
    if (!p) continue;
    if (p.available === false) available = false;
    else if (p.available === true && available !== false) available = true;

    if (p.masterEnv === true) masterEnv = true;
    else if (p.masterEnv === false && masterEnv !== true) masterEnv = false;

    if (p.exportersConfigured === true) exportersConfigured = true;
    else if (p.exportersConfigured === false && exportersConfigured !== true) {
      exportersConfigured = false;
    }

    if (p.configPresent === true) configPresent = true;
    else if (p.configPresent === false && configPresent !== true) {
      configPresent = false;
    }
  }

  return { masterEnv, exportersConfigured, configPresent, available };
}

/**
 * Resolve dual-opt-in status.
 *
 * - `host_only` — desktop probe unavailable
 * - `ready` — master on AND at least one exporter
 * - `incomplete` — only master or only exporter known true
 * - `off` — master explicitly false (and exporters not true)
 * - `unknown` — missing/unset evidence (never invent off)
 */
export function resolveExternalOtelStatus(
  input: ExternalOtelResolveInput = {},
): ExternalOtelStatus {
  if (input.available === false) return "host_only";

  const master = triBool(input.masterEnv);
  const exporters = triBool(input.exportersConfigured);

  if (master === true && exporters === true) return "ready";

  // One half of dual opt-in without the other → incomplete
  if (master === true && exporters !== true) return "incomplete";
  if (exporters === true && master !== true) return "incomplete";

  // Explicit master off, and no active exporter → off
  if (master === false && exporters !== true) return "off";

  // configPresent alone never claims off or ready
  return "unknown";
}

/** i18n key for a status chip. */
export function externalOtelStatusMessageKey(
  status: ExternalOtelStatus,
): string {
  switch (status) {
    case "off":
      return "settings.privacy.externalOtel.status.off";
    case "incomplete":
      return "settings.privacy.externalOtel.status.incomplete";
    case "ready":
      return "settings.privacy.externalOtel.status.ready";
    case "unknown":
      return "settings.privacy.externalOtel.status.unknown";
    case "host_only":
      return "settings.privacy.externalOtel.status.hostOnly";
  }
}

/** Visual tone for status chips. */
export function externalOtelStatusTone(
  status: ExternalOtelStatus,
): ExternalOtelTone {
  switch (status) {
    case "ready":
      return "ok";
    case "incomplete":
      return "warn";
    case "off":
      return "muted";
    case "unknown":
      return "info";
    case "host_only":
      return "muted";
  }
}

/** CSS helper class for tone chips (Settings panel). */
export function externalOtelToneClass(tone: ExternalOtelTone): string {
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
 * Honesty checklist for dual opt-in + content-free defaults.
 * Step `done` is null when evidence is unset (UI shows pending, not fail).
 */
export function buildExternalOtelChecklist(
  input: ExternalOtelResolveInput = {},
): ExternalOtelChecklistStep[] {
  const master = triBool(input.masterEnv);
  const exporters = triBool(input.exportersConfigured);

  return [
    {
      id: "master",
      done: master,
      messageKey: "settings.privacy.externalOtel.check.master",
    },
    {
      id: "exporter",
      done: exporters,
      messageKey: "settings.privacy.externalOtel.check.exporter",
    },
    {
      id: "content_free",
      // Always true as CLI default honesty (content-free by default).
      done: true,
      messageKey: "settings.privacy.externalOtel.check.contentFree",
    },
    {
      id: "no_app_secrets",
      // App never writes OTEL headers into config — always holds.
      done: true,
      messageKey: "settings.privacy.externalOtel.check.noAppSecrets",
    },
    {
      id: "independent_stream",
      // Independent of product telemetry / /privacy coding-data.
      done: true,
      messageKey: "settings.privacy.externalOtel.check.independent",
    },
  ];
}

/**
 * Plain-text env template with redacted placeholders (no secrets).
 * Safe to copy into a terminal or runbook.
 */
export function formatExternalOtelEnvHints(): string {
  return [
    "# External OpenTelemetry (enterprise) — Grok Build dual opt-in",
    "# Master alone enables nothing; exporters alone enable nothing.",
    "# Content-free by default (no prompts / code / tool args).",
    "# Collector auth: env headers only — never store tokens in config.toml.",
    "",
    `export ${EXTERNAL_OTEL_MASTER_ENV}=1`,
    "export OTEL_METRICS_EXPORTER=otlp",
    "export OTEL_LOGS_EXPORTER=otlp",
    "export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf",
    "export OTEL_EXPORTER_OTLP_ENDPOINT=https://collector.example:4318",
    `export ${EXTERNAL_OTEL_HEADERS_ENV}="Authorization=Bearer <REDACTED>"`,
    "",
    "# Optional content gates (default off):",
    "# export OTEL_LOG_USER_PROMPTS=0",
    "# export OTEL_LOG_TOOL_DETAILS=0",
    "",
    "# Config.toml peers (env wins; no headers key on disk):",
    "# [telemetry]",
    "# otel_enabled = true",
    '# otel_metrics_exporter = "otlp"',
    '# otel_logs_exporter = "otlp"',
    '# otel_endpoint = "https://collector.example:4318"',
    '# otel_protocol = "http/protobuf"',
  ].join("\n");
}

/**
 * Whether the App should claim external OTEL is disabled.
 * Always false when status is `unknown` / `host_only` / `incomplete`.
 */
export function externalOtelClaimsOff(status: ExternalOtelStatus): boolean {
  return status === "off";
}

/**
 * Soft shared-mode note: App privacy writes stay independent-only;
 * external OTEL is env/config on the CLI process — App never writes secrets.
 */
export function externalOtelSharedModeNoteKey(): string {
  return "settings.privacy.externalOtel.sharedNote";
}
