import { describe, expect, it } from "vitest";
import {
  BACKGROUND_WAIT_MIN_CLI,
  DEFAULT_BACKGROUND_WAIT_POLICY,
  DEFAULT_BACKGROUND_WAIT_TIMEOUT_SEC,
  MAX_BACKGROUND_WAIT_TIMEOUT_SEC,
  MIN_BACKGROUND_WAIT_TIMEOUT_SEC,
  backgroundWaitNeedsFlags,
  backgroundWaitSettingsEqual,
  backgroundWaitSpawnArgs,
  backgroundWaitSpawnArgsSoft,
  cliSupportsBackgroundWait,
  normalizeBackgroundWaitPolicy,
  normalizeBackgroundWaitTimeoutSec,
} from "./backgroundWaitPolicy";

describe("normalizeBackgroundWaitPolicy", () => {
  it("defaults to wait", () => {
    expect(DEFAULT_BACKGROUND_WAIT_POLICY).toBe("wait");
    expect(normalizeBackgroundWaitPolicy(null)).toBe("wait");
    expect(normalizeBackgroundWaitPolicy(undefined)).toBe("wait");
    expect(normalizeBackgroundWaitPolicy("")).toBe("wait");
    expect(normalizeBackgroundWaitPolicy("nope")).toBe("wait");
    expect(normalizeBackgroundWaitPolicy("default")).toBe("wait");
  });

  it("accepts aliases", () => {
    expect(normalizeBackgroundWaitPolicy("wait")).toBe("wait");
    expect(normalizeBackgroundWaitPolicy("WAIT")).toBe("wait");
    expect(normalizeBackgroundWaitPolicy("no_wait")).toBe("no_wait");
    expect(normalizeBackgroundWaitPolicy("no-wait")).toBe("no_wait");
    expect(normalizeBackgroundWaitPolicy("noWait")).toBe("no_wait");
    expect(normalizeBackgroundWaitPolicy("timeout")).toBe("timeout");
    expect(normalizeBackgroundWaitPolicy("TIMEOUT")).toBe("timeout");
  });
});

describe("normalizeBackgroundWaitTimeoutSec", () => {
  it("defaults and clamps 1–3600", () => {
    expect(normalizeBackgroundWaitTimeoutSec(null)).toBe(
      DEFAULT_BACKGROUND_WAIT_TIMEOUT_SEC,
    );
    expect(normalizeBackgroundWaitTimeoutSec("")).toBe(
      DEFAULT_BACKGROUND_WAIT_TIMEOUT_SEC,
    );
    expect(normalizeBackgroundWaitTimeoutSec("nope")).toBe(
      DEFAULT_BACKGROUND_WAIT_TIMEOUT_SEC,
    );
    expect(normalizeBackgroundWaitTimeoutSec(0)).toBe(
      MIN_BACKGROUND_WAIT_TIMEOUT_SEC,
    );
    expect(normalizeBackgroundWaitTimeoutSec(-5)).toBe(
      MIN_BACKGROUND_WAIT_TIMEOUT_SEC,
    );
    expect(normalizeBackgroundWaitTimeoutSec(1)).toBe(1);
    expect(normalizeBackgroundWaitTimeoutSec(600)).toBe(600);
    expect(normalizeBackgroundWaitTimeoutSec(3600)).toBe(
      MAX_BACKGROUND_WAIT_TIMEOUT_SEC,
    );
    expect(normalizeBackgroundWaitTimeoutSec(99999)).toBe(
      MAX_BACKGROUND_WAIT_TIMEOUT_SEC,
    );
    expect(normalizeBackgroundWaitTimeoutSec(" 90 ")).toBe(90);
    expect(normalizeBackgroundWaitTimeoutSec(30.6)).toBe(31);
  });
});

