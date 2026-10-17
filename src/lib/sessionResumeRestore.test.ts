import { describe, expect, it } from "vitest";
import {
  buildResumeWorktreeName,
  canOfferResumeWithCodeRestore,
  canRestoreCodeOnResume,
  isGitWorkingTreeDirty,
  shouldCaptureBaselineCommit,
} from "./sessionResumeRestore";

describe("isGitWorkingTreeDirty (resume path)", () => {
  it("is false when unavailable or empty", () => {
    expect(isGitWorkingTreeDirty(null)).toBe(false);
    expect(isGitWorkingTreeDirty(undefined)).toBe(false);
    expect(
      isGitWorkingTreeDirty({ available: false, files: [{ path: "a" }] }),
    ).toBe(false);
    expect(isGitWorkingTreeDirty({ available: true, files: [] })).toBe(false);
  });

  it("is true when available and any files listed", () => {
    expect(
      isGitWorkingTreeDirty({
        available: true,
        files: [{ path: "src/a.ts" }],
      }),
    ).toBe(true);
  });
});

describe("canRestoreCodeOnResume", () => {
  it("requires a project path", () => {
    expect(canRestoreCodeOnResume("", { available: true, files: [] })).toEqual({
      ok: false,
      reason: "no_project",
    });
    expect(
      canRestoreCodeOnResume(null, { available: true, files: [] }),
    ).toEqual({ ok: false, reason: "no_project" });
  });

  it("requires available git status", () => {
    expect(
      canRestoreCodeOnResume("/repo", {
        available: false,
        reason: "not a repo",
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(canRestoreCodeOnResume("/repo", null)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("refuses dirty trees (never destroy uncommitted work)", () => {
    expect(
      canRestoreCodeOnResume("/repo", {
        available: true,
        files: [{ path: "x" }],
      }),
    ).toEqual({ ok: false, reason: "dirty" });
  });

  it("allows clean git project", () => {
    expect(
      canRestoreCodeOnResume("/repo", { available: true, files: [] }),
    ).toEqual({ ok: true });
  });
});

describe("canOfferResumeWithCodeRestore", () => {
  it("needs a project path", () => {
    expect(canOfferResumeWithCodeRestore(null)).toBe(false);
    expect(canOfferResumeWithCodeRestore("")).toBe(false);
    expect(canOfferResumeWithCodeRestore("   ")).toBe(false);
  });

  it("offers when path present and git unknown or available", () => {
    expect(canOfferResumeWithCodeRestore("/repo")).toBe(true);
    expect(
      canOfferResumeWithCodeRestore("/repo", { gitAvailable: true }),
    ).toBe(true);
    expect(
      canOfferResumeWithCodeRestore("/repo", { gitAvailable: null }),
    ).toBe(true);
  });

  it("hides when known non-git", () => {
    expect(
      canOfferResumeWithCodeRestore("/repo", { gitAvailable: false }),
    ).toBe(false);
  });
});

describe("buildResumeWorktreeName", () => {
  it("builds a stable sanitize-safe name", () => {
    const name = buildResumeWorktreeName("a1b2c3d4-eeee-ffff", {
      now: 1_700_000_000_000,
      attempt: 0,
    });
    expect(name).toMatch(/^resume-a1b2c3d4-[a-z0-9]+$/);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name.startsWith("-")).toBe(false);
  });

  it("includes attempt suffix when retrying", () => {
    const name = buildResumeWorktreeName("session-id", {
      now: 42,
      attempt: 2,
    });
    expect(name).toContain("-2");
    expect(name.startsWith("resume-")).toBe(true);
  });

  it("falls back when session id is empty", () => {
    const name = buildResumeWorktreeName("", { now: 99, attempt: 0 });
    expect(name.startsWith("resume-chat-")).toBe(true);
  });
});

describe("shouldCaptureBaselineCommit", () => {
  it("captures when clean, available, and no stored baseline", () => {
    expect(
      shouldCaptureBaselineCommit({
        storedCommit: null,
        gitAvailable: true,
        status: { available: true, files: [] },
      }),
    ).toEqual({ capture: true });
  });

  it("skips when a baseline is already stored", () => {
    expect(
      shouldCaptureBaselineCommit({
        storedCommit: "abc123",
        gitAvailable: true,
        status: { available: true, files: [] },
      }),
    ).toEqual({ capture: false, reason: "has_stored" });
  });

  it("skips when dirty or git unavailable", () => {
    expect(
      shouldCaptureBaselineCommit({
        status: { available: true, files: [{ path: "a" }] },
      }),
    ).toEqual({ capture: false, reason: "unsafe" });
    expect(
      shouldCaptureBaselineCommit({
        gitAvailable: false,
        status: { available: true, files: [] },
      }),
    ).toEqual({ capture: false, reason: "unsafe" });
    expect(
      shouldCaptureBaselineCommit({
        status: { available: false },
      }),
    ).toEqual({ capture: false, reason: "unsafe" });
  });
});
