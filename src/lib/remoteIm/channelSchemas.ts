/**
 * Schema-driven Remote IM channel catalog helpers.
 * Field lists and CHANNEL_SCHEMAS live in channelSchemaCatalog.ts.
 */

import type { ChannelSchema, RemoteChannelId } from "./types";
import { CHANNEL_SCHEMAS, RETIRED_CHANNEL_IDS } from "./channelSchemaCatalog";
export { CHANNEL_SCHEMAS, RETIRED_CHANNEL_IDS };

/**
 * Required channel ids for default sidebar completeness checks.
 * Soft-retired WPS channels are intentionally excluded.
 */
export const REQUIRED_CHANNEL_IDS: RemoteChannelId[] = [
  "feishu",
  "lark",
  "dingtalk",
  "wecom",
  "weixin",
  "weibo",
  "qq",
  "qqbot",
  "telegram",
  "slack",
  "discord",
  "matrix",
  "line",
  "imessage",
];

export function getChannelSchema(
  id: RemoteChannelId | string,
): ChannelSchema | undefined {
  return CHANNEL_SCHEMAS.find((c) => c.id === id);
}

/**
 * Whether a channel is soft-retired / unsupported (hidden from default picker).
 * Accepts id string or schema object.
 */
export function isRetiredChannel(
  channel: RemoteChannelId | string | ChannelSchema | null | undefined,
): boolean {
  if (channel == null) return false;
  if (typeof channel === "object") {
    return !!(channel.retired || channel.unsupported);
  }
  if ((RETIRED_CHANNEL_IDS as readonly string[]).includes(channel)) {
    return true;
  }
  const schema = getChannelSchema(channel);
  return !!(schema?.retired || schema?.unsupported);
}

export type FilterActiveChannelsOpts = {
  /**
   * When true, keep retired schemas that still have a saved instance
   * (so users can open the soft-retired banner + delete credentials).
   */
  includeRetiredWithInstances?: boolean;
  /** Instance list used when includeRetiredWithInstances is set */
  instances?: Array<{ channel: string }>;
};

/**
 * Default sidebar / new-bind picker: active (non-retired) channels only.
 * Optionally re-includes retired channels that still have saved instances.
 */
export function filterActiveChannels(
  channels: readonly ChannelSchema[] = CHANNEL_SCHEMAS,
  opts?: FilterActiveChannelsOpts,
): ChannelSchema[] {
  const includeLegacy = !!opts?.includeRetiredWithInstances;
  const instances = opts?.instances ?? [];
  return channels.filter((schema) => {
    if (!isRetiredChannel(schema)) return true;
    if (!includeLegacy) return false;
    return instances.some((i) => i.channel === schema.id);
  });
}

export function channelsByGroup(
  group: ChannelSchema["group"],
): ChannelSchema[] {
  return CHANNEL_SCHEMAS.filter((c) => c.group === group);
}

export function isRemoteChannelId(v: string): v is RemoteChannelId {
  return CHANNEL_SCHEMAS.some((c) => c.id === v);
}

/** Default non-secret options from schema */
export function defaultOptionsFor(schema: ChannelSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of schema.fields) {
    if (f.secret) continue;
    if (f.defaultValue !== undefined) out[f.key] = f.defaultValue;
  }
  return out;
}

/** Visible fields given current option values */
export function visibleFields(
  schema: ChannelSchema,
  values: Record<string, unknown>,
  section?: ChannelSchema["fields"][0]["section"],
) {
  return schema.fields.filter((f) => {
    if (section && f.section !== section) return false;
    if (!f.when) return true;
    return values[f.when.key] === f.when.equals;
  });
}

/**
 * Whether to show the public-URL / tunnel Callout.
 * Spec §6.8 WeCom: Callout only for webhook mode (not WebSocket).
 * LINE / other `needsPublicUrl` channels: always when flagged.
 */
export function showsPublicUrlCallout(
  schema: ChannelSchema,
  values: Record<string, unknown>,
): boolean {
  if (!schema.needsPublicUrl) return false;
  if (schema.id === "wecom") {
    return values.connect_mode === "webhook";
  }
  return true;
}

/** Primary bind fields only (required credentials for connect). */
export function primaryBindFields(
  schema: ChannelSchema,
  values: Record<string, unknown>,
) {
  return visibleFields(schema, values, "bind").filter((f) => f.required || f.section === "bind");
}

/** Everything else goes under Advanced collapse. */
export function advancedPanelFields(
  schema: ChannelSchema,
  values: Record<string, unknown>,
) {
  const bindExtra = visibleFields(schema, values, "bind").filter(
    (f) => !f.required,
  );
  return [
    ...bindExtra,
    ...visibleFields(schema, values, "options"),
    ...visibleFields(schema, values, "advanced"),
  ];
}

/** Validate required bind fields (non-secret may be empty if hasCredentials) */
export function validateBindFields(
  schema: ChannelSchema,
  values: Record<string, unknown>,
  opts?: {
    hasCredentials?: boolean;
    secretKeysFilled?: Set<string>;
    /**
     * Last-saved options. When a secret field becomes visible only after a
     * mode change (e.g. WeCom websocket→webhook), vault reuse is denied
     * until the new secret keys are filled (honest soft-fail).
     */
    savedValues?: Record<string, unknown>;
  },
): { ok: boolean; missing: string[] } {
  if (isRetiredChannel(schema)) {
    return { ok: false, missing: ["_retired"] };
  }
  if (!schema.implemented) {
    return { ok: false, missing: ["_not_implemented"] };
  }
  const missing: string[] = [];
  for (const f of visibleFields(schema, values, "bind")) {
    if (!f.required) continue;
    const v = values[f.key];
    const empty =
      v === undefined ||
      v === null ||
      (typeof v === "string" && v.trim() === "");
    if (empty) {
      if (f.secret && opts?.secretKeysFilled?.has(f.key)) continue;
      if (
        f.secret &&
        opts?.hasCredentials &&
        !opts.secretKeysFilled?.has(f.key)
      ) {
        // Reuse vault only if this secret was already required under saved values
        if (opts.savedValues) {
          const wasVisible =
            !f.when || opts.savedValues[f.when.key] === f.when.equals;
          if (wasVisible) continue;
          // Mode switch → require re-entry
        } else {
          // Legacy callers without savedValues keep previous soft reuse
          continue;
        }
      }
      missing.push(f.key);
    }
  }
  return { ok: missing.length === 0, missing };
}

/** Parse `cli_xxx:secret` style paste into app_id + app_secret */
export function parseIdSecretPair(
  raw: string,
): { app_id: string; app_secret: string } | null {
  const s = raw.trim();
  const idx = s.indexOf(":");
  if (idx <= 0 || idx === s.length - 1) return null;
  const app_id = s.slice(0, idx).trim();
  const app_secret = s.slice(idx + 1).trim();
  if (!app_id || !app_secret) return null;
  return { app_id, app_secret };
}
