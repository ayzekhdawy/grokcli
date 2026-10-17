/**
 * Disallowed built-in tools → CLI `--disallowed-tools` (comma-separated).
 *
 * Coherent with `settings.disableWebSearch`: when that toggle is on, the
 * effective denylist always includes `web_search` / `web_fetch` (also mirrored
 * by the dedicated `--disable-web-search` spawn flag).
 */

/** Tools blocked by the dedicated disable-web-search setting. */
export const WEB_SEARCH_TOOLS = ["web_search", "web_fetch"] as const;

export type WebSearchToolId = (typeof WEB_SEARCH_TOOLS)[number];

export type CommonDisallowedTool = {
  /** CLI tool id (passed to `--disallowed-tools`). */
  id: string;
  /**
   * When true, UI may show a caution affordance (e.g. shell tools that break
   * most coding workflows when denied).
   */
  caution?: boolean;
};

/**
 * Common built-in tools offered as chips in Settings.
 * `run_terminal_command` is marked caution — denying it is powerful but
 * cripples normal agent work.
 */
export const COMMON_DISALLOWED_TOOLS: readonly CommonDisallowedTool[] = [
  { id: "web_search" },
  { id: "web_fetch" },
  { id: "run_terminal_command", caution: true },
  { id: "search_replace" },
  { id: "write" },
  { id: "Agent" },
  { id: "spawn_subagent" },
] as const;

/** Trim a single tool id. Empty → null. */
export function normalizeToolId(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t ? t : null;
}

/**
 * Normalize a list (or comma-separated string) of tool ids:
 * trim, drop empties, dedupe case-insensitively (first spelling wins).
 */
export function normalizeDisallowedTools(raw: unknown): string[] {
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
export function parseDisallowedToolsInput(raw: string | null | undefined): string[] {
  return normalizeDisallowedTools(raw ?? "");
}

/**
 * Effective denylist for UI / spawn coherence:
 * when `disableWebSearch` is true, ensure web tools are present.
 */
export function effectiveDisallowedTools(
  tools: unknown,
  disableWebSearch?: boolean,
): string[] {
  const base = normalizeDisallowedTools(tools);
  if (!disableWebSearch) return base;
  const seen = new Set(base.map((t) => t.toLowerCase()));
  const out = [...base];
  for (const w of WEB_SEARCH_TOOLS) {
    if (!seen.has(w)) {
      out.push(w);
      seen.add(w);
    }
  }
  return out;
}

/** Comma-separated value for `--disallowed-tools`, or null when empty. */
export function disallowedToolsCliValue(
  tools: unknown,
  disableWebSearch?: boolean,
): string | null {
  const list =
    disableWebSearch === undefined
      ? normalizeDisallowedTools(tools)
      : effectiveDisallowedTools(tools, disableWebSearch);
  return list.length ? list.join(",") : null;
}

/** Spawn argv fragments: `["--disallowed-tools", "a,b"]` or `[]`. */
export function disallowedToolsSpawnArgs(
  tools: unknown,
  disableWebSearch?: boolean,
): string[] {
  const v = disallowedToolsCliValue(tools, disableWebSearch);
  return v ? ["--disallowed-tools", v] : [];
}

/** Case-insensitive membership check. */
export function isToolDisallowed(tools: unknown, id: string): boolean {
  const needle = normalizeToolId(id);
  if (!needle) return false;
  const key = needle.toLowerCase();
  return normalizeDisallowedTools(tools).some((t) => t.toLowerCase() === key);
}

/** Toggle a tool id in/out of the list (normalized result). */
export function toggleDisallowedTool(tools: unknown, id: string): string[] {
  const list = normalizeDisallowedTools(tools);
  const needle = normalizeToolId(id);
  if (!needle) return list;
  const key = needle.toLowerCase();
  if (list.some((t) => t.toLowerCase() === key)) {
    return list.filter((t) => t.toLowerCase() !== key);
  }
  return [...list, needle];
}

/**
 * Whether two denylists are equivalent (order-independent, case-insensitive).
 * Used for soft-respawn flip detection on the UI side.
 */
export function disallowedToolsEqual(a: unknown, b: unknown): boolean {
  const aa = normalizeDisallowedTools(a)
    .map((t) => t.toLowerCase())
    .sort();
  const bb = normalizeDisallowedTools(b)
    .map((t) => t.toLowerCase())
    .sort();
  if (aa.length !== bb.length) return false;
  return aa.every((v, i) => v === bb[i]);
}

/** True when `id` is one of the web tools blocked by disableWebSearch. */
export function isWebSearchTool(id: string): boolean {
  const n = normalizeToolId(id);
  if (!n) return false;
  const key = n.toLowerCase();
  return (WEB_SEARCH_TOOLS as readonly string[]).some((w) => w === key);
}
