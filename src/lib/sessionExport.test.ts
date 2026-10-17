import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  formatToolSummaryLine,
  messagesToHtml,
  messagesToMarkdown,
  messagesToPlain,
  renderSessionExport,
  sessionExportFilename,
  sessionExportFilenameFor,
  sessionExportHtmlFilename,
  sessionExportJsonFilename,
  sessionExportMimeType,
  sessionExportPlainFilename,
  sessionToHtml,
  sessionToJson,
  sessionToMarkdown,
  sessionToPlain,
  shouldPreferCliMarkdownExport,
} from "./sessionExport";

describe("messagesToMarkdown", () => {
  it("renders user and assistant sections without a document header", () => {
    const md = messagesToMarkdown([
      { role: "user", content: "Add reset data" },
      {
        role: "assistant",
        content: "Done.",
        thought: "Need double confirm.",
      },
    ]);
    // No session document title (# Title) — only ## role headings.
    expect(md).not.toMatch(/^# /m);
    expect(md).toContain("## User");
    expect(md).toContain("Add reset data");
    expect(md).toContain("## Assistant");
    expect(md).toContain("<summary>Thinking</summary>");
    expect(md).toContain("Need double confirm.");
    expect(md).toContain("Done.");
  });

  it("skips tool_step noise by default", () => {
    const md = messagesToMarkdown([
      {
        role: "tool",
        content: "tool_step|bash|completed|ran tests",
        marker: "tool_step",
      },
      { role: "assistant", content: "All green." },
    ]);
    expect(md).not.toContain("## Tool");
    expect(md).not.toContain("bash");
    expect(md).toContain("All green.");
  });

  it("includes tool summaries when opted in", () => {
    const md = messagesToMarkdown(
      [
        {
          role: "tool",
          content: "tool_step|bash|completed|ran tests",
          marker: "tool_step",
        },
        { role: "assistant", content: "All green." },
      ],
      { includeToolSummary: true },
    );
    expect(md).toContain("## Tool");
    expect(md).toContain("- bash (completed)");
    expect(md).toContain("All green.");
  });

  it("omits thoughts when includeThoughts is false", () => {
    const md = messagesToMarkdown(
      [
        {
          role: "assistant",
          content: "Body only.",
          thought: "secret plan",
        },
      ],
      { includeThoughts: false },
    );
    expect(md).not.toContain("secret plan");
    expect(md).not.toContain("<summary>Thinking</summary>");
    expect(md).toContain("Body only.");
  });

  it("skips empty shells and returns empty string for no content", () => {
    expect(messagesToMarkdown([])).toBe("");
    expect(
      messagesToMarkdown([
        { role: "tool", content: "" },
        { role: "assistant", content: "   " },
      ]),
    ).toBe("");
  });

  it("includes createdAt when present", () => {
    const md = messagesToMarkdown([
      {
        role: "user",
        content: "hi",
        createdAt: "2026-07-24T00:00:00.000Z",
      },
    ]);
    expect(md).toContain("*2026-07-24T00:00:00.000Z*");
  });
});

describe("sessionToMarkdown", () => {
  it("builds a title, meta block, and role sections", () => {
    const md = sessionToMarkdown({
      title: "Doctor reset",
      projectName: "grok-app",
      projectPath: "/tmp/grok-app",
      sessionId: "abc12345-full",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [
        { role: "user", content: "Add reset data" },
        {
          role: "assistant",
          content: "Done.",
          thought: "Need double confirm.",
        },
      ],
    });
    expect(md).toContain("# Doctor reset");
    expect(md).toContain("Project: grok-app");
    expect(md).toContain("Session: abc12345-full");
    expect(md).toContain("## User");
    expect(md).toContain("Add reset data");
    expect(md).toContain("## Assistant");
    expect(md).toContain("<summary>Thinking</summary>");
    expect(md).toContain("Need double confirm.");
    expect(md).toContain("Done.");
  });

  it("skips empty tool messages", () => {
    const md = sessionToMarkdown({
      title: "t",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [
        { role: "tool", content: "" },
        { role: "user", content: "hi" },
      ],
    });
    expect(md).not.toContain("## Tool");
    expect(md).toContain("## User");
  });

  it("summarizes tool_step rows when includeToolSummary is on", () => {
    const md = sessionToMarkdown({
      title: "tools",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [
        {
          role: "tool",
          content: "tool_step|bash|completed|ran tests",
          marker: "tool_step",
        },
        { role: "assistant", content: "All green." },
      ],
    });
    expect(md).toContain("## Tool");
    expect(md).toContain("- bash (completed)");
    expect(md).toContain("All green.");
  });

  it("omits tools and thoughts when options say so", () => {
    const md = sessionToMarkdown({
      title: "opts",
      exportedAt: "2026-07-24T00:00:00.000Z",
      options: { includeThoughts: false, includeToolSummary: false },
      messages: [
        {
          role: "tool",
          content: "tool_step|edit|completed",
          marker: "tool_step",
        },
        {
          role: "assistant",
          content: "Body only.",
          thought: "secret plan",
        },
      ],
    });
    expect(md).not.toContain("## Tool");
    expect(md).not.toContain("secret plan");
    expect(md).not.toContain("<summary>Thinking</summary>");
    expect(md).toContain("Body only.");
  });

  it("falls back to Untitled", () => {
    const md = sessionToMarkdown({
      title: "   ",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [],
    });
    expect(md.startsWith("# Untitled")).toBe(true);
  });
});

describe("formatToolSummaryLine", () => {
  it("parses tool_step pipe format", () => {
    expect(formatToolSummaryLine("tool_step|read|running", "tool_step")).toBe(
      "read (running)",
    );
  });

  it("handles compact marker", () => {
    expect(formatToolSummaryLine("", "context_compact")).toBe("Context compact");
  });
});

describe("sessionExportFilename", () => {
  it("slugifies title and appends short id", () => {
    expect(sessionExportFilename("Fix Doctor Reset!", "abcdef12-xxxx")).toBe(
      "grok-fix-doctor-reset-abcdef12.md",
    );
  });

  it("handles empty title", () => {
    expect(sessionExportFilename("", null)).toBe("grok-session.md");
  });
});

describe("sessionExportJsonFilename", () => {
  it("uses .json extension", () => {
    expect(sessionExportJsonFilename("Fix Doctor Reset!", "abcdef12-xxxx")).toBe(
      "grok-fix-doctor-reset-abcdef12.json",
    );
  });

  it("handles empty title", () => {
    expect(sessionExportJsonFilename("", null)).toBe("grok-session.json");
  });
});

describe("sessionExportHtmlFilename", () => {
  it("uses .html extension", () => {
    expect(sessionExportHtmlFilename("Fix Doctor Reset!", "abcdef12-xxxx")).toBe(
      "grok-fix-doctor-reset-abcdef12.html",
    );
  });

  it("handles empty title", () => {
    expect(sessionExportHtmlFilename("", null)).toBe("grok-session.html");
  });
});

describe("sessionExportPlainFilename", () => {
  it("uses .txt extension", () => {
    expect(sessionExportPlainFilename("Fix Doctor Reset!", "abcdef12-xxxx")).toBe(
      "grok-fix-doctor-reset-abcdef12.txt",
    );
  });

  it("handles empty title", () => {
    expect(sessionExportPlainFilename("", null)).toBe("grok-session.txt");
  });
});

describe("sessionExportFilenameFor / mime / prefer CLI", () => {
  it("maps formats to filenames and mime types", () => {
    expect(sessionExportFilenameFor("markdown", "T", "abcdef12")).toBe(
      sessionExportFilename("T", "abcdef12"),
    );
    expect(sessionExportFilenameFor("plain", "T", "abcdef12")).toBe(
      sessionExportPlainFilename("T", "abcdef12"),
    );
    expect(sessionExportFilenameFor("json", "T", "abcdef12")).toBe(
      sessionExportJsonFilename("T", "abcdef12"),
    );
    expect(sessionExportFilenameFor("html", "T", "abcdef12")).toBe(
      sessionExportHtmlFilename("T", "abcdef12"),
    );
    expect(sessionExportMimeType("markdown")).toContain("markdown");
    expect(sessionExportMimeType("plain")).toContain("text/plain");
    expect(sessionExportMimeType("json")).toContain("json");
    expect(sessionExportMimeType("html")).toContain("html");
  });

  it("prefers CLI only for full transcript options", () => {
    expect(shouldPreferCliMarkdownExport(undefined)).toBe(true);
    expect(shouldPreferCliMarkdownExport({})).toBe(true);
    expect(shouldPreferCliMarkdownExport({ includeThoughts: true, includeToolSummary: true })).toBe(
      true,
    );
    expect(shouldPreferCliMarkdownExport({ includeThoughts: false })).toBe(false);
    expect(shouldPreferCliMarkdownExport({ includeToolSummary: false })).toBe(false);
  });
});

describe("escapeHtml", () => {
  it("escapes &, <, >, quotes", () => {
    expect(escapeHtml(`a & b <c> "d" 'e'`)).toBe(
      "a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;",
    );
  });

  it("handles empty / nullish", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("messagesToHtml", () => {
  it("renders user and assistant sections with escaped content", () => {
    const html = messagesToHtml([
      { role: "user", content: "Add <reset> & data" },
      {
        role: "assistant",
        content: "Done.",
        thought: "Need <double> confirm.",
      },
    ]);
    expect(html).not.toContain("<!DOCTYPE");
    expect(html).toContain('<section class="msg msg--user">');
    expect(html).toContain("<h2>User</h2>");
    expect(html).toContain("Add &lt;reset&gt; &amp; data");
    expect(html).not.toContain("Add <reset>");
    expect(html).toContain('<section class="msg msg--assistant">');
    expect(html).toContain("<h2>Assistant</h2>");
    expect(html).toContain("<summary>Thinking</summary>");
    expect(html).toContain("Need &lt;double&gt; confirm.");
    expect(html).toContain("Done.");
  });

  it("skips tool_step noise by default", () => {
    const html = messagesToHtml([
      {
        role: "tool",
        content: "tool_step|bash|completed|ran tests",
        marker: "tool_step",
      },
      { role: "assistant", content: "All green." },
    ]);
    expect(html).not.toContain("msg--tool");
    expect(html).not.toContain("bash");
    expect(html).toContain("All green.");
  });

  it("includes tool summaries when opted in", () => {
    const html = messagesToHtml(
      [
        {
          role: "tool",
          content: "tool_step|bash|completed|ran tests",
          marker: "tool_step",
        },
        { role: "assistant", content: "All green." },
      ],
      { includeToolSummary: true },
    );
    expect(html).toContain('class="msg msg--tool"');
    expect(html).toContain("bash (completed)");
    expect(html).toContain("All green.");
  });

  it("omits thoughts when includeThoughts is false", () => {
    const html = messagesToHtml(
      [
        {
          role: "assistant",
          content: "Body only.",
          thought: "secret plan",
        },
      ],
      { includeThoughts: false },
    );
    expect(html).not.toContain("secret plan");
    expect(html).not.toContain("<summary>Thinking</summary>");
    expect(html).toContain("Body only.");
  });

  it("skips empty shells and returns empty string for no content", () => {
    expect(messagesToHtml([])).toBe("");
    expect(
      messagesToHtml([
        { role: "tool", content: "" },
        { role: "assistant", content: "   " },
      ]),
    ).toBe("");
  });

  it("includes createdAt when present", () => {
    const html = messagesToHtml([
      {
        role: "user",
        content: "hi",
        createdAt: "2026-07-24T00:00:00.000Z",
      },
    ]);
    expect(html).toContain('datetime="2026-07-24T00:00:00.000Z"');
    expect(html).toContain(">2026-07-24T00:00:00.000Z</time>");
  });
});

describe("sessionToHtml", () => {
  it("builds a full HTML document with title, meta, and role sections", () => {
    const html = sessionToHtml({
      title: "Doctor <reset>",
      projectName: "grok-app",
      projectPath: "/tmp/grok-app",
      sessionId: "abc12345-full",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [
        { role: "user", content: "Add reset data" },
        {
          role: "assistant",
          content: "Done.",
          thought: "Need double confirm.",
        },
      ],
    });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>Doctor &lt;reset&gt;</title>");
    expect(html).toContain("<h1>Doctor &lt;reset&gt;</h1>");
    expect(html).toContain("Project: grok-app");
    expect(html).toContain("Session: abc12345-full");
    expect(html).toContain("<h2>User</h2>");
    expect(html).toContain("Add reset data");
    expect(html).toContain("<h2>Assistant</h2>");
    expect(html).toContain("<summary>Thinking</summary>");
    expect(html).toContain("Need double confirm.");
    expect(html).toContain("Done.");
  });

  it("summarizes tool_step rows when includeToolSummary is on by default", () => {
    const html = sessionToHtml({
      title: "tools",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [
        {
          role: "tool",
          content: "tool_step|bash|completed|ran tests",
          marker: "tool_step",
        },
        { role: "assistant", content: "All green." },
      ],
    });
    expect(html).toContain("msg--tool");
    expect(html).toContain("bash (completed)");
    expect(html).toContain("All green.");
  });

  it("omits tools and thoughts when options say so", () => {
    const html = sessionToHtml({
      title: "opts",
      exportedAt: "2026-07-24T00:00:00.000Z",
      options: { includeThoughts: false, includeToolSummary: false },
      messages: [
        {
          role: "tool",
          content: "tool_step|edit|completed",
          marker: "tool_step",
        },
        {
          role: "assistant",
          content: "Body only.",
          thought: "secret plan",
        },
      ],
    });
    expect(html).not.toContain('class="msg msg--tool"');
    expect(html).not.toContain("secret plan");
    expect(html).not.toContain("<summary>Thinking</summary>");
    expect(html).toContain("Body only.");
  });

  it("falls back to Untitled", () => {
    const html = sessionToHtml({
      title: "   ",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [],
    });
    expect(html).toContain("<title>Untitled</title>");
    expect(html).toContain("<h1>Untitled</h1>");
  });
});

describe("messagesToPlain", () => {
  it("renders role labels without markdown headings", () => {
    const text = messagesToPlain([
      { role: "user", content: "Add reset data" },
      {
        role: "assistant",
        content: "Done.",
        thought: "Need double confirm.",
      },
    ]);
    expect(text).not.toContain("## ");
    expect(text).toContain("User:");
    expect(text).toContain("Add reset data");
    expect(text).toContain("Assistant:");
    expect(text).toContain("Thinking:");
    expect(text).toContain("Need double confirm.");
    expect(text).toContain("Done.");
  });

  it("skips tool_step noise by default", () => {
    const text = messagesToPlain([
      {
        role: "tool",
        content: "tool_step|bash|completed|ran tests",
        marker: "tool_step",
      },
      { role: "assistant", content: "All green." },
    ]);
    expect(text).not.toContain("Tool:");
    expect(text).not.toContain("bash");
    expect(text).toContain("All green.");
  });

  it("includes tool summaries when opted in", () => {
    const text = messagesToPlain(
      [
        {
          role: "tool",
          content: "tool_step|bash|completed|ran tests",
          marker: "tool_step",
        },
        { role: "assistant", content: "All green." },
      ],
      { includeToolSummary: true },
    );
    expect(text).toContain("Tool:");
    expect(text).toContain("bash (completed)");
    expect(text).toContain("All green.");
  });

  it("omits thoughts when includeThoughts is false", () => {
    const text = messagesToPlain(
      [
        {
          role: "assistant",
          content: "Body only.",
          thought: "secret plan",
        },
      ],
      { includeThoughts: false },
    );
    expect(text).not.toContain("secret plan");
    expect(text).not.toContain("Thinking:");
    expect(text).toContain("Body only.");
  });
});

describe("sessionToPlain", () => {
  it("builds a title, meta block, and role sections", () => {
    const text = sessionToPlain({
      title: "Doctor reset",
      projectName: "grok-app",
      projectPath: "/tmp/grok-app",
      sessionId: "abc12345-full",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [
        { role: "user", content: "Add reset data" },
        {
          role: "assistant",
          content: "Done.",
          thought: "Need double confirm.",
        },
      ],
    });
    expect(text).toContain("Doctor reset");
    expect(text).toContain("Project: grok-app");
    expect(text).toContain("Session: abc12345-full");
    expect(text).toContain("User:");
    expect(text).toContain("Add reset data");
    expect(text).toContain("Assistant:");
    expect(text).toContain("Thinking:");
    expect(text).toContain("Done.");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("includes tool summaries by default for full session export", () => {
    const text = sessionToPlain({
      title: "tools",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [
        {
          role: "tool",
          content: "tool_step|bash|completed|ran tests",
          marker: "tool_step",
        },
        { role: "assistant", content: "All green." },
      ],
    });
    expect(text).toContain("Tool:");
    expect(text).toContain("bash (completed)");
  });

  it("falls back to Untitled", () => {
    const text = sessionToPlain({
      title: "   ",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [],
    });
    expect(text.startsWith("Untitled")).toBe(true);
  });
});

describe("renderSessionExport", () => {
  it("dispatches markdown / plain / json / html", () => {
    const input = {
      title: "Round trip",
      sessionId: "abc",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [{ role: "user" as const, content: "hi" }],
      options: { includeThoughts: false, includeToolSummary: false },
    };
    expect(renderSessionExport("markdown", input)).toContain("# Round trip");
    expect(renderSessionExport("plain", input)).toContain("User:");
    expect(JSON.parse(renderSessionExport("json", input)).messages).toEqual([
      { role: "user", content: "hi" },
    ]);
    expect(renderSessionExport("html", input)).toContain("<!DOCTYPE html>");
  });
});

describe("sessionToJson", () => {
  it("builds import-friendly object with user/assistant messages", () => {
    const raw = sessionToJson({
      title: "Doctor reset",
      sessionId: "abc12345-full",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [
        { role: "user", content: "Add reset data" },
        {
          role: "assistant",
          content: "Done.",
          thought: "Need double confirm.",
        },
        { role: "tool", content: "tool_step|bash|completed", marker: "tool_step" },
        { role: "user", content: "   " },
      ],
    });
    const parsed = JSON.parse(raw) as {
      title: string;
      sessionId: string;
      exportedAt: string;
      messages: Array<{ role: string; content: string; thought?: string }>;
    };
    expect(parsed.title).toBe("Doctor reset");
    expect(parsed.sessionId).toBe("abc12345-full");
    expect(parsed.exportedAt).toBe("2026-07-24T00:00:00.000Z");
    // default: omit tools + thoughts
    expect(parsed.messages).toEqual([
      { role: "user", content: "Add reset data" },
      { role: "assistant", content: "Done." },
    ]);
    // pretty-printed
    expect(raw).toContain("\n  ");
  });

  it("includes thought when includeThoughts is true", () => {
    const parsed = JSON.parse(
      sessionToJson({
        title: "t",
        exportedAt: "2026-07-24T00:00:00.000Z",
        options: { includeThoughts: true },
        messages: [
          {
            role: "assistant",
            content: "Body",
            thought: "secret plan",
          },
        ],
      }),
    );
    expect(parsed.messages).toEqual([
      { role: "assistant", content: "Body", thought: "secret plan" },
    ]);
  });

  it("includes tool summaries as assistant lines when includeToolSummary", () => {
    const parsed = JSON.parse(
      sessionToJson({
        title: "tools",
        exportedAt: "2026-07-24T00:00:00.000Z",
        options: { includeToolSummary: true },
        messages: [
          {
            role: "tool",
            content: "tool_step|bash|completed|ran tests",
            marker: "tool_step",
          },
          { role: "assistant", content: "All green." },
        ],
      }),
    );
    expect(parsed.messages).toEqual([
      { role: "assistant", content: "[tool] bash (completed)" },
      { role: "assistant", content: "All green." },
    ]);
  });

  it("falls back to Untitled and omits sessionId when missing", () => {
    const parsed = JSON.parse(
      sessionToJson({
        title: "   ",
        exportedAt: "2026-07-24T00:00:00.000Z",
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    expect(parsed.title).toBe("Untitled");
    expect(parsed.sessionId).toBeUndefined();
    expect(parsed.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("produces messages array suitable for array-style re-import", () => {
    const parsed = JSON.parse(
      sessionToJson({
        title: "round-trip",
        exportedAt: "2026-07-24T00:00:00.000Z",
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "world" },
        ],
      }),
    );
    // Import accepts object.messages or a bare array of {role,content}
    const asArray = parsed.messages as Array<{ role: string; content: string }>;
    expect(Array.isArray(asArray)).toBe(true);
    expect(asArray.every((m) => m.role === "user" || m.role === "assistant")).toBe(
      true,
    );
    expect(asArray.every((m) => typeof m.content === "string" && m.content.length > 0)).toBe(
      true,
    );
    // bare array form is also valid JSON for import
    expect(() => JSON.parse(JSON.stringify(asArray))).not.toThrow();
  });
});
