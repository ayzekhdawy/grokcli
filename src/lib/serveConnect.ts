/**
 * Pure helpers for Settings → Runtime → SDK Connect wizard
 * (local agent serve + external client examples + remote URL probe).
 *
 * Secrets: never include full tokens in display/probe fields; mask for UI;
 * full secret only lives in ephemeral client memory after serve_start.
 */

export const DEFAULT_SERVE_BIND = "127.0.0.1:2419";
export const DEFAULT_SERVE_PATH = "/ws";

export type ServeConnectParseError =
  | "empty"
  | "empty_host"
  | "missing_port"
  | "invalid_port"
  | "invalid_host"
  | "junk";

export type ParseServeConnectUrlResult =
  | {
      ok: true;
      host: string;
      port: number;
      /** host:port for TCP probe (no path, no secret). */
      bind: string;
      scheme: "ws" | "wss" | null;
      path: string;
      hasSecret: boolean;
      /** Connection URL with server-key masked — safe for UI. */
      displayUrl: string;
    }
  | { ok: false; error: ServeConnectParseError };

export type ServeClientExamples = {
  /** Full ws URL when secret known; otherwise placeholder server-key. */
  wsUrl: string;
  /** Always masked — safe for logs / always-on UI. */
  wsUrlMasked: string;
  /** HTTP upgrade probe-style curl (secret only when known). */
  curl: string;
  /** websocat one-liner. */
  websocat: string;
  /** grok CLI remote client. */
  grokRemote: string;
};

/** Mask a serve secret for UI / logs (bullets + last 4 when long enough). */
export function maskServeSecret(value: string | null | undefined): string {
  const t = (value ?? "").trim();
  if (!t) return "";
  if (t.length <= 4) return "••••";
  return `••••${t.slice(-4)}`;
}

/**
 * Replace `server-key` / `secret` query values with a masked form.
 * Leaves other query params intact. Safe if no secret present.
 */
