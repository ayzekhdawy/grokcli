/**
 * Optional project sidebar accent color.
 *
 * Stored as a named token or `#rgb` / `#rrggbb` hex on `Project.color`.
 * Missing / empty → no accent (default).
 */

export const PROJECT_COLOR_TOKENS = [
  "blue",
  "green",
  "orange",
  "purple",
  "pink",
  "gray",
] as const;

export type ProjectColorToken = (typeof PROJECT_COLOR_TOKENS)[number];

/** Resolved CSS color values for named tokens (readable on dark + light rails). */
export const PROJECT_COLOR_TOKEN_CSS: Record<ProjectColorToken, string> = {
  blue: "#5b8def",
  green: "#3dbf7a",
  orange: "#f0a030",
  purple: "#a78bfa",
  pink: "#f472b6",
  gray: "#9ca3af",
};

const TOKEN_SET = new Set<string>(PROJECT_COLOR_TOKENS);

/** Values that clear the accent (inherit / none). */
const CLEAR_TOKENS = new Set([
  "",
  "none",
  "inherit",
  "default",
  "clear",
  "null",
  "undefined",
]);

/**
 * Normalize a raw project color to a canonical stored value.
 * - tokens → lowercase token
 * - hex `#rgb` / `#rrggbb` → lowercase hex
 * - empty / clear tokens / invalid → `null`
 */
export function normalizeProjectColor(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (CLEAR_TOKENS.has(lower)) return null;
  if (TOKEN_SET.has(lower)) return lower;
  const hex = normalizeHexColor(lower);
  if (hex) return hex;
  return null;
}

/** Validate and canonicalize `#rgb` / `#rrggbb`. */
export function normalizeHexColor(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s.startsWith("#")) return null;
  const body = s.slice(1);
  if (body.length !== 3 && body.length !== 6) return null;
  if (!/^[0-9a-f]+$/.test(body)) return null;
  return `#${body}`;
}

/** True when `raw` is a known named token (after normalize). */
export function isProjectColorToken(
  raw: unknown,
): raw is ProjectColorToken {
  const n = normalizeProjectColor(raw);
  return n != null && TOKEN_SET.has(n);
}

/**
 * Resolve a stored color to a CSS color string for painting the sidebar dot.
 * Returns `null` when there is no accent.
 */
export function resolveProjectColorCss(raw: unknown): string | null {
  const n = normalizeProjectColor(raw);
  if (!n) return null;
  if (TOKEN_SET.has(n)) {
    return PROJECT_COLOR_TOKEN_CSS[n as ProjectColorToken];
  }
  return n; // hex
}
