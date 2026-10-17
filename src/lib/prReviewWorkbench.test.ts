import { describe, expect, it } from "vitest";
import type { GitPrCheckEntry, PrChecksSummary } from "./gitPrHub";
import {
  FIX_CI_CHECKS_CAP,
  PR_COMMENT_BODY_CAP,
  buildFixCiPrompt,
  buildPrCommentPrompt,
  canSuggestFixCi,
  classifyPrReviewActionError,
  listFailedChecks,
} from "./prReviewWorkbench";

function summary(
  partial: Partial<PrChecksSummary> & Pick<PrChecksSummary, "overall">,
): PrChecksSummary {
  return {
    pass: 0,
    fail: 0,
    pending: 0,
    skipping: 0,
    cancel: 0,
    total: 0,
    ...partial,
  };
}

function check(
  partial: Partial<GitPrCheckEntry> & Pick<GitPrCheckEntry, "name" | "bucket">,
): GitPrCheckEntry {
  return {
    state: partial.state ?? partial.bucket,
    ...partial,
  };
}

describe("canSuggestFixCi", () => {
  it("false for null / empty / pass / pending", () => {
    expect(canSuggestFixCi(null)).toBe(false);
    expect(canSuggestFixCi(undefined)).toBe(false);
    expect(
      canSuggestFixCi(
        summary({ overall: "none", total: 0 }),
      ),
    ).toBe(false);
    expect(
      canSuggestFixCi(
        summary({ overall: "pass", pass: 3, total: 3 }),
      ),
    ).toBe(false);
    expect(
      canSuggestFixCi(
        summary({ overall: "pending", pass: 1, pending: 2, total: 3 }),
      ),
    ).toBe(false);
  });

  it("true when overall fail", () => {
    expect(
      canSuggestFixCi(
        summary({ overall: "fail", pass: 2, fail: 1, total: 3 }),
      ),
    ).toBe(true);
  });

  it("true when mixed with fail>0", () => {
    expect(
      canSuggestFixCi(
        summary({ overall: "mixed", fail: 1, cancel: 1, total: 2 }),
      ),
    ).toBe(true);
  });

  it("true when fail count > 0 even if overall mis-set", () => {
    expect(
      canSuggestFixCi(
        summary({ overall: "pass", fail: 2, pass: 1, total: 3 }),
      ),
    ).toBe(true);
  });

  it("false for mixed without fails", () => {
    expect(
      canSuggestFixCi(
        summary({ overall: "mixed", cancel: 2, total: 2, fail: 0 }),
      ),
    ).toBe(false);
  });
});

describe("listFailedChecks", () => {
  it("returns only fail-bucket rows in order", () => {
    const checks = [
      check({ name: "frontend", bucket: "pass", state: "SUCCESS" }),
      check({ name: "Rust Windows", bucket: "fail", state: "FAILURE" }),
      check({ name: "lint", bucket: "fail", state: "FAILURE" }),
      check({ name: "Rust Linux", bucket: "pending", state: "PENDING" }),
    ];
    const failed = listFailedChecks(checks);
    expect(failed.map((c) => c.name)).toEqual(["Rust Windows", "lint"]);
  });

  it("empty for null / empty", () => {
    expect(listFailedChecks(null)).toEqual([]);
    expect(listFailedChecks([])).toEqual([]);
    expect(listFailedChecks(undefined)).toEqual([]);
  });

  it("infers fail from state when bucket empty", () => {
    const failed = listFailedChecks([
      check({ name: "x", bucket: "", state: "FAILURE" }),
      check({ name: "y", bucket: "", state: "SUCCESS" }),
    ]);
    expect(failed.map((c) => c.name)).toEqual(["x"]);
  });
});

