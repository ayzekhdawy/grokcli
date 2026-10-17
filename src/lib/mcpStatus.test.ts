import { describe, expect, it } from "vitest";
import {
  classifyMcpRowHealth,
  countMcpRowsByHealth,
  countMcpDoctorFindings,
  detectAuthToneFromText,
  filterMcpRows,
  filterMcpDoctorFindings,
  indexDoctorServerStatuses,
  inferMcpStatusTone,
  lookupServerStatus,
  mapIssuesToServers,
  matchMcpRowQuery,
  mcpAuthGuidanceKey,
  mcpRowCopyText,
  mcpRowHealthFromTone,
  mcpDoctorFindingTone,
  mcpStatusBadgeMod,
  mcpStatusLabelKey,
  MCP_ROW_STATUS_FILTERS,
  normalizeMcpDoctorFindings,
  redactMcpText,
  statusFromDoctorServer,
  type McpDoctorReportLike,
  type McpRowLike,
} from "./mcpStatus";

/** Fixture shaped like host `mcp_doctor` / `grok mcp doctor --json`. */
const DOCTOR_FIXTURE: McpDoctorReportLike = {
  ok: false,
  summary: { total: 3, healthy: 1, unhealthy: 2 },
  sources: [
    { path: "~/.grok/config.toml", status: "found", serverCount: 3 },
  ],
  servers: [
    {
      name: "context7",
      transport: "stdio",
      target: "npx",
      healthy: true,
      checks: [
        { label: "server started", passed: true, detail: "1.2s" },
      ],
    },
    {
      name: "github",
      transport: "http",
      target: "https://api.github.com/mcp",
      healthy: false,
      checks: [
        {
          label: "handshake",
          passed: false,
          detail: "401 Unauthorized — token expired",
          hint: "re-authenticate the MCP server",
        },
      ],
    },
    {
      name: "broken",
      transport: "http",
      target: "https://example.com",
      healthy: false,
      checks: [
        {
          label: "handshake failed",
          passed: false,
          detail: "connection refused",
          hint: "check remote URL",
        },
      ],
    },
  ],
  issues: [
    {
      server: "github",
      message: "OAuth token expired for github",
    },
    {
      name: "orphan-svc",
      message: "auth required before use",
    },
    "generic warning about slow startup",
  ],
};

describe("redactMcpText", () => {
  it("redacts env-style secrets and bearer tokens", () => {
    const raw =
      "failed with GITHUB_TOKEN=ghs_abc123secret and Bearer abcdefghijklmnop";
    const out = redactMcpText(raw);
    expect(out).not.toContain("ghs_abc123secret");
    expect(out).not.toMatch(/Bearer\s+abcdef/i);
    expect(out).toContain("[REDACTED]");
    expect(out).toContain("GITHUB_TOKEN=");
  });

  it("returns empty for nullish", () => {
    expect(redactMcpText(null)).toBe("");
    expect(redactMcpText(undefined)).toBe("");
  });
});

describe("detectAuthToneFromText", () => {
  it("detects expired", () => {
    expect(detectAuthToneFromText("Token expired")).toBe("auth_expired");
    expect(detectAuthToneFromText("SESSION EXPIRED")).toBe("auth_expired");
  });

  it("detects auth required / 401", () => {
    expect(detectAuthToneFromText("401 Unauthorized")).toBe("auth_required");
    expect(detectAuthToneFromText("authentication required")).toBe(
      "auth_required",
    );
    expect(detectAuthToneFromText("invalid token")).toBe("auth_required");
    expect(
      detectAuthToneFromText("OAuth authorization required"),
    ).toBe("auth_required");
    expect(detectAuthToneFromText("AuthorizationRequired")).toBe(
      "auth_required",
    );
  });

  it("returns null when no auth keywords", () => {
    expect(detectAuthToneFromText("connection refused")).toBeNull();
    expect(detectAuthToneFromText("")).toBeNull();
  });

  it("prioritizes expired over generic auth", () => {
    expect(
      detectAuthToneFromText("unauthorized because token expired"),
    ).toBe("auth_expired");
  });
});

