/**
 * Ship → PR hub deep-link helpers.
 *
 * Hash shape: `#/settings/runtime/tools` or `#/settings/runtime/tools?pr=42`
 * Pure only — no DOM / navigation side effects.
 */

export const PR_HUB_SECTION = "runtime" as const;
export const PR_HUB_TAB = "tools" as const;
export const PR_HUB_ANCHOR_ID = "settings-anchor-prHub";

export type PrHubDeepLink = {
  section: typeof PR_HUB_SECTION;
  tab: typeof PR_HUB_TAB;
  anchorId: typeof PR_HUB_ANCHOR_ID;
  /** Highlight target when known; null when link has no ?pr=. */
  prNumber: number | null;
};

/** Max accepted GitHub PR number (sanity clamp). */
const PR_NUMBER_MAX = 50_000_000;

/**
 * Path portion of a location hash without leading `#` / `#/` and without query.
 * `"#/settings/runtime/tools?pr=1"` → `"settings/runtime/tools"`.
 */
export function hashPathOnly(raw: string | null | undefined): string {
  let s = (raw ?? "").trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (s.startsWith("/")) s = s.slice(1);
  const qi = s.indexOf("?");
  if (qi >= 0) s = s.slice(0, qi);
  // Drop trailing slash segments for stable compares.
  return s.replace(/\/+$/, "");
}

/**
 * Parse `?a=1&b=2` from a hash or path. Values are decodeURIComponent'd.
 * Malformed pairs are skipped (never throws).
 */
export function parseHashQuery(
  raw: string | null | undefined,
): Record<string, string> {
  const s = (raw ?? "").replace(/^#/, "");
  const qi = s.indexOf("?");
  if (qi < 0) return {};
  let query = s.slice(qi + 1);
  // Rare: secondary `#fragment` after query.
  const hashFrag = query.indexOf("#");
  if (hashFrag >= 0) query = query.slice(0, hashFrag);
  const out: Record<string, string> = {};
  if (!query) return out;
  for (const part of query.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    let k = eq >= 0 ? part.slice(0, eq) : part;
    let v = eq >= 0 ? part.slice(eq + 1) : "";
    try {
      k = decodeURIComponent(k.replace(/\+/g, " ")).trim();
      v = decodeURIComponent(v.replace(/\+/g, " ")).trim();
    } catch {
      continue;
    }
    if (k) out[k] = v;
  }
  return out;
}

/** Coerce raw input to a positive integer PR number, or null. */
export function sanitizePrNumber(
  raw: string | number | null | undefined,
): number | null {
  if (raw == null || raw === "") return null;
  const n =
    typeof raw === "number"
      ? raw
      : Number(String(raw).trim().replace(/^#/, ""));
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n <= 0 || n > PR_NUMBER_MAX) return null;
  return n;
}

/**
 * Extract PR number from a GitHub pull request URL (or similar path tail).
 * `https://github.com/o/r/pull/42` → `42`. Non-GitHub paths with `/pull/N` also match.
 */
export function parseGithubPrNumber(
  url: string | null | undefined,
): number | null {
  const text = (url ?? "").trim();
  if (!text) return null;
  const m = text.match(/\/pull\/(\d+)\b/i);
  if (!m) return null;
  return sanitizePrNumber(m[1]);
}

/**
 * Build a settings deep link that opens Runtime → Tools (PR hub card).
 * Optional `prNumber` is appended as `?pr=N` for row highlight.
 */
export function buildPrHubDeepLink(opts?: {
  prNumber?: number | null;
}): string {
  const base = `#/settings/${PR_HUB_SECTION}/${PR_HUB_TAB}`;
  const n = sanitizePrNumber(opts?.prNumber ?? null);
  return n != null ? `${base}?pr=${n}` : base;
}

/**
 * Parse a hash as a PR hub deep link.
 * Accepts `#/settings/runtime/tools` and `#/settings/runtime/tools?pr=42`.
 * Returns null when the path is not Runtime → Tools.
 */
export function parsePrHubDeepLink(
  raw: string | null | undefined,
): PrHubDeepLink | null {
  const path = hashPathOnly(raw);
  if (!path.startsWith("settings")) return null;
  const parts = path.split("/").filter(Boolean);
  // parts[0] === "settings"
  if (parts[1] !== PR_HUB_SECTION) return null;
  // Require explicit tools tab (do not treat bare runtime as PR hub).
  if (parts[2] !== PR_HUB_TAB) return null;
  // Reject unknown extra path segments after tools.
  if (parts.length > 3) return null;
  const q = parseHashQuery(raw);
  const prNumber = sanitizePrNumber(q.pr ?? q.prNumber ?? null);
  return {
    section: PR_HUB_SECTION,
    tab: PR_HUB_TAB,
    anchorId: PR_HUB_ANCHOR_ID,
    prNumber,
  };
}

/** True when `entryNumber` matches a requested highlight PR. */
export function isHighlightedPr(
  entryNumber: number,
  highlight: string | number | null | undefined,
): boolean {
  const n = sanitizePrNumber(highlight);
  return n != null && entryNumber === n;
}
