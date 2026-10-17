import { describe, expect, it } from "vitest";
import {
  earliestTimestampMs,
  estimateDurationSecFromTimestamps,
  formatWorkDuration,
  resolveWorkDurationSec,
} from "./formatWorkDuration";

describe("formatWorkDuration", () => {
  it("formats seconds under a minute (en)", () => {
    expect(formatWorkDuration(0, "en")).toBe("0s");
    expect(formatWorkDuration(1, "en")).toBe("1s");
    expect(formatWorkDuration(38, "en")).toBe("38s");
    expect(formatWorkDuration(59, "en")).toBe("59s");
  });

  it("formats minutes + seconds like Grok web (en)", () => {
    expect(formatWorkDuration(60, "en")).toBe("1m");
    expect(formatWorkDuration(62, "en")).toBe("1m 2s");
    expect(formatWorkDuration(125, "en")).toBe("2m 5s");
  });

  it("formats hours (en)", () => {
    expect(formatWorkDuration(3600, "en")).toBe("1h");
    expect(formatWorkDuration(3661, "en")).toBe("1h 1m 1s");
    expect(formatWorkDuration(3720, "en")).toBe("1h 2m");
  });

  it("formats Chinese N分N秒 style", () => {
    expect(formatWorkDuration(4, "zh")).toBe("4秒");
    expect(formatWorkDuration(60, "zh")).toBe("1分");
    expect(formatWorkDuration(69, "zh")).toBe("1分9秒");
    expect(formatWorkDuration(125, "zh")).toBe("2分5秒");
    expect(formatWorkDuration(3661, "zh")).toBe("1小时1分1秒");
    expect(formatWorkDuration(69, "zh-TW")).toBe("1分9秒");
    expect(formatWorkDuration(3661, "zh-TW")).toBe("1小時1分1秒");
  });
});

describe("estimateDurationSecFromTimestamps", () => {
  it("returns span between earliest and latest", () => {
    expect(
      estimateDurationSecFromTimestamps([
        "2026-07-26T01:10:00Z",
        "2026-07-26T01:10:38Z",
      ]),
    ).toBe(38);
  });

  it("returns null without enough points", () => {
    expect(estimateDurationSecFromTimestamps([])).toBeNull();
    expect(
      estimateDurationSecFromTimestamps(["2026-07-26T01:10:00Z"]),
    ).toBeNull();
  });
});

describe("resolveWorkDurationSec", () => {
  it("takes the larger of short live timer and tool-span history", () => {
    // Trailing phase often freezes liveSec at a few seconds while journal
    // tools span a full minute — never hide the real span.
    expect(resolveWorkDurationSec({ liveSec: 4, historySec: 69 })).toBe(69);
    expect(resolveWorkDurationSec({ liveSec: 90, historySec: 69 })).toBe(90);
  });

  it("falls back to whichever side is present", () => {
    expect(resolveWorkDurationSec({ liveSec: 12, historySec: null })).toBe(12);
    expect(resolveWorkDurationSec({ liveSec: null, historySec: 45 })).toBe(45);
    expect(resolveWorkDurationSec({ liveSec: null, historySec: null })).toBe(
      null,
    );
  });
});

describe("earliestTimestampMs", () => {
  it("returns the earliest parseable stamp", () => {
    expect(
      earliestTimestampMs([
        "2026-08-06T14:35:39.834020Z",
        "2026-08-06T14:34:54.038995Z",
        null,
      ]),
    ).toBe(Date.parse("2026-08-06T14:34:54.038995Z"));
  });
});
