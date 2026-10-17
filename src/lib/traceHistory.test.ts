import { describe, expect, it } from "vitest";
import {
  TRACE_HISTORY_MAX,
  clearTraceHistory,
  clearTraceHistoryEntries,
  filterTraceHistory,
  formatTraceHistorySize,
  loadTraceHistory,
  parseTraceExportUploadedFlag,
  parseTraceHistory,
  parseTraceHistoryEntry,
  parseTraceHistorySizeBytes,
  parseTraceHistoryUploaded,
  pushTraceHistory,
  recordTraceExport,
  removeTraceHistory,
  removeTraceHistoryEntry,
  saveTraceHistory,
  traceHistoryFileName,
  traceHistoryLabel,
  type TraceHistoryEntry,
  type TraceHistoryStorage,
} from "./traceHistory";

function memStorage(seed?: Record<string, string>): TraceHistoryStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

const sample = (
  n: number,
  overrides?: Partial<TraceHistoryEntry>,
): TraceHistoryEntry => ({
  sessionId: `sess-${n}`,
  path: `/tmp/traces/trace-${n}.tar.gz`,
  exportedAt: new Date(1_700_000_000_000 + n * 1000).toISOString(),
  title: `Chat ${n}`,
  ...overrides,
});

describe("parseTraceHistoryEntry", () => {
  it("accepts valid entries and trims fields", () => {
    expect(
      parseTraceHistoryEntry({
        sessionId: "  abc  ",
        path: "  /tmp/a.tar.gz  ",
        title: "  Hello  ",
        exportedAt: "2026-01-01T00:00:00.000Z",
        secret: "should-drop",
      }),
    ).toEqual({
      sessionId: "abc",
      path: "/tmp/a.tar.gz",
      title: "Hello",
      exportedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("accepts optional sizeBytes and drops invalid sizes", () => {
    expect(
      parseTraceHistoryEntry({
        sessionId: "s",
        path: "/p",
        sizeBytes: 4096,
      }),
    ).toMatchObject({ sizeBytes: 4096 });
    expect(
      parseTraceHistoryEntry({
        sessionId: "s",
        path: "/p",
        size_bytes: "2048",
      }),
    ).toMatchObject({ sizeBytes: 2048 });
    expect(
      parseTraceHistoryEntry({
        sessionId: "s",
        path: "/p",
        sizeBytes: -1,
      }),
    ).not.toHaveProperty("sizeBytes");
    expect(
      parseTraceHistoryEntry({
        sessionId: "s",
        path: "/p",
        sizeBytes: Number.NaN,
      }),
    ).not.toHaveProperty("sizeBytes");
  });

  it("keeps uploaded=true only (paths still; no secrets)", () => {
    expect(
      parseTraceHistoryEntry({
        sessionId: "s",
        path: "/p",
        uploaded: true,
        remote_url: "https://evil.example/secret",
      }),
    ).toEqual({
      sessionId: "s",
      path: "/p",
      exportedAt: new Date(0).toISOString(),
      uploaded: true,
    });
    expect(
      parseTraceHistoryEntry({
        sessionId: "s",
        path: "/p",
        uploaded: false,
      }),
    ).not.toHaveProperty("uploaded");
  });

  it("rejects missing sessionId or path", () => {
    expect(parseTraceHistoryEntry({ path: "/x" })).toBeNull();
    expect(parseTraceHistoryEntry({ sessionId: "s" })).toBeNull();
    expect(parseTraceHistoryEntry(null)).toBeNull();
    expect(parseTraceHistoryEntry("nope")).toBeNull();
  });

  it("caps title length and omits empty title", () => {
    const long = "x".repeat(500);
    const e = parseTraceHistoryEntry({
      sessionId: "s",
      path: "/p",
      title: long,
    });
    expect(e?.title?.length).toBe(200);
    const emptyTitle = parseTraceHistoryEntry({
      sessionId: "s",
      path: "/p",
      title: "  ",
    });
    expect(emptyTitle).toMatchObject({ sessionId: "s", path: "/p" });
    expect(emptyTitle).not.toHaveProperty("title");
  });
});

describe("parseTraceHistory", () => {
  it("parses JSON string and array, newest-first order preserved", () => {
    const a = sample(1);
    const b = sample(2);
    expect(parseTraceHistory(JSON.stringify([a, b]))).toEqual([a, b]);
    expect(parseTraceHistory([a, b])).toEqual([a, b]);
  });

  it("returns empty on corrupt input", () => {
    expect(parseTraceHistory("{not json")).toEqual([]);
    expect(parseTraceHistory(42)).toEqual([]);
    expect(parseTraceHistory(undefined)).toEqual([]);
  });

  it("dedupes by path keeping first occurrence", () => {
    const a = sample(1, { path: "/same.tar.gz", title: "first" });
    const b = sample(2, { path: "/same.tar.gz", title: "second" });
    expect(parseTraceHistory([a, b])).toEqual([a]);
  });

  it("caps at max", () => {
    const many = Array.from({ length: 30 }, (_, i) => sample(i));
    expect(parseTraceHistory(many, 5)).toHaveLength(5);
    expect(parseTraceHistory(many).length).toBeLessThanOrEqual(
      TRACE_HISTORY_MAX,
    );
  });
});

describe("pushTraceHistory (ring buffer)", () => {
  it("prepends newest and trims to max", () => {
    const existing = Array.from({ length: 3 }, (_, i) => sample(i));
    const next = pushTraceHistory(existing, sample(99), 3);
    expect(next).toHaveLength(3);
    expect(next[0]!.sessionId).toBe("sess-99");
    expect(next.map((e) => e.sessionId)).toEqual([
      "sess-99",
      "sess-0",
      "sess-1",
    ]);
  });

  it("moves existing path to front (dedupe)", () => {
    const a = sample(1, { path: "/a.tar.gz" });
    const b = sample(2, { path: "/b.tar.gz" });
    const again = sample(3, { path: "/a.tar.gz", title: "updated" });
    const next = pushTraceHistory([a, b], again, 20);
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ path: "/a.tar.gz", title: "updated" });
    expect(next[1]!.path).toBe("/b.tar.gz");
  });

  it("ignores invalid entry", () => {
    const existing = [sample(1)];
    expect(
      pushTraceHistory(existing, {
        sessionId: "",
        path: "",
        exportedAt: "",
      }),
    ).toEqual(existing);
  });

  it("enforces default max of 20", () => {
    let list: TraceHistoryEntry[] = [];
    for (let i = 0; i < 25; i++) {
      list = pushTraceHistory(list, sample(i));
    }
    expect(list).toHaveLength(TRACE_HISTORY_MAX);
    expect(list[0]!.sessionId).toBe("sess-24");
    expect(list[list.length - 1]!.sessionId).toBe("sess-5");
  });
});

describe("remove / clear / filter", () => {
  it("removeTraceHistoryEntry by path string", () => {
    const a = sample(1, { path: "/a.tar.gz" });
    const b = sample(2, { path: "/b.tar.gz" });
    expect(removeTraceHistoryEntry([a, b], "/a.tar.gz")).toEqual([b]);
    expect(removeTraceHistoryEntry([a, b], "  /b.tar.gz  ")).toEqual([a]);
    expect(removeTraceHistoryEntry([a, b], "/missing")).toEqual([a, b]);
  });

  it("removeTraceHistoryEntry by path or sessionId object", () => {
    const a = sample(1, { path: "/a.tar.gz", sessionId: "sess-a" });
    const b = sample(2, { path: "/b.tar.gz", sessionId: "sess-a" });
    const c = sample(3, { path: "/c.tar.gz", sessionId: "sess-c" });
    expect(removeTraceHistoryEntry([a, b, c], { path: "/b.tar.gz" })).toEqual([
      a,
      c,
    ]);
    expect(
      removeTraceHistoryEntry([a, b, c], { sessionId: "sess-a" }),
    ).toEqual([c]);
  });

  it("clearTraceHistoryEntries returns empty", () => {
    expect(clearTraceHistoryEntries()).toEqual([]);
  });

  it("filterTraceHistory matches title and path (case-insensitive)", () => {
    const a = sample(1, {
      title: "Refactor login",
      path: "/tmp/traces/login.tar.gz",
    });
    const b = sample(2, {
      title: "Other",
      path: "/tmp/traces/other.tar.gz",
    });
    const list = [a, b];
    expect(filterTraceHistory(list, "")).toEqual(list);
    expect(filterTraceHistory(list, "  ")).toEqual(list);
    expect(filterTraceHistory(list, "LOGIN")).toEqual([a]);
    expect(filterTraceHistory(list, "other.tar")).toEqual([b]);
    expect(filterTraceHistory(list, "refactor")).toEqual([a]);
    expect(filterTraceHistory(list, "xyz")).toEqual([]);
  });

  it("removeTraceHistory / clearTraceHistory persist", () => {
    const storage = memStorage();
    saveTraceHistory([sample(1), sample(2)], storage);
    const afterRemove = removeTraceHistory(sample(1).path, storage);
    expect(afterRemove).toHaveLength(1);
    expect(afterRemove[0]!.path).toBe(sample(2).path);
    expect(loadTraceHistory(storage)).toHaveLength(1);
    expect(clearTraceHistory(storage)).toEqual([]);
    expect(loadTraceHistory(storage)).toEqual([]);
  });
});

describe("load / save / recordTraceExport", () => {
  it("round-trips via storage", () => {
    const storage = memStorage();
    const entries = [sample(1), sample(2)];
    saveTraceHistory(entries, storage);
    expect(loadTraceHistory(storage)).toEqual(entries);
  });

  it("recordTraceExport prepends and persists", () => {
    const storage = memStorage();
    saveTraceHistory([sample(1)], storage);
    const next = recordTraceExport(
      {
        sessionId: "sess-new",
        path: "/tmp/new.tar.gz",
        title: "New chat",
        sizeBytes: 12_345,
      },
      storage,
    );
    expect(next[0]).toMatchObject({
      sessionId: "sess-new",
      path: "/tmp/new.tar.gz",
      title: "New chat",
      sizeBytes: 12_345,
    });
    expect(next).toHaveLength(2);
    expect(loadTraceHistory(storage)[0]!.path).toBe("/tmp/new.tar.gz");
  });

  it("recordTraceExport can note uploaded=true without URLs", () => {
    const storage = memStorage();
    const next = recordTraceExport(
      {
        sessionId: "sess-up",
        path: "/tmp/up.tar.gz",
        uploaded: true,
      },
      storage,
    );
    expect(next[0]).toMatchObject({
      sessionId: "sess-up",
      path: "/tmp/up.tar.gz",
      uploaded: true,
    });
    expect(JSON.stringify(next[0])).not.toMatch(/https?:\/\//);
  });

  it("load returns empty when storage throws or missing", () => {
    expect(loadTraceHistory(memStorage())).toEqual([]);
    const bad: TraceHistoryStorage = {
      getItem: () => {
        throw new Error("quota");
      },
      setItem: () => {},
    };
    expect(loadTraceHistory(bad)).toEqual([]);
  });
});

describe("display helpers", () => {
  it("traceHistoryFileName handles posix and windows", () => {
    expect(traceHistoryFileName("/tmp/foo/bar.tar.gz")).toBe("bar.tar.gz");
    expect(traceHistoryFileName("C:\\Users\\a\\x.tar.gz")).toBe("x.tar.gz");
    expect(traceHistoryFileName("plain.tar.gz")).toBe("plain.tar.gz");
    expect(traceHistoryFileName("")).toBe("");
  });

  it("traceHistoryLabel prefers title then short id", () => {
    expect(
      traceHistoryLabel({
        sessionId: "abcdefghijklmnop",
        path: "/p",
        exportedAt: "",
        title: "My chat",
      }),
    ).toBe("My chat");
    expect(
      traceHistoryLabel({
        sessionId: "abcdefghijklmnop",
        path: "/p",
        exportedAt: "",
      }),
    ).toBe("abcdefgh…");
    expect(
      traceHistoryLabel({
        sessionId: "short",
        path: "/p",
        exportedAt: "",
      }),
    ).toBe("short");
  });

  it("formatTraceHistorySize / parseTraceHistorySizeBytes", () => {
    expect(formatTraceHistorySize(undefined)).toBeNull();
    expect(formatTraceHistorySize(null)).toBeNull();
    expect(formatTraceHistorySize(-1)).toBeNull();
    expect(formatTraceHistorySize(500)).toBe("500 B");
    expect(formatTraceHistorySize(2048)).toBe("2.0 KB");
    expect(formatTraceHistorySize(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(parseTraceHistorySizeBytes(100)).toBe(100);
    expect(parseTraceHistorySizeBytes("99.7")).toBe(99);
    expect(parseTraceHistorySizeBytes(-3)).toBeUndefined();
  });
});

describe("parseTraceExportUploadedFlag / parseTraceHistoryUploaded", () => {
  it("parseTraceHistoryUploaded coerces common truthy forms", () => {
    expect(parseTraceHistoryUploaded(true)).toBe(true);
    expect(parseTraceHistoryUploaded(false)).toBe(false);
    expect(parseTraceHistoryUploaded("true")).toBe(true);
    expect(parseTraceHistoryUploaded("no")).toBe(false);
    expect(parseTraceHistoryUploaded(undefined)).toBeUndefined();
  });

  it("detects host result uploaded flag", () => {
    expect(
      parseTraceExportUploadedFlag({
        ok: true,
        path: "/tmp/a.tar.gz",
        uploaded: true,
      }),
    ).toBe(true);
    expect(
      parseTraceExportUploadedFlag({
        ok: true,
        path: "/tmp/a.tar.gz",
        localOnly: true,
      }),
    ).toBe(false);
  });

  it("detects CLI-style remote info without requiring secrets", () => {
    expect(
      parseTraceExportUploadedFlag({
        session_id: "abc",
        status: "exported",
        local_path: "/tmp/x.tar.gz",
      }),
    ).toBe(false);
    expect(
      parseTraceExportUploadedFlag({
        session_id: "abc",
        status: "uploaded",
        local_path: "/tmp/x.tar.gz",
      }),
    ).toBe(true);
    expect(
      parseTraceExportUploadedFlag({
        local_path: "/tmp/x.tar.gz",
        remote_url: "https://example.invalid/t",
      }),
    ).toBe(true);
    expect(parseTraceExportUploadedFlag(null)).toBe(false);
  });
});
