/**
 * Secret redaction for logs and doctor output.
 */

const SECRET_KEYS = new Set([
  "app_secret",
  "appSecret",
  "secret",
  "token",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "authorization",
  "Authorization",
  "password",
  "api_key",
  "apiKey",
]);

const SECRET_PATTERNS: RegExp[] = [
  /app_secret["\s:=]+["']?([^\s"',}]+)/gi,
  /appSecret["\s:=]+["']?([^\s"',}]+)/gi,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /cli_[a-zA-Z0-9]+[:|][a-zA-Z0-9_\-]+/g,
];

export function redactValue(key: string, value: unknown): unknown {
  if (SECRET_KEYS.has(key)) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return redactObject(value as Record<string, unknown>);
  }
  return value;
}

export function redactString(input: string): string {
  let out = input;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match) => {
      if (/Bearer/i.test(match)) return "Bearer [REDACTED]";
      if (match.includes(":") || match.includes("|")) {
        const parts = match.split(/[:|]/);
        return `${parts[0]}:[REDACTED]`;
      }
      return match.replace(/(["\s:=]+)([^\s"',}]+)/, "$1[REDACTED]");
    });
  }
  // Long secret-looking tokens next to secret keywords already handled;
  // also strip common Feishu secret shapes (sec_...)
  out = out.replace(/\bsec_[A-Za-z0-9]+/g, "sec_[REDACTED]");
  return out;
}

export function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.has(k)) {
      out[k] = "[REDACTED]";
      continue;
    }
    if (typeof v === "string") {
      out[k] = redactString(v);
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactObject(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item && typeof item === "object"
          ? redactObject(item as Record<string, unknown>)
          : typeof item === "string"
            ? redactString(item)
            : item,
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Safe basename for attachments (path traversal guard). */
export function safeBasename(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() || "file";
  const cleaned = base.replace(/\0/g, "").replace(/^\.+/, "") || "file";
  // reject empty / parent refs
  if (cleaned === "." || cleaned === "..") return "file";
  return cleaned;
}

/** Stage a path under root using only safe basename. */
export function safeStagePath(stageRoot: string, fileName: string): string {
  const base = safeBasename(fileName);
  // Ensure no path separators remain
  const finalName = base.replace(/[/\\]/g, "_") || "file";
  return `${stageRoot.replace(/[/\\]+$/, "")}/${finalName}`;
}
