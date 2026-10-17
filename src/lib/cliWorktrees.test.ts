import { describe, expect, it } from "vitest";
import {
  canOpenCliWorktreeAsCwd,
  cliWorktreeDbStatsHasData,
  cliWorktreeMetaLabel,
  deriveCliWorktreeName,
  expandTildePath,
  filterCliWorktreesForProject,
  formatCliWorktreeDbStatsSummary,
  parseCliWorktreeDbRebuildText,
  parseCliWorktreeDbStatsJson,
  parseCliWorktreeDbStatsText,
  parseCliWorktreeListJson,
  parseCliWorktreeListText,
  parseHumanSizeBytes,
} from "./cliWorktrees";

const HOME = "/Users/me";

describe("deriveCliWorktreeName", () => {
  it("uses path basename", () => {
    expect(
      deriveCliWorktreeName(
        "id",
        "/Users/me/.grok/worktrees/repo/feat-login",
      ),
    ).toBe("feat-login");
  });

  it("falls back to id", () => {
    expect(deriveCliWorktreeName("only-id", "")).toBe("only-id");
  });
});

describe("expandTildePath", () => {
  it("expands home", () => {
    expect(expandTildePath("~/.grok/worktrees/r/a", HOME)).toBe(
      "/Users/me/.grok/worktrees/r/a",
    );
    expect(expandTildePath("/abs/x", HOME)).toBe("/abs/x");
  });
});

describe("parseCliWorktreeListJson", () => {
  it("parses array rows", () => {
    const raw = JSON.stringify([
      {
        id: "subagent-abc",
        path: "/Users/me/.grok/worktrees/oss-grok-app/subagent-abc",
        source_repo: "/Users/me/Code/oss/grok-app",
        repo_name: "grok-app",
        kind: "subagent",
        git_ref: "HEAD",
        head_commit: "ea837bbb4f3f625e9bb01268bab97476414abb5b",
        status: "alive",
      },
      {
        id: "feat-x",
        path: "~/.grok/worktrees/oss-grok-app/feat-x",
        repo_name: "grok-app",
        kind: "user",
        git_ref: "feat/x",
        status: "alive",
      },
    ]);
    const list = parseCliWorktreeListJson(raw, HOME);
    expect(list).toHaveLength(2);
    expect(list[0]!.name).toBe("subagent-abc");
    expect(list[0]!.branch).toBe("HEAD");
    expect(list[0]!.status).toBe("alive");
    expect(list[0]!.head).toBe("ea837bbb4f3f");
    expect(list[1]!.path).toBe(
      "/Users/me/.grok/worktrees/oss-grok-app/feat-x",
    );
    expect(list[1]!.branch).toBe("feat/x");
  });

  it("parses wrapped worktrees key", () => {
    const list = parseCliWorktreeListJson(
      JSON.stringify({ worktrees: [{ id: "a", path: "/tmp/a", status: "stale" }] }),
      HOME,
    );
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe("a");
    expect(list[0]!.status).toBe("stale");
  });

  it("returns empty for blank / invalid", () => {
    expect(parseCliWorktreeListJson("", HOME)).toEqual([]);
    expect(parseCliWorktreeListJson("not json", HOME)).toEqual([]);
    expect(parseCliWorktreeListJson("[]", HOME)).toEqual([]);
  });
});

describe("parseCliWorktreeListText", () => {
  it("parses table rows and skips header/summary", () => {
    const raw = `
  ID                                                             TYPE     REPO   LABEL BRANCH               AGE        PATH
  subagent-019f99c5-d7db-7e50-9212-2ee9821126c0-24f7e69a9a88c6fa subagent grok-…       HEAD                 4d ago     ~/.grok/worktrees/oss-grok-app/subagent-019f99c5-d7db-7e50-9212-2ee9821126c0
  feat-login                                                     user     grok-…       feat/login           1h ago     /Users/me/.grok/worktrees/oss-grok-app/feat-login
  20 worktrees (20 subagent)
`;
    const list = parseCliWorktreeListText(raw, HOME);
    expect(list).toHaveLength(2);
    expect(list[0]!.path).toBe(
      "/Users/me/.grok/worktrees/oss-grok-app/subagent-019f99c5-d7db-7e50-9212-2ee9821126c0",
    );
    expect(list[0]!.kind).toBe("subagent");
    expect(list[0]!.branch).toBe("HEAD");
    expect(list[1]!.name).toBe("feat-login");
    expect(list[1]!.branch).toBe("feat/login");
    expect(list[1]!.kind).toBe("user");
  });
});

