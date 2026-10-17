import { describe, expect, it } from "vitest";
import {
  CLI_UPDATE_NOTICE_COOLDOWN_MS,
  dismissCliUpdateNotice,
  loadCliUpdateNoticeRecord,
  shouldOfferCliUpdateNotice,
  type CliUpdateNoticeStorage,
} from "./cliUpdateNotice";

function memoryStorage(
  initial: Record<string, string> = {},
): CliUpdateNoticeStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

describe("shouldOfferCliUpdateNotice", () => {
  it("offers when no record", () => {
    expect(shouldOfferCliUpdateNotice("0.2.120", 1_000, null)).toBe(true);
  });

  it("rejects empty latest", () => {
    expect(shouldOfferCliUpdateNotice("", 1_000, null)).toBe(false);
  });

  it("suppresses same latest inside cooldown", () => {
    const rec = { dismissedLatest: "0.2.120", dismissedAt: 1_000 };
    expect(
      shouldOfferCliUpdateNotice("0.2.120", 1_000 + 60_000, rec),
    ).toBe(false);
  });

  it("re-offers after cooldown", () => {
    const rec = { dismissedLatest: "0.2.120", dismissedAt: 1_000 };
    expect(
      shouldOfferCliUpdateNotice(
        "0.2.120",
        1_000 + CLI_UPDATE_NOTICE_COOLDOWN_MS,
        rec,
      ),
    ).toBe(true);
  });

  it("offers when latest version changes", () => {
    const rec = { dismissedLatest: "0.2.120", dismissedAt: 1_000 };
    expect(shouldOfferCliUpdateNotice("0.2.121", 1_001, rec)).toBe(true);
  });
});

describe("dismissCliUpdateNotice", () => {
  it("persists record", () => {
    const store = memoryStorage();
    dismissCliUpdateNotice("0.3.0", 42_000, store);
    expect(loadCliUpdateNoticeRecord(store)).toEqual({
      dismissedLatest: "0.3.0",
      dismissedAt: 42_000,
    });
  });
});
