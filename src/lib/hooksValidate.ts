/**
 * HOOK-VALIDATE-PRO — pure helpers for Hooks try-run / stdin validation UX.
 *
 * Classifies host try-run outcomes and client-side JSON checks into stable
 * machine kinds for i18n labels, severity chips, and GlassModal presentation.
 * Never invents success — only maps honest host / parse signals.
 */

import {
  formatHookOverridePreview,
  validateHookOverrideJson,
  type ValidateHookOverrideResult,
} from "./hookOverride";
import {
  formatHooksTryRunOutput,
  formatHooksTryRunSummary,
  hooksTryStdinErrorCode,
  validateHooksTryStdin,
  type HooksTryRunLike,
  type ValidateTryStdinResult,
} from "./hooksTryRun";
import { redactHookDetail } from "./hooksDebug";

/** Stable error / outcome kinds for try-run + validate UI. */
export type HooksValidateKind =
  | "ok"
  | "timeout"
  | "exit_nonzero"
  | "empty_path"
  | "path_outside_hooks"
  | "path_not_absolute"
  | "not_found"
  | "not_a_file"
  | "invalid_path"
  | "stdin_too_large"
  | "invalid_json"
  | "stdin_empty"
  | "stdin_not_object"
  | "spawn_failed"
  | "wait_failed"
  | "refused"
  | "host_only"
  | "host_error"
  | "other";

/** Visual severity for chips / modal tone. */
export type HooksValidateSeverity = "ok" | "warn" | "err" | "info";

/** Modal / panel presentation model (strings already resolved or English fallback). */
export type HooksValidatePresentation = {
  kind: HooksValidateKind;
  severity: HooksValidateSeverity;
  /** Short headline (e.g. "Exit 0", "Refused", "Valid JSON object"). */
  title: string;
  /** One-line summary (may equal title + duration / reason). */
  summary: string;
  /** Optional longer detail (redacted host message or JSON preview). */
  detail: string;
  /** Combined stdout/stderr preview (try-run only). */
  output: string;
  /** Machine reason from host when present. */
  reason: string | null;
  path: string | null;
  scope: string | null;
  exitCode: number | null;
  durationMs: number | null;
  timedOut: boolean;
  refused: boolean;
  /** Whether this represents a successful outcome. */
  ok: boolean;
};

/** Known host `reason` strings → kind. */
const HOST_REASON_KIND: Record<string, HooksValidateKind> = {
  empty_path: "empty_path",
  path_outside_hooks: "path_outside_hooks",
  path_not_absolute: "path_not_absolute",
  not_found: "not_found",
  not_a_file: "not_a_file",
  invalid_path: "invalid_path",
  stdin_too_large: "stdin_too_large",
  invalid_json: "invalid_json",
  spawn_failed: "spawn_failed",
  wait_failed: "wait_failed",
  timeout: "timeout",
};

/**
 * Classify a host try-run envelope into a stable kind.
 * Prefer explicit flags (ok / timedOut / refused) then `reason`.
 */
export function classifyHooksTryResult(
  result: HooksTryRunLike | null | undefined,
): HooksValidateKind {
  if (!result) return "other";
  if (result.ok) return "ok";
  if (result.timedOut) return "timeout";

  const reason = String(result.reason ?? "")
    .trim()
    .toLowerCase();
  if (reason && HOST_REASON_KIND[reason]) {
    return HOST_REASON_KIND[reason];
  }

  if (result.refused) {
    if (reason.includes("outside")) return "path_outside_hooks";
    if (reason.includes("not_a_file") || reason.includes("directory")) {
      return "not_a_file";
    }
    if (reason.includes("not_found") || reason.includes("enoent")) {
      return "not_found";
    }
    return "refused";
  }

  if (reason === "spawn_failed") return "spawn_failed";
  if (reason === "wait_failed") return "wait_failed";

  if (
    typeof result.exitCode === "number" &&
    Number.isFinite(result.exitCode) &&
    result.exitCode !== 0
  ) {
    return "exit_nonzero";
  }

  return "other";
}

/**
 * Classify a thrown host / invoke error before a result envelope exists.
 */
