/**
 * ACCOUNT-QUOTA-HONESTY — pure helpers for SuperGrok quota surface.
 *
 * Rules:
 * - Never invent remaining % / used % when the Host is silent.
 * - Soft-fail probe errors (network · auth · host_only · other).
 * - Unknown / empty chips instead of fake "100%" or "0%".
 * - No DOM / Tauri side effects.
 *
 * See docs/llm-wiki/account.md (billing / quota aligned with grok-go).
 */

// ── Usage known? ─────────────────────────────────────────────────────────────

/** Minimal billing shape accepted by honesty helpers (matches BillingSnapshot). */
export type QuotaBillingLike = {
  available?: boolean | null;
  creditUsagePercent?: number | null;
  remainingPercent?: number | null;
  monthlyLimit?: number | null;
  includedUsed?: number | null;
  message?: string | null;
};

/**
 * True when Host returned a finite usage figure we can display.
 * Never treats `available: true` alone as known remaining.
 */
export function isQuotaUsageKnown(
  billing: QuotaBillingLike | null | undefined,
): boolean {
  if (!billing) return false;
  if (
    billing.creditUsagePercent != null &&
    Number.isFinite(billing.creditUsagePercent)
  ) {
    return true;
  }
  if (
    billing.remainingPercent != null &&
    Number.isFinite(billing.remainingPercent)
  ) {
    return true;
  }
  if (
    billing.monthlyLimit != null &&
    Number.isFinite(billing.monthlyLimit) &&
    billing.monthlyLimit > 0 &&
    billing.includedUsed != null &&
    Number.isFinite(billing.includedUsed)
  ) {
    return true;
  }
  return false;
}

/**
 * Honest used / remaining percents from a billing snapshot.
 * Returns nulls when Host is silent — never invents 0 or 100.
 */
export type QuotaPercents = {
  usedPercent: number | null;
  remainingPercent: number | null;
};

export function resolveQuotaPercents(
  billing: QuotaBillingLike | null | undefined,
): QuotaPercents {
  if (!billing) {
    return { usedPercent: null, remainingPercent: null };
  }

  let used: number | null = null;
  if (
    billing.creditUsagePercent != null &&
    Number.isFinite(billing.creditUsagePercent)
  ) {
    // Allow slight overflow past 100 like grok-go.
    used = Math.max(0, Math.min(200, billing.creditUsagePercent));
  } else if (
    billing.remainingPercent != null &&
    Number.isFinite(billing.remainingPercent)
  ) {
    used = Math.max(0, 100 - billing.remainingPercent);
  } else if (
    billing.monthlyLimit != null &&
    billing.monthlyLimit > 0 &&
    billing.includedUsed != null &&
    Number.isFinite(billing.includedUsed)
  ) {
    used = Math.max(
      0,
      Math.min(100, (billing.includedUsed / billing.monthlyLimit) * 100),
    );
  }

  let remaining: number | null = null;
  if (
    billing.remainingPercent != null &&
    Number.isFinite(billing.remainingPercent)
  ) {
    remaining = Math.max(0, Math.min(100, billing.remainingPercent));
  } else if (used != null) {
    remaining = Math.max(0, Math.min(100, 100 - used));
  }

  return { usedPercent: used, remainingPercent: remaining };
}

/**
 * Format a known remaining percent for chips ("42%").
 * Returns `null` when unknown — callers must use {@link formatQuotaUnknown}
 * instead of inventing "0%" / "100%".
 */
export function formatQuotaRemainLabel(
  remainingPercent: number | null | undefined,
): string | null {
  if (remainingPercent == null || !Number.isFinite(remainingPercent)) {
    return null;
  }
  const n = Math.max(0, Math.min(100, remainingPercent));
  return `${n.toFixed(0)}%`;
}

// ── Error classification ─────────────────────────────────────────────────────

/**
 * Stable SuperGrok quota probe failure kinds.
 * - `network` — transport / offline / timeout while fetching billing
 * - `auth` — signed-out / expired token / 401-class
 * - `host_only` — browser / mirror without desktop Host
 * - `other` — unclassified soft-fail
 */
export type QuotaErrorKind = "network" | "auth" | "host_only" | "other";

export type QuotaErrorView = {
  kind: QuotaErrorKind;
  /** Soft-fail: never invent remaining; warn chrome only. */
  softFail: boolean;
  /** Short detail excerpt (no secrets expected). */
  detail: string;
  /** i18n title key under account.quota.err.*. */
  titleKey: string;
  /** i18n hint key under account.quota.err.*. */
  hintKey: string;
};

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
      status?: unknown;
    };
    const parts = [o.code, o.status, o.message, o.reason, o.error]
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
 * Classify SuperGrok quota / account_status failures into a stable kind.
 * Prefer explicit codes and known host phrases over free-form text.
 */
