/**
 * Pure helpers for MCP OAuth findings in the App GUI.
 *
 * Classifies doctor / inspect text as OAuth-required vs OAuth-retry (expired),
 * extracts safe browser URLs when doctor reports include them, and never
 * surfaces client secrets or access tokens.
 *
 * CLI probe (0.2.117): no `grok mcp auth|oauth|login` subcommand — OAuth is
 * interactive (TUI `/mcps` → `i`). Host path is open-external URL when present.
 */

import {
  detectAuthToneFromText,
  redactMcpText,
  type McpDoctorFindingRow,
  type McpServerStatus,
  type McpStatusTone,
} from "@/lib/mcpStatus";

/** Primary action for an OAuth-ish MCP failure. */
export type McpOauthActionKind = "authorize" | "retry";

/** Result of classifying a finding / server status for OAuth UI. */
export type McpOauthAction = {
  kind: McpOauthActionKind;
  /** Safe http(s) URLs extracted from doctor text (query secrets stripped). */
  authUrls: string[];
  /** Best URL to open first, if any. */
  preferredUrl: string | null;
  /** Server name when known. */
  server: string | null;
  /** True when credentials look expired / invalid (retry) vs never authorized. */
  isRetry: boolean;
};

/** Loose bag of free-form text for classification. */
export type McpOauthTextSource = {
  title?: string | null;
  detail?: string | null;
  reason?: string | null;
  issues?: readonly string[] | null;
  server?: string | null;
  tone?: McpStatusTone | null;
};

const OAUTH_REQUIRED_RE =
  /\b(oauth|authorization\s+required|auth(?:entication|orization)?\s+required|AuthorizationRequired|AuthRequired|www[-_]?authenticate|resource_metadata|protected[-_\s]?resource)\b/i;

const OAUTH_FAILED_RE =
  /\b(oauth\s+(failed|error|denied)|authorization\s+(failed|denied)|invalid_token|invalid_grant|access_token\s+(missing|invalid|expired)|refresh_token\s+(missing|invalid|expired))\b/i;

const EXPIRED_RE =
  /\b(expired|token\s+expir|credential[s]?\s+expir|session\s+expir|auth(?:entication)?\s+expir)\b/i;

/** Absolute http(s) URLs — stop at common delimiters / trailing punctuation. */
const URL_RE = /https?:\/\/[^\s<>"'`\])},;]+/gi;

/** Query keys that must never appear in opened / displayed auth URLs. */
const SECRET_QUERY_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "token",
  "client_secret",
  "code",
  "password",
  "secret",
  "api_key",
  "apikey",
  "authorization",
  "bearer",
]);

/**
 * True when free text clearly indicates MCP OAuth / authorization flow
 * (broader than generic 401 — prefers OAuth-ish wording).
 */
export function isMcpOauthText(text: string | null | undefined): boolean {
  if (!text?.trim()) return false;
  const t = text.trim();
  if (OAUTH_REQUIRED_RE.test(t) || OAUTH_FAILED_RE.test(t)) return true;
  // Generic auth tone from doctor helpers still counts when oauth keyword present.
  if (/\boauth\b/i.test(t) && detectAuthToneFromText(t) != null) return true;
  return false;
}

/**
 * Strip secret-bearing query params and fragment tokens from a URL.
 * Returns null when the URL is not safe http(s) or looks like a credential.
 */
