/**
 * Pure helpers for Settings → Runtime → Connection → ACP server (API mode).
 *
 * Address form: `host:port` (optional `ws://` / `wss://` / `tcp://` scheme strip).
 * Empty ⇒ local CLI spawn. Invalid non-empty values must not be persisted.
 */

export type AcpServerAddrError =
  | "empty"
  | "empty_host"
  | "missing_port"
  | "invalid_port"
  | "invalid_host"
  | "junk";

export type ParseAcpServerAddrResult =
  | { ok: true; host: string; port: number; normalized: string }
  | { ok: false; error: AcpServerAddrError };

const SCHEME_RE = /^(?:ws|wss|tcp|http|https):\/\//i;

/**
 * Parse a raw ACP server address into host + port.
 *
 * Accepts:
 * - `host:port` / `127.0.0.1:8799` / `localhost:2419`
 * - `[::1]:8799` (bracketed IPv6)
 * - optional leading `ws://` / `wss://` / `tcp://` / `http(s)://` (stripped)
 *
 * Rejects empty host, missing/invalid port, paths, spaces, and other junk.
 * Empty / whitespace-only input → `{ ok: false, error: "empty" }` (callers
 * treat empty as “local CLI mode”, not a probe target).
 */
export function parseAcpServerAddr(
  raw: string | null | undefined,
): ParseAcpServerAddrResult {
  if (raw == null) return { ok: false, error: "empty" };
  let s = String(raw).trim();
  if (!s) return { ok: false, error: "empty" };

  // Strip optional scheme so users can paste a connection URL host:port piece.
  s = s.replace(SCHEME_RE, "");
  // Drop credentials if someone pasted user:pass@host:port
  const at = s.lastIndexOf("@");
  if (at >= 0) {
    s = s.slice(at + 1);
  }
  // Reject path / query / fragment remnants
  if (/[/?#]/.test(s)) {
    return { ok: false, error: "junk" };
  }
  s = s.trim();
  if (!s) return { ok: false, error: "empty" };

  let host: string;
  let portRaw: string;

  if (s.startsWith("[")) {
    // [IPv6]:port
    const close = s.indexOf("]");
    if (close <= 1) return { ok: false, error: "invalid_host" };
    host = s.slice(1, close);
    const rest = s.slice(close + 1);
    if (!rest.startsWith(":")) return { ok: false, error: "missing_port" };
    portRaw = rest.slice(1);
  } else {
    const colon = s.lastIndexOf(":");
    if (colon < 0) return { ok: false, error: "missing_port" };
    // Ambiguous bare IPv6 without brackets (multiple colons, no port separator)
    if (s.indexOf(":") !== colon && !s.includes("].")) {
      // e.g. fe80::1 or a:b:c — require brackets + port
      return { ok: false, error: "junk" };
    }
    host = s.slice(0, colon);
    portRaw = s.slice(colon + 1);
  }

  host = host.trim();
  portRaw = portRaw.trim();

  if (!host) return { ok: false, error: "empty_host" };
  if (!portRaw) return { ok: false, error: "missing_port" };
  if (/\s/.test(host) || /[/?#]/.test(host)) {
    return { ok: false, error: "invalid_host" };
  }
  // Host must look like a hostname / IPv4 / IPv6 (no shell junk)
  if (!/^[A-Za-z0-9._~%-]+$/.test(host) && !/^[0-9a-fA-F:]+$/.test(host)) {
    return { ok: false, error: "invalid_host" };
  }

  if (!/^\d{1,5}$/.test(portRaw)) {
    return { ok: false, error: "invalid_port" };
  }
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "invalid_port" };
  }

  const normalized =
    host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;

  return { ok: true, host, port, normalized };
}

/**
 * Settings blur validation: empty → local CLI (null); non-empty must parse.
 * Returns the value to persist (`null` clears API mode).
 */
export function normalizeAcpServerAddrForSettings(
  raw: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; error: AcpServerAddrError } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: true, value: null };
  const parsed = parseAcpServerAddr(trimmed);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.normalized };
}