export function classifyQuotaError(err: unknown): QuotaErrorKind {
  if (err == null || err === "") return "other";

  const code = errCode(err);
  if (
    code === "host_only" ||
    code === "host-only" ||
    code === "need_tauri" ||
    code === "need-tauri" ||
    code === "desktop_only"
  ) {
    return "host_only";
  }
  if (
    code === "network" ||
    code === "offline" ||
    code === "econnrefused" ||
    code === "etimedout" ||
    code === "timeout"
  ) {
    return "network";
  }
  if (
    code === "auth" ||
    code === "unauthorized" ||
    code === "unauthenticated" ||
    code === "401" ||
    code === "403" ||
    code === "token_expired" ||
    code === "expired"
  ) {
    return "auth";
  }

  const s = errText(err).toLowerCase();
  if (!s.trim()) return "other";

  if (
    /need[_\s-]?tauri|desktop\s+app|host[_\s-]?only|not\s+available\s+in\s+browser|webview\s+only|requires\s+the\s+(tauri|desktop)|account\s+requires\s+tauri/i.test(
      s,
    )
  ) {
    return "host_only";
  }
  if (
    /network|offline|fetch\s+failed|failed\s+to\s+fetch|econnrefused|enotfound|etimedout|timed?\s*out|dns|connection\s+(reset|refused|error)|socket|proxy/i.test(
      s,
    )
  ) {
    return "network";
  }
  if (
    /\b401\b|\b403\b|unauthori[sz]ed|unauthenticated|token\s+expir|auth(entication)?\s+(fail|error|expir|required)|sign[-\s]?in\s+(expir|required|again)|not\s+signed\s+in|login\s+required|expired\s+(token|session|credential)/i.test(
      s,
    )
  ) {
    return "auth";
  }

  return "other";
}

/**
 * Build soft-fail presentation for a quota probe error.
 * All kinds soft-fail — never invent remaining %.
 */
export function quotaErrorView(err: unknown): QuotaErrorView {
  const kind = classifyQuotaError(err);
  const detail = errText(err).trim().slice(0, 280);
  return {
    kind,
    softFail: true,
    detail,
    titleKey: `account.quota.err.${kind}`,
    hintKey: `account.quota.err.${kind}Hint`,
  };
}

// ── Empty honesty ────────────────────────────────────────────────────────────

/**
 * Contextual empty surfaces for the SuperGrok quota block.
 * - `loading` — status still fetching, no known usage yet
 * - `signed_out` — no official membership
 * - `unknown` — membership present but Host silent on remaining
 * - `error` — classified Host/network/auth failure (soft-fail)
 */
export type QuotaEmptyKind = "loading" | "signed_out" | "unknown" | "error";

export type QuotaEmptyState = {
  kind: QuotaEmptyKind;
  /** Primary title i18n key under account.quota.*. */
  titleKey: string;
  /** Optional body / hint i18n key. */
  bodyKey: string | null;
  /**
   * Short chip label key (remain slot) — never a numeric percent.
   * Use with {@link formatQuotaUnknown}.
   */
  chipKey: string;
  /**
   * Soft-fail chrome (warn chip) vs quiet empty.
   * loading / signed_out are quiet; unknown / error are soft-warn.
   */
  softFail: boolean;
  /** When kind === "error", the classified error view. */
  error: QuotaErrorView | null;
  /** Offer refresh CTA (loading already has busy button). */
  showRefresh: boolean;
};

export type QuotaEmptyInput = {
  loading: boolean;
  /**
   * True when the user has official SuperGrok / Grok Build membership
   * (signed in via OAuth or key). Custom relay alone is not membership.
   */
  membership: boolean;
  /**
   * True when Host returned finite remaining / used figures.
   * Prefer {@link isQuotaUsageKnown}(billing).
   */
  usageKnown: boolean;
  /** Optional Host / account_status / billing probe error (soft-fail). */
  error?: unknown;
};

/**
 * Resolve which empty surface to show for the quota block.
 * Returns `null` when known usage should render (progress bar + %).
 *
 * Priority:
 * 1. loading + !usageKnown → loading (keep bar on background refresh)
 * 2. !membership → signed_out
 * 3. error + !usageKnown → error (soft-fail; never invent remaining)
 * 4. membership + !usageKnown → unknown
 * 5. otherwise null (render known bar; error chip may still show in chrome)
 *
 * Never invents remaining / used percentages.
 */
