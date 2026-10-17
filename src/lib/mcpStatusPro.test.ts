import { describe, expect, it } from "vitest";
import {
  buildMcpProCopySummary,
  classifyMcpDoctorOpError,
  classifyMcpProStatus,
  countMcpProByStatus,
  filterMcpProRows,
  isMcpProRowDisabled,
  isMcpProSoftFailError,
  mcpProStatusBadgeMod,
  mcpProStatusFromTone,
  mcpProStatusLabelKey,
  MCP_PRO_STATUS_FILTERS,
  redactMcpProDetail,
  resolveMcpProEmptyState,
  type McpProRowLike,
} from "./mcpStatusPro";
import {
  indexDoctorServerStatuses,
  type McpDoctorReportLike,
  type McpServerStatus,
} from "./mcpStatus";

const ROWS: McpProRowLike[] = [
  {
    name: "context7",
    transport: "stdio",
    target: "npx -y @context7/mcp",
    compatibilityStatus: "ok",
  },
  {
    name: "github",
    transport: "http",
    target: "https://api.github.com/mcp",
    compatibilityStatus: "error",
  },
  {
    name: "off-svc",
    transport: "stdio",
    target: "/usr/bin/off",
    enabled: false,
  },
  {
    name: "mystery",
    transport: "stdio",
    target: "/usr/local/bin/mystery-mcp",
  },
];

const DOCTOR_FIXTURE: McpDoctorReportLike = {
  ok: false,
  servers: [
    {
      name: "context7",
      healthy: true,
      checks: [{ label: "started", passed: true }],
    },
    {
      name: "github",
      healthy: false,
      checks: [
        {
          label: "handshake",
          passed: false,
          detail: "401 Unauthorized — OAuth authorization required",
        },
      ],
    },
  ],
};

describe("isMcpProRowDisabled / classifyMcpProStatus", () => {
  it("detects disabled via enabled flag and status tokens", () => {
    expect(isMcpProRowDisabled({ enabled: false, name: "x" })).toBe(true);
    expect(isMcpProRowDisabled({ compatibilityStatus: "disabled" })).toBe(
      true,
    );
    expect(isMcpProRowDisabled({ compatibilityStatus: "ok" })).toBe(false);
    expect(isMcpProRowDisabled({ enabled: true })).toBe(false);
  });

  it("classifies ok / error / unknown / disabled from inspect row", () => {
    expect(classifyMcpProStatus(ROWS[0]!)).toBe("ok");
    expect(classifyMcpProStatus(ROWS[1]!)).toBe("error");
    expect(classifyMcpProStatus(ROWS[2]!)).toBe("disabled");
    expect(classifyMcpProStatus(ROWS[3]!)).toBe("unknown");
  });

  it("maps doctor auth tones to oauth (priority over inspect error)", () => {
    const auth: McpServerStatus = {
      name: "github",
      tone: "auth_required",
      reason: "OAuth authorization required",
      needsAuthRefresh: true,
      issues: ["OAuth authorization required"],
      healthy: false,
    };
    expect(classifyMcpProStatus(ROWS[1]!, auth)).toBe("oauth");

    const expired: McpServerStatus = {
      name: "github",
      tone: "auth_expired",
      reason: "token expired",
      needsAuthRefresh: true,
      issues: [],
      healthy: false,
    };
    expect(classifyMcpProStatus(ROWS[1]!, expired)).toBe("oauth");
  });

  it("disabled wins over doctor oauth", () => {
    const auth: McpServerStatus = {
      name: "off-svc",
      tone: "auth_required",
      reason: "auth required",
      needsAuthRefresh: true,
      issues: [],
      healthy: false,
    };
    expect(classifyMcpProStatus(ROWS[2]!, auth)).toBe("disabled");
  });

  it("collapses warn tone into error chip bucket", () => {
    expect(mcpProStatusFromTone("warn")).toBe("error");
    expect(mcpProStatusFromTone("auth_expired")).toBe("oauth");
    expect(
      classifyMcpProStatus({
        name: "slow",
        compatibilityStatus: "warn",
      }),
    ).toBe("error");
  });

  it("detects oauth from free-form compatibility text without doctor", () => {
    expect(
      classifyMcpProStatus({
        name: "remote",
        compatibilityStatus: "OAuth authorization required",
      }),
    ).toBe("oauth");
  });
});

describe("count / filter pro rows", () => {
  it("counts with doctor index for oauth", () => {
    const index = indexDoctorServerStatuses(DOCTOR_FIXTURE);
    const counts = countMcpProByStatus(ROWS, index);
    expect(counts.all).toBe(4);
    expect(counts.ok).toBe(1);
    expect(counts.oauth).toBe(1); // github via doctor
    expect(counts.disabled).toBe(1);
    expect(counts.unknown).toBe(1);
    expect(counts.error).toBe(0);
    expect(MCP_PRO_STATUS_FILTERS).toEqual([
      "all",
      "ok",
      "error",
      "oauth",
      "disabled",
      "unknown",
    ]);
  });

  it("filters by pro status chip and query", () => {
    const index = indexDoctorServerStatuses(DOCTOR_FIXTURE);
    expect(
      filterMcpProRows(ROWS, { status: "oauth" }, index).map((r) => r.name),
    ).toEqual(["github"]);
    expect(
      filterMcpProRows(ROWS, { status: "disabled" }, index).map((r) => r.name),
    ).toEqual(["off-svc"]);
    expect(
      filterMcpProRows(ROWS, { query: "mystery" }, index).map((r) => r.name),
    ).toEqual(["mystery"]);
    expect(
      filterMcpProRows(ROWS, { query: "http", status: "oauth" }, index).map(
        (r) => r.name,
      ),
    ).toEqual(["github"]);
    expect(
      filterMcpProRows(ROWS, { query: "http", status: "ok" }, index),
    ).toHaveLength(0);
  });

  it("never invents rows for empty input", () => {
    expect(filterMcpProRows([], { status: "ok" })).toEqual([]);
    expect(countMcpProByStatus([]).all).toBe(0);
  });
});

