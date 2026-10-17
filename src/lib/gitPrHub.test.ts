import { describe, expect, it } from "vitest";
import {
  bucketFromCheckFields,
  classifyPrHubReason,
  excerptCommentBody,
  formatChecksSummaryLine,
  mergePrComments,
  normalizeMergeable,
  overallFromCounts,
  parseGhPrCheckObject,
  parseGhPrChecksJson,
  parseGhPrCommentObject,
  parseGhPrCommentsJson,
  parseGhPrListJson,
  parseGhPrObject,
  parseGhPrReviewObject,
  parseGhPrViewJson,
  summarizeBuckets,
  summarizeChecks,
  summarizeStatusCheckRollup,
} from "./gitPrHub";

const SAMPLE_LIST = JSON.stringify([
  {
    number: 359,
    title: "feat(settings): CLI partial messages",
    url: "https://github.com/RongleCat/grok-app/pull/359",
    author: { login: "sonnemusk", name: "sonnemusk", is_bot: false },
    baseRefName: "main",
    headRefName: "feat/partial-stream",
    isDraft: false,
    mergeable: "UNKNOWN",
    state: "OPEN",
    createdAt: "2026-07-31T02:21:34Z",
    updatedAt: "2026-07-31T02:53:59Z",
    statusCheckRollup: [
      {
        __typename: "CheckRun",
        name: "frontend",
        status: "COMPLETED",
        conclusion: "SUCCESS",
      },
      {
        __typename: "CheckRun",
        name: "Rust macOS",
        status: "COMPLETED",
        conclusion: "SUCCESS",
      },
      {
        __typename: "CheckRun",
        name: "Rust Windows",
        status: "IN_PROGRESS",
        conclusion: null,
      },
    ],
  },
  {
    number: 1,
    title: "Draft example",
    url: "https://github.com/example/repo/pull/1",
    author: { login: "alice" },
    isDraft: true,
    mergeable: "CONFLICTING",
    state: "OPEN",
    headRefName: "fix/x",
    baseRefName: "main",
    statusCheckRollup: [
      { conclusion: "FAILURE", status: "COMPLETED", name: "ci" },
    ],
  },
]);

const SAMPLE_CHECKS = JSON.stringify([
  {
    bucket: "pass",
    link: "https://github.com/RongleCat/grok-app/actions/1",
    name: "frontend",
    state: "SUCCESS",
    workflow: "ci",
    description: "",
  },
  {
    bucket: "fail",
    name: "Rust Windows",
    state: "FAILURE",
    workflow: "ci",
  },
  {
    bucket: "pending",
    name: "Rust Linux",
    state: "PENDING",
  },
]);

describe("bucketFromCheckFields", () => {
  it("prefers explicit bucket", () => {
    expect(bucketFromCheckFields({ bucket: "pass", state: "FAILURE" })).toBe(
      "pass",
    );
  });

  it("maps conclusions", () => {
    expect(bucketFromCheckFields({ conclusion: "SUCCESS" })).toBe("pass");
    expect(bucketFromCheckFields({ conclusion: "FAILURE" })).toBe("fail");
    expect(bucketFromCheckFields({ conclusion: "CANCELLED" })).toBe("cancel");
    expect(bucketFromCheckFields({ conclusion: "SKIPPED" })).toBe("skipping");
    expect(bucketFromCheckFields({ conclusion: "TIMED_OUT" })).toBe("fail");
  });

  it("maps in-progress status to pending", () => {
    expect(
      bucketFromCheckFields({ status: "IN_PROGRESS", conclusion: null }),
    ).toBe("pending");
  });
});

