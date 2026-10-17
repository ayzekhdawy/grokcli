/** Build a markdown export for a whole chat session. */

export type ExportableMessage = {
  role: "user" | "assistant" | "tool" | string;
  content: string;
  thought?: string;
  createdAt?: string;
  /** Journal markers: tool_step, context_compact, turn_cancelled, … */
  marker?: string;
};

export type SessionExportOptions = {
  /** Include assistant thinking in collapsed `<details>` (default true). */
  includeThoughts?: boolean;
  /**
   * Include tool_step / tool rows as a short summary list (default true).
   * When false, tool shells are omitted entirely.
   */
  includeToolSummary?: boolean;
};

export type SessionExportInput = {
  title: string;
  projectName?: string | null;
  projectPath?: string | null;
  sessionId?: string | null;
  exportedAt?: string;
  messages: ExportableMessage[];
  options?: SessionExportOptions;
};

function roleHeading(role: string): string {
  if (role === "user") return "User";
  if (role === "assistant") return "Assistant";
  if (role === "tool") return "Tool";
  return role;
}

/** Parse `tool_step|name|status|…` or free-form tool content into one line. */
export function formatToolSummaryLine(content: string, marker?: string): string | null {
  const raw = (content || "").trim();
  if (!raw && !marker) return null;

  if (marker === "context_compact" || raw.startsWith("context_compact")) {
    return "Context compact";
  }
  if (marker === "turn_cancelled" || raw === "turn_cancelled") {
    return "Turn cancelled";
  }

  if (marker === "tool_step" || raw.startsWith("tool_step|") || raw.startsWith("tool_step")) {
    const body = raw.startsWith("tool_step|")
      ? raw.slice("tool_step|".length)
      : raw.replace(/^tool_step\s*/i, "");
    const parts = body.split("|").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return "Tool step";
    const name = parts[0] || "tool";
    const status = parts[1] || "";
    if (status) return `${name} (${status})`;
    return name;
  }

  // Generic tool row — single line, truncated.
  const one = raw.replace(/\s+/g, " ").slice(0, 160);
  return one || null;
}

function isToolish(m: ExportableMessage): boolean {
  if (m.role === "tool") return true;
  if (m.marker === "tool_step" || m.marker === "context_compact" || m.marker === "turn_cancelled") {
    return true;
  }
  const c = (m.content || "").trim();
  return c.startsWith("tool_step|") || c.startsWith("tool_step");
}

export type MessagesToMarkdownOptions = {
  /**
   * Include assistant thinking in collapsed `<details>` (default true).
   */
  includeThoughts?: boolean;
  /**
   * Include tool_step / tool rows as short summary lines.
   * Default **false** — skip pure tool-step noise for clipboard / paste.
   * Full session export opts in via {@link sessionToMarkdown}.
   */
  includeToolSummary?: boolean;
};

/**
 * Pure message list → GitHub-flavored markdown (no title / meta header).
 * Skips empty shells. Defaults: thoughts on, tool_step noise off.
 */