export function classifyHooksTryException(
  err: unknown,
): HooksValidateKind {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err ?? "");
  const m = raw.toLowerCase();
  if (!m.trim()) return "host_error";
  if (
    m.includes("not a tauri") ||
    m.includes("not available") ||
    m.includes("requires the desktop") ||
    m.includes("host only")
  ) {
    return "host_only";
  }
  if (m.includes("timed out") || m.includes("timeout")) return "timeout";
  if (m.includes("outside") && m.includes("hook")) return "path_outside_hooks";
  if (m.includes("not found") || m.includes("enoent")) return "not_found";
  if (m.includes("invalid json") || m.includes("json")) return "invalid_json";
  if (m.includes("too large") || m.includes("32")) return "stdin_too_large";
  return "host_error";
}

/**
 * Map client-side try-run stdin check (`validateHooksTryStdin`) to a kind.
 * Empty stdin is allowed for real try-run → returns null (no error).
 */
export function classifyHooksTryStdinError(
  result: ValidateTryStdinResult,
): HooksValidateKind | null {
  if (result.ok) return null;
  const code = hooksTryStdinErrorCode(result);
  if (code === "too_large") return "stdin_too_large";
  if (code === "invalid_json") return "invalid_json";
  return "invalid_json";
}

/**
 * Map dry-run / Validate-button object JSON check to a kind.
 */
export function classifyHooksOverrideValidation(
  result: ValidateHookOverrideResult,
): HooksValidateKind {
  if (result.ok) return "ok";
  const err = result.error;
  if (err === "empty") return "stdin_empty";
  if (err === "not_object") return "stdin_not_object";
  if (err.startsWith("too_large:")) return "stdin_too_large";
  if (err.startsWith("invalid_json:")) return "invalid_json";
  return "other";
}

/** Severity for a classified kind (honest: refused is warn, fail is err). */
export function hooksValidateSeverity(
  kind: HooksValidateKind,
): HooksValidateSeverity {
  switch (kind) {
    case "ok":
      return "ok";
    case "refused":
    case "empty_path":
    case "path_outside_hooks":
    case "path_not_absolute":
    case "not_found":
    case "not_a_file":
    case "invalid_path":
    case "host_only":
      return "warn";
    case "timeout":
    case "exit_nonzero":
    case "stdin_too_large":
    case "invalid_json":
    case "stdin_empty":
    case "stdin_not_object":
    case "spawn_failed":
    case "wait_failed":
    case "host_error":
    case "other":
      return "err";
    default:
      return "err";
  }
}

export type HooksValidateKindLabels = Partial<
  Record<HooksValidateKind, string>
>;

/** English fallback labels for kinds (UI should prefer i18n). */
export const HOOKS_VALIDATE_KIND_FALLBACK: Record<HooksValidateKind, string> = {
  ok: "OK",
  timeout: "Timed out",
  exit_nonzero: "Non-zero exit",
  empty_path: "Empty path",
  path_outside_hooks: "Path outside hooks",
  path_not_absolute: "Path not absolute",
  not_found: "Not found",
  not_a_file: "Not a file",
  invalid_path: "Invalid path",
  stdin_too_large: "JSON too large",
  invalid_json: "Invalid JSON",
  stdin_empty: "JSON empty",
  stdin_not_object: "JSON not an object",
  spawn_failed: "Spawn failed",
  wait_failed: "Wait failed",
  refused: "Refused",
  host_only: "Desktop host required",
  host_error: "Host error",
  other: "Error",
};

/** Actionable English hints (UI should prefer i18n). */
export const HOOKS_VALIDATE_HINT_FALLBACK: Partial<
  Record<HooksValidateKind, string>
> = {
  ok: "Script exited 0. Review stdout/stderr if needed.",
  timeout: "Raise the timeout (up to 60s) or fix a hung script.",
  exit_nonzero: "Script exited non-zero. Check stderr for details.",
  empty_path: "Pick a script under ~/.grok/hooks or project .grok/hooks.",
  path_outside_hooks:
    "Only scripts under user or project hooks folders can be try-run.",
  path_not_absolute: "Use an absolute path from the hooks list.",
  not_found: "File missing — refresh the list or recreate the script.",
  not_a_file: "Try-run needs a script file, not a directory.",
  invalid_path: "Path is invalid (e.g. contains NUL).",
  stdin_too_large: "Keep sample JSON under 32 KB.",
  invalid_json: "Fix JSON syntax before running.",
  stdin_empty: "Paste a JSON object for sample stdin validation.",
  stdin_not_object: "Hook stdin must be a JSON object ({ … }).",
  spawn_failed: "Could not start the process (permissions or interpreter).",
  wait_failed: "Host lost the process while waiting.",
  refused: "Host refused before spawn — see reason.",
  host_only: "Open the desktop app (Tauri) to try-run hooks.",
  host_error: "Host invoke failed — see detail.",
  other: "Unexpected outcome — see detail and output.",
};

