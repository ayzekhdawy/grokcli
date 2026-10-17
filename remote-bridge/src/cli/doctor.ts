import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load.js";
import { validateConfig } from "../config/validate.js";
import { isPlaceholderCredential } from "../config/credentials.js";
import { grokAuthExists, resolveGrokBinary, defaultDataDir, CLI_NAME } from "../util/paths.js";
import { redactString } from "../util/redact.js";

export function runDoctor(configPath?: string, projectName?: string): number {
  console.log(`${CLI_NAME} doctor\n`);
  let ok = true;

  const { path: cfgPath, config } = loadConfig(configPath);
  console.log(`config: ${fs.existsSync(cfgPath) ? cfgPath : cfgPath + " (missing)"}`);
  console.log(`data:   ${defaultDataDir()}`);

  const validation = validateConfig(config);
  for (const issue of validation.issues) {
    const line = redactString(`[${issue.level}] ${issue.code}: ${issue.message}`);
    console.log(line);
    if (issue.level === "error") ok = false;
  }

  const projects = projectName
    ? config.projects.filter((p) => p.name === projectName)
    : config.projects;

  if (!projects.length) {
    console.log("project: ❌ none — run `agent-connect feishu setup`");
    ok = false;
  }

  for (const project of projects) {
    console.log(`\nproject: ${project.name}`);
    const feishu = project.feishu;
    if (
      feishu.app_id &&
      feishu.app_secret &&
      !isPlaceholderCredential(feishu.app_id) &&
      !isPlaceholderCredential(feishu.app_secret)
    ) {
      console.log(
        `feishu:  ✅ app_id=${feishu.app_id} platform=${feishu.platform} secret=[REDACTED]`,
      );
    } else if (
      isPlaceholderCredential(feishu.app_id) ||
      isPlaceholderCredential(feishu.app_secret)
    ) {
      console.log(
        `feishu:  ❌ placeholder credentials (app_id=${feishu.app_id || "(empty)"}) — re-run feishu bind/setup`,
      );
      ok = false;
    } else {
      console.log("feishu:  ❌ missing app_id/app_secret");
      ok = false;
    }
    if (project.platforms?.length) {
      console.log(
        `platforms: ${project.platforms.length} binding(s) (primary resolved from best credentials)`,
      );
    }

    const abs = resolveGrokBinary(project.grok.command);
    if (path.isAbsolute(abs) || abs.includes(path.sep)) {
      if (fs.existsSync(abs)) console.log(`grok:    ✅ ${abs}`);
      else {
        console.log(`grok:    ❌ not found at ${abs}`);
        ok = false;
      }
    } else {
      const probed = resolveGrokBinary(project.grok.command);
      if (probed !== project.grok.command && fs.existsSync(probed)) {
        console.log(`grok:    ✅ ${probed}`);
      } else if (fs.existsSync(probed)) {
        console.log(`grok:    ✅ ${probed}`);
      } else {
        console.log(
          `grok:    ⚠️  \`${project.grok.command}\` not found on PATH or ~/.grok/bin`,
        );
        ok = false;
      }
    }

    console.log(`work_dir: ${project.grok.work_dir}`);
    console.log(`mode:     ${project.grok.mode}`);
    console.log(
      `auth:     ${grokAuthExists() ? "✅ ~/.grok/auth.json" : "⚠️  missing — run `grok` once to login"}`,
    );
    if (project.allow_chat) console.log(`allow_chat: ${project.allow_chat}`);
  }

  console.log(ok ? "\nOK" : "\nIssues found");
  return ok ? 0 : 1;
}
