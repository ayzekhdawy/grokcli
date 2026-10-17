import { describe, expect, it } from "vitest";
import {
  auditLedgerEventKey,
  auditLedgerExportFilterActive,
  auditLedgerTsMs,
  filterAuditLedger,
  formatAuditLedgerRow,
  normalizeAuditLedgerLimit,
  normalizeAuditRetentionDays,
  parseAuditLedgerBoundMs,
  parseAuditLedgerEntry,
  parseAuditLedgerList,
  pruneAuditLedgerEntries,
  serializeAuditLedgerJsonl,
  toAuditLedgerExportFilter,
  AUDIT_LEDGER_DEFAULT_LIMIT,
  AUDIT_LEDGER_MAX_LIMIT,
  AUDIT_LEDGER_RETENTION_UNLIMITED,
  AUDIT_LEDGER_SUMMARY_MAX,
  type AuditLedgerEntry,
} from "./auditLedger";

const sample: AuditLedgerEntry = {
  ts: "2026-07-31T12:00:00.000Z",
  sessionId: "sess-1",
  projectPath: "/tmp/proj",
  toolName: "bash",
  event: "tool_end",
  outcome: "ok",
  summary: "echo hi",
};

describe("normalizeAuditLedgerLimit", () => {
  it("defaults and clamps", () => {
    expect(normalizeAuditLedgerLimit(undefined)).toBe(AUDIT_LEDGER_DEFAULT_LIMIT);
    expect(normalizeAuditLedgerLimit(0)).toBe(1);
    expect(normalizeAuditLedgerLimit(50)).toBe(50);
    expect(normalizeAuditLedgerLimit(99_999)).toBe(AUDIT_LEDGER_MAX_LIMIT);
  });
});

describe("parseAuditLedgerEntry", () => {
  it("accepts camelCase host rows", () => {
    const e = parseAuditLedgerEntry({
      ts: "2026-01-01T00:00:00.000Z",
      sessionId: "s1",
      toolName: "read_file",
      event: "permission",
      permission: "allow_once",
      summary: "src/main.rs",
    });
    expect(e).toEqual({
      ts: "2026-01-01T00:00:00.000Z",
      sessionId: "s1",
      toolName: "read_file",
      event: "permission",
      permission: "allow_once",
      summary: "src/main.rs",
    });
  });

  it("accepts snake_case aliases", () => {
    const e = parseAuditLedgerEntry({
      ts: "t",
      session_id: "s",
      tool_name: "write",
      event: "tool_start",
      project_path: "/p",
    });
    expect(e?.sessionId).toBe("s");
    expect(e?.toolName).toBe("write");
    expect(e?.projectPath).toBe("/p");
  });

  it("rejects unknown events and empty junk", () => {
    expect(parseAuditLedgerEntry(null)).toBeNull();
    expect(parseAuditLedgerEntry({ event: "hack", toolName: "x" })).toBeNull();
    expect(parseAuditLedgerEntry({ toolName: "x" })).toBeNull();
  });

  it("caps summary length", () => {
    const long = "x".repeat(AUDIT_LEDGER_SUMMARY_MAX + 80);
    const e = parseAuditLedgerEntry({
      ts: "t",
      toolName: "bash",
      event: "tool_end",
      outcome: "ok",
      summary: long,
    });
    expect(e?.summary?.length).toBe(AUDIT_LEDGER_SUMMARY_MAX);
  });
});

describe("parseAuditLedgerList", () => {
  it("parses array newest-first order preserved", () => {
    const list = parseAuditLedgerList([
      { ...sample, ts: "2026-07-31T13:00:00.000Z", toolName: "a" },
      { ...sample, ts: "2026-07-31T12:00:00.000Z", toolName: "b" },
    ]);
    expect(list.map((e) => e.toolName)).toEqual(["a", "b"]);
  });

  it("parses JSONL oldest-first into newest-first", () => {
    const jsonl = [
      JSON.stringify({ ...sample, toolName: "old", ts: "2026-01-01T00:00:00.000Z" }),
      JSON.stringify({ ...sample, toolName: "new", ts: "2026-01-02T00:00:00.000Z" }),
    ].join("\n");
    const list = parseAuditLedgerList(jsonl);
    expect(list.map((e) => e.toolName)).toEqual(["new", "old"]);
  });

  it("tolerates corrupt lines", () => {
    const jsonl = 'not-json\n{"ts":"t","toolName":"ok","event":"tool_start"}\n';
    const list = parseAuditLedgerList(jsonl);
    expect(list).toHaveLength(1);
    expect(list[0]?.toolName).toBe("ok");
  });
});

