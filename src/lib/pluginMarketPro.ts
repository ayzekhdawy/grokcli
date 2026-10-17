/**
 * PLUGIN-MARKET-PRO — pure helpers for marketplace install recovery and
 * catalog empty-state honesty (Settings → Extensions → Marketplace).
 *
 * CLI (`grok plugin …`) is the source of truth — never invent a second store.
 * Soft-fail when CLI is missing / too old (warn, no hard crash banner).
 * No DOM / Tauri side effects.
 */

/** Which marketplace operation produced the error. */
export type PluginMarketOp =
  | "install"
  | "list"
  | "validate"
  | "sources"
  | "update";

/** Stable failure kinds for install / list / validate / sources. */
export type PluginMarketErrorKind =
  | "cli_missing"
  | "cli_too_old"
  | "network"
  | "offline"
  | "timeout"
  | "not_found"
  | "already_installed"
  | "permission"
  | "auth"
  | "invalid_source"
  | "parse"
  | "host_only"
  | "host_error"
  | "other";

/** Contextual empty states for the catalog browse list. */
export type PluginCatalogEmptyKind =
  | "loading"
  | "cli_missing"
  | "cli_too_old"
  | "offline"
  | "error"
  | "no_sources"
  | "empty_catalog"
  | "empty_filter"
  | "empty_query";

/** Primary recovery action for Retry / empty CTAs. */
export type PluginMarketRetryAction =
  | "retry_install"
  | "retry_load"
  | "refresh_catalog"
  | "open_runtime"
  | "update_cli"
  | "clear_filter"
  | "none";

export type PluginMarketErrorView = {
  kind: PluginMarketErrorKind;
  /** Soft-fail: capability gap — warn, do not escalate to hard action banner. */
  softFail: boolean;
  /** Short English fallback title (UI prefers i18n). */
  title: string;
  /** Actionable English fallback hint (UI prefers i18n). */
  hint: string;
  /** Trimmed host detail (may be empty). */
  detail: string;
  op: PluginMarketOp;
};

export type PluginCatalogEmptyPresentation = {
  kind: PluginCatalogEmptyKind;
  /** Soft-fail empty (cli missing / too old) vs hard error empty. */
  softFail: boolean;
  /** i18n title key under ext.market.* */
  titleKey: string;
  /** Optional i18n hint key. */
  hintKey: string | null;
  /** Suggested primary CTA. */
  retryAction: PluginMarketRetryAction;
  /** Offer clear-filter / clear-search when filter or query is active. */
  showClearFilters: boolean;
};

export type PluginMarketRetryPlan = {
  action: PluginMarketRetryAction;
  softFail: boolean;
  /** Whether Retry button should re-run the failed op. */
  canRetry: boolean;
  /** English fallback label for the primary CTA. */
  label: string;
};

export type PluginMarketRowError = {
  kind: PluginMarketErrorKind;
  message: string;
  softFail: boolean;
};

// ── Error text helpers ──────────────────────────────────────────────────────

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
  if (typeof err === "object" && err !== null) {
    const o = err as { code?: unknown; reason?: unknown };
    if (typeof o.code === "string" && o.code.trim()) {
      return o.code.trim().toLowerCase().replace(/-/g, "_");
    }
    if (typeof o.reason === "string" && o.reason.trim()) {
      return o.reason.trim().toLowerCase().replace(/-/g, "_");
    }
  }
  return "";
}

/** English fallback titles for classified kinds. */
export const PLUGIN_MARKET_ERROR_TITLE_FALLBACK: Record<
  PluginMarketErrorKind,
  string
> = {
  cli_missing: "CLI missing",
  cli_too_old: "CLI too old",
  network: "Network error",
  offline: "Offline",
  timeout: "Timed out",
  not_found: "Not found",
  already_installed: "Already installed",
  permission: "Permission denied",
  auth: "Auth required",
  invalid_source: "Invalid source",
  parse: "Parse error",
  host_only: "Desktop host required",
  host_error: "Host error",
  other: "Error",
};

