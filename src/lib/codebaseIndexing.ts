/**
 * Pure helpers for Codebase indexing settings (`[features].codebase_indexing`).
 *
 * Grok Build code **graph** indexing for search/code-nav — **not** memory
 * embeddings / vector search. App never invents embeddings client-side.
 *
 * CLI user guide (0.2.117+): default `true` when the key is missing. Value may
 * be a bool or richer forms (globs). This App writes **bool only**; non-bool
 * forms stay read-only with an honest “custom” status.
 *
 * Host enforces path-scope + write gate (independent agent-home only).
 */

/** Config table for the feature flag. */
export const CODEBASE_INDEXING_CONFIG_TABLE = "features";

/** Config key under `[features]`. */
export const CODEBASE_INDEXING_CONFIG_KEY = "codebase_indexing";

/** Full config path string for UI hints. */
export const CODEBASE_INDEXING_CONFIG_PATH = "[features] codebase_indexing";

/**
 * CLI documented default when the key is **unset** in config.toml.
 * Honesty: UI must show “unset” + “CLI default on”, not claim the key is set on.
 */
export const CODEBASE_INDEXING_CLI_DEFAULT = true;

/** First CLI that documents this surface (user-guide 0.2.117). */
export const CODEBASE_INDEXING_MIN_CLI = "0.2.117";

/** How the key appears on disk. */
export type CodebaseIndexingKind = "unset" | "bool" | "custom";

/** Tri-state bool for the simple enable form (null = unset or non-bool). */
export type CodebaseIndexingTri = boolean | null;

export type CodebaseIndexingValues = {
  /**
   * Bool form only. `null` when unset **or** custom (globs / tables).
   * Never invent CLI default as a concrete `true` in this field.
   */
  enabled: CodebaseIndexingTri;
  /**
   * Raw non-bool assignment text when kind is custom (e.g. globs).
   * Null for unset / bool forms. App does not parse or invent globs.
   */
  customRaw: string | null;
};

export type CodebaseIndexingPatch = {
  /** Set `[features].codebase_indexing` to this bool. Null = leave unchanged. */
  enabled?: boolean | null;
};

export type CodebaseIndexingSnapshotLike = {
  enabled?: boolean | null;
  customRaw?: string | null;
  kind?: string | null;
  /** CLI default when unset (host may echo; pure default is true). */
  cliDefault?: boolean | null;
  writable?: boolean;
  mode?: string;
  fileExists?: boolean;
  path?: string;
  /** Optional probed CLI version for soft-fail notes. */
  cliVersion?: string | null;
};

function tri(v: boolean | null | undefined): CodebaseIndexingTri {
  if (v === true) return true;
  if (v === false) return false;
  return null;
}

function optStr(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t : null;
}

/** Derive kind from snapshot fields (soft-fail missing → unset). */
export function codebaseIndexingKind(
  snap: CodebaseIndexingSnapshotLike | null | undefined,
): CodebaseIndexingKind {
  if (snap?.kind === "custom" || optStr(snap?.customRaw)) return "custom";
  if (snap?.kind === "bool" || snap?.enabled === true || snap?.enabled === false) {
    return "bool";
  }
  if (snap?.enabled != null && snap.enabled !== true && snap.enabled !== false) {
    // Non-boolean sneaked in — treat as custom for honesty.
    return "custom";
  }
  return "unset";
}

/** Map host snapshot → UI draft (null = unset / custom, never invent defaults). */
export function valuesFromCodebaseIndexingSnapshot(
  snap: CodebaseIndexingSnapshotLike | null | undefined,
): CodebaseIndexingValues {
  const kind = codebaseIndexingKind(snap);
  if (kind === "custom") {
    return {
      enabled: null,
      customRaw: optStr(snap?.customRaw) ?? optStr(String(snap?.enabled ?? "")),
    };
  }
  if (kind === "bool") {
    return { enabled: tri(snap?.enabled), customRaw: null };
  }
  return { enabled: null, customRaw: null };
}

/** Build a host patch from draft vs baseline (only concrete bool flips). */
export function buildCodebaseIndexingPatch(
  draft: CodebaseIndexingValues,
  baseline: CodebaseIndexingValues,
): CodebaseIndexingPatch {
  const patch: CodebaseIndexingPatch = {};
  if (draft.enabled !== baseline.enabled && draft.enabled !== null) {
    patch.enabled = draft.enabled;
  }
  return patch;
}

export function hasCodebaseIndexingChanges(
  patch: CodebaseIndexingPatch,
): boolean {
  return patch.enabled != null;
}

