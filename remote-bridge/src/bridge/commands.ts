/**
 * Slash command parsing and help text.
 * Aligns with Grok App Remote IM: /p project · /r resume.
 */

export type BuiltinCommand =
  | { name: "help" }
  | { name: "new" }
  | { name: "whoami" }
  | { name: "status" }
  | { name: "stop" }
  | { name: "project"; query?: string }
  | { name: "resume"; query?: string }
  | { name: "unknown"; raw: string };

export function parseSlashCommand(text: string): BuiltinCommand | null {
  const t = text.trim();
  if (!t.startsWith("/")) return null;
  const rest = t.slice(1);
  const sp = rest.indexOf(" ");
  const head = (sp < 0 ? rest : rest.slice(0, sp)).toLowerCase();
  const query = (sp < 0 ? "" : rest.slice(sp + 1)).trim();
  switch (head) {
    case "help":
    case "h":
    case "?":
      return { name: "help" };
    case "new":
    case "reset":
      return { name: "new" };
    case "whoami":
    case "id":
      return { name: "whoami" };
    case "status":
      return { name: "status" };
    case "stop":
    case "cancel":
      return { name: "stop" };
    case "p":
    case "project":
      return query ? { name: "project", query } : { name: "project" };
    case "r":
    case "resume":
      return query ? { name: "resume", query } : { name: "resume" };
    default:
      return { name: "unknown", raw: head };
  }
}

export function helpText(lang: "zh" | "en" = "zh"): string {
  if (lang === "en") {
    return [
      "**Grok Remote Bridge** — local Grok Build via IM",
      "",
      "Commands:",
      "- `/help` — this message",
      "- `/p` · `/project` — list / bind a trusted project (new session)",
      "- `/p <name|n>` — bind project by name or number",
      "- `/r` · `/resume` — list / resume a prior session",
      "- `/r <n>` — resume by number",
      "- `/new` — fresh Grok session (keep project)",
      "- `/whoami` — show your open_id (for allow_from)",
      "- `/status` — project + session snapshot",
      "- `/stop` — cancel in-flight turn",
      "- `0` — cancel number-pick mode",
      "",
      "After `/p`, the next message starts a **new** session.",
      "After `/r`, the next message **resumes** that session.",
    ].join("\n");
  }
  return [
    "**Grok Remote Bridge** — 本地 Grok Build 远程 IM 桥",
    "",
    "命令：",
    "- `/help` — 显示帮助",
    "- `/p` · `/project` — 列出 / 绑定已信任项目（新会话）",
    "- `/p <名|序号>` — 按名称或序号绑定项目",
    "- `/r` · `/resume` — 列出 / 恢复历史会话",
    "- `/r <序号>` — 按序号恢复",
    "- `/new` — 保持项目，开启新会话",
    "- `/whoami` — 查看 open_id",
    "- `/status` — 项目与会话状态",
    "- `/stop` — 中断当前任务",
    "- `0` — 取消序号选择",
    "",
    "绑定项目后直接说话 = **新会话**；`/r` 选定后 = **恢复会话**。",
  ].join("\n");
}