describe("summarizeStatusCheckRollup", () => {
  it("counts success + pending", () => {
    const list = parseGhPrListJson(SAMPLE_LIST);
    expect(list).toHaveLength(2);
    const s = list[0]!.checks!;
    expect(s.pass).toBe(2);
    expect(s.pending).toBe(1);
    expect(s.total).toBe(3);
    expect(s.overall).toBe("pending");
  });

  it("empty rollup is none", () => {
    expect(summarizeStatusCheckRollup([])).toEqual({
      pass: 0,
      fail: 0,
      pending: 0,
      skipping: 0,
      cancel: 0,
      total: 0,
      overall: "none",
    });
    expect(summarizeStatusCheckRollup(null)).toMatchObject({ overall: "none" });
  });

  it("fail wins over pass", () => {
    const s = summarizeStatusCheckRollup([
      { conclusion: "SUCCESS", status: "COMPLETED" },
      { conclusion: "FAILURE", status: "COMPLETED" },
    ]);
    expect(s.overall).toBe("fail");
    expect(s.fail).toBe(1);
    expect(s.pass).toBe(1);
  });
});

describe("parseGhPrListJson", () => {
  it("parses array rows with author + mergeable", () => {
    const list = parseGhPrListJson(SAMPLE_LIST);
    expect(list[0]!.number).toBe(359);
    expect(list[0]!.author).toBe("sonnemusk");
    expect(list[0]!.headRefName).toBe("feat/partial-stream");
    expect(list[0]!.isDraft).toBe(false);
    expect(list[1]!.isDraft).toBe(true);
    expect(normalizeMergeable(list[1]!.mergeable)).toBe("conflicting");
    expect(list[1]!.checks!.overall).toBe("fail");
  });

  it("parses wrapped pullRequests key", () => {
    const list = parseGhPrListJson(
      JSON.stringify({
        pullRequests: [{ number: 7, title: "x", url: "https://x", author: "a" }],
      }),
    );
    expect(list).toHaveLength(1);
    expect(list[0]!.number).toBe(7);
  });

  it("returns empty for blank / invalid", () => {
    expect(parseGhPrListJson("")).toEqual([]);
    expect(parseGhPrListJson("not json")).toEqual([]);
    expect(parseGhPrListJson("[]")).toEqual([]);
  });

  it("tolerates leading log noise", () => {
    const list = parseGhPrListJson(
      "debug: loading\n" +
        JSON.stringify([{ number: 3, title: "t", url: "u", author: "a" }]),
    );
    expect(list).toHaveLength(1);
    expect(list[0]!.number).toBe(3);
  });
});

describe("parseGhPrViewJson", () => {
  it("parses single object + body", () => {
    const pr = parseGhPrViewJson(
      JSON.stringify({
        number: 344,
        title: "feat: ask timeout",
        url: "https://github.com/RongleCat/grok-app/pull/344",
        author: { login: "sonnemusk" },
        isDraft: false,
        mergeable: "MERGEABLE",
        state: "OPEN",
        body: "## Summary\nHello",
        statusCheckRollup: [],
      }),
    );
    expect(pr?.number).toBe(344);
    expect(pr?.body).toContain("Summary");
    expect(normalizeMergeable(pr?.mergeable)).toBe("mergeable");
    expect(pr?.checks?.overall).toBe("none");
  });

  it("returns null for invalid", () => {
    expect(parseGhPrViewJson("")).toBeNull();
    expect(parseGhPrViewJson("{}")).toBeNull();
  });
});

describe("parseGhPrChecksJson", () => {
  it("parses checks with buckets", () => {
    const checks = parseGhPrChecksJson(SAMPLE_CHECKS);
    expect(checks).toHaveLength(3);
    expect(checks[0]!.name).toBe("frontend");
    expect(checks[0]!.bucket).toBe("pass");
    expect(checks[1]!.bucket).toBe("fail");
    expect(checks[2]!.bucket).toBe("pending");
    const s = summarizeChecks(checks);
    expect(s.pass).toBe(1);
    expect(s.fail).toBe(1);
    expect(s.pending).toBe(1);
    expect(s.overall).toBe("fail");
  });

  it("infers bucket from state when missing", () => {
    const c = parseGhPrCheckObject({ name: "x", state: "SUCCESS" });
    expect(c?.bucket).toBe("pass");
  });

  it("returns empty for blank", () => {
    expect(parseGhPrChecksJson("")).toEqual([]);
    expect(parseGhPrChecksJson("[]")).toEqual([]);
  });
});

