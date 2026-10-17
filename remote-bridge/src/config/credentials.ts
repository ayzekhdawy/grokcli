/**
 * Credential quality helpers — avoid example placeholders overriding real keys.
 */

/** True when value looks like a docs/example stub (not a real Feishu/Lark secret). */
export function isPlaceholderCredential(value: string | undefined | null): boolean {
  const s = (value ?? "").trim();
  if (!s) return false;
  if (/^x+$/i.test(s)) return true;
  if (s.toLowerCase().includes("xxxxxxxx")) return true;
  if (/_x{4,}$/i.test(s)) return true;
  if (/^cli_[a-z0-9]*x{4,}/i.test(s)) return true;
  if (/(your[_-]|change[_-]?me|placeholder|example|replace[_-]?me|\btodo\b)/i.test(s)) {
    return true;
  }
  return false;
}

/**
 * 0 = missing, 1 = placeholder, 2 = looks real.
 */
export function credentialQuality(appId: string, appSecret: string): 0 | 1 | 2 {
  const id = (appId || "").trim();
  const secret = (appSecret || "").trim();
  if (!id || !secret) return 0;
  if (isPlaceholderCredential(id) || isPlaceholderCredential(secret)) return 1;
  return 2;
}

export function isUsableCredential(appId: string, appSecret: string): boolean {
  return credentialQuality(appId, appSecret) === 2;
}
