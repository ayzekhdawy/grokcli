import { describe, expect, it } from "vitest";
import {
  ARCHIVE_AGE_DAY_OPTIONS,
  ARCHIVE_AGE_PREVIEW_LIMIT,
  archiveAgeEmptyMessageKey,
  archiveAgePreviewTitles,
  countSessionsOlderThanDays,
  daysToMs,
  filterSessionsOlderThanDays,
  hasAnyArchiveAgeMatches,
  isSessionOlderThanDays,
  listArchiveAgeOptionPreviews,
  planArchiveOlderThan,
  resolveArchiveAgeEmpty,
} from "./sessionArchiveAge";

const NOW = new Date("2026-07-30T12:00:00.000Z").getTime();

function isoDaysAgo(days: number): string {
  return new Date(NOW - daysToMs(days)).toISOString();
}

describe("ARCHIVE_AGE_DAY_OPTIONS", () => {
  it("offers 7 / 30 / 90 day thresholds", () => {
    expect([...ARCHIVE_AGE_DAY_OPTIONS]).toEqual([7, 30, 90]);
  });
});

describe("daysToMs", () => {
  it("converts whole days to milliseconds", () => {
    expect(daysToMs(1)).toBe(86_400_000);
    expect(daysToMs(7)).toBe(7 * 86_400_000);
  });
});

describe("isSessionOlderThanDays", () => {
  it("is true when updatedAt is strictly older than the threshold", () => {
    expect(isSessionOlderThanDays(isoDaysAgo(8), 7, NOW)).toBe(true);
    expect(isSessionOlderThanDays(isoDaysAgo(7), 7, NOW)).toBe(false);
    expect(isSessionOlderThanDays(isoDaysAgo(6), 7, NOW)).toBe(false);
  });

  it("rejects invalid, empty, or non-positive inputs", () => {
    expect(isSessionOlderThanDays("", 7, NOW)).toBe(false);
    expect(isSessionOlderThanDays(null, 7, NOW)).toBe(false);
    expect(isSessionOlderThanDays("not-a-date", 7, NOW)).toBe(false);
    expect(isSessionOlderThanDays(isoDaysAgo(30), 0, NOW)).toBe(false);
    expect(isSessionOlderThanDays(isoDaysAgo(30), -1, NOW)).toBe(false);
  });
});

describe("filterSessionsOlderThanDays", () => {
  const rows = [
    { id: "fresh", updatedAt: isoDaysAgo(1), archived: false, pinned: false },
    { id: "old7", updatedAt: isoDaysAgo(8), archived: false, pinned: false },
    { id: "old30", updatedAt: isoDaysAgo(31), archived: false, pinned: false },
    { id: "old90", updatedAt: isoDaysAgo(100), archived: false, pinned: false },
    {
      id: "pinned-old",
      updatedAt: isoDaysAgo(100),
      archived: false,
      pinned: true,
    },
    {
      id: "archived-old",
      updatedAt: isoDaysAgo(100),
      archived: true,
      pinned: false,
    },
    {
      id: "bad-date",
      updatedAt: "nope",
      archived: false,
      pinned: false,
    },
  ];

  it("keeps only non-archived, non-pinned sessions older than N days", () => {
    expect(filterSessionsOlderThanDays(rows, 7, NOW).map((s) => s.id)).toEqual([
      "old7",
      "old30",
      "old90",
    ]);
    expect(filterSessionsOlderThanDays(rows, 30, NOW).map((s) => s.id)).toEqual(
      ["old30", "old90"],
    );
    expect(filterSessionsOlderThanDays(rows, 90, NOW).map((s) => s.id)).toEqual(
      ["old90"],
    );
  });

  it("skips pinned and already-archived rows", () => {
    const hits = filterSessionsOlderThanDays(rows, 7, NOW);
    expect(hits.some((s) => s.id === "pinned-old")).toBe(false);
    expect(hits.some((s) => s.id === "archived-old")).toBe(false);
  });

  it("returns empty for non-positive days or empty input", () => {
    expect(filterSessionsOlderThanDays(rows, 0, NOW)).toEqual([]);
    expect(filterSessionsOlderThanDays([], 7, NOW)).toEqual([]);
  });

  it("preserves input order", () => {
    const shuffled = [rows[3], rows[1], rows[2]];
    expect(
      filterSessionsOlderThanDays(shuffled, 7, NOW).map((s) => s.id),
    ).toEqual(["old90", "old7", "old30"]);
  });
});

