/**
 * Pure helpers for “Continue last agent for this project” (CLI `grok -c/--continue`).
 *
 * Host scans `{GROK_HOME}/sessions/{percent-encoded-cwd}/` and imports/opens the
 * newest agent session. These helpers stay I/O-free for unit tests and UI gates.
 *
 * Pro: classified soft-fail (no session · no CLI · untrusted · host-only ·
 * import), empty honesty when none exist, and preflight gates for menu/palette.
 */

/** Normalize a project / cwd path for equality (trim, unify slashes, drop trailing sep, lower). */
export function normalizeCwdPath(path: string | null | undefined): string {
  let s = String(path ?? "")
    .trim()
    .replace(/\\/g, "/");
  while (s.length > 1 && s.endsWith("/")) {
    s = s.slice(0, -1);
  }
  return s.toLowerCase();
}

/** True when two cwd strings refer to the same project folder. */
export function cwdPathsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeCwdPath(a);
  const nb = normalizeCwdPath(b);
  return na.length > 0 && na === nb;
}

export type ContinueCwdSessionRow = {
  agentSessionId: string;
  cwd?: string | null;
  updatedAt?: string | null;
};

/**
 * Pick the newest session among rows whose `cwd` matches `projectPath`.
 * Compares `updatedAt` lexicographically (RFC3339-friendly). Soft-fails → null.
 */
export function pickLatestCliSessionForCwd<T extends ContinueCwdSessionRow>(
  rows: readonly T[],
  projectPath: string | null | undefined,
): T | null {
  const target = normalizeCwdPath(projectPath);
  if (!target) return null;
  let best: T | null = null;
  let bestUpdated = "";
  for (const row of rows) {
    if (!cwdPathsMatch(row.cwd, projectPath)) continue;
    const updated = (row.updatedAt ?? "").trim();
    if (!best || updated > bestUpdated) {
      best = row;
      bestUpdated = updated;
    }
  }
  return best;
}

// ── Soft-fail classification (pro) ───────────────────────────────────────────

/**
 * Stable soft-fail kinds for continue-cwd toasts / gates.
 * Never invents a session id; empty host result is {@link "no_session"}.
 */
export type ContinueCwdSoftFailKind =
  | "no_project"
  | "no_session"
  | "no_cli"
  | "untrusted"
  | "host_only"
  | "import_failed"
  | "other";

/** Empty / honesty states the UI may surface without inventing history. */
export type ContinueCwdEmptyKind =
  | "no_project"
  | "no_session"
  | "no_cli"
  | "untrusted";

export type ContinueCwdGate =
  | { ok: true }
  | { ok: false; kind: ContinueCwdSoftFailKind };

export type ContinueCwdProjectLike = {
  path?: string | null;
  /** Trusted projects may run agents; untrusted soft-fails continue. */
  trusted?: boolean | null;
};

/**
 * Whether the project menu / palette should offer “Continue last agent…”.
 * Needs a non-empty bound project path. When `trusted === false`, still offer
 * so the click path can show an honest untrusted soft-fail toast (unless
 * `opts.hideWhenUntrusted`).
 */
export function canOfferContinueCwd(
  projectPath: string | null | undefined,
  opts?: {
    trusted?: boolean | null;
    /** When true, hide the action for untrusted projects. Default false. */
    hideWhenUntrusted?: boolean;
  },
): boolean {
  if (!normalizeCwdPath(projectPath)) return false;
  if (opts?.hideWhenUntrusted && opts.trusted === false) return false;
  return true;
}

/**
 * Preflight before Host `cli_session_continue_cwd`.
 * Order: host_only → no_project → untrusted → no_cli → ok.
 * Does **not** invent “no_session” (that is a host empty result).
 */
export function evaluateContinueCwd(
  project: ContinueCwdProjectLike | null | undefined,
  opts?: {
    /** `api.isTauri()` — false → host_only. Default true (optimistic). */
    isTauri?: boolean | null;
    /**
     * When known `false` (doctor / setup probe), soft-fail no_cli without
     * calling Host. `null`/`undefined` = unknown → allow attempt.
     */
    cliFound?: boolean | null;
  },
): ContinueCwdGate {
  if (opts?.isTauri === false) {
    return { ok: false, kind: "host_only" };
  }
  const path = project?.path;
  if (!normalizeCwdPath(path)) {
    return { ok: false, kind: "no_project" };
  }
  if (project?.trusted === false) {
    return { ok: false, kind: "untrusted" };
  }
  if (opts?.cliFound === false) {
    return { ok: false, kind: "no_cli" };
  }
  return { ok: true };
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
      status?: unknown;
    };
    const parts = [o.code, o.status, o.message, o.reason]
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

/**
 * Classify a thrown value / host error into a stable soft-fail kind.
 * Prefer explicit `code` over free-form text. Never invents success.
 */