/** Actionable English hints for classified kinds. */
export const PLUGIN_MARKET_ERROR_HINT_FALLBACK: Record<
  PluginMarketErrorKind,
  string
> = {
  cli_missing: "Install or path the Grok CLI in Settings → Runtime, then retry.",
  cli_too_old:
    "Update Grok CLI (`grok update`) and fully restart the app, then retry.",
  network: "Check your connection and refresh the catalog.",
  offline: "You appear offline — reconnect and refresh the catalog.",
  timeout: "The CLI timed out — retry or refresh sources.",
  not_found: "Plugin or marketplace source was not found — check the name.",
  already_installed: "Plugin is already installed — use Reinstall to force.",
  permission: "Permission denied — check filesystem or agent trust.",
  auth: "Sign in or fix credentials, then retry.",
  invalid_source: "Use a marketplace name, git URL, owner/repo, or local path.",
  parse: "Catalog JSON could not be parsed — refresh or update the CLI.",
  host_only: "Open the desktop app (Tauri) to manage plugins.",
  host_error: "Host invoke failed — see detail.",
  other: "Unexpected result — see detail and retry.",
};

/** i18n title keys for market error kinds (`ext.market.err.*`). */
export function pluginMarketErrorTitleKey(kind: PluginMarketErrorKind): string {
  switch (kind) {
    case "cli_missing":
      return "ext.market.err.cliMissing";
    case "cli_too_old":
      return "ext.market.err.cliTooOld";
    case "network":
      return "ext.market.err.network";
    case "offline":
      return "ext.market.err.offline";
    case "timeout":
      return "ext.market.err.timeout";
    case "not_found":
      return "ext.market.err.notFound";
    case "already_installed":
      return "ext.market.err.alreadyInstalled";
    case "permission":
      return "ext.market.err.permission";
    case "auth":
      return "ext.market.err.auth";
    case "invalid_source":
      return "ext.market.err.invalidSource";
    case "parse":
      return "ext.market.err.parse";
    case "host_only":
      return "ext.market.err.hostOnly";
    case "host_error":
      return "ext.market.err.hostError";
    case "other":
    default:
      return "ext.market.err.other";
  }
}

/** i18n hint keys for market error kinds. */
export function pluginMarketErrorHintKey(kind: PluginMarketErrorKind): string {
  switch (kind) {
    case "cli_missing":
      return "ext.market.err.hint.cliMissing";
    case "cli_too_old":
      return "ext.market.err.hint.cliTooOld";
    case "network":
      return "ext.market.err.hint.network";
    case "offline":
      return "ext.market.err.hint.offline";
    case "timeout":
      return "ext.market.err.hint.timeout";
    case "not_found":
      return "ext.market.err.hint.notFound";
    case "already_installed":
      return "ext.market.err.hint.alreadyInstalled";
    case "permission":
      return "ext.market.err.hint.permission";
    case "auth":
      return "ext.market.err.hint.auth";
    case "invalid_source":
      return "ext.market.err.hint.invalidSource";
    case "parse":
      return "ext.market.err.hint.parse";
    case "host_only":
      return "ext.market.err.hint.hostOnly";
    case "host_error":
      return "ext.market.err.hint.hostError";
    case "other":
    default:
      return "ext.market.err.hint.other";
  }
}

/**
 * Soft-fail kinds: capability / environment gaps.
 * UI should warn (not hard red global crash) and still show catalog chrome.
 */
export function pluginMarketIsSoftFailKind(kind: PluginMarketErrorKind): boolean {
  return (
    kind === "cli_missing" ||
    kind === "cli_too_old" ||
    kind === "host_only"
  );
}

/**
 * Classify install / list / validate / sources failures into a stable kind.
 * Prefer explicit `code` / `reason`, then known host / CLI phrases.
 * Never invents success.
 */