export function messagesToMarkdown(
  messages: ExportableMessage[],
  opts?: MessagesToMarkdownOptions,
): string {
  const includeThoughts = opts?.includeThoughts !== false;
  // Opt-in: clipboard copy should not dump every tool_step by default.
  const includeToolSummary = opts?.includeToolSummary === true;

  const lines: string[] = [];

  for (const m of messages) {
    const body = (m.content || "").trim();
    const thought = (m.thought || "").trim();

    if (isToolish(m)) {
      if (!includeToolSummary) continue;
      const line = formatToolSummaryLine(body, m.marker);
      if (!line) continue;
      lines.push(`## Tool`);
      if (m.createdAt) {
        lines.push(`*${m.createdAt}*`);
        lines.push("");
      }
      lines.push(`- ${line}`);
      lines.push("");
      continue;
    }

    if (!body && !thought) continue;

    lines.push(`## ${roleHeading(m.role)}`);
    if (m.createdAt) {
      lines.push(`*${m.createdAt}*`);
      lines.push("");
    }
    if (includeThoughts && thought) {
      lines.push("<details>");
      lines.push("<summary>Thinking</summary>");
      lines.push("");
      lines.push(thought);
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
    if (body) {
      lines.push(body);
      lines.push("");
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Render a session as GitHub-flavored markdown.
 * Skips empty shells; optional thinking + tool summaries.
 * Export defaults keep tool summaries on (unlike {@link messagesToMarkdown}).
 */
export function sessionToMarkdown(input: SessionExportInput): string {
  const opts = input.options ?? {};
  const includeThoughts = opts.includeThoughts !== false;
  // Session file export historically includes tools unless explicitly off.
  const includeToolSummary = opts.includeToolSummary !== false;

  const lines: string[] = [];
  const title = (input.title || "Untitled").trim() || "Untitled";
  lines.push(`# ${title}`);
  lines.push("");

  const meta: string[] = [];
  if (input.projectName) meta.push(`Project: ${input.projectName}`);
  if (input.projectPath) meta.push(`Path: ${input.projectPath}`);
  if (input.sessionId) meta.push(`Session: ${input.sessionId}`);
  meta.push(`Exported: ${input.exportedAt || new Date().toISOString()}`);
  lines.push(meta.map((m) => `- ${m}`).join("\n"));
  lines.push("");
  lines.push("---");
  lines.push("");

  const body = messagesToMarkdown(input.messages, {
    includeThoughts,
    includeToolSummary,
  });
  if (body) {
    lines.push(body);
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** Safe download basename from a session title (no extension). */
function sessionExportBasename(title: string, sessionId?: string | null): string {
  const base = (title || "session")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const id = (sessionId || "").slice(0, 8);
  const name = base || "session";
  return id ? `grok-${name}-${id}` : `grok-${name}`;
}

/** Safe download filename from a session title (Markdown). */
export function sessionExportFilename(title: string, sessionId?: string | null): string {
  return `${sessionExportBasename(title, sessionId)}.md`;
}

/** Safe download filename for JSON session export. */
export function sessionExportJsonFilename(title: string, sessionId?: string | null): string {
  return `${sessionExportBasename(title, sessionId)}.json`;
}

/** Safe download filename for HTML session export. */
export function sessionExportHtmlFilename(title: string, sessionId?: string | null): string {
  return `${sessionExportBasename(title, sessionId)}.html`;
}

/** Safe download filename for plain-text session export. */
export function sessionExportPlainFilename(title: string, sessionId?: string | null): string {
  return `${sessionExportBasename(title, sessionId)}.txt`;
}

/**
 * Transcript export formats aligned with CLI / headless naming:
 * - `markdown` — `grok export` (App journal or CLI when linked)
 * - `plain` — headless `--output-format plain` style (role labels + body)
 * - `json` — import-friendly / headless-style structured transcript
 * - `html` — standalone readable page (App-only)
 */
export type SessionExportFormat = "markdown" | "plain" | "json" | "html";

/** MIME type for a blob download of the given format. */
export function sessionExportMimeType(format: SessionExportFormat): string {
  switch (format) {
    case "markdown":
      return "text/markdown;charset=utf-8";
    case "plain":
      return "text/plain;charset=utf-8";
    case "json":
      return "application/json;charset=utf-8";
    case "html":
      return "text/html;charset=utf-8";
  }
}

/** Download filename for a session export format. */
export function sessionExportFilenameFor(
  format: SessionExportFormat,
  title: string,
  sessionId?: string | null,
): string {
  switch (format) {
    case "markdown":
      return sessionExportFilename(title, sessionId);
    case "plain":
      return sessionExportPlainFilename(title, sessionId);
    case "json":
      return sessionExportJsonFilename(title, sessionId);
    case "html":
      return sessionExportHtmlFilename(title, sessionId);
  }
}

/** Render a session in the chosen export format (local journal path). */
export function renderSessionExport(
  format: SessionExportFormat,
  input: SessionExportInput,
): string {
  switch (format) {
    case "markdown":
      return sessionToMarkdown(input);
    case "plain":
      return sessionToPlain(input);
    case "json":
      return sessionToJson(input);
    case "html":
      return sessionToHtml(input);
  }
}

/**
 * Whether Markdown download may prefer `grok export` (CLI) over the local
 * journal. Only when export options match a full transcript (CLI has no
 * thought/tool toggles). Callers soft-fail to {@link sessionToMarkdown}.
 */
export function shouldPreferCliMarkdownExport(
  options?: SessionExportOptions | null,
): boolean {
  const opts = options ?? {};
  // Defaults for full session MD export: thoughts + tools on.
  return opts.includeThoughts !== false && opts.includeToolSummary !== false;
}

/** Escape text for safe inclusion in HTML text/attributes. */
export function escapeHtml(text: string): string {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type MessagesToHtmlOptions = MessagesToMarkdownOptions;

/**
 * Pure message list → simple readable HTML fragments (no document chrome).
 * Content is escaped; whitespace preserved via CSS. Defaults match
 * {@link messagesToMarkdown}: thoughts on, tool_step noise off.
 */
export function messagesToHtml(
  messages: ExportableMessage[],
  opts?: MessagesToHtmlOptions,
): string {
  const includeThoughts = opts?.includeThoughts !== false;
  const includeToolSummary = opts?.includeToolSummary === true;

  const parts: string[] = [];

  for (const m of messages) {
    const body = (m.content || "").trim();
    const thought = (m.thought || "").trim();

    if (isToolish(m)) {
      if (!includeToolSummary) continue;
      const line = formatToolSummaryLine(body, m.marker);
      if (!line) continue;
      const time =
        m.createdAt && m.createdAt.trim()
          ? `\n  <time datetime="${escapeHtml(m.createdAt)}">${escapeHtml(m.createdAt)}</time>`
          : "";
      parts.push(
        `<section class="msg msg--tool">\n  <h2>Tool</h2>${time}\n  <ul>\n    <li>${escapeHtml(line)}</li>\n  </ul>\n</section>`,
      );
      continue;
    }

    if (!body && !thought) continue;

    const role = roleHeading(m.role);
    const roleClass =
      m.role === "user" ? "user" : m.role === "assistant" ? "assistant" : "other";
    const time =
      m.createdAt && m.createdAt.trim()
        ? `\n  <time datetime="${escapeHtml(m.createdAt)}">${escapeHtml(m.createdAt)}</time>`
        : "";
    const thoughtBlock =
      includeThoughts && thought
        ? `\n  <details class="thought">\n    <summary>Thinking</summary>\n    <pre>${escapeHtml(thought)}</pre>\n  </details>`
        : "";
    const bodyBlock = body
      ? `\n  <div class="content"><pre>${escapeHtml(body)}</pre></div>`
      : "";

    parts.push(
      `<section class="msg msg--${roleClass}">\n  <h2>${escapeHtml(role)}</h2>${time}${thoughtBlock}${bodyBlock}\n</section>`,
    );
  }

  return parts.join("\n\n");
}

const HTML_EXPORT_STYLES = `body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;max-width:48rem;margin:1.5rem auto;padding:0 1rem;color:#111;background:#fff}
h1{font-size:1.5rem;margin:0 0 .75rem}
.meta{list-style:none;padding:0;margin:0 0 1rem;color:#555;font-size:.875rem}
.meta li{margin:.15rem 0}
hr{border:none;border-top:1px solid #ddd;margin:1.25rem 0}
.msg{margin:1.25rem 0;padding:.75rem 0;border-bottom:1px solid #eee}
.msg h2{font-size:1rem;margin:0 0 .35rem}
.msg time{display:block;font-size:.75rem;color:#777;margin-bottom:.5rem}
.msg .content pre,.msg .thought pre{white-space:pre-wrap;word-break:break-word;margin:.5rem 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.875rem}
.msg .thought{margin:.5rem 0;color:#444}
.msg--tool ul{margin:.35rem 0 0;padding-left:1.25rem}
@media (prefers-color-scheme:dark){body{color:#e8e8e8;background:#121212}.meta,.msg time{color:#aaa}hr,.msg{border-color:#333}.msg .thought{color:#ccc}}`;

/**
 * Render a session as a standalone HTML document.
 * Export defaults keep tool summaries on (unlike {@link messagesToHtml}).
 */
export function sessionToHtml(input: SessionExportInput): string {
  const opts = input.options ?? {};
  const includeThoughts = opts.includeThoughts !== false;
  const includeToolSummary = opts.includeToolSummary !== false;

  const title = (input.title || "Untitled").trim() || "Untitled";
  const exportedAt = input.exportedAt || new Date().toISOString();

  const metaItems: string[] = [];
  if (input.projectName) {
    metaItems.push(`<li>Project: ${escapeHtml(input.projectName)}</li>`);
  }
  if (input.projectPath) {
    metaItems.push(`<li>Path: ${escapeHtml(input.projectPath)}</li>`);
  }
  if (input.sessionId) {
    metaItems.push(`<li>Session: ${escapeHtml(input.sessionId)}</li>`);
  }
  metaItems.push(`<li>Exported: ${escapeHtml(exportedAt)}</li>`);

  const body = messagesToHtml(input.messages, {
    includeThoughts,
    includeToolSummary,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${HTML_EXPORT_STYLES}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<ul class="meta">
${metaItems.join("\n")}
</ul>
<hr>
${body ? `${body}\n` : ""}</body>
</html>
`;
}

export type MessagesToPlainOptions = MessagesToMarkdownOptions;

/**
 * Pure message list → plain text (no markdown chrome).
 * Role lines as `User:` / `Assistant:`; thoughts as indented `Thinking:`.
 * Defaults match {@link messagesToMarkdown}: thoughts on, tool_step noise off.
 */
export function messagesToPlain(
  messages: ExportableMessage[],
  opts?: MessagesToPlainOptions,
): string {
  const includeThoughts = opts?.includeThoughts !== false;
  const includeToolSummary = opts?.includeToolSummary === true;

  const blocks: string[] = [];

  for (const m of messages) {
    const body = (m.content || "").trim();
    const thought = (m.thought || "").trim();

    if (isToolish(m)) {
      if (!includeToolSummary) continue;
      const line = formatToolSummaryLine(body, m.marker);
      if (!line) continue;
      const head = m.createdAt?.trim()
        ? `Tool (${m.createdAt.trim()}):\n${line}`
        : `Tool:\n${line}`;
      blocks.push(head);
      continue;
    }

    if (!body && !thought) continue;

    const role = roleHeading(m.role);
    const lines: string[] = [];
    if (m.createdAt?.trim()) {
      lines.push(`${role} (${m.createdAt.trim()}):`);
    } else {
      lines.push(`${role}:`);
    }
    if (includeThoughts && thought) {
      lines.push("Thinking:");
      lines.push(thought);
      if (body) lines.push("");
    }
    if (body) {
      lines.push(body);
    }
    blocks.push(lines.join("\n"));
  }

  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Render a session as plain text (aligned with headless `--output-format plain`).
 * Export defaults keep tool summaries on (unlike {@link messagesToPlain}).
 */
export function sessionToPlain(input: SessionExportInput): string {
  const opts = input.options ?? {};
  const includeThoughts = opts.includeThoughts !== false;
  const includeToolSummary = opts.includeToolSummary !== false;

  const lines: string[] = [];
  const title = (input.title || "Untitled").trim() || "Untitled";
  lines.push(title);
  lines.push("=".repeat(Math.min(title.length, 72)));
  lines.push("");

  const meta: string[] = [];
  if (input.projectName) meta.push(`Project: ${input.projectName}`);
  if (input.projectPath) meta.push(`Path: ${input.projectPath}`);
  if (input.sessionId) meta.push(`Session: ${input.sessionId}`);
  meta.push(`Exported: ${input.exportedAt || new Date().toISOString()}`);
  lines.push(...meta);
  lines.push("");
  lines.push("---");
  lines.push("");

  const body = messagesToPlain(input.messages, {
    includeThoughts,
    includeToolSummary,
  });
  if (body) {
    lines.push(body);
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export type SessionJsonMessage = {
  role: "user" | "assistant";
  content: string;
  /** Present only when includeThoughts and thought is non-empty. Import ignores unknown fields. */
  thought?: string;
};

export type SessionJsonExport = {
  title: string;
  sessionId?: string;
  exportedAt: string;
  messages: SessionJsonMessage[];
};

/**
 * Render a session as pretty-printed JSON for re-import.
 *
 * Shape matches `session_import` object form (`messages: [{role,content}]`).
 * Defaults omit tools and thoughts for a clean round-trip. Tools are never
 * re-importable as user/assistant, so they are omitted unless
 * `includeToolSummary` is true (then emitted as assistant `[tool] …` lines).
 * Set `includeThoughts` to attach optional `thought` fields (import ignores them).
 */
export function sessionToJson(input: SessionExportInput): string {
  const opts = input.options ?? {};
  // Prefer clean re-import: tools/thoughts off unless explicitly requested.
  const includeThoughts = opts.includeThoughts === true;
  const includeToolSummary = opts.includeToolSummary === true;

  const title = (input.title || "Untitled").trim() || "Untitled";
  const exportedAt = input.exportedAt || new Date().toISOString();
  const messages: SessionJsonMessage[] = [];

  for (const m of input.messages) {
    if (isToolish(m)) {
      if (!includeToolSummary) continue;
      const line = formatToolSummaryLine((m.content || "").trim(), m.marker);
      if (!line) continue;
      // Import only keeps user/assistant; surface tool summary as assistant text.
      messages.push({ role: "assistant", content: `[tool] ${line}` });
      continue;
    }

    const roleRaw = (m.role || "").trim().toLowerCase();
    const role: "user" | "assistant" | null =
      roleRaw === "user" || roleRaw === "human" || roleRaw === "me" || roleRaw === "prompt"
        ? "user"
        : roleRaw === "assistant" ||
            roleRaw === "ai" ||
            roleRaw === "bot" ||
            roleRaw === "model" ||
            roleRaw === "grok" ||
            roleRaw === "agent"
          ? "assistant"
          : null;
    if (!role) continue;

    const content = (m.content || "").trim();
    if (!content) continue; // import requires non-empty content

    const row: SessionJsonMessage = { role, content };
    const thought = (m.thought || "").trim();
    if (includeThoughts && thought) {
      row.thought = thought;
    }
    messages.push(row);
  }

  const out: SessionJsonExport = {
    title,
    exportedAt,
    messages,
  };
  if (input.sessionId) {
    out.sessionId = input.sessionId;
  }

  return `${JSON.stringify(out, null, 2)}\n`;
}
