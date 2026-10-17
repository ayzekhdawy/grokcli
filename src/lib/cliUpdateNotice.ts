/**
 * Soft launch-time CLI update notice (#238).
 * Persist dismissals so the same latest version is not re-offered too often.
 */

const STORAGE_KEY = "grok.cliUpdateNotice.v1";

export type CliUpdateNoticeRecord = {
  /** Last dismissed latest version (or empty). */
  dismissedLatest: string;
  /** Unix ms when dismissed. */
  dismissedAt: number;
};

export type CliUpdateNoticeStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

/** Re-offer after this long even for the same latest (default 24h). */
export const CLI_UPDATE_NOTICE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export { STORAGE_KEY as CLI_UPDATE_NOTICE_STORAGE_KEY };

function defaultStorage(): CliUpdateNoticeStorage | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

export function loadCliUpdateNoticeRecord(
  storage: CliUpdateNoticeStorage | null = defaultStorage(),
): CliUpdateNoticeRecord | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as CliUpdateNoticeRecord;
    if (!j || typeof j !== "object") return null;
    return {
      dismissedLatest: String(j.dismissedLatest || ""),
      dismissedAt: Number(j.dismissedAt) || 0,
    };
  } catch {
    return null;
  }
}

export function dismissCliUpdateNotice(
  latestVersion: string,
  now = Date.now(),
  storage: CliUpdateNoticeStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  const rec: CliUpdateNoticeRecord = {
    dismissedLatest: String(latestVersion || "").trim(),
    dismissedAt: now,
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(rec));
  } catch {
    /* quota / private mode */
  }
}

/**
 * Whether to show a soft notice for `latestVersion`.
 * Silent when latest is empty; suppress same version within cooldown.
 */
export function shouldOfferCliUpdateNotice(
  latestVersion: string,
  now = Date.now(),
  record: CliUpdateNoticeRecord | null = loadCliUpdateNoticeRecord(),
): boolean {
  const latest = String(latestVersion || "").trim();
  if (!latest) return false;
  if (!record?.dismissedLatest) return true;
  if (record.dismissedLatest !== latest) return true;
  if (!record.dismissedAt) return true;
  return now - record.dismissedAt >= CLI_UPDATE_NOTICE_COOLDOWN_MS;
}