describe("buildFixCiPrompt", () => {
  it("builds structured prompt with failed checks only", () => {
    const p = buildFixCiPrompt({
      prNumber: 359,
      title: "feat(settings): CLI partial messages",
      url: "https://github.com/RongleCat/grok-app/pull/359",
      headRef: "feat/partial-stream",
      baseRef: "main",
      failedChecks: [
        {
          name: "Rust Windows",
          state: "FAILURE",
          description: "test target/debug failed",
        },
        { name: "frontend", state: "FAILURE" },
      ],
      bodyExcerpt: "## Summary\nPartial stream polish",
    });
    expect(p).toContain("#359");
    expect(p).toContain("feat(settings): CLI partial messages");
    expect(p).toContain("Rust Windows");
    expect(p).toContain("frontend");
    expect(p).toContain("feat/partial-stream → main");
    expect(p).toContain("Partial stream polish");
    expect(p).toContain("Do not invent CI results");
    // Does not invent checks not supplied
    expect(p).not.toContain("Rust Linux");
  });

  it("returns empty for invalid pr number", () => {
    expect(
      buildFixCiPrompt({
        prNumber: 0,
        title: "x",
        failedChecks: [{ name: "a", state: "FAILURE" }],
      }),
    ).toBe("");
    expect(
      buildFixCiPrompt({
        prNumber: -1,
        title: "x",
        failedChecks: [],
      }),
    ).toBe("");
  });

  it("honest when no failed check rows provided", () => {
    const p = buildFixCiPrompt({
      prNumber: 1,
      title: "t",
      failedChecks: [],
    });
    expect(p).toContain("#1");
    expect(p).toMatch(/No individual failed-check/i);
    expect(p).not.toMatch(/Invented check/i);
  });

  it("caps failed checks list", () => {
    const many = Array.from({ length: FIX_CI_CHECKS_CAP + 5 }, (_, i) => ({
      name: `check-${i}`,
      state: "FAILURE",
    }));
    const p = buildFixCiPrompt({
      prNumber: 2,
      title: "many fails",
      failedChecks: many,
    });
    expect(p).toContain("check-0");
    expect(p).toContain(`check-${FIX_CI_CHECKS_CAP - 1}`);
    expect(p).not.toContain(`check-${FIX_CI_CHECKS_CAP}`);
    expect(p).toMatch(/more failed check/i);
  });

  it("redacts secrets in descriptions and body", () => {
    const p = buildFixCiPrompt({
      prNumber: 9,
      title: "sec",
      failedChecks: [
        {
          name: "deploy",
          state: "FAILURE",
          description: "token sk-abcdefghijklmnopqrstuvwxyz leaked",
        },
      ],
      bodyExcerpt: "Bearer abcdefghijklmnopqr",
    });
    expect(p).toContain("[REDACTED]");
    expect(p).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });
});

describe("buildPrCommentPrompt", () => {
  it("builds prompt from comment fields", () => {
    const p = buildPrCommentPrompt({
      prNumber: 344,
      title: "feat: ask timeout",
      comment: {
        author: "alice",
        body: "Please also cover zh-TW.",
        kind: "comment",
        url: "https://github.com/RongleCat/grok-app/pull/344#issuecomment-2",
      },
    });
    expect(p).toContain("#344");
    expect(p).toContain("feat: ask timeout");
    expect(p).toContain("alice");
    expect(p).toContain("Please also cover zh-TW.");
    expect(p).toContain("issuecomment-2");
    expect(p).toContain("Do not invent review history");
  });

  it("includes review state when kind is review", () => {
    const p = buildPrCommentPrompt({
      prNumber: 10,
      title: "t",
      comment: {
        author: "bob",
        body: "Needs tests",
        kind: "review",
        state: "CHANGES_REQUESTED",
      },
    });
    expect(p).toContain("review");
    expect(p).toContain("CHANGES_REQUESTED");
    expect(p).toContain("Needs tests");
  });

  it("returns empty for invalid pr or empty body", () => {
    expect(
      buildPrCommentPrompt({
        prNumber: 0,
        title: "t",
        comment: { author: "a", body: "hi" },
      }),
    ).toBe("");
    expect(
      buildPrCommentPrompt({
        prNumber: 3,
        title: "t",
        comment: { author: "a", body: "   " },
      }),
    ).toBe("");
  });

  it("caps long comment body and redacts secrets", () => {
    const long = "x".repeat(PR_COMMENT_BODY_CAP + 100);
    const p = buildPrCommentPrompt({
      prNumber: 5,
      title: "t",
      comment: {
        author: "eve",
        body: `token sk-abcdefghijklmnopqrstuvwxyz\n${long}`,
      },
    });
    expect(p.length).toBeLessThan(PR_COMMENT_BODY_CAP + 800);
    expect(p).toContain("[REDACTED]");
    expect(p).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(p).toMatch(/…$/m); // truncated
  });
});

describe("classifyPrReviewActionError", () => {
  it("classifies soft kinds", () => {
    expect(classifyPrReviewActionError(null)).toBeNull();
    expect(classifyPrReviewActionError("")).toBeNull();
    expect(classifyPrReviewActionError("empty_prompt")).toBe("empty_prompt");
    expect(classifyPrReviewActionError("empty comment body")).toBe(
      "empty_comment",
    );
    expect(classifyPrReviewActionError("invalid pr number")).toBe("empty_pr");
    expect(classifyPrReviewActionError("no failed checks")).toBe(
      "no_failed_checks",
    );
    expect(classifyPrReviewActionError("boom")).toBe("other");
  });
});
