import { describe, expect, it } from "vitest";
import {
  SUBAGENT_WORKTREE_SNAPSHOT_CONFIG_KEY,
  SUBAGENT_WORKTREE_SNAPSHOT_ENV,
  cliSupportsSubagentWorktreeSnapshot,
  normalizeSubagentWorktreeSnapshotEnabled,
  subagentWorktreeSnapshotEqual,
  subagentWorktreeSnapshotSpawnEnv,
  subagentWorktreeSnapshotSpawnEnvSoft,
} from "./subagentWorktreeSnapshot";

describe("normalizeSubagentWorktreeSnapshotEnabled", () => {
  it("defaults to false", () => {
    expect(normalizeSubagentWorktreeSnapshotEnabled(null)).toBe(false);
    expect(normalizeSubagentWorktreeSnapshotEnabled(undefined)).toBe(false);
    expect(normalizeSubagentWorktreeSnapshotEnabled(false)).toBe(false);
  });

  it("is true only for true", () => {
    expect(normalizeSubagentWorktreeSnapshotEnabled(true)).toBe(true);
  });
});

describe("subagentWorktreeSnapshotSpawnEnv", () => {
  it("always sets GROK_SUBAGENT_WORKTREE_SNAPSHOT", () => {
    expect(subagentWorktreeSnapshotSpawnEnv(true)).toEqual({
      [SUBAGENT_WORKTREE_SNAPSHOT_ENV]: "1",
    });
    expect(subagentWorktreeSnapshotSpawnEnv(false)).toEqual({
      [SUBAGENT_WORKTREE_SNAPSHOT_ENV]: "0",
    });
    expect(subagentWorktreeSnapshotSpawnEnv(null)).toEqual({
      [SUBAGENT_WORKTREE_SNAPSHOT_ENV]: "0",
    });
  });
});

describe("cliSupportsSubagentWorktreeSnapshot", () => {
  it("parses version tokens", () => {
    expect(cliSupportsSubagentWorktreeSnapshot("0.2.117")).toBe(true);
    expect(cliSupportsSubagentWorktreeSnapshot("grok 0.2.117 (abc)")).toBe(
      true,
    );
    expect(cliSupportsSubagentWorktreeSnapshot("0.2.118")).toBe(true);
    expect(cliSupportsSubagentWorktreeSnapshot("0.3.0")).toBe(true);
    expect(cliSupportsSubagentWorktreeSnapshot("0.2.116")).toBe(false);
    expect(cliSupportsSubagentWorktreeSnapshot("0.2.100")).toBe(false);
    expect(cliSupportsSubagentWorktreeSnapshot("0.1.99")).toBe(false);
  });

  it("returns null for unknown", () => {
    expect(cliSupportsSubagentWorktreeSnapshot(null)).toBe(null);
    expect(cliSupportsSubagentWorktreeSnapshot(undefined)).toBe(null);
    expect(cliSupportsSubagentWorktreeSnapshot("")).toBe(null);
    expect(cliSupportsSubagentWorktreeSnapshot("nope")).toBe(null);
  });
});

describe("subagentWorktreeSnapshotSpawnEnvSoft", () => {
  it("omits env on known-old CLI", () => {
    expect(
      subagentWorktreeSnapshotSpawnEnvSoft(true, "0.2.112"),
    ).toEqual({});
    expect(
      subagentWorktreeSnapshotSpawnEnvSoft(false, "grok 0.2.100"),
    ).toEqual({});
  });

  it("emits on new or unknown CLI", () => {
    expect(subagentWorktreeSnapshotSpawnEnvSoft(true, "0.2.117")).toEqual({
      [SUBAGENT_WORKTREE_SNAPSHOT_ENV]: "1",
    });
    expect(subagentWorktreeSnapshotSpawnEnvSoft(true, null)).toEqual({
      [SUBAGENT_WORKTREE_SNAPSHOT_ENV]: "1",
    });
    expect(subagentWorktreeSnapshotSpawnEnvSoft(false, "garbage")).toEqual({
      [SUBAGENT_WORKTREE_SNAPSHOT_ENV]: "0",
    });
  });
});

describe("subagentWorktreeSnapshotEqual", () => {
  it("compares after normalize", () => {
    expect(subagentWorktreeSnapshotEqual(null, false)).toBe(true);
    expect(subagentWorktreeSnapshotEqual(true, true)).toBe(true);
    expect(subagentWorktreeSnapshotEqual(true, false)).toBe(false);
  });
});

describe("config key constant", () => {
  it("matches CLI 0.2.117 surface", () => {
    expect(SUBAGENT_WORKTREE_SNAPSHOT_CONFIG_KEY).toBe(
      "subagent_worktree_snapshot_enabled",
    );
  });
});
