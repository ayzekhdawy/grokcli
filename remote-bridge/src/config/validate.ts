/**
 * Multi-project config validation (architecture §4.4).
 */

import type { AppConfig, ProjectConfig } from "./types.js";
import { isPlaceholderCredential } from "./credentials.js";

export interface ValidationIssue {
  level: "error" | "warn";
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

function platformBindings(p: ProjectConfig): Array<{
  type: string;
  app_id: string;
  app_secret: string;
  allow_chat?: string;
  allow_from?: string;
}> {
  // Always include resolved primary feishu so validation matches runtime Engine wiring
  const primary = {
    type: "feishu" as const,
    app_id: p.feishu?.app_id || "",
    app_secret: p.feishu?.app_secret || "",
    allow_chat: p.allow_chat,
    allow_from: p.allow_from,
  };

  if (!p.platforms?.length) {
    return [primary];
  }

  const extra = p.platforms
    .filter(
      (pl) =>
        !(pl.app_id === primary.app_id && pl.app_secret === primary.app_secret),
    )
    .map((pl) => ({
      type: pl.type,
      app_id: pl.app_id,
      app_secret: pl.app_secret,
      allow_chat: pl.allow_chat ?? p.allow_chat,
      allow_from: pl.allow_from ?? p.allow_from,
    }));

  return [primary, ...extra];
}

function parseChatList(raw?: string): string[] {
  if (!raw || !raw.trim() || raw.trim() === "*") return ["*"];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function chatsOverlap(a?: string, b?: string): boolean {
  const la = parseChatList(a);
  const lb = parseChatList(b);
  if (la.includes("*") || lb.includes("*")) return true;
  const setB = new Set(lb);
  return la.some((c) => setB.has(c));
}

export function validateConfig(config: AppConfig): ValidationResult {
  const issues: ValidationIssue[] = [];
  const names = new Set<string>();

  for (const p of config.projects) {
    if (names.has(p.name)) {
      issues.push({
        level: "error",
        code: "duplicate_project_name",
        message: `Duplicate project name: ${p.name}`,
      });
    }
    names.add(p.name);

    const bindings = platformBindings(p);
    const appIdsInProject = new Set<string>();
    for (const b of bindings) {
      if (b.type === "feishu" || b.type === "lark" || !b.type) {
        if (!b.app_id || !b.app_secret) {
          issues.push({
            level: "error",
            code: "missing_feishu_credentials",
            message: `Project ${p.name}: missing app_id/app_secret`,
          });
        } else if (
          isPlaceholderCredential(b.app_id) ||
          isPlaceholderCredential(b.app_secret)
        ) {
          issues.push({
            level: "error",
            code: "placeholder_credentials",
            message: `Project ${p.name}: app_id/app_secret still look like example placeholders (e.g. cli_*_xxxxxxxx). Run \`agent-connect feishu bind --project ${p.name} --app 'cli_xxx:sec_xxx'\` or remove copy-pasted values from config.example.toml`,
          });
        }
        if (b.app_id && !isPlaceholderCredential(b.app_id)) {
          if (appIdsInProject.has(b.app_id)) {
            issues.push({
              level: "error",
              code: "duplicate_app_id_in_project",
              message: `Project ${p.name}: duplicate app_id ${b.app_id}`,
            });
          }
          appIdsInProject.add(b.app_id);
        }
      }
      const allowFrom = b.allow_from ?? p.allow_from;
      if (!allowFrom || !String(allowFrom).trim()) {
        issues.push({
          level: "warn",
          code: "permit_all_allow_from",
          message: `Project ${p.name}: empty allow_from permits all users`,
        });
      }
    }

    const workDir = p.agent?.work_dir || p.grok?.work_dir;
    if (!workDir) {
      issues.push({
        level: "error",
        code: "missing_work_dir",
        message: `Project ${p.name}: missing work_dir`,
      });
    }
  }

  // Cross-project same app_id → validate allow_chat overlap
  const byApp = new Map<string, Array<{ project: string; allow_chat?: string }>>();
  for (const p of config.projects) {
    for (const b of platformBindings(p)) {
      if (!b.app_id) continue;
      const list = byApp.get(b.app_id) || [];
      list.push({ project: p.name, allow_chat: b.allow_chat });
      byApp.set(b.app_id, list);
    }
  }
  for (const [appId, owners] of byApp) {
    if (owners.length < 2) continue;
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        if (chatsOverlap(owners[i]!.allow_chat, owners[j]!.allow_chat)) {
          issues.push({
            level: "error",
            code: "overlapping_allow_chat",
            message: `app_id ${appId}: overlapping allow_chat between projects ${owners[i]!.project} and ${owners[j]!.project}`,
          });
        }
      }
    }
  }

  return {
    ok: !issues.some((i) => i.level === "error"),
    issues,
  };
}