describe("inferMcpStatusTone", () => {
  it("returns ok for healthy without warnings", () => {
    expect(inferMcpStatusTone(["server started"], true)).toBe("ok");
  });

  it("returns warn for healthy with warning keywords", () => {
    expect(inferMcpStatusTone(["slow response warning"], true)).toBe("warn");
  });

  it("returns error for unhealthy connection failures", () => {
    expect(inferMcpStatusTone(["connection refused"], false)).toBe("error");
  });

  it("returns auth tones from text even when healthy flag set", () => {
    expect(inferMcpStatusTone(["token expired"], false)).toBe("auth_expired");
    expect(inferMcpStatusTone(["401 unauthorized"], false)).toBe(
      "auth_required",
    );
  });

  it("returns unknown with no signal", () => {
    expect(inferMcpStatusTone([], null)).toBe("unknown");
  });
});

describe("statusFromDoctorServer", () => {
  it("marks healthy servers ok", () => {
    const s = statusFromDoctorServer(DOCTOR_FIXTURE.servers![0]);
    expect(s?.tone).toBe("ok");
    expect(s?.needsAuthRefresh).toBe(false);
    expect(s?.healthy).toBe(true);
  });

  it("detects auth_expired from failed checks", () => {
    const s = statusFromDoctorServer(DOCTOR_FIXTURE.servers![1]);
    expect(s?.tone).toBe("auth_expired");
    expect(s?.needsAuthRefresh).toBe(true);
    expect(s?.issues.length).toBeGreaterThan(0);
    expect(s?.reason).toBeTruthy();
  });

  it("marks connection failures as error", () => {
    const s = statusFromDoctorServer(DOCTOR_FIXTURE.servers![2]);
    expect(s?.tone).toBe("error");
    expect(s?.needsAuthRefresh).toBe(false);
  });

  it("never leaks secrets in reason/issues", () => {
    const s = statusFromDoctorServer({
      name: "leaky",
      healthy: false,
      checks: [
        {
          label: "auth",
          passed: false,
          detail: "API_TOKEN=supersecretvalue123 failed",
        },
      ],
    });
    expect(s?.reason).not.toContain("supersecretvalue123");
    expect(s?.issues.join(" ")).not.toContain("supersecretvalue123");
    expect(s?.issues.join(" ")).toContain("[REDACTED]");
  });

  it("returns null without a name", () => {
    expect(statusFromDoctorServer({ healthy: true })).toBeNull();
  });
});

describe("mapIssuesToServers", () => {
  it("maps by server / name fields and text mention", () => {
    const map = mapIssuesToServers(
      [
        { server: "github", message: "token expired" },
        { name: "orphan-svc", message: "auth required" },
        "context7 is slow",
        "unscoped noise",
      ],
      ["context7", "github"],
    );
    expect(map.get("github")?.[0]).toMatch(/token expired/i);
    expect(map.get("orphan-svc")?.[0]).toMatch(/auth required/i);
    expect(map.get("context7")?.[0]).toMatch(/slow/i);
    expect(map.get("")?.[0]).toMatch(/unscoped/i);
  });
});