export function classifyContinueCwdError(
  err: unknown,
): ContinueCwdSoftFailKind {
  if (err == null || err === "") return "other";

  const code = errCode(err);
  if (
    code === "no_project" ||
    code === "no-project" ||
    code === "empty_path" ||
    code === "empty-path"
  ) {
    return "no_project";
  }
  if (
    code === "no_session" ||
    code === "no-session" ||
    code === "none" ||
    code === "empty" ||
    code === "not_found"
  ) {
    return "no_session";
  }
  if (
    code === "no_cli" ||
    code === "no-cli" ||
    code === "cli_missing" ||
    code === "cli-missing" ||
    code === "cli_not_found" ||
    code === "cli-not-found"
  ) {
    return "no_cli";
  }
  if (
    code === "untrusted" ||
    code === "not_trusted" ||
    code === "not-trusted" ||
    code === "trust_required"
  ) {
    return "untrusted";
  }
  if (
    code === "host_only" ||
    code === "host-only" ||
    code === "need_tauri" ||
    code === "need-tauri"
  ) {
    return "host_only";
  }
  if (
    code === "import_failed" ||
    code === "import-failed" ||
    code === "import_error" ||
    code === "path_not_allowed" ||
    code === "path-not-allowed"
  ) {
    return "import_failed";
  }

  const s = errText(err).toLowerCase();
  if (!s.trim()) return "other";

  if (
    s.includes("need tauri") ||
    s.includes("requires the tauri") ||
    s.includes("host only") ||
    s.includes("not in tauri")
  ) {
    return "host_only";
  }

  if (
    s.includes("cli_not_found") ||
    s.includes("cli not found") ||
    s.includes("cli_missing") ||
    s.includes("cli missing") ||
    s.includes("grok build not found") ||
    s.includes("grok build cli not found") ||
    s.includes("command not found") ||
    (s.includes("enoent") && (s.includes("grok") || s.includes("cli")))
  ) {
    return "no_cli";
  }

  if (
    s.includes("untrusted") ||
    s.includes("not trusted") ||
    s.includes("trust this project") ||
    s.includes("project is not trusted")
  ) {
    return "untrusted";
  }

  if (
    s.includes("no project") ||
    s.includes("select a project") ||
    s.includes("empty path") ||
    s.includes("path is empty")
  ) {
    return "no_project";
  }

  if (
    s.includes("no agent session") ||
    s.includes("no session") ||
    s.includes("session not found") ||
    s.includes("none found") ||
    s.includes("no cli session")
  ) {
    return "no_session";
  }

  if (
    s.includes("import") ||
    s.includes("path not allowed") ||
    s.includes("outside grok_home") ||
    s.includes("not a directory") ||
    s.includes("cli session dir not found")
  ) {
    return "import_failed";
  }

  return "other";
}

/**
 * Classify a successful Host call that returned null / empty id as empty honesty.
 * Non-empty id → null (caller handles success).
 */
export function classifyContinueCwdEmptyResult(
  meta: { id?: string | null } | null | undefined,
): ContinueCwdSoftFailKind | null {
  if (meta == null) return "no_session";
  const id = typeof meta.id === "string" ? meta.id.trim() : "";
  if (!id) return "no_session";
  return null;
}

/** i18n message key for a classified soft-fail (never invent success). */
export function continueCwdSoftFailMessageKey(
  kind: ContinueCwdSoftFailKind,
): string {
  switch (kind) {
    case "no_project":
      return "project.continueCwdNoProject";
    case "no_session":
      return "project.continueCwdNone";
    case "no_cli":
      return "project.continueCwdNoCli";
    case "untrusted":
      return "project.continueCwdUntrusted";
    case "host_only":
      return "project.continueCwdHostOnly";
    case "import_failed":
      return "project.continueCwdImportFailed";
    case "other":
    default:
      return "project.continueCwdFailed";
  }
}

/**
 * Resolve user-facing soft-fail copy from a thrown value.
 * `detail` is a short technical suffix for `other` only (never secrets-heavy).
 */
export function resolveContinueCwdSoftFail(err: unknown): {
  kind: ContinueCwdSoftFailKind;
  messageKey: string;
  /** Short technical detail for debug suffix (empty when not useful). */
  detail: string;
} {
  const kind = classifyContinueCwdError(err);
  const messageKey = continueCwdSoftFailMessageKey(kind);
  const raw = errText(err).trim();
  let detail = "";
  if (
    kind === "other" &&
    raw &&
    !/^error:\s*$/i.test(raw) &&
    raw.length < 200
  ) {
    detail = raw.replace(/^Error:\s*/i, "").trim();
  }
  return { kind, messageKey, detail };
}

/**
 * Empty honesty for null Host result (no agent session under cwd).
 * Prefer this over a generic failure toast.
 */
export function resolveContinueCwdEmptyHonesty(): {
  kind: "no_session";
  messageKey: string;
} {
  return {
    kind: "no_session",
    messageKey: continueCwdSoftFailMessageKey("no_session"),
  };
}

/**
 * Resolve an empty / blocked state for menu hints or toasts without inventing
 * a session. Returns null when the project is ready to attempt continue.
 */
export function resolveContinueCwdEmptyState(input: {
  projectPath?: string | null;
  trusted?: boolean | null;
  isTauri?: boolean | null;
  cliFound?: boolean | null;
  /** Host already returned empty / null meta. */
  hostEmpty?: boolean;
}): { kind: ContinueCwdEmptyKind | "host_only"; messageKey: string } | null {
  if (input.isTauri === false) {
    return {
      kind: "host_only",
      messageKey: continueCwdSoftFailMessageKey("host_only"),
    };
  }
  if (!normalizeCwdPath(input.projectPath)) {
    return {
      kind: "no_project",
      messageKey: continueCwdSoftFailMessageKey("no_project"),
    };
  }
  if (input.trusted === false) {
    return {
      kind: "untrusted",
      messageKey: continueCwdSoftFailMessageKey("untrusted"),
    };
  }
  if (input.cliFound === false) {
    return {
      kind: "no_cli",
      messageKey: continueCwdSoftFailMessageKey("no_cli"),
    };
  }
  if (input.hostEmpty) {
    return {
      kind: "no_session",
      messageKey: continueCwdSoftFailMessageKey("no_session"),
    };
  }
  return null;
}
