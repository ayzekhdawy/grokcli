/**
 * Pure helpers for the agent config.toml safe viewer.
 *
 * Host already redacts; this is a defensive client-side pass + section index
 * for jump-to-header UX. Never log or copy secret values — only path / redacted text.
 */

import { redact } from "@/lib/redact";

/** One `[table]` / `[[array]]` header with 0-based line index in the text. */
export type TomlSection = {
  /** Raw header including brackets, e.g. `[model.relay]`. */
  name: string;
  /** 0-based line number in the source text. */
  line: number;
};

/** KEY=value / TOML secret-ish assignments. */
const SECRET_ASSIGN_RE =
  /^(\s*(?:[A-Za-z0-9_.-]*?)(?:api[_-]?key|apikey|secret|password|passwd|token|authorization|bearer|private[_-]?key|access[_-]?key|secret[_-]?key|client[_-]?secret|deployment[_-]?key|deploy[_-]?key|xai_api_key|openai_api_key|refresh_token|access_token|auth_token|server[_-]?key|webhook_secret|channel_secret|channel_access_token)\s*[=:]\s*)(.+)$/i;

const TOKEN_PREFIX_RE =
  /\b((?:sk|rk|xai|ghp|gho|ghu|ghs|ghr|xoxb|xoxp)-[A-Za-z0-9._-]{12,}|AKIA[A-Z0-9]{12,}|ASIA[A-Z0-9]{12,}|dep_[A-Za-z0-9._-]{12,})\b/g;

const BEARER_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

/**
 * Defensive redaction for config.toml text shown in the UI.
 * Format-preserving where possible (line structure kept).
 */
export function redactConfigToml(text: string | null | undefined): string {
  if (text == null || text === "") return "";
  const lines = String(text).split("\n");
  const out = lines.map(redactConfigTomlLine);
  let joined = out.join("\n");
  // Preserve trailing newline from original.
  if (String(text).endsWith("\n") && !joined.endsWith("\n")) {
    joined += "\n";
  }
  return joined;
}

function redactConfigTomlLine(line: string): string {
  const m = line.match(SECRET_ASSIGN_RE);
  if (m) {
    return `${m[1]}[REDACTED]`;
  }
  let s = line.replace(BEARER_RE, "Bearer [REDACTED]");
  s = s.replace(TOKEN_PREFIX_RE, (tok) => {
    const dash = tok.indexOf("-");
    const under = tok.indexOf("_");
    let cut = -1;
    if (dash >= 0 && under >= 0) cut = Math.min(dash, under);
    else if (dash >= 0) cut = dash;
    else if (under >= 0) cut = under;
    if (cut >= 0 && cut <= 5) {
      return `${tok.slice(0, cut + 1)}[REDACTED]`;
    }
    return "[REDACTED]";
  });
  s = redact(s);
  return s;
}

/**
 * Extract TOML table headers with line numbers for section jump UI.
 * Ignores comments and blank lines; keeps document order.
 */
export function extractTomlSections(text: string | null | undefined): TomlSection[] {
  if (!text) return [];
  const out: TomlSection[] = [];
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (!t || t.startsWith("#")) continue;
    if (t.startsWith("[") && t.endsWith("]") && t.length >= 3) {
      out.push({ name: t, line: i });
    }
  }
  return out;
}

/**
 * Build a scroll target id for a section chip (stable, DOM-safe).
 */
export function sectionAnchorId(name: string, line: number): string {
  const safe = name.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 64);
  return `cfg-toml-sec-${line}-${safe}`;
}