export function classifyPluginMarketError(
  err: unknown,
  _op: PluginMarketOp = "install",
): PluginMarketErrorKind {
  // `_op` reserved for future op-specific heuristics; keep signature stable.
  void _op;
  if (err == null || err === "") return "other";

  const code = errCode(err);
  if (code === "cli_missing" || code === "cli_not_found") return "cli_missing";
  if (code === "cli_too_old" || code === "unsupported") return "cli_too_old";
  if (code === "network" || code === "econnrefused" || code === "enotfound") {
    return "network";
  }
  if (code === "offline") return "offline";
  if (code === "timeout" || code === "timed_out") return "timeout";
  if (code === "not_found" || code === "enoent") return "not_found";
  if (code === "already_installed" || code === "exists") {
    return "already_installed";
  }
  if (code === "permission" || code === "eacces" || code === "eperm") {
    return "permission";
  }
  if (code === "auth" || code === "unauthorized" || code === "auth_failed") {
    return "auth";
  }
  if (code === "invalid_source" || code === "invalid") return "invalid_source";
  if (code === "parse" || code === "parse_error") return "parse";
  if (code === "host_only" || code === "need_tauri") return "host_only";
  if (code === "host_error") return "host_error";

  const s = errText(err).toLowerCase();
  if (!s.trim()) return "other";

  // CLI missing
  if (
    s.includes("cli not found") ||
    s.includes("cli_not_found") ||
    s.includes("grok build not found") ||
    s.includes("grok build cli not found") ||
    s.includes("command not found") ||
    (s.includes("no such file") && s.includes("grok")) ||
    (s.includes("not found") && s.includes("cli"))
  ) {
    return "cli_missing";
  }

  // CLI too old / unknown subcommand (marketplace / available / install flags)
  if (
    s.includes("cli_too_old") ||
    s.includes("cli too old") ||
    (s.includes("does not support") &&
      (s.includes("plugin") ||
        s.includes("marketplace") ||
        s.includes("available") ||
        s.includes("validate"))) ||
    s.includes("unrecognized subcommand") ||
    s.includes("unknown subcommand") ||
    s.includes("unexpected subcommand") ||
    (s.includes("unexpected argument") &&
      (s.includes("available") ||
        s.includes("marketplace") ||
        s.includes("validate") ||
        s.includes("--trust")))
  ) {
    return "cli_too_old";
  }

  // Host-only (browser / non-Tauri)
  if (
    s.includes("need tauri") ||
    s.includes("not a tauri") ||
    s.includes("desktop only") ||
    s.includes("host only") ||
    s.includes("requires the desktop") ||
    s.includes("not available in browser")
  ) {
    return "host_only";
  }

  // Offline / network
  if (
    s.includes("offline") ||
    s.includes("network is unreachable") ||
    s.includes("no internet") ||
    s.includes("not connected to the internet")
  ) {
    return "offline";
  }
  if (
    s.includes("timed out") ||
    s.includes("timeout") ||
    s.includes("deadline exceeded")
  ) {
    return "timeout";
  }
  if (
    s.includes("econnrefused") ||
    s.includes("enotfound") ||
    s.includes("econnreset") ||
    s.includes("network") ||
    s.includes("dns") ||
    s.includes("could not resolve") ||
    s.includes("failed to fetch") ||
    s.includes("connection refused") ||
    s.includes("connection reset") ||
    s.includes("ssl") ||
    s.includes("tls") ||
    s.includes("proxy") ||
    s.includes("http 5") ||
    s.includes("http 4") ||
    s.includes("status code")
  ) {
    return "network";
  }

  // Already installed
  if (
    s.includes("already installed") ||
    s.includes("already exists") ||
    (s.includes("exists") && s.includes("install"))
  ) {
    return "already_installed";
  }

  // Invalid source / empty
  if (
    s.includes("plugin source required") ||
    s.includes("marketplace source required") ||
    s.includes("invalid source") ||
    s.includes("source required") ||
    s.includes("empty source")
  ) {
    return "invalid_source";
  }

  // Auth
  if (
    s.includes("unauthorized") ||
    s.includes("authentication") ||
    s.includes("not logged in") ||
    s.includes("login required") ||
    s.includes("401") ||
    s.includes("403") ||
    (s.includes("permission denied") && s.includes("auth"))
  ) {
    return "auth";
  }

  // Permission (filesystem)
  if (
    s.includes("permission denied") ||
    s.includes("access denied") ||
    s.includes("eacces") ||
    s.includes("operation not permitted")
  ) {
    return "permission";
  }

  // Parse / JSON
  if (
    s.includes("failed to parse") ||
    s.includes("parse error") ||
    s.includes("invalid json") ||
    s.includes("not an array") ||
    s.includes("json")
  ) {
    return "parse";
  }

  // Not found
  if (
    s.includes("not found") ||
    s.includes("does not exist") ||
    s.includes("no such") ||
    s.includes("unknown plugin") ||
    s.includes("unknown marketplace")
  ) {
    return "not_found";
  }

  // Host invoke failures
  if (
    s.includes("invoke") ||
    s.includes("ipc") ||
    s.includes("tauri") && s.includes("error")
  ) {
    return "host_error";
  }

  return "other";
}