export function resolveQuotaEmptyState(
  opts: QuotaEmptyInput,
): QuotaEmptyState | null {
  const hasErr = opts.error != null && opts.error !== "";

  // Keep an existing known bar visible while a background refresh is in flight.
  if (opts.loading && !opts.usageKnown) {
    return {
      kind: "loading",
      titleKey: "account.quota.loading",
      bodyKey: "account.quota.loadingHint",
      chipKey: "account.quota.chip.loading",
      softFail: false,
      error: null,
      showRefresh: false,
    };
  }

  if (!opts.membership) {
    return {
      kind: "signed_out",
      titleKey: "account.quota.signedOut",
      bodyKey: "account.quota.signedOutHint",
      chipKey: "account.quota.chip.signedOut",
      softFail: false,
      error: null,
      showRefresh: false,
    };
  }

  if (hasErr && !opts.usageKnown) {
    const view = quotaErrorView(opts.error);
    return {
      kind: "error",
      titleKey: view.titleKey,
      bodyKey: view.hintKey,
      chipKey: `account.quota.chip.err.${view.kind}`,
      softFail: true,
      error: view,
      showRefresh: true,
    };
  }

  if (!opts.usageKnown) {
    return {
      kind: "unknown",
      titleKey: "account.quotaUnknown",
      bodyKey: "account.billingUnavailable",
      chipKey: "account.quota.chip.unknown",
      softFail: true,
      error: null,
      showRefresh: true,
    };
  }

  return null;
}

/**
 * Honesty labels for unknown / empty remaining chips.
 * Never returns a numeric percent string.
 */
export type QuotaUnknownLabels = {
  kind: QuotaEmptyKind | QuotaErrorKind | "unknown";
  /** Short remain-slot chip key. */
  chipKey: string;
  /** Primary title key. */
  titleKey: string;
  /** Body / hint key (nullable for minimal chips). */
  bodyKey: string | null;
};

/**
 * Map an empty-state or error kind to i18n honesty label keys.
 * Callers translate via `t(chipKey)` — never invent "0%" remaining.
 */
export function formatQuotaUnknown(
  kind: QuotaEmptyKind | QuotaErrorKind | "unknown" | null | undefined,
): QuotaUnknownLabels {
  switch (kind) {
    case "loading":
      return {
        kind: "loading",
        chipKey: "account.quota.chip.loading",
        titleKey: "account.quota.loading",
        bodyKey: "account.quota.loadingHint",
      };
    case "signed_out":
      return {
        kind: "signed_out",
        chipKey: "account.quota.chip.signedOut",
        titleKey: "account.quota.signedOut",
        bodyKey: "account.quota.signedOutHint",
      };
    case "network":
      return {
        kind: "network",
        chipKey: "account.quota.chip.err.network",
        titleKey: "account.quota.err.network",
        bodyKey: "account.quota.err.networkHint",
      };
    case "auth":
      return {
        kind: "auth",
        chipKey: "account.quota.chip.err.auth",
        titleKey: "account.quota.err.auth",
        bodyKey: "account.quota.err.authHint",
      };
    case "host_only":
      return {
        kind: "host_only",
        chipKey: "account.quota.chip.err.host_only",
        titleKey: "account.quota.err.host_only",
        bodyKey: "account.quota.err.host_onlyHint",
      };
    case "other":
      return {
        kind: "other",
        chipKey: "account.quota.chip.err.other",
        titleKey: "account.quota.err.other",
        bodyKey: "account.quota.err.otherHint",
      };
    case "error":
      return {
        kind: "error",
        chipKey: "account.quota.chip.err.other",
        titleKey: "account.quota.err.other",
        bodyKey: "account.quota.err.otherHint",
      };
    case "unknown":
    default:
      return {
        kind: "unknown",
        chipKey: "account.quota.chip.unknown",
        titleKey: "account.quotaUnknown",
        bodyKey: "account.billingUnavailable",
      };
  }
}

/**
 * Soft-fail error chip for the plan/quota title row when usage is known
 * but a background refresh failed (or as compact error chrome).
 */
export type QuotaErrorChip = {
  kind: QuotaErrorKind;
  titleKey: string;
  hintKey: string;
  softFail: true;
};

/** Build a title-row error chip; always soft-fail. */
export function resolveQuotaErrorChip(
  err: unknown,
): QuotaErrorChip | null {
  if (err == null || err === "") return null;
  const view = quotaErrorView(err);
  return {
    kind: view.kind,
    titleKey: view.titleKey,
    hintKey: view.hintKey,
    softFail: true,
  };
}