/**
 * Toggle for simple bool/unset form:
 * - null (unset) → true (first write enables; matches CLI default direction)
 * - true → false
 * - false → true
 *
 * Custom forms should not call this (toggle disabled).
 */
export function toggleCodebaseIndexingTri(
  current: CodebaseIndexingTri,
): boolean {
  if (current === null) return true;
  return !current;
}

/** Presence label id for the key on disk. */
export function codebaseIndexingPresence(
  values: CodebaseIndexingValues,
): "set_on" | "set_off" | "unset" | "custom" {
  if (optStr(values.customRaw)) return "custom";
  if (values.enabled === true) return "set_on";
  if (values.enabled === false) return "set_off";
  return "unset";
}

/**
 * Effective enable for status honesty (CLI semantics).
 * - bool true → on
 * - bool false → off
 * - unset → CLI default (true)
 * - custom (globs) → on with filters (not “embeddings”)
 */
export function effectiveCodebaseIndexingEnabled(
  values: CodebaseIndexingValues,
  cliDefault: boolean = CODEBASE_INDEXING_CLI_DEFAULT,
): boolean {
  const p = codebaseIndexingPresence(values);
  if (p === "set_on" || p === "custom") return true;
  if (p === "set_off") return false;
  return cliDefault === true;
}

/** Toggle checked state: only true when key is set on (not “default on”). */
export function codebaseIndexingToggleChecked(
  values: CodebaseIndexingValues,
): boolean {
  return values.enabled === true;
}

/** Whether the simple enable toggle is interactive (not custom). */
export function isCodebaseIndexingToggleable(
  values: CodebaseIndexingValues,
): boolean {
  return codebaseIndexingPresence(values) !== "custom";
}

/** Whether writes are allowed (independent mode only). */
export function isCodebaseIndexingWritable(
  snap: CodebaseIndexingSnapshotLike | null | undefined,
): boolean {
  return !!snap?.writable;
}

/**
 * Soft-gate: whether the CLI is known to document `[features].codebase_indexing`.
 * - Known ≥ 0.2.117 → true
 * - Known older → false
 * - Unknown / unparseable → null (soft-fail: still allow config write)
 *
 * Pure parse of `x.y.z` tokens only (no host IO).
 */
export function cliSupportsCodebaseIndexing(
  rawVersion: string | null | undefined,
): boolean | null {
  if (rawVersion == null) return null;
  const m = String(rawVersion).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3] ?? "0");
  if (![major, minor, patch].every((n) => Number.isFinite(n))) return null;
  if (major > 0) return true;
  if (major < 0) return false;
  if (minor > 2) return true;
  if (minor < 2) return false;
  return patch >= 117;
}

/**
 * Status summary for UI badges / copy (no invented embeddings).
 * `effective` follows CLI default when unset; `presence` stays honest.
 */
export function describeCodebaseIndexingStatus(
  values: CodebaseIndexingValues,
  opts?: {
    cliVersion?: string | null;
    cliDefault?: boolean;
  },
): {
  presence: "set_on" | "set_off" | "unset" | "custom";
  effective: boolean;
  cliSupport: boolean | null;
  /** True only for code-graph indexing — never “embeddings ready”. */
  isCodeGraphOnly: true;
  /** Always false: App does not run or claim embeddings for this feature. */
  inventsEmbeddings: false;
} {
  return {
    presence: codebaseIndexingPresence(values),
    effective: effectiveCodebaseIndexingEnabled(
      values,
      opts?.cliDefault ?? CODEBASE_INDEXING_CLI_DEFAULT,
    ),
    cliSupport: cliSupportsCodebaseIndexing(opts?.cliVersion),
    isCodeGraphOnly: true,
    inventsEmbeddings: false,
  };
}

/**
 * Config.toml assignment line for independent agent-home writes (bool only).
 * Example: `codebase_indexing = true`
 */
export function codebaseIndexingConfigAssignment(
  enabled: boolean | null | undefined,
): string {
  const v = enabled === true;
  return `${CODEBASE_INDEXING_CONFIG_KEY} = ${v}`;
}

/** True when two drafts normalize equal for dirty checks. */
export function codebaseIndexingEqual(
  a: CodebaseIndexingValues,
  b: CodebaseIndexingValues,
): boolean {
  return (
    a.enabled === b.enabled &&
    (optStr(a.customRaw) ?? null) === (optStr(b.customRaw) ?? null)
  );
}
