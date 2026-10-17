/**
 * Feishu setup mode resolution — mirrors cc-connect's three-mode contract:
 * - auto (setup): no creds → new; with --app → bind
 * - new: force QR registration; rejects credential flags
 * - bind: requires credentials
 */

export const FEISHU_SETUP_MODE_AUTO = "auto" as const;
export const FEISHU_SETUP_MODE_NEW = "new" as const;
export const FEISHU_SETUP_MODE_BIND = "bind" as const;

export type FeishuSetupMode =
  | typeof FEISHU_SETUP_MODE_AUTO
  | typeof FEISHU_SETUP_MODE_NEW
  | typeof FEISHU_SETUP_MODE_BIND;

export interface ResolveFeishuSetupInputsArgs {
  mode: FeishuSetupMode;
  app?: string;
  appId?: string;
  appSecret?: string;
}

export interface ResolveFeishuSetupInputsResult {
  effectiveMode: typeof FEISHU_SETUP_MODE_NEW | typeof FEISHU_SETUP_MODE_BIND;
  appId: string;
  appSecret: string;
}

export function parseAppPair(raw: string): { appId: string; appSecret: string } {
  const idx = raw.indexOf(":");
  if (idx <= 0 || idx >= raw.length - 1) {
    throw new Error("--app format must be app_id:app_secret");
  }
  const appId = raw.slice(0, idx).trim();
  const appSecret = raw.slice(idx + 1).trim();
  if (!appId || !appSecret) {
    throw new Error("--app format must be app_id:app_secret");
  }
  return { appId, appSecret };
}

/**
 * Pure resolver for setup/new/bind CLI inputs.
 * Throws Error with user-facing messages on invalid combinations.
 */
export function resolveFeishuSetupInputs(
  args: ResolveFeishuSetupInputsArgs,
): ResolveFeishuSetupInputsResult {
  let app = (args.app || "").trim();
  let appId = (args.appId || "").trim();
  let appSecret = (args.appSecret || "").trim();
  const mode = args.mode;

  if (app && (appId || appSecret)) {
    throw new Error("use either --app or --app-id/--app-secret, not both");
  }

  if (app) {
    const pair = parseAppPair(app);
    appId = pair.appId;
    appSecret = pair.appSecret;
  }

  if (appId || appSecret) {
    if (!appId || !appSecret) {
      throw new Error("both --app-id and --app-secret are required");
    }
  }

  let effectiveMode: typeof FEISHU_SETUP_MODE_NEW | typeof FEISHU_SETUP_MODE_BIND;
  if (mode === FEISHU_SETUP_MODE_AUTO) {
    effectiveMode =
      appId && appSecret ? FEISHU_SETUP_MODE_BIND : FEISHU_SETUP_MODE_NEW;
  } else if (mode === FEISHU_SETUP_MODE_BIND) {
    if (!appId || !appSecret) {
      throw new Error(
        "bind mode requires credentials: use --app id:secret or --app-id/--app-secret",
      );
    }
    effectiveMode = FEISHU_SETUP_MODE_BIND;
  } else if (mode === FEISHU_SETUP_MODE_NEW) {
    if (appId || appSecret) {
      throw new Error("new mode does not accept credentials; use `agent-connect feishu bind`");
    }
    effectiveMode = FEISHU_SETUP_MODE_NEW;
  } else {
    throw new Error(`unsupported mode ${JSON.stringify(mode)}`);
  }

  return { effectiveMode, appId, appSecret };
}

export function normalizePlatformType(
  raw: string | undefined,
): "feishu" | "lark" | "" {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return "";
  if (s !== "feishu" && s !== "lark") {
    throw new Error(`invalid --platform-type ${JSON.stringify(raw)}, want feishu or lark`);
  }
  return s;
}
