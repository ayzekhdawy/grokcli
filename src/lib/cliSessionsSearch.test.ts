import { describe, expect, it } from "vitest";
import {
  clampCliSessionsSearchLimit,
  looksLikeCliSearchUnsupported,
  mergeCliSearchHitsWithLocal,
  parseCliSessionsSearchJson,
  parseCliSessionsSearchOutput,
  parseCliSessionsSearchText,
} from "./cliSessionsSearch";

const SAMPLE_TEXT = `019f3fc7-485c-7ef1-ba71-624d6c014657 (remote)  Jul 08, 11:42am
  Test Message
  test
019f3fc7-fd3a-72b1-b0a7-5d0c3e0b02bc (remote)  Jul 08, 11:42am
  Test Session
  测试 session

Total: 2
`;

const SAMPLE_LOCAL = `019fa76f-bed6-7293-b52d-2d4e647c0755 (local)  Jul 28,  3:01pm
  Update Code to Latest Version
  please update all packages

Total: 1
`;

describe("parseCliSessionsSearchText", () => {
  it("parses id, status, title, and first prompt", () => {
    const hits = parseCliSessionsSearchText(SAMPLE_TEXT);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({
      agentSessionId: "019f3fc7-485c-7ef1-ba71-624d6c014657",
      title: "Test Message",
      firstPrompt: "test",
      status: "remote",
      updatedLabel: "Jul 08, 11:42am",
    });
    expect(hits[1].title).toBe("Test Session");
    expect(hits[1].firstPrompt).toBe("测试 session");
  });

  it("parses local status hits", () => {
    const hits = parseCliSessionsSearchText(SAMPLE_LOCAL);
    expect(hits).toHaveLength(1);
    expect(hits[0].status).toBe("local");
    expect(hits[0].firstPrompt).toBe("please update all packages");
  });

  it("returns empty for Total: 0 and blank input", () => {
    expect(parseCliSessionsSearchText("\nTotal: 0\n")).toEqual([]);
    expect(parseCliSessionsSearchText("")).toEqual([]);
    expect(parseCliSessionsSearchText("   \n  ")).toEqual([]);
  });

  it("skips warning lines and tolerates missing first prompt", () => {
    const raw = `warning: remote session search timed out, showing local results only
019ea630-1bd7-7f20-9ee4-78325ae16994 (local)  Jun 08,  6:17pm
  GatePath Software Download

Total: 1
`;
    const hits = parseCliSessionsSearchText(raw);
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe("GatePath Software Download");
    expect(hits[0].firstPrompt).toBeNull();
  });

  it("joins multi-line first prompts", () => {
    const raw = `019f3fc7-485c-7ef1-ba71-624d6c014657 (remote)  Jul 08, 11:42am
  Title Line
  first line of prompt
  second line of prompt

Total: 1
`;
    const hits = parseCliSessionsSearchText(raw);
    expect(hits[0].firstPrompt).toBe(
      "first line of prompt\nsecond line of prompt",
    );
  });
});

describe("parseCliSessionsSearchJson", () => {
  it("parses array of camelCase objects", () => {
    const raw = JSON.stringify([
      {
        agentSessionId: "abc-1111",
        title: "Hello",
        firstPrompt: "hi there",
        status: "local",
      },
    ]);
    expect(parseCliSessionsSearchJson(raw)).toEqual([
      {
        agentSessionId: "abc-1111",
        title: "Hello",
        firstPrompt: "hi there",
        status: "local",
        updatedLabel: null,
      },
    ]);
  });

  it("parses { sessions: [...] } with snake_case keys", () => {
    const raw = JSON.stringify({
      sessions: [
        {
          session_id: "def-2222",
          summary: "Refactor",
          first_prompt: "please refactor",
          updated_at: "2026-07-01",
        },
      ],
    });
    const hits = parseCliSessionsSearchJson(raw);
    expect(hits).toHaveLength(1);
    expect(hits![0]).toMatchObject({
      agentSessionId: "def-2222",
      title: "Refactor",
      firstPrompt: "please refactor",
      updatedLabel: "2026-07-01",
    });
  });

  it("returns null for non-JSON or unrelated JSON", () => {
    expect(parseCliSessionsSearchJson("not json")).toBeNull();
    expect(parseCliSessionsSearchJson('{"foo":1}')).toBeNull();
    expect(parseCliSessionsSearchJson("")).toBeNull();
  });
});

describe("parseCliSessionsSearchOutput", () => {
  it("prefers JSON when valid", () => {
    const raw = JSON.stringify([
      { id: "x-1", title: "From JSON", firstPrompt: "q" },
    ]);
    const hits = parseCliSessionsSearchOutput(raw);
    expect(hits[0].title).toBe("From JSON");
  });

  it("falls back to text parse", () => {
    const hits = parseCliSessionsSearchOutput(SAMPLE_TEXT);
    expect(hits).toHaveLength(2);
  });
});

describe("looksLikeCliSearchUnsupported", () => {
  it("detects clap unexpected argument", () => {
    expect(
      looksLikeCliSearchUnsupported(
        "error: unexpected argument '--json' found",
      ),
    ).toBe(true);
    expect(looksLikeCliSearchUnsupported("")).toBe(false);
    expect(looksLikeCliSearchUnsupported("auth failed")).toBe(false);
  });
});

describe("clampCliSessionsSearchLimit", () => {
  it("clamps to 1..100 with default 40", () => {
    expect(clampCliSessionsSearchLimit(undefined)).toBe(40);
    expect(clampCliSessionsSearchLimit(0)).toBe(1);
    expect(clampCliSessionsSearchLimit(200)).toBe(100);
    expect(clampCliSessionsSearchLimit(25.9)).toBe(25);
  });
});

describe("mergeCliSearchHitsWithLocal", () => {
  const local = [
    {
      agentSessionId: "019f3fc7-485c-7ef1-ba71-624d6c014657",
      title: "Old title",
      cwd: "/Users/me/app",
      dir: "/tmp/sess",
      numMessages: 3,
      alreadyLinked: true,
      appSessionId: "app-1",
      sourceHome: "/.grok",
      updatedAt: "2026-01-01",
    },
  ];

  it("fills dir / linked from local list and keeps CLI title/prompt", () => {
    const hits = parseCliSessionsSearchText(SAMPLE_TEXT);
    const merged = mergeCliSearchHitsWithLocal(hits, local);
    expect(merged).toHaveLength(2);
    expect(merged[0].dir).toBe("/tmp/sess");
    expect(merged[0].alreadyLinked).toBe(true);
    expect(merged[0].title).toBe("Test Message");
    expect(merged[0].firstPrompt).toBe("test");
    // Second hit has no local row
    expect(merged[1].dir).toBe("");
    expect(merged[1].alreadyLinked).toBe(false);
    expect(merged[1].title).toBe("Test Session");
  });
});