describe("formatChecksSummaryLine", () => {
  it("joins non-zero buckets", () => {
    expect(
      formatChecksSummaryLine({
        pass: 3,
        fail: 1,
        pending: 0,
        skipping: 0,
        cancel: 0,
        total: 4,
        overall: "fail",
      }),
    ).toBe("3 pass · 1 fail");
  });

  it("empty for no checks", () => {
    expect(formatChecksSummaryLine(null)).toBe("");
    expect(
      formatChecksSummaryLine({
        pass: 0,
        fail: 0,
        pending: 0,
        skipping: 0,
        cancel: 0,
        total: 0,
        overall: "none",
      }),
    ).toBe("");
  });
});

describe("overallFromCounts / summarizeBuckets", () => {
  it("all pass", () => {
    expect(summarizeBuckets(["pass", "pass"]).overall).toBe("pass");
  });

  it("pending without fail", () => {
    expect(overallFromCounts({ pass: 1, fail: 0, pending: 2, cancel: 0, total: 3 })).toBe(
      "pending",
    );
  });
});

describe("normalizeMergeable", () => {
  it("maps gh enum", () => {
    expect(normalizeMergeable("MERGEABLE")).toBe("mergeable");
    expect(normalizeMergeable("CONFLICTING")).toBe("conflicting");
    expect(normalizeMergeable("UNKNOWN")).toBe("unknown");
    expect(normalizeMergeable(null)).toBeNull();
  });
});

describe("classifyPrHubReason", () => {
  it("classifies soft-fail reasons", () => {
    expect(classifyPrHubReason("gh not available")).toBe("no_gh");
    expect(classifyPrHubReason("git not available")).toBe("no_git");
    expect(classifyPrHubReason("not a git repository")).toBe("not_repo");
    expect(classifyPrHubReason("empty path")).toBe("empty_path");
    expect(classifyPrHubReason(null)).toBeNull();
  });
});

describe("parseGhPrObject edge cases", () => {
  it("skips missing number", () => {
    expect(parseGhPrObject({ title: "x" })).toBeNull();
  });

  it("accepts string author", () => {
    const pr = parseGhPrObject({
      number: 9,
      title: "t",
      url: "u",
      author: "bob",
    });
    expect(pr?.author).toBe("bob");
  });
});

const SAMPLE_COMMENTS_VIEW = JSON.stringify({
  number: 344,
  url: "https://github.com/RongleCat/grok-app/pull/344",
  comments: [
    {
      id: "IC_1",
      author: { login: "RongleCat" },
      body: "Thanks — integrated on main via batch land.",
      createdAt: "2026-07-31T02:53:02Z",
      url: "https://github.com/RongleCat/grok-app/pull/344#issuecomment-1",
    },
    {
      id: "IC_2",
      author: { login: "alice" },
      body: "Follow-up: please also cover zh-TW.",
      createdAt: "2026-07-31T04:00:00Z",
      url: "https://github.com/RongleCat/grok-app/pull/344#issuecomment-2",
    },
  ],
  reviews: [
    {
      id: "PRR_1",
      author: { login: "bob" },
      body: "LGTM with a nit on naming.",
      state: "APPROVED",
      submittedAt: "2026-07-31T03:10:00Z",
      url: "https://github.com/RongleCat/grok-app/pull/344#pullrequestreview-1",
    },
    {
      id: "PRR_pending",
      author: { login: "carol" },
      body: "",
      state: "PENDING",
    },
    {
      id: "PRR_2",
      author: { login: "dave" },
      body: "",
      state: "CHANGES_REQUESTED",
      submittedAt: "2026-07-31T01:00:00Z",
      url: "https://github.com/RongleCat/grok-app/pull/344#pullrequestreview-2",
    },
  ],
});