export function sanitizeMcpAuthUrl(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  let u = String(raw).trim();
  // Trim trailing punctuation left by prose.
  u = u.replace(/[.,;:!?)]+$/g, "");
  if (!/^https?:\/\//i.test(u)) return null;
  if (u.length > 2048) return null;
  if (/[\u0000-\u001f]/.test(u)) return null;

  // Reject obvious embedded credentials in userinfo.
  try {
    const parsed = new URL(u);
    if (parsed.username || parsed.password) return null;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    // Drop secret query params (never log / open with tokens).
    const keys = [...parsed.searchParams.keys()];
    for (const k of keys) {
      if (SECRET_QUERY_KEYS.has(k.toLowerCase())) {
        parsed.searchParams.delete(k);
      }
    }
    // Drop fragments that look like tokens.
    if (
      parsed.hash &&
      /(access_token|refresh_token|id_token|client_secret)=/i.test(parsed.hash)
    ) {
      parsed.hash = "";
    }
    // Reject path segments that look like raw secrets (very long base64-ish).
    if (/\/(eyJ[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{10,}|xai-[A-Za-z0-9]{10,})/.test(parsed.pathname)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function urlAuthScore(url: string): number {
  const lower = url.toLowerCase();
  let score = 0;
  if (/\/authorize\b|\/oauth\/authorize|response_type=/.test(lower)) score += 100;
  if (/\/login\b|\/signin\b|\/sign-in\b/.test(lower)) score += 80;
  if (/oauth|openid|auth\./.test(lower)) score += 50;
  if (/well-known\/oauth|resource_metadata|protected-resource/.test(lower)) {
    score += 40;
  }
  if (/well-known/.test(lower)) score += 10;
  // Prefer https slightly.
  if (lower.startsWith("https://")) score += 5;
  return score;
}

/**
 * Extract safe auth-related http(s) URLs from doctor / error text.
 * Never returns URLs with access tokens or client secrets in the query.
 */
export function extractMcpAuthUrls(
  text: string | null | undefined,
): string[] {
  if (!text) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(URL_RE.source, URL_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const clean = sanitizeMcpAuthUrl(m[0]);
    if (!clean) continue;
    // Keep only auth-ish or well-known URLs (avoid random MCP tool endpoints).
    const score = urlAuthScore(clean);
    const lower = clean.toLowerCase();
    const keep =
      score >= 10 ||
      /oauth|authorize|login|signin|auth|token|well-known/i.test(lower);
    if (!keep) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    found.push(clean);
  }
  found.sort((a, b) => urlAuthScore(b) - urlAuthScore(a));
  return found.slice(0, 8);
}

function joinSourceTexts(src: McpOauthTextSource): string {
  const parts: string[] = [];
  if (src.title) parts.push(String(src.title));
  if (src.detail) parts.push(String(src.detail));
  if (src.reason) parts.push(String(src.reason));
  for (const i of src.issues ?? []) {
    if (i) parts.push(String(i));
  }
  return parts.join("\n");
}

/**
 * Decide authorize vs retry from tone + free text.
 * Priority: explicit expired → retry; oauth/auth required → authorize;
 * auth_expired tone → retry; auth_required tone → authorize.
 */
export function mcpOauthActionKind(
  text: string,
  tone?: McpStatusTone | null,
): McpOauthActionKind | null {
  const joined = text.trim();
  if (!joined && !tone) return null;

  if (tone === "auth_expired" || EXPIRED_RE.test(joined) || OAUTH_FAILED_RE.test(joined)) {
    // Expired / failed OAuth → retry.
    if (
      isMcpOauthText(joined) ||
      tone === "auth_expired" ||
      detectAuthToneFromText(joined) === "auth_expired" ||
      OAUTH_FAILED_RE.test(joined)
    ) {
      return "retry";
    }
  }

  if (tone === "auth_required" || isMcpOauthText(joined)) {
    if (EXPIRED_RE.test(joined)) return "retry";
    return "authorize";
  }

  const auth = detectAuthToneFromText(joined);
  if (auth === "auth_expired") return "retry";
  if (auth === "auth_required") {
    // Generic 401 without oauth wording still gets authorize (provider flow).
    return "authorize";
  }
  return null;
}

/**
 * Classify a free-form text source into an OAuth action for the GUI.
 * Returns null when the text is not auth-related.
 */
export function classifyMcpOauthSource(
  src: McpOauthTextSource | null | undefined,
): McpOauthAction | null {
  if (!src) return null;
  const joined = joinSourceTexts(src);
  const kind = mcpOauthActionKind(joined, src.tone ?? null);
  if (!kind) return null;

  const authUrls = extractMcpAuthUrls(joined);
  return {
    kind,
    authUrls,
    preferredUrl: authUrls[0] ?? null,
    server: src.server?.trim() || null,
    isRetry: kind === "retry",
  };
}

/** Classify a normalized doctor finding row. */
export function classifyMcpOauthFinding(
  row: McpDoctorFindingRow | null | undefined,
): McpOauthAction | null {
  if (!row) return null;
  // Passed ok findings never need authorize.
  if (row.level === "ok") return null;
  return classifyMcpOauthSource({
    title: row.title,
    detail: row.detail,
    server: row.server,
  });
}

/** Classify from {@link McpServerStatus} (doctor index). */
export function classifyMcpOauthFromStatus(
  status: McpServerStatus | null | undefined,
  extraText?: string | null,
): McpOauthAction | null {
  if (!status) return null;
  if (!status.needsAuthRefresh && !isMcpOauthText(extraText ?? "")) {
    // Still allow when tone is auth_* even if needsAuthRefresh was false (defensive).
    if (status.tone !== "auth_expired" && status.tone !== "auth_required") {
      return null;
    }
  }
  return classifyMcpOauthSource({
    reason: status.reason,
    issues: status.issues,
    server: status.name,
    tone: status.tone,
    detail: extraText,
  });
}

/**
 * Soft-fail plan for “Authorize / Retry OAuth” click.
 * - Prefer opening a doctor-provided URL.
 * - CLI has no dedicated mcp oauth helper (probed) → no CLI spawn.
 * Never includes secrets; URLs are pre-sanitized.
 */
export type McpOauthOpenPlan =
  | { mode: "open_url"; url: string; kind: McpOauthActionKind }
  | { mode: "instructions"; kind: McpOauthActionKind; reason: "no_url" | "no_cli_helper" };

export function planMcpOauthOpen(
  action: McpOauthAction | null | undefined,
  opts?: { preferUrl?: string | null },
): McpOauthOpenPlan | null {
  if (!action) return null;
  const prefer = sanitizeMcpAuthUrl(opts?.preferUrl ?? null);
  const url = prefer ?? action.preferredUrl;
  if (url) {
    return { mode: "open_url", url, kind: action.kind };
  }
  // No browser URL and no CLI helper — fall back to in-app instructions.
  return { mode: "instructions", kind: action.kind, reason: "no_cli_helper" };
}

/** Redact free-form OAuth/doctor text for UI or logs (never store secrets). */
export function redactMcpOauthText(text: string | null | undefined): string {
  return redactMcpText(text);
}

/** i18n key for the primary action button label. */
export function mcpOauthActionLabelKey(
  kind: McpOauthActionKind,
): "mcpModal.oauth.authorize" | "mcpModal.oauth.retry" {
  return kind === "retry" ? "mcpModal.oauth.retry" : "mcpModal.oauth.authorize";
}