describe("backgroundWaitSpawnArgs", () => {
  it("omits flags for wait (CLI default)", () => {
    expect(backgroundWaitSpawnArgs("wait")).toEqual([]);
    expect(backgroundWaitSpawnArgs(null)).toEqual([]);
    expect(backgroundWaitNeedsFlags("wait")).toBe(false);
  });

  it("builds --no-wait-for-background", () => {
    expect(backgroundWaitSpawnArgs("no_wait")).toEqual([
      "--no-wait-for-background",
    ]);
    expect(backgroundWaitNeedsFlags("no_wait")).toBe(true);
  });

  it("builds --background-wait-timeout with clamp", () => {
    expect(backgroundWaitSpawnArgs("timeout", 120)).toEqual([
      "--background-wait-timeout",
      "120",
    ]);
    expect(backgroundWaitSpawnArgs("timeout", 0)).toEqual([
      "--background-wait-timeout",
      "1",
    ]);
    expect(backgroundWaitSpawnArgs("timeout", 99999)).toEqual([
      "--background-wait-timeout",
      "3600",
    ]);
    expect(backgroundWaitNeedsFlags("timeout")).toBe(true);
  });

  it("places flags as top-level pairs (not under agent/stdio)", () => {
    const args = backgroundWaitSpawnArgs("timeout", 45);
    expect(args[0]).toBe("--background-wait-timeout");
    expect(args).not.toContain("agent");
    expect(args).not.toContain("stdio");
  });
});

describe("backgroundWaitSettingsEqual", () => {
  it("ignores timeout when policy is not timeout", () => {
    expect(
      backgroundWaitSettingsEqual(
        { policy: "wait", timeoutSec: 1 },
        { policy: "wait", timeoutSec: 999 },
      ),
    ).toBe(true);
    expect(
      backgroundWaitSettingsEqual(
        { policy: "no_wait", timeoutSec: 1 },
        { policy: "no_wait", timeoutSec: 2 },
      ),
    ).toBe(true);
  });

  it("compares timeout when policy is timeout", () => {
    expect(
      backgroundWaitSettingsEqual(
        { policy: "timeout", timeoutSec: 60 },
        { policy: "timeout", timeoutSec: 60 },
      ),
    ).toBe(true);
    expect(
      backgroundWaitSettingsEqual(
        { policy: "timeout", timeoutSec: 60 },
        { policy: "timeout", timeoutSec: 120 },
      ),
    ).toBe(false);
  });

  it("detects policy flips", () => {
    expect(
      backgroundWaitSettingsEqual(
        { policy: "wait" },
        { policy: "no_wait" },
      ),
    ).toBe(false);
  });
});

describe("cliSupportsBackgroundWait / soft gate", () => {
  it("parses version against 0.2.117", () => {
    expect(BACKGROUND_WAIT_MIN_CLI).toBe("0.2.117");
    expect(cliSupportsBackgroundWait("grok 0.2.117")).toBe(true);
    expect(cliSupportsBackgroundWait("0.2.118")).toBe(true);
    expect(cliSupportsBackgroundWait("grok 0.3.0")).toBe(true);
    expect(cliSupportsBackgroundWait("grok 0.2.116")).toBe(false);
    expect(cliSupportsBackgroundWait("0.2.112")).toBe(false);
    expect(cliSupportsBackgroundWait("")).toBe(null);
    expect(cliSupportsBackgroundWait("nope")).toBe(null);
    expect(cliSupportsBackgroundWait(null)).toBe(null);
  });

  it("soft-fails: omits non-default flags on old / unknown CLI", () => {
    expect(
      backgroundWaitSpawnArgsSoft("no_wait", 600, "grok 0.2.112"),
    ).toEqual([]);
    expect(
      backgroundWaitSpawnArgsSoft("timeout", 90, "0.2.100"),
    ).toEqual([]);
    expect(
      backgroundWaitSpawnArgsSoft("no_wait", 600, "unknown"),
    ).toEqual([]);
    expect(
      backgroundWaitSpawnArgsSoft("wait", 600, "0.2.112"),
    ).toEqual([]);
  });

  it("emits flags when CLI is new enough", () => {
    expect(
      backgroundWaitSpawnArgsSoft("no_wait", 600, "grok 0.2.117"),
    ).toEqual(["--no-wait-for-background"]);
    expect(
      backgroundWaitSpawnArgsSoft("timeout", 45, "0.2.120"),
    ).toEqual(["--background-wait-timeout", "45"]);
  });
});
