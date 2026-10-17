import { describe, expect, it } from "vitest";
import {
  hasSessionNoAskUser,
  noAskUserSpawnArgs,
  resolveNoAskUser,
} from "./noAskUser";

describe("resolveNoAskUser", () => {
  it("inherits global when session is null/undefined", () => {
    expect(resolveNoAskUser(null, false)).toBe(false);
    expect(resolveNoAskUser(undefined, true)).toBe(true);
    expect(resolveNoAskUser(null, null)).toBe(false);
  });

  it("session override wins over global", () => {
    expect(resolveNoAskUser(true, false)).toBe(true);
    expect(resolveNoAskUser(false, true)).toBe(false);
    expect(resolveNoAskUser(true, true)).toBe(true);
    expect(resolveNoAskUser(false, false)).toBe(false);
  });
});

describe("noAskUserSpawnArgs", () => {
  it("emits top-level flag when on", () => {
    expect(noAskUserSpawnArgs(true)).toEqual(["--no-ask-user"]);
  });

  it("empty when off or unset", () => {
    expect(noAskUserSpawnArgs(false)).toEqual([]);
    expect(noAskUserSpawnArgs(null)).toEqual([]);
    expect(noAskUserSpawnArgs(undefined)).toEqual([]);
  });
});

describe("hasSessionNoAskUser", () => {
  it("true only for boolean override", () => {
    expect(hasSessionNoAskUser(true)).toBe(true);
    expect(hasSessionNoAskUser(false)).toBe(true);
    expect(hasSessionNoAskUser(null)).toBe(false);
    expect(hasSessionNoAskUser(undefined)).toBe(false);
  });
});