describe("countSessionsOlderThanDays", () => {
  it("matches filter length", () => {
    const rows = [
      { id: "a", updatedAt: isoDaysAgo(10), archived: false, pinned: false },
      { id: "b", updatedAt: isoDaysAgo(1), archived: false, pinned: false },
    ];
    expect(countSessionsOlderThanDays(rows, 7, NOW)).toBe(1);
    expect(countSessionsOlderThanDays([], 7, NOW)).toBe(0);
  });
});

describe("resolveArchiveAgeEmpty / empty honesty", () => {
  it("returns no_sessions for empty catalog", () => {
    expect(resolveArchiveAgeEmpty([], 7, NOW)).toBe("no_sessions");
  });

  it("returns null when matches exist", () => {
    const rows = [
      { id: "old", updatedAt: isoDaysAgo(10), archived: false, pinned: false },
    ];
    expect(resolveArchiveAgeEmpty(rows, 7, NOW)).toBe(null);
  });

  it("returns none_active when every row is archived", () => {
    const rows = [
      { id: "a", updatedAt: isoDaysAgo(100), archived: true, pinned: false },
      { id: "b", updatedAt: isoDaysAgo(1), archived: true, pinned: false },
    ];
    expect(resolveArchiveAgeEmpty(rows, 7, NOW)).toBe("none_active");
  });

  it("returns all_pinned when older actives are all pinned", () => {
    const rows = [
      { id: "p", updatedAt: isoDaysAgo(40), archived: false, pinned: true },
      { id: "fresh", updatedAt: isoDaysAgo(1), archived: false, pinned: false },
    ];
    expect(resolveArchiveAgeEmpty(rows, 30, NOW)).toBe("all_pinned");
  });

  it("returns all_pinned when every active is pinned (none older unpinned)", () => {
    const rows = [
      { id: "p1", updatedAt: isoDaysAgo(1), archived: false, pinned: true },
      { id: "p2", updatedAt: isoDaysAgo(100), archived: false, pinned: true },
    ];
    expect(resolveArchiveAgeEmpty(rows, 7, NOW)).toBe("all_pinned");
  });

  it("returns all_recent when unpinned actives exist but are within threshold", () => {
    const rows = [
      { id: "a", updatedAt: isoDaysAgo(3), archived: false, pinned: false },
      { id: "b", updatedAt: isoDaysAgo(1), archived: false, pinned: false },
    ];
    expect(resolveArchiveAgeEmpty(rows, 7, NOW)).toBe("all_recent");
  });

  it("maps empty kinds to message keys", () => {
    expect(archiveAgeEmptyMessageKey("no_sessions")).toBe(
      "sidebar.archiveOlderEmpty.no_sessions",
    );
    expect(archiveAgeEmptyMessageKey("none_active")).toBe(
      "sidebar.archiveOlderEmpty.none_active",
    );
    expect(archiveAgeEmptyMessageKey("all_pinned")).toBe(
      "sidebar.archiveOlderEmpty.all_pinned",
    );
    expect(archiveAgeEmptyMessageKey("all_recent")).toBe(
      "sidebar.archiveOlderEmpty.all_recent",
    );
  });
});

