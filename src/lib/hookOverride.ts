/**
 * Hook override / dry-run helpers for Settings → Extensions → Hooks.
 *
 * Validates sample stdin JSON and records synthetic activity rows.
 * Does **not** execute shell hooks or talk to the host runner.
 */

import {
  normalizeHookEventType,
  pushHookActivity,
  redactHookDetail,
  type HookActivityOutcome,
  type HookActivityRecord,
} from "./hooksDebug";

/** Cap for sample stdin JSON (~32 KiB). */
export const HOOK_OVERRIDE_JSON_MAX = 32 * 1024;

/** Default max length for compact preview strings. */
export const HOOK_OVERRIDE_PREVIEW_MAX = 200;

export type ValidateHookOverrideOk = {
  ok: true;
  parsed: Record<string, unknown>;
};

export type ValidateHookOverrideErr = {
  ok: false;
  error: string;
};

export type ValidateHookOverrideResult =
  | ValidateHookOverrideOk
  | ValidateHookOverrideErr;

export type HookDryRunInput = {
  hookName?: string | null;
  /** Lifecycle event type label (PreToolUse, SessionStart, …). */
  type: string;
  outcome: HookActivityOutcome;
  detail?: string | null;
};

/**
 * Validate sample hook stdin as a JSON **object** only (not array/null/primitive).
 * Caps size at {@link HOOK_OVERRIDE_JSON_MAX}.
 */
export function validateHookOverrideJson(
  text: string | null | undefined,
): ValidateHookOverrideResult {
  const raw = String(text ?? "");
  if (!raw.trim()) {
    return { ok: false, error: "empty" };
  }
  // Count UTF-16 code units ≈ JS string length; good enough for a soft cap.
  if (raw.length > HOOK_OVERRIDE_JSON_MAX) {
    return {
      ok: false,
      error: `too_large:${raw.length}:${HOOK_OVERRIDE_JSON_MAX}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `invalid_json:${msg}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "not_object" };
  }
  return { ok: true, parsed: parsed as Record<string, unknown> };
}

/**
 * Compact one-line preview of a validated override object (keys + short values).
 * Secrets are redacted via {@link redactHookDetail}.
 */
export function formatHookOverridePreview(
  value: unknown,
  maxLen: number = HOOK_OVERRIDE_PREVIEW_MAX,
): string {
  if (value == null) return "";
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (typeof value === "object") {
    try {
      // Prefer stable key listing for plain objects.
      if (!Array.isArray(value)) {
        const o = value as Record<string, unknown>;
        const keys = Object.keys(o);
        if (keys.length === 0) {
          text = "{}";
        } else {
          const parts = keys.slice(0, 12).map((k) => {
            const v = o[k];
            if (v == null) return `${k}:null`;
            if (typeof v === "string") {
              const s = v.length > 24 ? `${v.slice(0, 23)}…` : v;
              return `${k}:${JSON.stringify(s)}`;
            }
            if (typeof v === "number" || typeof v === "boolean") {
              return `${k}:${String(v)}`;
            }
            if (Array.isArray(v)) return `${k}:[${v.length}]`;
            return `${k}:{…}`;
          });
          const more = keys.length > 12 ? `, +${keys.length - 12}` : "";
          text = `{ ${parts.join(", ")}${more} }`;
        }
      } else {
        text = JSON.stringify(value);
      }
    } catch {
      text = String(value);
    }
  } else {
    text = String(value);
  }
  return redactHookDetail(text, maxLen);
}

/**
 * Human-readable validation error for UI (English fallback; prefer i18n keys).
 * Maps machine codes from {@link validateHookOverrideJson}.
 */
export function hookOverrideValidationMessage(
  result: ValidateHookOverrideResult,
  labels?: {
    empty?: string;
    tooLarge?: string;
    invalidJson?: string;
    notObject?: string;
    ok?: string;
  },
): string {
  if (result.ok) {
    return labels?.ok ?? "Valid JSON object";
  }
  const err = result.error;
  if (err === "empty") {
    return labels?.empty ?? "JSON is empty";
  }
  if (err === "not_object") {
    return labels?.notObject ?? "JSON must be an object ({ … }), not an array or value";
  }
  if (err.startsWith("too_large:")) {
    return (
      labels?.tooLarge ??
      `JSON exceeds ${HOOK_OVERRIDE_JSON_MAX} character limit`
    );
  }
  if (err.startsWith("invalid_json:")) {
    const detail = err.slice("invalid_json:".length);
    if (labels?.invalidJson) {
      return labels.invalidJson.replace("{detail}", detail);
    }
    return `Invalid JSON: ${detail}`;
  }
  return err;
}

/**
 * Record a **synthetic dry-run** activity row into the session ring buffer.
 * Does not execute any hook script. Source is `"debug"`.
 */
export function recordHookDryRun(input: HookDryRunInput): HookActivityRecord {
  const type = normalizeHookEventType(input.type || "Hook");
  const hookName =
    typeof input.hookName === "string" && input.hookName.trim()
      ? input.hookName.trim()
      : undefined;
  const outcome = input.outcome ?? "info";
  const detailParts = [
    "dry-run",
    hookName ? `hook ${hookName}` : undefined,
    input.detail ? String(input.detail) : undefined,
  ].filter(Boolean);
  const rec: HookActivityRecord = {
    id: `debug-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    outcome,
    atMs: Date.now(),
    detail: redactHookDetail(detailParts.join(" · ") || "dry-run"),
    source: "debug",
    hookName,
  };
  pushHookActivity(rec);
  return rec;
}

export type HookActivityOutcomeFilter = "all" | "ok" | "fail" | "skip";

/** Filter activity rows by outcome chip (all / ok / fail / skip). */
export function filterHookActivitiesByOutcome<
  T extends { outcome: HookActivityOutcome },
>(
  records: readonly T[],
  filter: HookActivityOutcomeFilter,
): T[] {
  if (filter === "all") return records.slice();
  return records.filter((r) => r.outcome === filter);
}

/** Counts per outcome chip (info rolls into all only). */
export function countHookActivityOutcomes(
  records: readonly { outcome: HookActivityOutcome }[],
): Record<HookActivityOutcomeFilter, number> {
  const counts: Record<HookActivityOutcomeFilter, number> = {
    all: records.length,
    ok: 0,
    fail: 0,
    skip: 0,
  };
  for (const r of records) {
    if (r.outcome === "ok") counts.ok += 1;
    else if (r.outcome === "fail") counts.fail += 1;
    else if (r.outcome === "skip") counts.skip += 1;
  }
  return counts;
}

/**
 * Honest empty-state kind for the activity list.
 * - `empty` — no rows stored (soft-fail empty; never invent history)
 * - `filtered` — rows exist but none match the chip
 * - `list` — show rows
 */
export function resolveHookActivityEmptyState(
  totalCount: number,
  filteredCount: number,
): "empty" | "filtered" | "list" {
  if (totalCount <= 0) return "empty";
  if (filteredCount <= 0) return "filtered";
  return "list";
}