describe("canOpenCliWorktreeAsCwd", () => {
  it("requires path and pathOk", () => {
    expect(
      canOpenCliWorktreeAsCwd({ path: "/tmp/x", pathOk: true }),
    ).toBe(true);
    expect(
      canOpenCliWorktreeAsCwd({ path: "/tmp/x", pathOk: false }),
    ).toBe(false);
    expect(canOpenCliWorktreeAsCwd({ path: "", pathOk: true })).toBe(false);
    expect(
      canOpenCliWorktreeAsCwd({
        path: "/tmp/x",
        pathOk: true,
        status: "missing",
      }),
    ).toBe(false);
  });
});

describe("filterCliWorktreesForProject", () => {
  const list = [
    {
      id: "a",
      name: "a",
      path: "/Users/me/.grok/worktrees/oss-grok-app/a",
      sourceRepo: "/Users/me/Code/oss/grok-app",
      repoName: "grok-app",
    },
    {
      id: "b",
      name: "b",
      path: "/Users/me/.grok/worktrees/other/b",
      sourceRepo: "/Users/me/Code/other",
      repoName: "other",
    },
  ];

  it("filters by source repo path", () => {
    const f = filterCliWorktreesForProject(
      list,
      "/Users/me/Code/oss/grok-app",
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.id).toBe("a");
  });

  it("filters by repo name", () => {
    const f = filterCliWorktreesForProject(list, null, "other");
    expect(f).toHaveLength(1);
    expect(f[0]!.id).toBe("b");
  });

  it("filters by CLI worktrees folder slug when cwd is a linked tree", () => {
    const f = filterCliWorktreesForProject(
      list,
      "/Users/me/.grok/worktrees/oss-grok-app/feat-x",
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.id).toBe("a");
  });
});

describe("cliWorktreeMetaLabel", () => {
  it("joins kind branch status", () => {
    expect(
      cliWorktreeMetaLabel({
        id: "x",
        name: "x",
        path: "/p",
        kind: "user",
        branch: "main",
        status: "alive",
      }),
    ).toBe("user · main");
    expect(
      cliWorktreeMetaLabel({
        id: "x",
        name: "x",
        path: "/p",
        kind: "subagent",
        status: "stale",
        repoName: "app",
      }),
    ).toBe("subagent · stale · app");
  });
});

describe("parseCliWorktreeDbStatsText", () => {
  it("parses 0.2.117 fixture", () => {
    const raw = `Worktree DB Statistics
======================
  Total records:  20
  Alive:          20
  Dead:           0
  DB size:        48.0 KB
`;
    const s = parseCliWorktreeDbStatsText(raw);
    expect(s.total).toBe(20);
    expect(s.alive).toBe(20);
    expect(s.dead).toBe(0);
    expect(s.dbSize).toBe("48.0 KB");
    expect(s.dbSizeBytes).toBe(49152);
    expect(cliWorktreeDbStatsHasData(s)).toBe(true);
    expect(formatCliWorktreeDbStatsSummary(s)).toBe(
      "20 total · 20 alive · 0 dead · 48.0 KB",
    );
  });
});

describe("parseCliWorktreeDbStatsJson", () => {
  it("parses flat object", () => {
    const s = parseCliWorktreeDbStatsJson(
      JSON.stringify({
        total: 5,
        alive: 4,
        dead: 1,
        db_size: "1.5 KB",
      }),
    );
    expect(s?.total).toBe(5);
    expect(s?.alive).toBe(4);
    expect(s?.dead).toBe(1);
    expect(s?.dbSize).toBe("1.5 KB");
    expect(s?.dbSizeBytes).toBe(1536);
  });

  it("parses wrapped stats", () => {
    const s = parseCliWorktreeDbStatsJson(
      JSON.stringify({
        stats: { total_records: 3, alive: 3, dead: 0, size: "512 B" },
      }),
    );
    expect(s?.total).toBe(3);
    expect(s?.dbSize).toBe("512 B");
    expect(s?.dbSizeBytes).toBe(512);
  });
});

describe("parseHumanSizeBytes", () => {
  it("handles units and bare bytes", () => {
    expect(parseHumanSizeBytes("48.0 KB")).toBe(49152);
    expect(parseHumanSizeBytes("1 MB")).toBe(1024 * 1024);
    expect(parseHumanSizeBytes("100")).toBe(100);
    expect(parseHumanSizeBytes("")).toBeNull();
  });
});

describe("parseCliWorktreeDbRebuildText", () => {
  it("parses rebuild report", () => {
    const r = parseCliWorktreeDbRebuildText(`Rebuild report:
  Discovered:      20
  Registered:      0
  Already tracked: 20
`);
    expect(r.discovered).toBe(20);
    expect(r.registered).toBe(0);
    expect(r.alreadyTracked).toBe(20);
  });
});
