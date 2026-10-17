/**
 * Pure helpers for `grok sessions search` output and CLI session search UI.
 *
 * CLI text shape (current grok sessions search):
 *   <uuid> (local|remote)  <date>
 *     <summary / title>
 *     <first prompt…>
 *   …
 *   Total: N
 *
 * JSON (when CLI adds --json later) is also accepted.
 */

/** One hit from CLI search or local first-prompt fallback. */
export type CliSessionSearchHit = {
  agentSessionId: string;
  /** Session summary / generated title. */
  title: string;
  /** First user prompt snippet when known. */
  firstPrompt?: string | null;
  /** CLI status token: local | remote | … */
  status?: string | null;
  /** Raw date / time label from CLI text, if present. */
  updatedLabel?: string | null;
};

const SESSION_ID_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;

/**
 * Parse human-readable `grok sessions search` stdout into hits.
 * Tolerant of warnings / blank lines / missing body lines.
 */
export function parseCliSessionsSearchText(raw: string): CliSessionSearchHit[] {
  const text = (raw ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) return [];

  const hits: CliSessionSearchHit[] = [];
  let current: {
    agentSessionId: string;
    status: string | null;
    updatedLabel: string | null;
    body: string[];
  } | null = null;

  const flush = () => {
    if (!current) return;
    const body = current.body.map((l) => l.trim()).filter(Boolean);
    const title = body[0] || `CLI ${current.agentSessionId.slice(0, 8)}`;
    const firstPrompt = body.length > 1 ? body.slice(1).join("\n") : null;
    hits.push({
      agentSessionId: current.agentSessionId,
      title,
      firstPrompt,
      status: current.status,
      updatedLabel: current.updatedLabel,
    });
    current = null;
  };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Footer
    if (/^total:\s*\d+/i.test(trimmed)) {
      flush();
      break;
    }
    // Skip common warning banners that appear on stdout/stderr mixed.
    if (/^warning:/i.test(trimmed) || /^error:/i.test(trimmed)) {
      continue;
    }

    const idMatch = SESSION_ID_RE.exec(trimmed);
    // Header lines start at column 0 (no indent). Indented lines are body.
    const isIndented = /^\s{2,}/.test(line);
    if (idMatch && !isIndented) {
      flush();
      const id = idMatch[1];
      const rest = trimmed.slice(idMatch[0].length).trim();
      let status: string | null = null;
      let updatedLabel: string | null = null;
      const statusMatch = /^\(([^)]+)\)\s*(.*)$/.exec(rest);
      if (statusMatch) {
        status = statusMatch[1].trim() || null;
        updatedLabel = statusMatch[2].trim() || null;
      } else if (rest) {
        updatedLabel = rest;
      }
      current = {
        agentSessionId: id,
        status,
        updatedLabel,
        body: [],
      };
      continue;
    }

    if (current && isIndented) {
      // Strip leading indent only.
      current.body.push(line.replace(/^\s{2,}/, ""));
      continue;
    }

    // Continuation of first prompt without indent (rare wrap) — attach when we
    // already have a title line so we do not swallow the next header.
    if (current && current.body.length >= 1 && !SESSION_ID_RE.test(trimmed)) {
      current.body.push(trimmed);
    }
  }
  flush();
  return hits;
}

/**
 * Parse JSON `grok sessions search --json` when available.
 * Accepts an array, `{ sessions|results|items: [...] }`, or a single object.
 * Returns null when the blob is not JSON session-search data.
 */