/**
 * Build a presentation envelope for a thrown / host error.
 * `ok` is never implied — callers already know the action failed.
 */
export function buildPluginMarketErrorView(
  err: unknown,
  op: PluginMarketOp = "install",
): PluginMarketErrorView {
  const kind = classifyPluginMarketError(err, op);
  const detail = errText(err).trim();
  return {
    kind,
    softFail: pluginMarketIsSoftFailKind(kind),
    title: PLUGIN_MARKET_ERROR_TITLE_FALLBACK[kind],
    hint: PLUGIN_MARKET_ERROR_HINT_FALLBACK[kind],
    detail,
    op,
  };
}

// ── Catalog empty state ─────────────────────────────────────────────────────

export type PluginCatalogEmptyInput = {
  loading: boolean;
  /** Probe: CLI binary found (false → soft empty). */
  cliFound?: boolean | null;
  /**
   * Load / list error string or object (classified).
   * Soft-fail kinds suppress hard red banners.
   */
  error?: unknown;
  /** Configured marketplace source count. */
  sourceCount: number;
  /** Available plugins before filter/query (catalog size). */
  availableCount: number;
  /** Rows after marketplace chip + search query. */
  visibleCount: number;
  /** Active marketplace filter id (`__all__` or source name). */
  marketFilter?: string | null;
  /** Search query. */
  query?: string | null;
};

/**
 * Resolve empty-state presentation for marketplace catalog browse.
 * Returns `null` when there are visible rows (no empty UI).
 *
 * Priority: loading → cli missing → classified load error → no sources →
 * empty catalog → empty filter/query.
 */
