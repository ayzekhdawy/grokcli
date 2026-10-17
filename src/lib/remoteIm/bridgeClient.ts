/**
 * Bridge client — prefers Tauri remote_im_* IPC; falls back to in-memory mock
 * only when not running inside Tauri (browser / unit tests).
 */

import type {
  BridgeGlobalConfig,
  BridgeStatus,
  ChannelInstance,
  RemoteChannelId,
} from "./types";
import { loadBridgeConfig, saveBridgeConfig } from "./store";

export type TestConnectionResult = {
  ok: boolean;
  message: string;
  mock?: boolean;
};

export type ScanBeginResult = {
  deviceCode: string;
  verificationUri: string;
  intervalSec: number;
  expireInSec: number;
  platform: string;
};

export type ScanPollResult = {
  status: string;
  appId?: string | null;
  appSecret?: string | null;
  ownerOpenId?: string | null;
  platform?: string | null;
  error?: string | null;
  /** Weixin QR refresh: new QR content URL */
  verificationUri?: string | null;
  /** Weixin QR refresh: new device/qr key for subsequent polls */
  deviceCode?: string | null;
};

let mockRunning = false;
let mockConfig: BridgeGlobalConfig = {
  enabled: false,
  lifecycle: "attached",
  allowRemoteYolo: false,
};
let mockConnected: BridgeStatus["connectedChannels"] = [];
let mockLastError: string | null = null;

function isTauri(): boolean {
  try {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  } catch {
    return false;
  }
}

async function invokeSafe<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd, args);
  } catch (e) {
    console.warn(`[remoteIm] invoke ${cmd} failed`, e);
    return null;
  }
}

function mapStatus(raw: Record<string, unknown>): BridgeStatus {
  const nextRetry =
    raw.nextRetrySecs != null && Number.isFinite(Number(raw.nextRetrySecs))
      ? Math.max(0, Math.floor(Number(raw.nextRetrySecs)))
      : null;
  const attempt =
    raw.restartAttempt != null && Number.isFinite(Number(raw.restartAttempt))
      ? Math.max(0, Math.floor(Number(raw.restartAttempt)))
      : 0;
  return {
    state: String(raw.state || "stopped") as BridgeStatus["state"],
    enabled: !!raw.enabled,
    lifecycle: (raw.lifecycle === "detached" ? "detached" : "attached") as BridgeStatus["lifecycle"],
    allowRemoteYolo: !!raw.allowRemoteYolo,
    connectedChannels: Array.isArray(raw.connectedChannels)
      ? (raw.connectedChannels as BridgeStatus["connectedChannels"])
      : [],
    lastError: (raw.lastError as string) || null,
    mock: !!raw.mock,
    remoteBridgePath:
      (raw.remoteBridgePath as string) ||
      (raw.agentConnectPath as string) ||
      null,
    backend: (raw.backend as string) || "rust",
    restartAttempt: attempt,
    nextRetrySecs: nextRetry != null && nextRetry > 0 ? nextRetry : null,
    recoveryPhase: (raw.recoveryPhase as string) || null,
    errorKind: (raw.errorKind as string) || null,
    rateLimited: !!raw.rateLimited,
  };
}

export async function bridgeGetStatus(): Promise<BridgeStatus> {
  const host = await invokeSafe<Record<string, unknown>>("remote_im_bridge_status");
  if (host) return mapStatus(host);

  const cfg = typeof localStorage !== "undefined" ? loadBridgeConfig() : mockConfig;
  mockConfig = cfg;
  return {
    state: mockRunning && cfg.enabled ? "running" : "stopped",
    enabled: cfg.enabled,
    lifecycle: cfg.lifecycle,
    allowRemoteYolo: cfg.allowRemoteYolo,
    connectedChannels: mockRunning ? mockConnected : [],
    lastError: mockLastError,
    mock: true,
    restartAttempt: 0,
    nextRetrySecs: null,
    recoveryPhase: mockRunning && cfg.enabled ? "listening" : "stopped",
    errorKind: null,
    rateLimited: false,
  };
}

export async function bridgeStart(): Promise<BridgeStatus> {
  const host = await invokeSafe<Record<string, unknown>>("remote_im_bridge_start");
  if (host) return mapStatus(host);

  mockConfig = { ...mockConfig, enabled: true };
  mockRunning = true;
  mockLastError = null;
  saveBridgeConfig(mockConfig);
  return bridgeGetStatus();
}

export async function bridgeStop(): Promise<BridgeStatus> {
  const host = await invokeSafe<Record<string, unknown>>("remote_im_bridge_stop");
  if (host) return mapStatus(host);

  mockRunning = false;
  mockConnected = [];
  mockConfig = { ...mockConfig, enabled: false };
  saveBridgeConfig(mockConfig);
  return bridgeGetStatus();
}

export async function bridgeRestart(): Promise<BridgeStatus> {
  await bridgeStop();
  return bridgeStart();
}

