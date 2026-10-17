import { describe, expect, it } from "vitest";
import {
  TWO_PASS_COMPACTION_CONFIG_KEY,
  TWO_PASS_COMPACTION_ENV,
  cliSupportsTwoPassCompaction,
  normalizeTwoPassCompactionEnabled,
  twoPassCompactionEqual,
  twoPassCompactionSpawnEnv,
  twoPassCompactionSpawnEnvSoft,
} from "./twoPassCompaction";

describe("normalizeTwoPassCompactionEnabled", () => {
  it("defaults to false", () => {
    expect(normalizeTwoPassCompactionEnabled(null)).toBe(false);
    expect(normalizeTwoPassCompactionEnabled(undefined)).toBe(false);
    expect(normalizeTwoPassCompactionEnabled(false)).toBe(false);
  });

  it("is true only for true", () => {
    expect(normalizeTwoPassCompactionEnabled(true)).toBe(true);
  });
});

describe("twoPassCompactionSpawnEnv", () => {
  it("always sets GROK_TWO_PASS_COMPACTION", () => {
    expect(twoPassCompactionSpawnEnv(true)).toEqual({
      [TWO_PASS_COMPACTION_ENV]: "1",
    });
    expect(twoPassCompactionSpawnEnv(false)).toEqual({
      [TWO_PASS_COMPACTION_ENV]: "0",
    });
    expect(twoPassCompactionSpawnEnv(null)).toEqual({
      [TWO_PASS_COMPACTION_ENV]: "0",
    });
  });
});

describe("cliSupportsTwoPassCompaction", () => {
  it("parses version tokens", () => {
    expect(cliSupportsTwoPassCompaction("0.2.117")).toBe(true);
    expect(cliSupportsTwoPassCompaction("grok 0.2.117 (abc)")).toBe(true);
    expect(cliSupportsTwoPassCompaction("0.2.118")).toBe(true);
    expect(cliSupportsTwoPassCompaction("0.3.0")).toBe(true);
    expect(cliSupportsTwoPassCompaction("0.2.116")).toBe(false);
    expect(cliSupportsTwoPassCompaction("0.2.100")).toBe(false);
    expect(cliSupportsTwoPassCompaction("0.1.99")).toBe(false);
  });

  it("returns null for unknown", () => {
    expect(cliSupportsTwoPassCompaction(null)).toBe(null);
    expect(cliSupportsTwoPassCompaction(undefined)).toBe(null);
    expect(cliSupportsTwoPassCompaction("")).toBe(null);
    expect(cliSupportsTwoPassCompaction("nope")).toBe(null);
  });
});

describe("twoPassCompactionSpawnEnvSoft", () => {
  it("omits env on known-old CLI", () => {
    expect(twoPassCompactionSpawnEnvSoft(true, "0.2.112")).toEqual({});
    expect(twoPassCompactionSpawnEnvSoft(false, "grok 0.2.100")).toEqual({});
  });

  it("emits on new or unknown CLI", () => {
    expect(twoPassCompactionSpawnEnvSoft(true, "0.2.117")).toEqual({
      [TWO_PASS_COMPACTION_ENV]: "1",
    });
    expect(twoPassCompactionSpawnEnvSoft(true, null)).toEqual({
      [TWO_PASS_COMPACTION_ENV]: "1",
    });
    expect(twoPassCompactionSpawnEnvSoft(false, "garbage")).toEqual({
      [TWO_PASS_COMPACTION_ENV]: "0",
    });
  });
});

describe("twoPassCompactionEqual", () => {
  it("compares after normalize", () => {
    expect(twoPassCompactionEqual(null, false)).toBe(true);
    expect(twoPassCompactionEqual(true, true)).toBe(true);
    expect(twoPassCompactionEqual(true, false)).toBe(false);
  });
});

describe("config key constant", () => {
  it("matches CLI 0.2.117 surface", () => {
    expect(TWO_PASS_COMPACTION_CONFIG_KEY).toBe("two_pass_compaction_enabled");
  });
});
