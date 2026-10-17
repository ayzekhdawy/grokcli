/**
 * Allowed built-in tools → CLI `--tools` (comma-separated allowlist).
 *
 * Empty / omitted = CLI default (all tools available). When non-empty, the
 * agent is restricted to the listed tools. Coexists with `disallowedTools` /
 * `disableWebSearch`: allowlist restricts the set; denylist and disable-web
 * still apply when set.
 */

import {
  COMMON_DISALLOWED_TOOLS,
  normalizeToolId,
  type CommonDisallowedTool,
} from "./disallowedTools";

/** Same chip catalog as the denylist UI (common built-in tool ids). */
export const COMMON_ALLOWED_TOOLS: readonly CommonDisallowedTool[] =
  COMMON_DISALLOWED_TOOLS;

/**
 * Normalize a list (or comma-separated string) of tool ids:
 * trim, drop empties, dedupe case-insensitively (first spelling wins).
 */
export function normalizeAllowedTools(raw: unknown): string[] {
  const parts: string[] = [];
  if (raw == null) return parts;
  if (typeof raw === "string") {
    for (const piece of raw.split(",")) {
      const n = normalizeToolId(piece);
      if (n) parts.push(n);
    }
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" && item.includes(",")) {
        for (const piece of item.split(",")) {
          const n = normalizeToolId(piece);
          if (n) parts.push(n);
        }
      } else {
        const n = normalizeToolId(item);
        if (n) parts.push(n);
      }
    }
  } else {
    return parts;
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of parts) {
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

/** Parse a freeform comma-separated input into a normalized list. */
export function parseAllowedToolsInput(raw: string | null | undefined): string[] {
  return normalizeAllowedTools(raw ?? "");
}

/** Comma-separated value for `--tools`, or null when empty (omit flag). */
export function allowedToolsCliValue(tools: unknown): string | null {
  const list = normalizeAllowedTools(tools);
  return list.length ? list.join(",") : null;
}

/** Spawn argv fragments: `["--tools", "a,b"]` or `[]`. */
export function allowedToolsSpawnArgs(tools: unknown): string[] {
  const v = allowedToolsCliValue(tools);
  return v ? ["--tools", v] : [];
}

/** Case-insensitive membership check. */
export function isToolAllowed(tools: unknown, id: string): boolean {
  const needle = normalizeToolId(id);
  if (!needle) return false;
  const key = needle.toLowerCase();
  return normalizeAllowedTools(tools).some((t) => t.toLowerCase() === key);
}

/** Toggle a tool id in/out of the list (normalized result). */
export function toggleAllowedTool(tools: unknown, id: string): string[] {
  const list = normalizeAllowedTools(tools);
  const needle = normalizeToolId(id);
  if (!needle) return list;
  const key = needle.toLowerCase();
  if (list.some((t) => t.toLowerCase() === key)) {
    return list.filter((t) => t.toLowerCase() !== key);
  }
  return [...list, needle];
}

/**
 * Whether two allowlists are equivalent (order-independent, case-insensitive).
 * Used for soft-respawn flip detection on the UI side.
 */
export function allowedToolsEqual(a: unknown, b: unknown): boolean {
  const aa = normalizeAllowedTools(a)
    .map((t) => t.toLowerCase())
    .sort();
  const bb = normalizeAllowedTools(b)
    .map((t) => t.toLowerCase())
    .sort();
  if (aa.length !== bb.length) return false;
  return aa.every((v, i) => v === bb[i]);
}

/**
 * True when both allowlist and denylist are non-empty — UI may warn that
 * allowlist restricts tools and denylist still applies.
 */
export function bothToolListsSet(allowed: unknown, disallowed: unknown): boolean {
  return (
    normalizeAllowedTools(allowed).length > 0 &&
    normalizeAllowedTools(disallowed).length > 0
  );
}