export function hooksValidateKindLabel(
  kind: HooksValidateKind,
  labels?: HooksValidateKindLabels,
): string {
  return labels?.[kind] ?? HOOKS_VALIDATE_KIND_FALLBACK[kind] ?? kind;
}

export function hooksValidateHint(
  kind: HooksValidateKind,
  hints?: Partial<Record<HooksValidateKind, string>>,
): string {
  return hints?.[kind] ?? HOOKS_VALIDATE_HINT_FALLBACK[kind] ?? "";
}

export type BuildTryPresentationLabels = {
  refused?: string;
  timedOut?: string;
  ok?: string;
  fail?: string;
  kinds?: HooksValidateKindLabels;
  /** Optional override for summary line; default uses formatHooksTryRunSummary. */
};

/**
 * Build GlassModal-ready presentation from a host try-run result.
 */
export function buildHooksTryPresentation(
  result: HooksTryRunLike | null | undefined,
  labels?: BuildTryPresentationLabels,
): HooksValidatePresentation {
  const kind = classifyHooksTryResult(result);
  const severity = hooksValidateSeverity(kind);
  const kindLabel = hooksValidateKindLabel(kind, labels?.kinds);
  const summary = result
    ? formatHooksTryRunSummary(result, {
        refused: labels?.refused,
        timedOut: labels?.timedOut,
        ok: labels?.ok,
        fail: labels?.fail,
      })
    : kindLabel;
  const detail = result?.message
    ? redactHookDetail(String(result.message), 240)
    : result?.reason
      ? redactHookDetail(String(result.reason), 120)
      : "";
  const output = formatHooksTryRunOutput(result);
  return {
    kind,
    severity,
    title: kindLabel,
    summary: summary || kindLabel,
    detail,
    output,
    reason: result?.reason ? String(result.reason) : null,
    path: result?.path ? String(result.path) : null,
    scope: result?.scope ? String(result.scope) : null,
    exitCode:
      result?.exitCode == null || result.exitCode === undefined
        ? null
        : Number(result.exitCode),
    durationMs:
      typeof result?.durationMs === "number" ? result.durationMs : null,
    timedOut: Boolean(result?.timedOut),
    refused: Boolean(result?.refused),
    ok: Boolean(result?.ok),
  };
}

/**
 * Build presentation for a thrown error (no result envelope).
 */
export function buildHooksTryExceptionPresentation(
  err: unknown,
  labels?: { kinds?: HooksValidateKindLabels },
): HooksValidatePresentation {
  const kind = classifyHooksTryException(err);
  const severity = hooksValidateSeverity(kind);
  const kindLabel = hooksValidateKindLabel(kind, labels?.kinds);
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err ?? "");
  const detail = redactHookDetail(raw, 240);
  return {
    kind,
    severity,
    title: kindLabel,
    summary: detail || kindLabel,
    detail,
    output: "",
    reason: kind,
    path: null,
    scope: null,
    exitCode: null,
    durationMs: null,
    timedOut: kind === "timeout",
    refused: false,
    ok: false,
  };
}

export type BuildStdinValidateLabels = {
  empty?: string;
  tooLarge?: string;
  invalidJson?: string;
  notObject?: string;
  ok?: string;
  kinds?: HooksValidateKindLabels;
};

/**
 * Validate sample stdin as a JSON **object** (Validate button / dry-run style).
 * Empty is an error (user asked to validate). Returns presentation + raw check.
 */