describe("archiveAgePreviewTitles", () => {
  it("trims titles and reports more beyond limit", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `id-${i}`,
      title: `  Chat ${i}  `,
    }));
    const { titles, more } = archiveAgePreviewTitles(rows, 3);
    expect(titles).toEqual(["Chat 0", "Chat 1", "Chat 2"]);
    expect(more).toBe(7);
  });

  it("keeps empty titles as empty strings (UI falls back to untitled)", () => {
    const { titles, more } = archiveAgePreviewTitles(
      [
        { id: "a", title: "  " },
        { id: "b", title: null },
        { id: "c", title: "Hi" },
      ],
      8,
    );
    expect(titles).toEqual(["", "", "Hi"]);
    expect(more).toBe(0);
  });

  it("defaults to ARCHIVE_AGE_PREVIEW_LIMIT", () => {
    const rows = Array.from({ length: ARCHIVE_AGE_PREVIEW_LIMIT + 2 }, (_, i) => ({
      id: `id-${i}`,
      title: `T${i}`,
    }));
    const { titles, more } = archiveAgePreviewTitles(rows);
    expect(titles).toHaveLength(ARCHIVE_AGE_PREVIEW_LIMIT);
    expect(more).toBe(2);
  });
});

describe("planArchiveOlderThan", () => {
  const rows = [
    {
      id: "old",
      title: "Old chat",
      updatedAt: isoDaysAgo(40),
      archived: false,
      pinned: false,
    },
    {
      id: "fresh",
      title: "Fresh",
      updatedAt: isoDaysAgo(1),
      archived: false,
      pinned: false,
    },
    {
      id: "pin",
      title: "Pinned old",
      updatedAt: isoDaysAgo(40),
      archived: false,
      pinned: true,
    },
  ];

  it("plans confirm when matches exist", () => {
    const plan = planArchiveOlderThan(rows, 30, NOW);
    expect(plan.confirmNeeded).toBe(true);
    expect(plan.count).toBe(1);
    expect(plan.sessions.map((s) => s.id)).toEqual(["old"]);
    expect(plan.emptyKind).toBe(null);
    expect(plan.previewTitles).toEqual(["Old chat"]);
    expect(plan.previewMore).toBe(0);
    expect(plan.logMeta).toEqual({
      days: 30,
      count: 1,
      ids: ["old"],
    });
  });

  it("does not confirm when empty; sets honest emptyKind", () => {
    const onlyFresh = [
      {
        id: "f",
        title: "F",
        updatedAt: isoDaysAgo(1),
        archived: false,
        pinned: false,
      },
    ];
    const plan = planArchiveOlderThan(onlyFresh, 7, NOW);
    expect(plan.confirmNeeded).toBe(false);
    expect(plan.count).toBe(0);
    expect(plan.emptyKind).toBe("all_recent");
    expect(plan.logMeta).toBe(null);
    expect(plan.previewTitles).toEqual([]);
  });

  it("never invents logMeta ids for empty plan", () => {
    const plan = planArchiveOlderThan([], 7, NOW);
    expect(plan.emptyKind).toBe("no_sessions");
    expect(plan.logMeta).toBe(null);
  });
});

describe("listArchiveAgeOptionPreviews / hasAnyArchiveAgeMatches", () => {
  it("lists counts for 7 / 30 / 90", () => {
    const rows = [
      { id: "a", updatedAt: isoDaysAgo(10), archived: false, pinned: false },
      { id: "b", updatedAt: isoDaysAgo(40), archived: false, pinned: false },
      { id: "c", updatedAt: isoDaysAgo(100), archived: false, pinned: false },
    ];
    const previews = listArchiveAgeOptionPreviews(rows, NOW);
    expect(previews.map((p) => p.days)).toEqual([7, 30, 90]);
    expect(previews.map((p) => p.count)).toEqual([3, 2, 1]);
    expect(previews.every((p) => p.emptyKind === null)).toBe(true);
    expect(hasAnyArchiveAgeMatches(rows, NOW)).toBe(true);
  });

  it("sets emptyKind per threshold when zero matches", () => {
    const rows = [
      { id: "f", updatedAt: isoDaysAgo(1), archived: false, pinned: false },
    ];
    const previews = listArchiveAgeOptionPreviews(rows, NOW);
    expect(previews.every((p) => p.count === 0)).toBe(true);
    expect(previews.every((p) => p.emptyKind === "all_recent")).toBe(true);
    expect(hasAnyArchiveAgeMatches(rows, NOW)).toBe(false);
  });

  it("returns false for empty catalog", () => {
    expect(hasAnyArchiveAgeMatches([], NOW)).toBe(false);
  });
});