describe("excerptCommentBody", () => {
  it("collapses whitespace and truncates", () => {
    expect(excerptCommentBody("hello\n\n  world")).toBe("hello world");
    expect(excerptCommentBody("abcdefghij", 6)).toMatch(/…$/);
    expect(excerptCommentBody("abcdefghij", 6).length).toBeLessThanOrEqual(6);
    expect(excerptCommentBody("")).toBe("");
    expect(excerptCommentBody(null)).toBe("");
  });
});

describe("parseGhPrCommentObject / parseGhPrReviewObject", () => {
  it("parses issue comment", () => {
    const c = parseGhPrCommentObject({
      id: "IC_9",
      author: { login: "alice" },
      body: "Looks good",
      createdAt: "2026-01-01T00:00:00Z",
      url: "https://example.com/c/9",
    });
    expect(c?.kind).toBe("comment");
    expect(c?.author).toBe("alice");
    expect(c?.excerpt).toBe("Looks good");
    expect(c?.url).toContain("/c/9");
  });

  it("parses review and drops empty PENDING", () => {
    const r = parseGhPrReviewObject({
      id: "PRR_9",
      author: { login: "bob" },
      body: "Needs tests",
      state: "CHANGES_REQUESTED",
      submittedAt: "2026-01-02T00:00:00Z",
    });
    expect(r?.kind).toBe("review");
    expect(r?.state).toBe("CHANGES_REQUESTED");
    expect(
      parseGhPrReviewObject({
        id: "PRR_p",
        author: { login: "x" },
        body: "",
        state: "PENDING",
      }),
    ).toBeNull();
  });

  it("uses state as excerpt when body empty", () => {
    const r = parseGhPrReviewObject({
      id: "PRR_a",
      author: "eve",
      body: "",
      state: "APPROVED",
      submittedAt: "2026-01-03T00:00:00Z",
    });
    expect(r?.excerpt).toBe("APPROVED");
  });
});

describe("parseGhPrCommentsJson", () => {
  it("merges comments + reviews newest first and drops pending", () => {
    const { comments, url, number } = parseGhPrCommentsJson(SAMPLE_COMMENTS_VIEW);
    expect(number).toBe(344);
    expect(url).toBe("https://github.com/RongleCat/grok-app/pull/344");
    // 2 comments + 2 non-pending reviews
    expect(comments).toHaveLength(4);
    expect(comments[0]!.author).toBe("alice"); // 04:00
    expect(comments[0]!.kind).toBe("comment");
    expect(comments[1]!.author).toBe("bob"); // 03:10 review
    expect(comments[1]!.kind).toBe("review");
    expect(comments[2]!.author).toBe("RongleCat"); // 02:53
    expect(comments[3]!.author).toBe("dave"); // 01:00
    expect(comments[3]!.state).toBe("CHANGES_REQUESTED");
  });

  it("accepts bare comments array", () => {
    const { comments } = parseGhPrCommentsJson(
      JSON.stringify([
        {
          id: "1",
          author: "a",
          body: "hi",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ]),
    );
    expect(comments).toHaveLength(1);
    expect(comments[0]!.author).toBe("a");
  });

  it("returns empty for blank / empty object", () => {
    expect(parseGhPrCommentsJson("").comments).toEqual([]);
    expect(
      parseGhPrCommentsJson(
        JSON.stringify({ number: 1, url: "u", comments: [], reviews: [] }),
      ).comments,
    ).toEqual([]);
  });
});

describe("mergePrComments", () => {
  it("dedupes by id and caps", () => {
    const a = parseGhPrCommentObject({
      id: "same",
      author: "a",
      body: "one",
      createdAt: "2026-01-02T00:00:00Z",
    })!;
    const b = parseGhPrCommentObject({
      id: "same",
      author: "a",
      body: "dup",
      createdAt: "2026-01-03T00:00:00Z",
    })!;
    const c = parseGhPrCommentObject({
      id: "other",
      author: "b",
      body: "two",
      createdAt: "2026-01-01T00:00:00Z",
    })!;
    const merged = mergePrComments([a, c], [b], 10);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.id).toBe("same");
    expect(merged[0]!.body).toBe("one"); // first wins
  });
});