export function buildHooksStdinValidatePresentation(
  text: string | null | undefined,
  labels?: BuildStdinValidateLabels,
): {
  check: ValidateHookOverrideResult;
  presentation: HooksValidatePresentation;
} {
  const check = validateHookOverrideJson(text);
  const kind = classifyHooksOverrideValidation(check);
  const severity = hooksValidateSeverity(kind);
  const kindLabel = hooksValidateKindLabel(kind, labels?.kinds);

  let title = kindLabel;
  let summary = kindLabel;
  let detail = "";

  if (check.ok) {
    title = labels?.ok ?? kindLabel;
    const preview = formatHookOverridePreview(check.parsed);
    summary = preview ? `${title} · ${preview}` : title;
    detail = preview;
  } else if (check.error === "empty") {
    title = labels?.empty ?? kindLabel;
    summary = title;
  } else if (check.error === "not_object") {
    title = labels?.notObject ?? kindLabel;
    summary = title;
  } else if (check.error.startsWith("too_large:")) {
    title = labels?.tooLarge ?? kindLabel;
    summary = title;
  } else if (check.error.startsWith("invalid_json:")) {
    const rawDetail = check.error.slice("invalid_json:".length);
    if (labels?.invalidJson) {
      title = labels.invalidJson.replace("{detail}", rawDetail);
    } else {
      title = `Invalid JSON: ${rawDetail}`;
    }
    summary = title;
    detail = redactHookDetail(rawDetail, 160);
  }

  return {
    check,
    presentation: {
      kind,
      severity,
      title,
      summary,
      detail,
      output: "",
      reason: check.ok ? null : check.error.split(":")[0] ?? "error",
      path: null,
      scope: null,
      exitCode: null,
      durationMs: null,
      timedOut: false,
      refused: false,
      ok: check.ok,
    },
  };
}

/**
 * Pre-flight for real try-run: path + optional JSON (empty OK).
 * Returns a presentation when the client should block the host call.
 */
export function buildHooksTryPreflightError(
  path: string | null | undefined,
  stdinText: string | null | undefined,
  opts?: {
    isTauri?: boolean;
    labels?: {
      noPath?: string;
      hostOnly?: string;
      tooLarge?: string;
      invalidJson?: string;
      kinds?: HooksValidateKindLabels;
    };
  },
): HooksValidatePresentation | null {
  const labels = opts?.labels;
  if (opts?.isTauri === false) {
    const kind: HooksValidateKind = "host_only";
    const title = labels?.hostOnly ?? hooksValidateKindLabel(kind, labels?.kinds);
    return {
      kind,
      severity: hooksValidateSeverity(kind),
      title,
      summary: title,
      detail: "",
      output: "",
      reason: "host_only",
      path: null,
      scope: null,
      exitCode: null,
      durationMs: null,
      timedOut: false,
      refused: true,
      ok: false,
    };
  }
  if (!(path ?? "").trim()) {
    const kind: HooksValidateKind = "empty_path";
    const title = labels?.noPath ?? hooksValidateKindLabel(kind, labels?.kinds);
    return {
      kind,
      severity: hooksValidateSeverity(kind),
      title,
      summary: title,
      detail: "",
      output: "",
      reason: "empty_path",
      path: null,
      scope: null,
      exitCode: null,
      durationMs: null,
      timedOut: false,
      refused: true,
      ok: false,
    };
  }
  const stdin = validateHooksTryStdin(stdinText);
  const stdinKind = classifyHooksTryStdinError(stdin);
  if (stdinKind) {
    let title = hooksValidateKindLabel(stdinKind, labels?.kinds);
    let detail = "";
    if (stdinKind === "stdin_too_large") {
      title = labels?.tooLarge ?? title;
    } else if (!stdin.ok && stdin.error.startsWith("invalid_json:")) {
      const d = stdin.error.slice("invalid_json:".length);
      title = labels?.invalidJson
        ? labels.invalidJson.replace("{detail}", d)
        : `Invalid JSON: ${d}`;
      detail = d;
    }
    return {
      kind: stdinKind,
      severity: hooksValidateSeverity(stdinKind),
      title,
      summary: title,
      detail: redactHookDetail(detail, 160),
      output: "",
      reason: stdinKind,
      path: (path ?? "").trim() || null,
      scope: null,
      exitCode: null,
      durationMs: null,
      timedOut: false,
      refused: true,
      ok: false,
    };
  }
  return null;
}

/**
 * Badge class suffix helper for UI (`ok` | `fail` | `muted`).
 * Maps severity → existing ext-badge modifiers.
 */
export function hooksValidateBadgeTone(
  severity: HooksValidateSeverity,
): "ok" | "fail" | "muted" {
  if (severity === "ok") return "ok";
  if (severity === "err") return "fail";
  return "muted";
}