describe("indexDoctorServerStatuses", () => {
  it("indexes fixture servers with auth and error tones", () => {
    const index = indexDoctorServerStatuses(DOCTOR_FIXTURE);
    expect(index.size).toBeGreaterThanOrEqual(3);

    const ctx = lookupServerStatus(index, "context7");
    expect(ctx?.tone).toBe("ok");

    const gh = lookupServerStatus(index, "github");
    expect(gh?.tone).toBe("auth_expired");
    expect(gh?.needsAuthRefresh).toBe(true);
    // Extra top-level issue for github should be attached.
    expect(gh?.issues.some((i) => /oauth|token|expired/i.test(i))).toBe(true);

    const broken = lookupServerStatus(index, "broken");
    expect(broken?.tone).toBe("error");

    // Synthetic orphan from issues[]
    const orphan = lookupServerStatus(index, "orphan-svc");
    expect(orphan?.tone).toBe("auth_required");
  });

  it("looks up case-insensitively", () => {
    const index = indexDoctorServerStatuses(DOCTOR_FIXTURE);
    expect(lookupServerStatus(index, "GITHUB")?.name).toBe("github");
  });

  it("handles empty / null report", () => {
    expect(indexDoctorServerStatuses(null).size).toBe(0);
    expect(indexDoctorServerStatuses({}).size).toBe(0);
  });

  it("handles report with only issues array", () => {
    const index = indexDoctorServerStatuses({
      issues: [{ server: "remote", message: "401 Unauthorized" }],
    });
    expect(lookupServerStatus(index, "remote")?.tone).toBe("auth_required");
  });
});

describe("label / badge / guidance helpers", () => {
  it("maps tones to i18n keys and badge mods", () => {
    expect(mcpStatusLabelKey("ok")).toBe("ext.mcp.status.ok");
    expect(mcpStatusLabelKey("auth_expired")).toBe(
      "ext.mcp.status.authExpired",
    );
    expect(mcpStatusBadgeMod("ok")).toBe("ok");
    expect(mcpStatusBadgeMod("error")).toBe("fail");
    expect(mcpStatusBadgeMod("auth_required")).toBe("auth");
    expect(mcpStatusBadgeMod("unknown")).toBe("muted");
  });

  it("returns guidance keys only for auth tones", () => {
    expect(mcpAuthGuidanceKey("auth_expired")).toBe(
      "ext.mcp.auth.expiredHint",
    );
    expect(mcpAuthGuidanceKey("auth_required")).toBe(
      "ext.mcp.auth.requiredHint",
    );
    expect(mcpAuthGuidanceKey("error")).toBeNull();
  });
});

const INSPECT_ROWS: McpRowLike[] = [
  {
    name: "context7",
    transport: "stdio",
    target: "npx -y @context7/mcp",
    compatibilityStatus: "ok",
    vendor: "context7",
  },
  {
    name: "github",
    transport: "http",
    target: "https://api.github.com/mcp",
    compatibilityStatus: "warn",
  },
  {
    name: "broken",
    transport: "http",
    target: "https://example.com/mcp",
    compatibilityStatus: "error",
  },
  {
    name: "mystery",
    transport: "stdio",
    target: "/usr/local/bin/mystery-mcp",
  },
];

describe("classifyMcpRowHealth", () => {
  it("maps known compatibilityStatus tokens", () => {
    expect(classifyMcpRowHealth({ compatibilityStatus: "ok" })).toBe("ok");
    expect(classifyMcpRowHealth({ compatibilityStatus: "compatible" })).toBe(
      "ok",
    );
    expect(classifyMcpRowHealth({ compatibilityStatus: "WARN" })).toBe("warn");
    expect(classifyMcpRowHealth({ compatibilityStatus: "degraded" })).toBe(
      "warn",
    );
    expect(classifyMcpRowHealth({ compatibilityStatus: "error" })).toBe(
      "error",
    );
    expect(classifyMcpRowHealth({ compatibilityStatus: "incompatible" })).toBe(
      "error",
    );
  });

  it("infers free-form compatibility text", () => {
    expect(
      classifyMcpRowHealth({
        compatibilityStatus: "token expired for this server",
      }),
    ).toBe("error");
    expect(
      classifyMcpRowHealth({
        compatibilityStatus: "slow handshake warning",
      }),
    ).toBe("warn");
  });

  it("does not invent ok from transport alone", () => {
    expect(classifyMcpRowHealth({ transport: "stdio" })).toBe("unknown");
    expect(classifyMcpRowHealth({ transport: "http", name: "x" })).toBe(
      "unknown",
    );
    expect(classifyMcpRowHealth({})).toBe("unknown");
    expect(classifyMcpRowHealth(null)).toBe("unknown");
  });

  it("uses transport text only when it carries health keywords", () => {
    expect(
      classifyMcpRowHealth({ transport: "failed to start stdio" }),
    ).toBe("error");
  });

  it("collapses doctor tones for chip buckets", () => {
    expect(mcpRowHealthFromTone("ok")).toBe("ok");
    expect(mcpRowHealthFromTone("warn")).toBe("warn");
    expect(mcpRowHealthFromTone("auth_expired")).toBe("error");
    expect(mcpRowHealthFromTone("auth_required")).toBe("error");
    expect(mcpRowHealthFromTone("unknown")).toBe("unknown");
  });
});

