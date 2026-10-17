/**
 * Remote IM secrets API shape.
 * Secrets never enter git or plaintext logs; host stores via keychain / secrets.json.
 */

import type {
  RemoteChannelId,
  RemoteImSecretGetMasked,
  RemoteImSecretPut,
} from "./types";

/** In-memory mock store for browser / tests (never secrets in logs). */
const mockVault = new Map<string, Record<string, string>>();

export function credentialsRefFor(
  channel: RemoteChannelId,
  instanceId: string,
): string {
  return `remote_im:${channel}:${instanceId}`;
}

export function maskSecretValue(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (v.length <= 4) return "••••";
  return `••••${v.slice(-4)}`;
}

/**
 * Put secrets for an instance. Returns credentialsRef.
 * Tauri host should implement remote_im_secrets_put; mock used when unavailable.
 */
export async function remoteImSecretsPut(
  body: RemoteImSecretPut,
  opts?: {
    put?: (body: RemoteImSecretPut) => Promise<void>;
  },
): Promise<{ credentialsRef: string }> {
  const ref = body.credentialsRef || credentialsRefFor(body.channel, body.instanceId);
  if (opts?.put) {
    await opts.put({ ...body, credentialsRef: ref });
    return { credentialsRef: ref };
  }
  // Mock: store in memory only
  const existing = mockVault.get(ref) ?? {};
  const next = { ...existing };
  for (const [k, v] of Object.entries(body.secrets)) {
    if (v != null && String(v).length > 0) next[k] = String(v);
  }
  mockVault.set(ref, next);
  return { credentialsRef: ref };
}

export async function remoteImSecretsGetMasked(
  credentialsRef: string,
  opts?: {
    get?: (ref: string) => Promise<RemoteImSecretGetMasked | null>;
  },
): Promise<RemoteImSecretGetMasked | null> {
  if (opts?.get) return opts.get(credentialsRef);
  const row = mockVault.get(credentialsRef);
  if (!row) return null;
  const masked: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(row)) {
    masked[k] = maskSecretValue(v);
  }
  return { credentialsRef, masked };
}

export async function remoteImSecretsDelete(
  credentialsRef: string,
  opts?: { del?: (ref: string) => Promise<void> },
): Promise<void> {
  if (opts?.del) {
    await opts.del(credentialsRef);
    return;
  }
  mockVault.delete(credentialsRef);
}

/** Test helper — clear mock vault */
export function __resetRemoteImSecretsMock(): void {
  mockVault.clear();
}

/** Redact secret-like keys from a loggable object */
export function redactRemoteImLog(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const SECRET_KEYS =
    /secret|token|password|sid|encoding_aes|app_secret|bot_secret|corp_secret|access_token|channel_secret/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.test(k)) {
      out[k] = typeof v === "string" && v ? maskSecretValue(v) : "[redacted]";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactRemoteImLog(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}
