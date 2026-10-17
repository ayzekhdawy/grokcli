/**
 * Feishu/Lark PersonalAgent device registration (QR onboarding).
 * Protocol mirrored from cc-connect:
 *   POST {accounts}/oauth/v1/app/registration  action=init|begin|poll
 */

import { accountsBase, type PlatformBrand } from "../config/types.js";

export interface RegistrationBeginResult {
  deviceCode: string;
  verificationUriComplete: string;
  interval: number;
  expireIn: number;
}

export interface RegistrationPollResult {
  status: "pending" | "completed" | "denied" | "expired" | "error";
  appId?: string;
  appSecret?: string;
  ownerOpenId?: string;
  platform?: PlatformBrand;
  error?: string;
  slowDown?: boolean;
  baseUrl?: string;
}

export interface RegistrationFlowResult {
  appId: string;
  appSecret: string;
  ownerOpenId: string;
  platform: PlatformBrand;
}

export type RegistrationHttp = (
  url: string,
  init: RequestInit,
) => Promise<{ status: number; text: () => Promise<string> }>;

async function registrationCall(
  baseUrl: string,
  action: string,
  params: Record<string, string> | null,
  http: RegistrationHttp,
  debug = false,
): Promise<Record<string, unknown>> {
  const form = new URLSearchParams();
  form.set("action", action);
  if (params) {
    for (const [k, v] of Object.entries(params)) form.set(k, v);
  }
  const res = await http(`${baseUrl}/oauth/v1/app/registration`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const body = await res.text();
  if (debug) {
    console.error(`[debug] registration action=${action} status=${res.status} body=${body.trim()}`);
  }
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error(`decode response: ${body.slice(0, 200)}`);
  }
}

export async function registrationInit(
  baseUrl = accountsBase("feishu"),
  http: RegistrationHttp = defaultHttp,
  debug = false,
): Promise<void> {
  const data = await registrationCall(baseUrl, "init", null, http, debug);
  if (data.error) {
    throw new Error(`${data.error}: ${data.error_description || ""}`);
  }
  const methods = data.supported_auth_methods as string[] | undefined;
  if (methods?.length && !methods.some((m) => m.toLowerCase() === "client_secret")) {
    throw new Error("current environment does not support client_secret auth");
  }
}

export async function registrationBegin(
  baseUrl = accountsBase("feishu"),
  http: RegistrationHttp = defaultHttp,
  debug = false,
): Promise<RegistrationBeginResult> {
  const data = await registrationCall(
    baseUrl,
    "begin",
    {
      archetype: "PersonalAgent",
      auth_method: "client_secret",
      request_user_info: "open_id",
    },
    http,
    debug,
  );
  if (data.error) {
    throw new Error(`${data.error}: ${data.error_description || ""}`);
  }
  const deviceCode = String(data.device_code || "");
  const uri = String(data.verification_uri_complete || "");
  if (!deviceCode || !uri) {
    throw new Error("incomplete onboarding response");
  }
  return {
    deviceCode,
    verificationUriComplete: uri,
    interval: Number(data.interval) || 5,
    expireIn: Number(data.expire_in) || 600,
  };
}

/** One poll step — pure enough for unit tests with a mock http. */
export async function registrationPollOnce(
  deviceCode: string,
  baseUrl = accountsBase("feishu"),
  http: RegistrationHttp = defaultHttp,
  debug = false,
): Promise<RegistrationPollResult> {
  let url = baseUrl;
  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await registrationCall(
      url,
      "poll",
      { device_code: deviceCode },
      http,
      debug,
    );
    const userInfo = (data.user_info || {}) as Record<string, unknown>;
    const brand = String(userInfo.tenant_brand || "").toLowerCase();
    if (brand === "lark" && url !== accountsBase("lark")) {
      url = accountsBase("lark");
      continue;
    }

    const clientId = String(data.client_id || "");
    const clientSecret = String(data.client_secret || "");
    if (clientId && clientSecret) {
      return {
        status: "completed",
        appId: clientId,
        appSecret: clientSecret,
        ownerOpenId: String(userInfo.open_id || ""),
        platform: brand === "lark" ? "lark" : "feishu",
        baseUrl: url,
      };
    }

    const errCode = String(data.error || "");
    if (errCode === "authorization_pending" || errCode === "") {
      return { status: "pending", baseUrl: url };
    }
    if (errCode === "slow_down") {
      return { status: "pending", slowDown: true, baseUrl: url };
    }
    if (errCode === "access_denied") {
      return { status: "denied", baseUrl: url };
    }
    if (errCode === "expired_token") {
      return { status: "expired", baseUrl: url };
    }
    return {
      status: "error",
      error: `${errCode}: ${data.error_description || ""}`,
      baseUrl: url,
    };
  }
  return { status: "pending", baseUrl: url };
}

export interface RunRegistrationFlowOptions {
  timeoutSeconds?: number;
  debug?: boolean;
  http?: RegistrationHttp;
  sleep?: (ms: number) => Promise<void>;
  onQr?: (uri: string) => void | Promise<void>;
  now?: () => number;
}

/**
 * Full QR registration loop. Interactive by default; injectable for tests.
 */
export async function runRegistrationFlow(
  opts: RunRegistrationFlowOptions = {},
): Promise<RegistrationFlowResult> {
  const http = opts.http || defaultHttp;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now || (() => Date.now());
  const timeoutSeconds = opts.timeoutSeconds && opts.timeoutSeconds > 0 ? opts.timeoutSeconds : 600;

  let baseUrl = accountsBase("feishu");
  await registrationInit(baseUrl, http, opts.debug);
  const begin = await registrationBegin(baseUrl, http, opts.debug);

  if (opts.onQr) await opts.onQr(begin.verificationUriComplete);

  let interval = begin.interval > 0 ? begin.interval : 5;
  const expireIn = begin.expireIn > 0 ? begin.expireIn : timeoutSeconds;
  let timeoutAt = now() + expireIn * 1000;
  const flagLimit = now() + timeoutSeconds * 1000;
  if (flagLimit < timeoutAt) timeoutAt = flagLimit;

  while (now() < timeoutAt) {
    const poll = await registrationPollOnce(begin.deviceCode, baseUrl, http, opts.debug);
    if (poll.baseUrl) baseUrl = poll.baseUrl;

    if (poll.status === "completed" && poll.appId && poll.appSecret) {
      return {
        appId: poll.appId,
        appSecret: poll.appSecret,
        ownerOpenId: poll.ownerOpenId || "",
        platform: poll.platform || "feishu",
      };
    }
    if (poll.status === "denied") throw new Error("authorization denied by user");
    if (poll.status === "expired") throw new Error("onboarding session expired");
    if (poll.status === "error") throw new Error(poll.error || "onboarding error");
    if (poll.slowDown) interval += 5;
    await sleep(interval * 1000);
  }
  throw new Error("timed out waiting for QR onboarding result");
}

async function defaultHttp(
  url: string,
  init: RequestInit,
): Promise<{ status: number; text: () => Promise<string> }> {
  const res = await fetch(url, init);
  return {
    status: res.status,
    text: () => res.text(),
  };
}