describe("countMcpRowsByHealth / filterMcpRows", () => {
  it("counts per health including all", () => {
    const counts = countMcpRowsByHealth(INSPECT_ROWS);
    expect(counts.all).toBe(4);
    expect(counts.ok).toBe(1);
    expect(counts.warn).toBe(1);
    expect(counts.error).toBe(1);
    expect(counts.unknown).toBe(1);
    expect(MCP_ROW_STATUS_FILTERS).toEqual([
      "all",
      "ok",
      "warn",
      "error",
      "unknown",
    ]);
  });

  it("filters by status chip", () => {
    expect(filterMcpRows(INSPECT_ROWS, { status: "ok" }).map((r) => r.name)).toEqual([
      "context7",
    ]);
    expect(
      filterMcpRows(INSPECT_ROWS, { status: "error" }).map((r) => r.name),
    ).toEqual(["broken"]);
    expect(filterMcpRows(INSPECT_ROWS, { status: "all" })).toHaveLength(4);
  });

  it("filters by free-text query across name/target/transport/status", () => {
    expect(
      filterMcpRows(INSPECT_ROWS, { query: "github" }).map((r) => r.name),
    ).toEqual(["github"]);
    expect(
      filterMcpRows(INSPECT_ROWS, { query: "api.github" }).map((r) => r.name),
    ).toEqual(["github"]);
    expect(
      filterMcpRows(INSPECT_ROWS, { query: "stdio" }).map((r) => r.name),
    ).toEqual(["context7", "mystery"]);
    expect(filterMcpRows(INSPECT_ROWS, "context7").map((r) => r.name)).toEqual([
      "context7",
    ]);
  });

  it("combines query and status with AND", () => {
    expect(
      filterMcpRows(INSPECT_ROWS, { query: "http", status: "error" }).map(
        (r) => r.name,
      ),
    ).toEqual(["broken"]);
    expect(
      filterMcpRows(INSPECT_ROWS, { query: "http", status: "ok" }),
    ).toHaveLength(0);
  });

  it("never invents rows for empty input", () => {
    expect(filterMcpRows([], { status: "ok" })).toEqual([]);
    expect(countMcpRowsByHealth([]).all).toBe(0);
  });

  it("matchMcpRowQuery treats empty as match-all", () => {
    expect(matchMcpRowQuery(INSPECT_ROWS[0]!, "")).toBe(true);
    expect(matchMcpRowQuery(INSPECT_ROWS[0]!, "nope")).toBe(false);
  });
});

describe("mcpRowCopyText", () => {
  it("prefers target for auto, with field overrides", () => {
    const row = INSPECT_ROWS[0]!;
    expect(mcpRowCopyText(row, "auto")).toBe("npx -y @context7/mcp");
    expect(mcpRowCopyText(row, "name")).toBe("context7");
    expect(mcpRowCopyText(row, "target")).toBe("npx -y @context7/mcp");
    expect(mcpRowCopyText({ name: "solo" }, "auto")).toBe("solo");
    expect(mcpRowCopyText(null)).toBe("");
  });
});