export function resolvePluginCatalogEmptyState(
  input: PluginCatalogEmptyInput,
): PluginCatalogEmptyPresentation | null {
  if (input.loading && input.availableCount === 0 && input.sourceCount === 0) {
    return {
      kind: "loading",
      softFail: true,
      titleKey: "ext.market.availableLoading",
      hintKey: null,
      retryAction: "none",
      showClearFilters: false,
    };
  }

  if (input.cliFound === false) {
    return {
      kind: "cli_missing",
      softFail: true,
      titleKey: "ext.market.emptyCli",
      hintKey: "ext.market.emptyCliHint",
      retryAction: "open_runtime",
      showClearFilters: false,
    };
  }

  if (input.error != null && String(input.error).trim()) {
    const kind = classifyPluginMarketError(input.error, "list");
    if (kind === "cli_missing") {
      return {
        kind: "cli_missing",
        softFail: true,
        titleKey: "ext.market.emptyCli",
        hintKey: "ext.market.emptyCliHint",
        retryAction: "open_runtime",
        showClearFilters: false,
      };
    }
    if (kind === "cli_too_old") {
      return {
        kind: "cli_too_old",
        softFail: true,
        titleKey: "ext.market.emptyCliTooOld",
        hintKey: "ext.market.emptyCliTooOldHint",
        retryAction: "update_cli",
        showClearFilters: false,
      };
    }
    if (kind === "offline" || kind === "network") {
      return {
        kind: "offline",
        softFail: false,
        titleKey: "ext.market.emptyOffline",
        hintKey: "ext.market.emptyOfflineHint",
        retryAction: "retry_load",
        showClearFilters: false,
      };
    }
    if (kind === "timeout") {
      return {
        kind: "error",
        softFail: false,
        titleKey: "ext.market.emptyError",
        hintKey: "ext.market.err.hint.timeout",
        retryAction: "retry_load",
        showClearFilters: false,
      };
    }
    // Parse / host / other load failures — still show catalog chrome + retry.
    if (input.availableCount === 0) {
      return {
        kind: "error",
        softFail: pluginMarketIsSoftFailKind(kind),
        titleKey: "ext.market.emptyError",
        hintKey: pluginMarketErrorHintKey(kind),
        retryAction: "retry_load",
        showClearFilters: false,
      };
    }
  }

  if (input.visibleCount > 0) return null;

  // No sources configured
  if (input.sourceCount === 0) {
    return {
      kind: "no_sources",
      softFail: true,
      titleKey: "ext.market.empty",
      hintKey: "ext.market.emptyNoSourcesHint",
      retryAction: "none",
      showClearFilters: false,
    };
  }

  // Sources exist but catalog has zero available plugins
  if (input.availableCount === 0) {
    return {
      kind: "empty_catalog",
      softFail: true,
      titleKey: "ext.market.emptyCatalog",
      hintKey: "ext.market.emptyCatalogHint",
      retryAction: "refresh_catalog",
      showClearFilters: false,
    };
  }

  // Filter / query emptied the list
  const q = (input.query ?? "").trim();
  const filter = (input.marketFilter ?? "").trim();
  const filterActive = !!filter && filter !== "__all__";

  if (q) {
    return {
      kind: "empty_query",
      softFail: true,
      titleKey: "ext.market.availableEmpty",
      hintKey: "ext.market.emptyQueryHint",
      retryAction: "clear_filter",
      showClearFilters: true,
    };
  }

  if (filterActive) {
    return {
      kind: "empty_filter",
      softFail: true,
      titleKey: "ext.market.availableEmpty",
      hintKey: "ext.market.emptyFilterHint",
      retryAction: "clear_filter",
      showClearFilters: true,
    };
  }

  // Defensive fallback
  return {
    kind: "empty_catalog",
    softFail: true,
    titleKey: "ext.market.emptyCatalog",
    hintKey: "ext.market.emptyCatalogHint",
    retryAction: "refresh_catalog",
    showClearFilters: false,
  };
}

// ── Retry plan ──────────────────────────────────────────────────────────────

/**
 * Plan recovery for a classified error (install row Retry, catalog Retry, etc.).
 */
export function planPluginMarketRetry(
  kind: PluginMarketErrorKind,
  op: PluginMarketOp = "install",
): PluginMarketRetryPlan {
  const softFail = pluginMarketIsSoftFailKind(kind);

  if (kind === "cli_missing") {
    return {
      action: "open_runtime",
      softFail: true,
      canRetry: false,
      label: "Open Runtime",
    };
  }
  if (kind === "cli_too_old") {
    return {
      action: "update_cli",
      softFail: true,
      canRetry: false,
      label: "Update CLI",
    };
  }
  if (kind === "host_only") {
    return {
      action: "none",
      softFail: true,
      canRetry: false,
      label: "",
    };
  }
  if (kind === "offline" || kind === "network" || kind === "timeout") {
    if (op === "install" || op === "update") {
      return {
        action: "retry_install",
        softFail: false,
        canRetry: true,
        label: "Retry",
      };
    }
    return {
      action: "retry_load",
      softFail: false,
      canRetry: true,
      label: "Retry",
    };
  }
  if (kind === "already_installed") {
    return {
      action: "retry_install",
      softFail: false,
      canRetry: true,
      label: "Reinstall",
    };
  }
  if (kind === "parse" && (op === "list" || op === "sources")) {
    return {
      action: "refresh_catalog",
      softFail: false,
      canRetry: true,
      label: "Refresh catalog",
    };
  }
  if (op === "list" || op === "sources") {
    return {
      action: "retry_load",
      softFail,
      canRetry: true,
      label: "Retry",
    };
  }
  // install / update / validate default
  return {
    action: "retry_install",
    softFail,
    canRetry: true,
    label: "Retry",
  };
}