describe("filterAuditLedger", () => {
  const rows: AuditLedgerEntry[] = [
    sample,
    {
      ts: "2026-07-31T11:00:00.000Z",
      toolName: "read_file",
      event: "permission",
      permission: "deny",
      sessionId: "sess-2",
      summary: "secrets.env",
    },
    {
      ts: "2026-07-31T10:00:00.000Z",
      toolName: "bash",
      event: "tool_start",
      sessionId: "sess-1",
    },
  ];

  it("filters by event", () => {
    expect(filterAuditLedger(rows, { event: "permission" })).toHaveLength(1);
    expect(filterAuditLedger(rows, { event: "all" })).toHaveLength(3);
  });

  it("filters by query substring", () => {
    expect(filterAuditLedger(rows, { query: "deny" })).toHaveLength(1);
    expect(filterAuditLedger(rows, { query: "bash" })).toHaveLength(2);
    expect(filterAuditLedger(rows, { query: "nope" })).toHaveLength(0);
  });

  it("filters by sessionId exact", () => {
    expect(filterAuditLedger(rows, { sessionId: "sess-1" })).toHaveLength(2);
  });

  it("filters by date range (date-only inclusive)", () => {
    const dated: AuditLedgerEntry[] = [
      { ...sample, ts: "2026-07-01T12:00:00.000Z", toolName: "old" },
      { ...sample, ts: "2026-07-15T12:00:00.000Z", toolName: "mid" },
      { ...sample, ts: "2026-07-30T12:00:00.000Z", toolName: "new" },
    ];
    const mid = filterAuditLedger(dated, {
      fromTs: "2026-07-10",
      toTs: "2026-07-20",
    });
    expect(mid.map((e) => e.toolName)).toEqual(["mid"]);
  });
});

describe("retention helpers", () => {
  it("normalizes retention presets", () => {
    expect(normalizeAuditRetentionDays(7)).toBe(7);
    expect(normalizeAuditRetentionDays(30)).toBe(30);
    expect(normalizeAuditRetentionDays(90)).toBe(90);
    expect(normalizeAuditRetentionDays(0)).toBe(AUDIT_LEDGER_RETENTION_UNLIMITED);
    expect(normalizeAuditRetentionDays(14)).toBe(AUDIT_LEDGER_RETENTION_UNLIMITED);
    expect(normalizeAuditRetentionDays("nope")).toBe(
      AUDIT_LEDGER_RETENTION_UNLIMITED,
    );
  });

  it("prunes entries older than retention window", () => {
    const now = Date.parse("2026-07-31T12:00:00.000Z");
    const rows: AuditLedgerEntry[] = [
      { ...sample, ts: "2026-06-01T12:00:00.000Z", toolName: "old" },
      { ...sample, ts: "2026-07-28T12:00:00.000Z", toolName: "young" },
    ];
    const kept = pruneAuditLedgerEntries(rows, 30, now);
    expect(kept.map((e) => e.toolName)).toEqual(["young"]);
    expect(pruneAuditLedgerEntries(rows, 0, now)).toHaveLength(2);
  });

  it("parses date bounds", () => {
    expect(parseAuditLedgerBoundMs("2026-07-15", false)).toBe(
      Date.parse("2026-07-15T00:00:00.000Z"),
    );
    const end = parseAuditLedgerBoundMs("2026-07-15", true);
    expect(end).toBe(Date.parse("2026-07-15T00:00:00.000Z") + 86_400_000 - 1);
  });

  it("builds host export filter", () => {
    const f = toAuditLedgerExportFilter({
      event: "permission",
      sessionId: " s1 ",
      fromTs: "2026-07-01",
      toTs: "2026-07-31",
    });
    expect(f).toEqual({
      event: "permission",
      sessionId: "s1",
      fromTs: "2026-07-01",
      toTs: "2026-07-31",
    });
    expect(auditLedgerExportFilterActive(f)).toBe(true);
    expect(auditLedgerExportFilterActive({})).toBe(false);
  });
});

describe("format + serialize + keys", () => {
  it("formats a readable row", () => {
    expect(formatAuditLedgerRow(sample)).toContain("bash");
    expect(formatAuditLedgerRow(sample)).toContain("ok");
  });

  it("serializes chronological JSONL", () => {
    const a = { ...sample, ts: "2026-01-02T00:00:00.000Z", toolName: "new" };
    const b = { ...sample, ts: "2026-01-01T00:00:00.000Z", toolName: "old" };
    const out = serializeAuditLedgerJsonl([a, b]);
    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).toolName).toBe("old");
    expect(JSON.parse(lines[1]!).toolName).toBe("new");
  });

  it("maps event keys", () => {
    expect(auditLedgerEventKey("permission")).toBe(
      "reliability.audit.event.permission",
    );
    expect(auditLedgerEventKey("tool_start")).toBe(
      "reliability.audit.event.toolStart",
    );
    expect(auditLedgerEventKey("tool_end")).toBe(
      "reliability.audit.event.toolEnd",
    );
  });

  it("parses ts to ms", () => {
    expect(auditLedgerTsMs(sample)).toBeGreaterThan(0);
    expect(auditLedgerTsMs({ ...sample, ts: "not-a-date" })).toBe(0);
  });
});