export function parseCliSessionsSearchJson(
  raw: string,
): CliSessionSearchHit[] | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const rows = normalizeJsonRows(data);
  if (rows === null) return null;

  const out: CliSessionSearchHit[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = pickString(o, [
      "agentSessionId",
      "agent_session_id",
      "sessionId",
      "session_id",
      "id",
    ]);
    if (!id) continue;
    const title =
      pickString(o, [
        "title",
        "summary",
        "generatedTitle",
        "generated_title",
        "sessionSummary",
        "session_summary",
      ]) || `CLI ${id.slice(0, 8)}`;
    const firstPrompt = pickString(o, [
      "firstPrompt",
      "first_prompt",
      "prompt",
      "firstUserPrompt",
      "first_user_prompt",
    ]);
    const status = pickString(o, ["status", "location", "source"]);
    const updatedLabel = pickString(o, [
      "updatedLabel",
      "updatedAt",
      "updated_at",
      "updated",
      "lastActiveAt",
      "last_active_at",
    ]);
    out.push({
      agentSessionId: id,
      title,
      firstPrompt,
      status,
      updatedLabel,
    });
  }
  return out;
}

function normalizeJsonRows(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  for (const key of ["sessions", "results", "items", "data", "hits"]) {
    if (Array.isArray(o[key])) return o[key] as unknown[];
  }
  // Single session object
  if (
    pickString(o, [
      "agentSessionId",
      "agent_session_id",
      "sessionId",
      "session_id",
      "id",
    ])
  ) {
    return [o];
  }
  return null;
}

function pickString(
  o: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Prefer JSON when stdout looks like JSON; otherwise parse text.
 */
export function parseCliSessionsSearchOutput(raw: string): CliSessionSearchHit[] {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const json = parseCliSessionsSearchJson(trimmed);
    if (json) return json;
  }
  return parseCliSessionsSearchText(trimmed);
}

/**
 * Detect CLI clap errors that mean `--json` (or the whole search subcommand)
 * is not supported — so the host can retry without the flag or fall back.
 */
export function looksLikeCliSearchUnsupported(stderr: string): boolean {
  const s = (stderr ?? "").toLowerCase();
  return (
    s.includes("unexpected argument") ||
    s.includes("unrecognized option") ||
    s.includes("unknown flag") ||
    s.includes("unknown option") ||
    s.includes("invalid option") ||
    s.includes("unrecognized subcommand") ||
    s.includes("unexpected subcommand")
  );
}

/**
 * Clamp search limit for host / UI (1–100, default 40).
 */
export function clampCliSessionsSearchLimit(
  limit: number | null | undefined,
  fallback = 40,
): number {
  const n = typeof limit === "number" && Number.isFinite(limit) ? limit : fallback;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

/**
 * Merge CLI search hits with local list rows so import/delete still have `dir`.
 * Preserves CLI hit order. Local-only fields fill gaps.
 */
export function mergeCliSearchHitsWithLocal<
  T extends {
    agentSessionId: string;
    title: string;
    cwd?: string | null;
    dir?: string;
    numMessages?: number;
    alreadyLinked?: boolean;
    appSessionId?: string | null;
    sourceHome?: string;
    updatedAt?: string;
  },
>(
  hits: CliSessionSearchHit[],
  local: T[],
): Array<
  T & {
    title: string;
    firstPrompt?: string | null;
    status?: string | null;
    fromCliSearch: true;
  }
> {
  const byId = new Map(local.map((r) => [r.agentSessionId, r]));
  return hits.map((h) => {
    const loc = byId.get(h.agentSessionId);
    if (loc) {
      return {
        ...loc,
        title: h.title || loc.title,
        firstPrompt: h.firstPrompt ?? null,
        status: h.status ?? null,
        fromCliSearch: true as const,
      };
    }
    // Synthetic row for remote-only / not-yet-listed hits.
    const synthetic = {
      agentSessionId: h.agentSessionId,
      title: h.title,
      cwd: null,
      dir: "",
      numMessages: 0,
      alreadyLinked: false,
      appSessionId: null,
      sourceHome: "",
      updatedAt: h.updatedLabel ?? "",
      firstPrompt: h.firstPrompt ?? null,
      status: h.status ?? null,
      fromCliSearch: true as const,
    } as unknown as T & {
      title: string;
      firstPrompt?: string | null;
      status?: string | null;
      fromCliSearch: true;
    };
    return synthetic;
  });
}
