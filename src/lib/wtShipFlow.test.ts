import { describe, expect, it } from "vitest";
import {
  buildGhHead,
  buildGhPrCreateArgs,
  buildGitPushArgs,
  canShipWorktree,
  combineShipOutcome,
  defaultPrTitleFromBranch,
  githubOwner,
  normalizeShipPath,
  parseGhPrUrl,
  parseGitHubOwnerRepo,
  redactShipOutput,
  resolveShipRemotes,
  sanitizeBaseBranch,
  sanitizeBranchName,
  sanitizeGitHubRepo,
  sanitizePrBody,
  sanitizePrTitle,
  shipOutcomeSummary,
  type ShipPrResult,
  type ShipPushResult,
} from "./wtShipFlow";

describe("normalizeShipPath", () => {
  it("trims and strips trailing slashes", () => {
    expect(normalizeShipPath(" /Users/me/repo/ ")).toBe("/Users/me/repo");
    expect(normalizeShipPath("C:\\a\\b\\")).toBe("C:/a/b");
  });
});

describe("sanitizeBranchName", () => {
  it("accepts feat paths", () => {
    expect(sanitizeBranchName("feat/wt-ship-flow")).toBe("feat/wt-ship-flow");
  });
  it("rejects flags and empty", () => {
    expect(sanitizeBranchName("")).toBeNull();
    expect(sanitizeBranchName("HEAD")).toBeNull();
    expect(() => sanitizeBranchName("-u")).toThrow(/start/);
    expect(() => sanitizeBranchName("a;rm")).toThrow(/invalid/);
  });
});

describe("sanitizePrTitle / body", () => {
  it("requires title and strips newlines", () => {
    expect(sanitizePrTitle("Hello\nworld")).toBe("Hello world");
    expect(() => sanitizePrTitle("  ")).toThrow(/required/);
  });
  it("allows empty body", () => {
    expect(sanitizePrBody(undefined)).toBe("");
    expect(sanitizePrBody("line1\r\nline2")).toBe("line1\nline2");
  });
});

describe("sanitizeGitHubRepo", () => {
  it("parses owner/name", () => {
    expect(sanitizeGitHubRepo("RongleCat/grok-app")).toBe("RongleCat/grok-app");
    expect(sanitizeGitHubRepo("")).toBeNull();
    expect(() => sanitizeGitHubRepo("nope")).toThrow(/owner/);
  });
});

describe("defaultPrTitleFromBranch", () => {
  it("maps conventional prefixes", () => {
    expect(defaultPrTitleFromBranch("feat/wt-ship-flow")).toBe(
      "feat: wt ship flow",
    );
    expect(defaultPrTitleFromBranch("fix/foo_bar")).toBe("fix: foo bar");
  });
  it("falls back for plain names", () => {
    expect(defaultPrTitleFromBranch("hello-world")).toBe("hello world");
    expect(defaultPrTitleFromBranch("")).toBe("Ship changes");
  });
});

describe("parseGitHubOwnerRepo", () => {
  it("parses ssh and https", () => {
    expect(
      parseGitHubOwnerRepo("git@github.com:RongleCat/grok-app.git"),
    ).toBe("RongleCat/grok-app");
    expect(
      parseGitHubOwnerRepo("https://github.com/sonnemusk/grok-app.git"),
    ).toBe("sonnemusk/grok-app");
    expect(parseGitHubOwnerRepo("")).toBeNull();
  });
  it("githubOwner extracts owner", () => {
    expect(githubOwner("sonnemusk/grok-app")).toBe("sonnemusk");
  });
});

describe("buildGhHead / resolveShipRemotes", () => {
  it("uses owner:branch for forks", () => {
    expect(
      buildGhHead(
        "feat/wt-ship-flow",
        "sonnemusk/grok-app",
        "RongleCat/grok-app",
      ),
    ).toBe("sonnemusk:feat/wt-ship-flow");
    expect(
      buildGhHead("feat/x", "RongleCat/grok-app", "RongleCat/grok-app"),
    ).toBe("feat/x");
  });
  it("prefers upstream as PR target repo", () => {
    const r = resolveShipRemotes({
      branch: "feat/wt-ship-flow",
      originUrl: "git@github.com:sonnemusk/grok-app.git",
      upstreamUrl: "git@github.com:RongleCat/grok-app.git",
    });
    expect(r.repo).toBe("RongleCat/grok-app");
    expect(r.base).toBe("main");
    expect(r.head).toBe("sonnemusk:feat/wt-ship-flow");
  });
});