describe("normalizeMcpDoctorFindings", () => {
  it("flattens checks into { id, level, title, detail, server }", () => {
    const rows = normalizeMcpDoctorFindings(DOCTOR_FIXTURE);
    expect(rows.length).toBeGreaterThanOrEqual(3);

    const ok = rows.find((r) => r.server === "context7");
    expect(ok?.level).toBe("ok");
    expect(ok?.title).toMatch(/server started/i);
    expect(ok?.id).toBeTruthy();

    const gh = rows.find(
      (r) => r.server === "github" && /handshake/i.test(r.title),
    );
    expect(gh?.level).toBe("fail");
    expect(gh?.detail).toMatch(/401|expired|re-authenticate/i);

    const broken = rows.find((r) => r.server === "broken");
    expect(broken?.level).toBe("fail");
    expect(broken?.detail).toMatch(/refused|check remote/i);
  });

  it("includes top-level issues with optional server", () => {
    const rows = normalizeMcpDoctorFindings(DOCTOR_FIXTURE);
    const orphan = rows.find((r) => r.server === "orphan-svc");
    expect(orphan?.level).toBe("fail");
    expect(orphan?.title).toMatch(/auth required/i);

    const unscoped = rows.find(
      (r) => !r.server && /slow startup/i.test(r.title),
    );
    expect(unscoped?.level).toBe("warn");
  });

  it("filters by server name (case-insensitive) and skips unscoped by default", () => {
    const rows = normalizeMcpDoctorFindings(DOCTOR_FIXTURE, {
      server: "GITHUB",
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.server?.toLowerCase() === "github")).toBe(
      true,
    );
    // Unscoped "slow startup" must not appear when filter is set.
    expect(rows.some((r) => /slow startup/i.test(r.title))).toBe(false);
  });

  it("can include unscoped rows when filtering", () => {
    const rows = normalizeMcpDoctorFindings(DOCTOR_FIXTURE, {
      server: "github",
      includeUnscoped: true,
    });
    expect(rows.some((r) => r.server?.toLowerCase() === "github")).toBe(true);
    expect(rows.some((r) => !r.server && /slow/i.test(r.title))).toBe(true);
  });

  it("never invents servers — empty report yields no rows", () => {
    expect(normalizeMcpDoctorFindings(null)).toEqual([]);
    expect(normalizeMcpDoctorFindings({})).toEqual([]);
    expect(
      normalizeMcpDoctorFindings({
        servers: [{ healthy: true }], // no name → skipped
      }),
    ).toEqual([]);
  });

  it("redacts secrets in title/detail", () => {
    const rows = normalizeMcpDoctorFindings({
      servers: [
        {
          name: "leaky",
          healthy: false,
          checks: [
            {
              label: "auth",
              passed: false,
              detail: "API_TOKEN=supersecretvalue123 failed",
            },
          ],
        },
      ],
    });
    const joined = rows.map((r) => `${r.title} ${r.detail}`).join(" ");
    expect(joined).not.toContain("supersecretvalue123");
    expect(joined).toContain("[REDACTED]");
  });

  it("emits rawText fallback when no structured findings", () => {
    const rows = normalizeMcpDoctorFindings({
      rawText: "doctor crashed: connection reset",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.level).toBe("fail");
    expect(rows[0]?.detail).toMatch(/connection reset/i);
  });

  it("counts and filters findings", () => {
    const rows = normalizeMcpDoctorFindings(DOCTOR_FIXTURE);
    const counts = countMcpDoctorFindings(rows);
    expect(counts.total).toBe(rows.length);
    expect(counts.ok + counts.warn + counts.fail).toBe(counts.total);

    const filtered = filterMcpDoctorFindings(rows, "github");
    expect(filtered.every((r) => /github/i.test(`${r.server} ${r.title} ${r.detail}`))).toBe(
      true,
    );
    expect(filterMcpDoctorFindings(rows, "").length).toBe(rows.length);
  });

  it("maps finding levels to status tones", () => {
    expect(mcpDoctorFindingTone("ok")).toBe("ok");
    expect(mcpDoctorFindingTone("warn")).toBe("warn");
    expect(mcpDoctorFindingTone("fail")).toBe("error");
  });
});
