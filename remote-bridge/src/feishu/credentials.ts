import { openApiBase, type PlatformBrand } from "../config/types.js";

export interface TenantTokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
}

export interface ValidateCredentialsResult {
  platform: PlatformBrand;
  tenantAccessToken: string;
}

/**
 * Validate app_id/app_secret by requesting a tenant access token.
 * Tries feishu then lark when platform is not forced.
 */
export async function validateAppCredentials(
  appId: string,
  appSecret: string,
  platformType: "" | PlatformBrand = "",
  fetchImpl: typeof fetch = fetch,
): Promise<ValidateCredentialsResult> {
  const candidates: PlatformBrand[] =
    platformType === "feishu" || platformType === "lark"
      ? [platformType]
      : ["feishu", "lark"];

  let lastErr: Error | null = null;
  for (const candidate of candidates) {
    try {
      const token = await requestTenantToken(appId, appSecret, candidate, fetchImpl);
      if (token) {
        return { platform: candidate, tenantAccessToken: token };
      }
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr || new Error("credential validation failed");
}

export async function requestTenantToken(
  appId: string,
  appSecret: string,
  platform: PlatformBrand,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const base = openApiBase(platform);
  const res = await fetchImpl(`${base}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = (await res.json()) as TenantTokenResponse;
  if (data.code === 0 && data.tenant_access_token) {
    return data.tenant_access_token;
  }
  throw new Error(
    data.msg
      ? `code=${data.code} msg=${data.msg}`
      : `remote returned non-zero code=${data.code}`,
  );
}

export async function fetchBotOpenId(
  appId: string,
  appSecret: string,
  platform: PlatformBrand,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const token = await requestTenantToken(appId, appSecret, platform, fetchImpl);
  const base = openApiBase(platform);
  const res = await fetchImpl(`${base}/open-apis/bot/v3/info`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as {
    code: number;
    bot?: { open_id?: string };
  };
  if (data.code === 0 && data.bot?.open_id) return data.bot.open_id;
  return "";
}
