import { describe, expect, it } from "vitest";
import {
  COMPACTION_CLI_FLAGS_MIN,
  COMPACTION_DETAILS,
  COMPACTION_MODES,
  DEFAULT_COMPACTION_DETAIL,
  DEFAULT_COMPACTION_MODE,
  cliSupportsCompactionFlags,
  compactionDetailApplies,
  compactionDetailSpawnArgs,
  compactionModeSpawnArgs,
  compactionSpawnArgs,
  compactionSpawnEnv,
  isCompactionDetailId,
  isCompactionModeId,
  normalizeCompactionDetail,
  normalizeCompactionMode,
  parseCliSemver,
} from "./compactionMode";

describe("compactionMode", () => {
  it("exposes CLI enums and defaults", () => {
    expect(COMPACTION_MODES).toEqual(["summary", "transcript", "segments"]);
    expect(COMPACTION_DETAILS).toEqual([
      "none",
      "minimal",
      "balanced",
      "verbose",
    ]);
    expect(DEFAULT_COMPACTION_MODE).toBe("summary");
    expect(DEFAULT_COMPACTION_DETAIL).toBe("verbose");
    expect(COMPACTION_CLI_FLAGS_MIN).toBe("0.2.117");
  });

  it("normalizes mode ids", () => {
    expect(normalizeCompactionMode("summary")).toBe("summary");
    expect(normalizeCompactionMode(" Transcript ")).toBe("transcript");
    expect(normalizeCompactionMode("SEGMENTS")).toBe("segments");
    expect(normalizeCompactionMode("")).toBe("summary");
    expect(normalizeCompactionMode(null)).toBe("summary");
    expect(normalizeCompactionMode("heavy")).toBe("summary");
    expect(normalizeCompactionMode(12)).toBe("summary");
  });

  it("normalizes detail ids", () => {
    expect(normalizeCompactionDetail("none")).toBe("none");
    expect(normalizeCompactionDetail(" Minimal ")).toBe("minimal");
    expect(normalizeCompactionDetail("BALANCED")).toBe("balanced");
    expect(normalizeCompactionDetail("verbose")).toBe("verbose");
    expect(normalizeCompactionDetail("")).toBe("verbose");
    expect(normalizeCompactionDetail(undefined)).toBe("verbose");
    expect(normalizeCompactionDetail("max")).toBe("verbose");
  });

  it("type guards", () => {
    expect(isCompactionModeId("summary")).toBe(true);
    expect(isCompactionModeId("segments")).toBe(true);
    expect(isCompactionModeId("nope")).toBe(false);
    expect(isCompactionDetailId("minimal")).toBe(true);
    expect(isCompactionDetailId("loud")).toBe(false);
  });

  it("detail only applies to segments", () => {
    expect(compactionDetailApplies("segments")).toBe(true);
    expect(compactionDetailApplies("summary")).toBe(false);
    expect(compactionDetailApplies("transcript")).toBe(false);
    expect(compactionDetailApplies("")).toBe(false);
  });

  it("builds mode spawn args", () => {
    expect(compactionModeSpawnArgs("summary")).toEqual([
      "--compaction-mode",
      "summary",
    ]);
    expect(compactionModeSpawnArgs("  SEGMENTS ")).toEqual([
      "--compaction-mode",
      "segments",
    ]);
    expect(compactionModeSpawnArgs("bogus")).toEqual([
      "--compaction-mode",
      "summary",
    ]);
  });

  it("builds detail spawn args only for segments", () => {
    expect(compactionDetailSpawnArgs("summary", "minimal")).toEqual([]);
    expect(compactionDetailSpawnArgs("transcript", "verbose")).toEqual([]);
    expect(compactionDetailSpawnArgs("segments", "minimal")).toEqual([
      "--compaction-detail",
      "minimal",
    ]);
    expect(compactionDetailSpawnArgs("segments", "  NONE ")).toEqual([
      "--compaction-detail",
      "none",
    ]);
    expect(compactionDetailSpawnArgs("segments", "bogus")).toEqual([
      "--compaction-detail",
      "verbose",
    ]);
  });

  it("combines spawn args", () => {
    expect(compactionSpawnArgs("transcript", "none")).toEqual([
      "--compaction-mode",
      "transcript",
    ]);
    expect(compactionSpawnArgs("segments", "balanced")).toEqual([
      "--compaction-mode",
      "segments",
      "--compaction-detail",
      "balanced",
    ]);
  });

  it("builds env pairs (detail only for segments)", () => {
    expect(compactionSpawnEnv("summary", "minimal")).toEqual([
      ["GROK_COMPACTION_MODE", "summary"],
    ]);
    expect(compactionSpawnEnv("segments", "none")).toEqual([
      ["GROK_COMPACTION_MODE", "segments"],
      ["GROK_COMPACTION_DETAIL", "none"],
    ]);
    expect(compactionSpawnEnv("bogus", "bogus")).toEqual([
      ["GROK_COMPACTION_MODE", "summary"],
    ]);
  });

  it("parses CLI version banners", () => {
    expect(parseCliSemver("grok 0.2.117 (f1c06093089f)")).toEqual([
      0, 2, 117,
    ]);
    expect(parseCliSemver("0.2.117")).toEqual([0, 2, 117]);
    expect(parseCliSemver("v0.2.112")).toEqual([0, 2, 112]);
    expect(parseCliSemver("")).toBeNull();
    expect(parseCliSemver("grok")).toBeNull();
  });

  it("gates flags at 0.2.117", () => {
    expect(cliSupportsCompactionFlags("grok 0.2.117")).toBe(true);
    expect(cliSupportsCompactionFlags("grok 0.2.200")).toBe(true);
    expect(cliSupportsCompactionFlags("grok 0.3.0")).toBe(true);
    expect(cliSupportsCompactionFlags("grok 0.2.116")).toBe(false);
    expect(cliSupportsCompactionFlags("grok 0.2.112")).toBe(false);
    expect(cliSupportsCompactionFlags(null)).toBe(false);
    expect(cliSupportsCompactionFlags("")).toBe(false);
    expect(cliSupportsCompactionFlags("unknown")).toBe(false);
  });
});