describe("buildGitPushArgs", () => {
  it("builds safe argv", () => {
    expect(buildGitPushArgs("/Users/me/repo")).toEqual([
      "-C",
      "/Users/me/repo",
      "push",
      "-u",
      "origin",
      "HEAD",
    ]);
    expect(() => buildGitPushArgs("")).toThrow(/empty/);
    expect(() => buildGitPushArgs("-C")).toThrow(/invalid/);
  });
});

describe("buildGhPrCreateArgs", () => {
  it("includes title body base head repo draft", () => {
    expect(
      buildGhPrCreateArgs({
        title: "feat: ship",
        body: "hello",
        draft: true,
        base: "main",
        head: "sonnemusk:feat/wt-ship-flow",
        repo: "RongleCat/grok-app",
      }),
    ).toEqual([
      "pr",
      "create",
      "--title",
      "feat: ship",
      "--body",
      "hello",
      "--repo",
      "RongleCat/grok-app",
      "--base",
      "main",
      "--head",
      "sonnemusk:feat/wt-ship-flow",
      "--draft",
    ]);
  });
  it("defaults base to main and omits empty body flags carefully", () => {
    const args = buildGhPrCreateArgs({ title: "T" });
    expect(args).toContain("--base");
    expect(args).toContain("main");
    expect(args).toContain("--body");
    expect(args).not.toContain("--draft");
    expect(args).not.toContain("--head");
  });
});

describe("parseGhPrUrl", () => {
  it("extracts pull URL", () => {
    expect(
      parseGhPrUrl(
        "Creating pull request\nhttps://github.com/RongleCat/grok-app/pull/42\n",
      ),
    ).toBe("https://github.com/RongleCat/grok-app/pull/42");
    expect(parseGhPrUrl("no url here")).toBeNull();
  });
});

describe("canShipWorktree", () => {
  it("requires a real branch", () => {
    expect(canShipWorktree({ branch: "feat/x", detached: false })).toBe(true);
    expect(canShipWorktree({ branch: null, detached: true })).toBe(false);
    expect(canShipWorktree({ branch: "HEAD" })).toBe(false);
    expect(canShipWorktree({ branch: "feat/x", available: false })).toBe(
      false,
    );
  });
});

describe("combineShipOutcome", () => {
  const pushOk: ShipPushResult = {
    available: true,
    ok: true,
    branch: "feat/x",
  };
  const pushFail: ShipPushResult = {
    available: true,
    ok: false,
    reason: "rejected",
  };
  const prOk: ShipPrResult = {
    available: true,
    ok: true,
    url: "https://github.com/RongleCat/grok-app/pull/1",
  };
  const prFail: ShipPrResult = {
    available: true,
    ok: false,
    reason: "GraphQL error",
  };
  const prMissing: ShipPrResult = {
    available: false,
    ok: false,
    reason: "gh not available",
  };

  it("requires PR URL when creating PR", () => {
    const o = combineShipOutcome(pushOk, prOk, { createPr: true });
    expect(o.ok).toBe(true);
    expect(o.prUrl).toContain("/pull/1");
  });
  it("does not fake success when gh fails even if push ok", () => {
    const o = combineShipOutcome(pushOk, prFail, { createPr: true });
    expect(o.ok).toBe(false);
    expect(o.failReason).toMatch(/GraphQL|failed/i);
  });
  it("does not fake success when gh missing", () => {
    const o = combineShipOutcome(pushOk, prMissing, { createPr: true });
    expect(o.ok).toBe(false);
  });
  it("push-only uses push.ok", () => {
    expect(combineShipOutcome(pushOk, null, { createPr: false }).ok).toBe(
      true,
    );
    expect(combineShipOutcome(pushFail, null, { createPr: false }).ok).toBe(
      false,
    );
  });
  it("summary is honest", () => {
    const s = shipOutcomeSummary(
      combineShipOutcome(pushOk, prFail, { createPr: true }),
    );
    expect(s).toMatch(/pushed/);
    expect(s).toMatch(/PR failed/);
  });
});

describe("redactShipOutput", () => {
  it("scrubs token-like spans", () => {
    const out = redactShipOutput("Bearer supersecrettokenvalue abc");
    expect(out.toLowerCase()).toContain("redacted");
  });
});

describe("sanitizeBaseBranch", () => {
  it("accepts main", () => {
    expect(sanitizeBaseBranch("main")).toBe("main");
    expect(sanitizeBaseBranch("")).toBeNull();
  });
});
