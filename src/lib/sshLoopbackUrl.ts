/**
 * Loopback URL helpers for SSH side-browser.
 * Pure: no DOM / Tauri. Host `ssh_browser_prepare` does the actual -L forward.
 */

export function isLoopbackHttpHost(host: string): boolean {
  const h = host
    .trim()
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "0.0.0.0" ||
    h.endsWith(".localhost")
  );
}

export type LoopbackHttpTarget = {
  scheme: string;
  host: string;
  port: number;
  rest: string;
};

export function parseLoopbackHttpUrl(raw: string): LoopbackHttpTarget | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!isLoopbackHttpHost(host)) return null;
    const port =
      u.port && u.port.trim()
        ? Number(u.port)
        : u.protocol === "https:"
          ? 443
          : 80;
    if (!Number.isFinite(port) || port <= 0) return null;
    return {
      scheme: u.protocol.replace(/:$/, ""),
      host,
      port,
      rest: `${u.pathname}${u.search}${u.hash}`,
    };
  } catch {
    return null;
  }
}

export function isLoopbackHttpUrl(raw: string): boolean {
  return parseLoopbackHttpUrl(raw) != null;
}

export function rewriteLoopbackUrl(
  raw: string,
  localPort: number,
): string | null {
  const t = parseLoopbackHttpUrl(raw);
  if (!t) return null;
  const rest = t.rest || "/";
  return `${t.scheme}://127.0.0.1:${localPort}${rest}`;
}

/**
 * Address-bar commit. Bare `localhost:3000` on an SSH project must be http,
 * not https — Vite / grok preview bind http on the remote loopback.
 */
export function normalizeBrowserUrl(
  raw: string,
  opts?: { preferHttpLoopback?: boolean },
): string {
  const next = raw.trim() || "https://www.google.com";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(next)) return next;
  if (opts?.preferHttpLoopback) {
    const hostport = next.split("/")[0] ?? "";
    let host = hostport;
    if (hostport.startsWith("[")) {
      const end = hostport.indexOf("]");
      host = end >= 0 ? hostport.slice(1, end) : hostport;
    } else {
      host = hostport.split(":")[0] ?? "";
    }
    if (isLoopbackHttpHost(host)) return `http://${next}`;
  }
  return `https://${next}`;
}