export async function bridgeSetConfig(
  cfg: Partial<BridgeGlobalConfig>,
): Promise<BridgeStatus> {
  const host = await invokeSafe<Record<string, unknown>>("remote_im_bridge_set_config", {
    enabled: cfg.enabled,
    lifecycle: cfg.lifecycle,
    allowRemoteYolo: cfg.allowRemoteYolo,
  });
  if (host) return mapStatus(host);

  mockConfig = { ...mockConfig, ...cfg };
  saveBridgeConfig(mockConfig);
  if (!mockConfig.enabled) {
    mockRunning = false;
    mockConnected = [];
  }
  return bridgeGetStatus();
}

export async function bridgeReloadInstance(
  instance: ChannelInstance,
): Promise<BridgeStatus> {
  const host = await invokeSafe<Record<string, unknown>>("remote_im_bridge_reload", {
    instanceId: instance.id,
    channel: instance.channel,
  });
  if (host) return mapStatus(host);

  if (instance.enabled && instance.hasCredentials) {
    mockConnected = mockConnected.filter((c) => c.instanceId !== instance.id);
    mockConnected.push({
      channel: instance.channel,
      instanceId: instance.id,
      name: instance.name,
    });
    if (!mockConfig.enabled) {
      mockConfig = { ...mockConfig, enabled: true };
      mockRunning = true;
      saveBridgeConfig(mockConfig);
    } else if (!mockRunning) {
      mockRunning = true;
    }
  } else {
    mockConnected = mockConnected.filter((c) => c.instanceId !== instance.id);
  }
  return bridgeGetStatus();
}

export async function bridgeTestConnection(input: {
  channel: RemoteChannelId;
  instanceId: string;
  hasCredentials: boolean;
}): Promise<TestConnectionResult> {
  const host = await invokeSafe<{
    ok: boolean;
    message: string;
    mock?: boolean;
  }>("remote_im_test_connection", {
    channel: input.channel,
    instanceId: input.instanceId,
  });
  if (host) {
    return { ok: host.ok, message: host.message, mock: host.mock };
  }
  if (!input.hasCredentials) {
    return { ok: false, message: "missing_credentials", mock: true };
  }
  return { ok: true, message: "mock_ok", mock: true };
}

/** Real Feishu/Lark / Weixin QR registration begin */
export async function remoteImScanBegin(
  channel: RemoteChannelId,
  options?: Record<string, string>,
): Promise<ScanBeginResult | null> {
  const host = await invokeSafe<{
    deviceCode: string;
    verificationUri: string;
    intervalSec: number;
    expireInSec: number;
    platform: string;
  }>("remote_im_scan_begin", { channel, options: options ?? null });
  if (!host) return null;
  return {
    deviceCode: host.deviceCode,
    verificationUri: host.verificationUri,
    intervalSec: host.intervalSec,
    expireInSec: host.expireInSec,
    platform: host.platform,
  };
}

export async function remoteImScanPoll(
  channel: RemoteChannelId,
  deviceCode: string,
): Promise<ScanPollResult | null> {
  const host = await invokeSafe<{
    status: string;
    appId?: string | null;
    appSecret?: string | null;
    ownerOpenId?: string | null;
    platform?: string | null;
    error?: string | null;
    verificationUri?: string | null;
    deviceCode?: string | null;
  }>("remote_im_scan_poll", { channel, deviceCode });
  if (!host) return null;
  return host;
}

export async function remoteImSaveInstance(body: {
  instance: ChannelInstance;
  secrets: Record<string, string>;
  connectAfterSave: boolean;
}): Promise<ChannelInstance | null> {
  const host = await invokeSafe<ChannelInstance>("remote_im_save_instance", {
    body: {
      instance: {
        id: body.instance.id,
        channel: body.instance.channel,
        name: body.instance.name,
        enabled: body.instance.enabled,
        hasCredentials: body.instance.hasCredentials,
        options: body.instance.options,
        acl: body.instance.acl,
        projectScope: body.instance.projectScope,
        presenter: body.instance.presenter,
        status: body.instance.status,
        lastError: body.instance.lastError ?? null,
      },
      secrets: body.secrets,
      connectAfterSave: body.connectAfterSave,
    },
  });
  return host;
}

export async function remoteImDeleteInstance(
  instanceId: string,
): Promise<boolean> {
  const host = await invokeSafe<void>("remote_im_delete_instance", {
    instanceId,
  });
  // null means not tauri or failed
  return host !== null || !isTauri();
}

export async function remoteImListInstances(): Promise<ChannelInstance[] | null> {
  return invokeSafe<ChannelInstance[]>("remote_im_list_instances");
}

export async function remoteImDoctor(): Promise<Record<string, unknown> | null> {
  return invokeSafe<Record<string, unknown>>("remote_im_doctor");
}

export function __resetBridgeMock(): void {
  mockRunning = false;
  mockConfig = { enabled: false, lifecycle: "attached", allowRemoteYolo: false };
  mockConnected = [];
  mockLastError = null;
}