export function maskServerKeyInUrl(url: string): string {
  const raw = String(url ?? "");
  if (!raw) return "";
  return raw.replace(
    /([?&](?:server-key|secret)=)([^&#]*)/gi,
    (_m, prefix: string, val: string) => `${prefix}${maskServeSecret(val) || "••••"}`,
  );
}

/** Build the WebSocket connection URL clients use. */
export function buildServeConnectionUrl(bind: string, secret: string): string {
  const b = (bind || DEFAULT_SERVE_BIND).trim();
  const s = (secret || "").trim();
  return `ws://${b}${DEFAULT_SERVE_PATH}?server-key=${s}`;
}

/** Log-safe connection URL (masked server-key). */
export function buildServeConnectionUrlMasked(
  bind: string,
  secret: string | null | undefined,
): string {
  const b = (bind || DEFAULT_SERVE_BIND).trim();
  const masked = maskServeSecret(secret) || "••••";
  return `ws://${b}${DEFAULT_SERVE_PATH}?server-key=${masked}`;
}

/**
 * Parse a serve connection target for display + TCP probe.
 *
 * Accepts:
 * - `host:port`
 * - `ws://host:port/ws?server-key=…` / `wss://…`
 * - optional path / query (secret is never returned in full)
 *
 * The probe target is always bare `host:port` — secrets are stripped.
 */
export function parseServeConnectUrl(
  raw: string | null | undefined,
): ParseServeConnectUrlResult {
  if (raw == null) return { ok: false, error: "empty" };
  let s = String(raw).trim();
  if (!s) return { ok: false, error: "empty" };

  let scheme: "ws" | "wss" | null = null;
  const schemeMatch = s.match(/^(ws|wss|tcp|http|https):\/\//i);
  if (schemeMatch) {
    const sch = schemeMatch[1]!.toLowerCase();
    if (sch === "ws" || sch === "wss") scheme = sch;
    s = s.slice(schemeMatch[0].length);
  }

  // Drop credentials user:pass@
  const at = s.lastIndexOf("@");
  if (at >= 0) {
    s = s.slice(at + 1);
  }

  // Split path / query / fragment before host:port parse
  let pathAndQuery = "";
  const pathIdx = s.search(/[/?#]/);
  if (pathIdx >= 0) {
    pathAndQuery = s.slice(pathIdx);
    s = s.slice(0, pathIdx);
  }
  s = s.trim();
  if (!s) return { ok: false, error: "empty_host" };

  let host: string;
  let portRaw: string;

  if (s.startsWith("[")) {
    const close = s.indexOf("]");
    if (close <= 1) return { ok: false, error: "invalid_host" };
    host = s.slice(1, close);
    const rest = s.slice(close + 1);
    if (!rest.startsWith(":")) return { ok: false, error: "missing_port" };
    portRaw = rest.slice(1);
  } else {
    const colon = s.lastIndexOf(":");
    if (colon < 0) return { ok: false, error: "missing_port" };
    if (s.indexOf(":") !== colon) {
      // bare IPv6 without brackets
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

  const bind = host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;

  // Path (default /ws) — ignore query for path field
  let path = DEFAULT_SERVE_PATH;
  if (pathAndQuery.startsWith("/")) {
    const q = pathAndQuery.indexOf("?");
    const h = pathAndQuery.indexOf("#");
    let end = pathAndQuery.length;
    if (q >= 0) end = Math.min(end, q);
    if (h >= 0) end = Math.min(end, h);
    const p = pathAndQuery.slice(0, end);
    if (p) path = p;
  }

  const query = pathAndQuery.includes("?")
    ? pathAndQuery.slice(pathAndQuery.indexOf("?") + 1).split("#")[0] ?? ""
    : "";
  const hasSecret = /(?:^|[&])(?:server-key|secret)=([^&\s#]+)/i.test(query);

  // Build display URL without ever embedding a full secret we might have seen.
  let displayUrl: string;
  if (scheme || pathAndQuery) {
    const sch = scheme ?? "ws";
    const maskedQuery = query
      ? `?${maskServerKeyInUrl(`x?${query}`).replace(/^x\?/, "")}`
      : "";
    displayUrl = `${sch}://${bind}${path}${maskedQuery}`;
  } else {
    displayUrl = buildServeConnectionUrlMasked(bind, null);
  }

  return {
    ok: true,
    host,
    port,
    bind,
    scheme,
    path,
    hasSecret,
    displayUrl,
  };
}

/**
 * Resolve a TCP probe target from free-form paste (host:port or full ws URL).
 * Never returns secrets — only `host:port`.
 */
export function resolveServeProbeTarget(
  raw: string | null | undefined,
): { ok: true; bind: string } | { ok: false; error: ServeConnectParseError } {
  const parsed = parseServeConnectUrl(raw);
  if (!parsed.ok) return parsed;
  return { ok: true, bind: parsed.bind };
}

/** Pull server-key from a connection URL (internal; do not log result). */
export function extractSecretFromConnectionUrl(
  url: string | null | undefined,
): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/[?&](?:server-key|secret)=([^&#]*)/i);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * Build copy-ready client snippets for an external consumer of agent serve.
 * When `secret` / full `connectionUrl` is unknown, uses `<server-key>` placeholder.
 */
export function buildServeClientExamples(opts: {
  bind?: string | null;
  secret?: string | null;
  connectionUrl?: string | null;
}): ServeClientExamples {
  const bind = (opts.bind || DEFAULT_SERVE_BIND).trim() || DEFAULT_SERVE_BIND;
  const fromUrl = extractSecretFromConnectionUrl(opts.connectionUrl);
  const secret = (opts.secret ?? "").trim() || fromUrl || "";
  const fullFromStart = (opts.connectionUrl ?? "").trim();

  let wsUrl: string;
  if (fullFromStart) {
    wsUrl = fullFromStart;
  } else if (secret) {
    wsUrl = buildServeConnectionUrl(bind, secret);
  } else {
    wsUrl = `ws://${bind}${DEFAULT_SERVE_PATH}?server-key=<server-key>`;
  }

  const wsUrlMasked = maskServerKeyInUrl(wsUrl);
  // Prefer explicit secret for CLI flags; else placeholder.
  const secretForCli = secret || "<server-key>";
  const httpUrl = wsUrl
    .replace(/^ws:/i, "http:")
    .replace(/^wss:/i, "https:");

  const curl = [
    `curl -i -N \\`,
    `  -H "Connection: Upgrade" \\`,
    `  -H "Upgrade: websocket" \\`,
    `  -H "Sec-WebSocket-Version: 13" \\`,
    `  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \\`,
    `  "${httpUrl}"`,
  ].join("\n");

  const websocat = `websocat "${wsUrl}"`;
  const grokRemote = `grok --remote "ws://${bind}${DEFAULT_SERVE_PATH}" --secret "${secretForCli}"`;

  return { wsUrl, wsUrlMasked, curl, websocat, grokRemote };
}

/** Mask secrets inside multi-line client example text for safe on-screen display. */
export function maskServeExampleText(text: string): string {
  let out = maskServerKeyInUrl(text);
  // grok --secret "…" / --secret '…' / --secret bare
  out = out.replace(
    /(--secret\s+)(["']?)([^"'\s]+)\2/gi,
    (_m, flag: string, _q: string, val: string) => {
      if (val === "<server-key>" || val.startsWith("••••")) return `${flag}"${val}"`;
      return `${flag}"${maskServeSecret(val) || "••••"}"`;
    },
  );
  return out;
}

/** True when a string looks like it may contain a full serve secret (for log guards). */
export function looksLikeServeSecretLeak(text: string): boolean {
  // Long server-key values are URL-safe base64 (~43 chars for 32 bytes).
  return /[?&](?:server-key|secret)=[A-Za-z0-9_-]{16,}/i.test(text);
}