/**
 * Plan from a retry action suggested by empty-state presentation.
 */
export function planPluginMarketEmptyRetry(
  empty: Pick<PluginCatalogEmptyPresentation, "kind" | "retryAction" | "softFail">,
): PluginMarketRetryPlan {
  switch (empty.retryAction) {
    case "open_runtime":
      return {
        action: "open_runtime",
        softFail: true,
        canRetry: false,
        label: "Open Runtime",
      };
    case "update_cli":
      return {
        action: "update_cli",
        softFail: true,
        canRetry: false,
        label: "Update CLI",
      };
    case "retry_load":
      return {
        action: "retry_load",
        softFail: empty.softFail,
        canRetry: true,
        label: "Retry",
      };
    case "refresh_catalog":
      return {
        action: "refresh_catalog",
        softFail: empty.softFail,
        canRetry: true,
        label: "Refresh catalog",
      };
    case "clear_filter":
      return {
        action: "clear_filter",
        softFail: true,
        canRetry: false,
        label: "Clear filters",
      };
    case "retry_install":
      return {
        action: "retry_install",
        softFail: empty.softFail,
        canRetry: true,
        label: "Retry",
      };
    case "none":
    default:
      return {
        action: "none",
        softFail: empty.softFail,
        canRetry: false,
        label: "",
      };
  }
}

// ── Structured row errors (install recovery) ────────────────────────────────

/**
 * Set a classified per-row install error (immutable).
 * Empty key / empty message → no-op.
 */
export function setPluginMarketRowError(
  errors: Record<string, PluginMarketRowError>,
  rowKey: string,
  err: unknown,
  op: PluginMarketOp = "install",
): Record<string, PluginMarketRowError> {
  const key = (rowKey ?? "").trim();
  if (!key) return errors;
  const view = buildPluginMarketErrorView(err, op);
  const message = view.detail || view.title;
  if (!message.trim()) return errors;
  const next: PluginMarketRowError = {
    kind: view.kind,
    message,
    softFail: view.softFail,
  };
  const prev = errors[key];
  if (
    prev &&
    prev.kind === next.kind &&
    prev.message === next.message &&
    prev.softFail === next.softFail
  ) {
    return errors;
  }
  return { ...errors, [key]: next };
}

/** Clear a per-row install error (immutable). */
export function clearPluginMarketRowError(
  errors: Record<string, PluginMarketRowError>,
  rowKey: string,
): Record<string, PluginMarketRowError> {
  const key = (rowKey ?? "").trim();
  if (!key || !(key in errors)) return errors;
  const next = { ...errors };
  delete next[key];
  return next;
}

/**
 * Whether a catalog-level load error should use the soft (warn) banner
 * instead of a hard red action-error alert.
 */
export function pluginMarketLoadIsSoftFail(error: unknown): boolean {
  if (error == null || !String(error).trim()) return false;
  return pluginMarketIsSoftFailKind(classifyPluginMarketError(error, "list"));
}

/**
 * Prefer classified title + optional detail for row error text.
 * UI may still show raw detail under the kind chip.
 */
export function formatPluginMarketRowErrorMessage(
  row: PluginMarketRowError,
  opts?: { title?: string; includeDetail?: boolean },
): string {
  const title = (opts?.title ?? PLUGIN_MARKET_ERROR_TITLE_FALLBACK[row.kind]).trim();
  const detail = (row.message ?? "").trim();
  if (!opts?.includeDetail || !detail || detail === title) return title || detail;
  // Avoid duplicating long CLI dumps when title already covers it.
  if (detail.toLowerCase().includes(title.toLowerCase())) return detail;
  return `${title}: ${detail}`;
}