describe("label / badge helpers", () => {
  it("maps pro status to i18n keys and badge mods", () => {
    expect(mcpProStatusLabelKey("ok")).toBe("ext.mcp.status.ok");
    expect(mcpProStatusLabelKey("oauth")).toBe("ext.mcp.status.oauth");
    expect(mcpProStatusLabelKey("disabled")).toBe("ext.mcp.status.disabled");
    expect(mcpProStatusBadgeMod("ok")).toBe("ok");
    expect(mcpProStatusBadgeMod("error")).toBe("fail");
    expect(mcpProStatusBadgeMod("oauth")).toBe("auth");
    expect(mcpProStatusBadgeMod("disabled")).toBe("disabled");
    expect(mcpProStatusBadgeMod("unknown")).toBe("muted");
  });
});

describe("resolveMcpProEmptyState", () => {
  it("returns loading when busy and empty", () => {
    const e = resolveMcpProEmptyState({
      loading: true,
      total: 0,
      filtered: 0,
    });
    expect(e?.kind).toBe("loading");
    expect(e?.titleKey).toBe("mcpModal.loading");
  });

  it("returns empty catalog with hint", () => {
    const e = resolveMcpProEmptyState({
      loading: false,
      total: 0,
      filtered: 0,
    });
    expect(e?.kind).toBe("empty");
    expect(e?.titleKey).toBe("mcpModal.empty");
    expect(e?.hintKey).toBe("mcpModal.emptyHint");
  });

  it("returns soft-fail error when CLI missing and list empty", () => {
    const e = resolveMcpProEmptyState({
      loading: false,
      total: 0,
      filtered: 0,
      error: "Grok Build CLI not found",
    });
    expect(e?.kind).toBe("error");
    expect(e?.softFail).toBe(true);
    expect(e?.titleKey).toBe("mcpModal.emptyErrorSoft");
  });

  it("returns hard error presentation for other load failures", () => {
    const e = resolveMcpProEmptyState({
      loading: false,
      total: 0,
      filtered: 0,
      error: "permission denied reading config",
    });
    expect(e?.kind).toBe("error");
    expect(e?.softFail).toBe(false);
  });

  it("returns filter empty with clear CTA", () => {
    const e = resolveMcpProEmptyState({
      loading: false,
      total: 4,
      filtered: 0,
      hasFilters: true,
    });
    expect(e?.kind).toBe("filter_empty");
    expect(e?.showClearFilters).toBe(true);
  });

  it("returns null when rows are visible", () => {
    expect(
      resolveMcpProEmptyState({
        loading: false,
        total: 2,
        filtered: 2,
      }),
    ).toBeNull();
  });
});

describe("classifyMcpDoctorOpError", () => {
  it("soft-fails CLI missing / too old / timeout / host-only", () => {
    expect(classifyMcpDoctorOpError("Grok Build CLI not found").kind).toBe(
      "cli_missing",
    );
    expect(classifyMcpDoctorOpError("Grok Build CLI not found").softFail).toBe(
      true,
    );
    expect(
      classifyMcpDoctorOpError("unrecognized subcommand mcp doctor").kind,
    ).toBe("cli_too_old");
    expect(classifyMcpDoctorOpError("grok mcp doctor timed out").kind).toBe(
      "timeout",
    );
    expect(classifyMcpDoctorOpError("need_tauri").kind).toBe("host_only");
    expect(isMcpProSoftFailError("CLI not found on PATH")).toBe(true);
  });

  it("classifies parse / host / other and redacts secrets in detail", () => {
    const p = classifyMcpDoctorOpError("invalid JSON from doctor");
    expect(p.kind).toBe("parse");
    expect(p.softFail).toBe(false);

    const leak = classifyMcpDoctorOpError(
      "host error API_TOKEN=supersecretvalue123",
    );
    expect(leak.detail).not.toContain("supersecretvalue123");
    expect(leak.detail).toContain("[REDACTED]");
  });
});

describe("buildMcpProCopySummary / redact", () => {
  it("builds a redacted multi-line summary with status tags", () => {
    const index = indexDoctorServerStatuses(DOCTOR_FIXTURE);
    const text = buildMcpProCopySummary(ROWS, index, {
      header: "MCP servers (4)",
    });
    expect(text).toContain("MCP servers (4)");
    expect(text).toContain("context7 [ok]");
    expect(text).toMatch(/github \[oauth\]/);
    expect(text).toContain("off-svc [disabled]");
    expect(text).toContain("mystery [unknown]");
    expect(text).toContain("npx -y @context7/mcp");
  });

  it("redacts secrets in targets and reasons", () => {
    const text = buildMcpProCopySummary([
      {
        name: "leaky",
        target: "https://x?token=abc",
        compatibilityStatus: "API_TOKEN=supersecretvalue123 failed",
      },
    ]);
    expect(text).not.toContain("supersecretvalue123");
    expect(text).toContain("[REDACTED]");
  });

  it("handles empty list honestly", () => {
    expect(buildMcpProCopySummary([])).toContain("(none)");
  });

  it("redactMcpProDetail strips env secrets", () => {
    expect(redactMcpProDetail("GITHUB_TOKEN=ghs_abc123secret")).toContain(
      "[REDACTED]",
    );
    expect(redactMcpProDetail(null)).toBe("");
  });
});
