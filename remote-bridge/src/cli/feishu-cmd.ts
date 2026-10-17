import fs from "node:fs";
import path from "node:path";
import qrcode from "qrcode-terminal";
import {
  FEISHU_SETUP_MODE_AUTO,
  FEISHU_SETUP_MODE_BIND,
  FEISHU_SETUP_MODE_NEW,
  normalizePlatformType,
  resolveFeishuSetupInputs,
  type FeishuSetupMode,
} from "../feishu/setup.js";
import { validateAppCredentials, fetchBotOpenId } from "../feishu/credentials.js";
import { runRegistrationFlow } from "../feishu/registration.js";
import { saveFeishuCredentials } from "../config/save.js";
import { loadConfig, listProjectNames } from "../config/load.js";
import { log } from "../util/logger.js";

export function printFeishuUsage(): void {
  console.log(`Usage: agent-connect feishu <command> [options]

Commands:
  setup   Unified entry: no credentials => NEW (QR); with --app => BIND
  new     Force NEW flow (QR onboarding). Rejects --app/--app-id.
  bind    Force BIND flow (requires app_id/app_secret).

Options:
  --config <path>             Path to config file
  --project <name>            Target project (default: default; auto-created)
  --platform-type <type>      Force platform type: feishu or lark
  --app <id:secret>           Existing credentials (recommended for bind/setup)
  --app-id <id>               Existing app_id
  --app-secret <secret>       Existing app_secret
  --timeout <seconds>         QR onboarding timeout (default: 600)
  --qr-image <path>           Save QR code as PNG (requires optional tooling)
  --set-allow-from-empty      Write owner open_id into allow_from when available
  --work-dir <path>           Grok work_dir for the project
  --debug                     Print onboarding debug logs

Examples:
  agent-connect feishu setup --project default
  agent-connect feishu setup --project default --app cli_xxx:sec_xxx
  agent-connect feishu bind --project default --app cli_xxx:sec_xxx
  agent-connect feishu new --project default --platform-type lark`);
}

function parseArgs(args: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--help" || a === "-h") {
      out.help = true;
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

export async function runFeishuCommand(args: string[]): Promise<number> {
  if (!args.length || args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    printFeishuUsage();
    return 0;
  }

  const sub = args[0]!;
  let mode: FeishuSetupMode;
  switch (sub) {
    case "setup":
      mode = FEISHU_SETUP_MODE_AUTO;
      break;
    case "new":
    case "create":
      mode = FEISHU_SETUP_MODE_NEW;
      break;
    case "bind":
    case "link":
      mode = FEISHU_SETUP_MODE_BIND;
      break;
    default:
      console.error(`Unknown feishu subcommand: ${sub}\n`);
      printFeishuUsage();
      return 1;
  }

  const flags = parseArgs(args.slice(1));
  if (flags.help) {
    printFeishuUsage();
    return 0;
  }

  try {
    const resolved = resolveFeishuSetupInputs({
      mode,
      app: String(flags.app || ""),
      appId: String(flags["app-id"] || ""),
      appSecret: String(flags["app-secret"] || ""),
    });

    const projectName = String(flags.project || "default");
    const configPath = flags.config ? String(flags.config) : undefined;
    const platformType = normalizePlatformType(
      flags["platform-type"] ? String(flags["platform-type"]) : "",
    );
    const timeout = Number(flags.timeout) || 600;
    const debug = Boolean(flags.debug);
    const setAllowFromEmpty = Boolean(flags["set-allow-from-empty"]);
    const workDir = flags["work-dir"]
      ? path.resolve(String(flags["work-dir"]))
      : process.cwd();

    let appId = resolved.appId;
    let appSecret = resolved.appSecret;
    let ownerOpenId = "";
    let finalPlatform = platformType;

    if (resolved.effectiveMode === FEISHU_SETUP_MODE_BIND) {
      const validated = await validateAppCredentials(
        appId,
        appSecret,
        platformType || "",
      );
      finalPlatform = validated.platform;
      console.log(`Credentials verified for app_id ${appId} (${validated.platform}).`);
    } else {
      console.log("请使用飞书/Lark 手机 App 扫码完成机器人创建与授权：");
      const result = await runRegistrationFlow({
        timeoutSeconds: timeout,
        debug,
        onQr: async (uri) => {
          console.log(`URL: ${uri}\n`);
          try {
            qrcode.generate(uri, { small: true });
            console.log("");
          } catch {
            /* terminal QR optional */
          }
          const qrImage = flags["qr-image"] ? String(flags["qr-image"]) : "";
          if (qrImage) {
            // Minimal: write URL to sibling .txt so user can open; full PNG needs extra dep
            const txtPath = qrImage.endsWith(".png")
              ? qrImage.replace(/\.png$/i, ".url.txt")
              : `${qrImage}.url.txt`;
            fs.writeFileSync(txtPath, uri + "\n", "utf8");
            console.log(`QR URL saved to: ${txtPath}`);
          }
        },
      });
      appId = result.appId;
      appSecret = result.appSecret;
      ownerOpenId = result.ownerOpenId;
      if (!finalPlatform) finalPlatform = result.platform;
    }

    const saved = saveFeishuCredentials({
      configPath,
      projectName,
      appId,
      appSecret,
      platform: (finalPlatform || "feishu") as "feishu" | "lark",
      ownerOpenId,
      setAllowFromEmpty,
      workDir,
    });

    if (saved.created) {
      console.log(`Created project ${JSON.stringify(projectName)} automatically.`);
    }

    console.log(`✅ Feishu/Lark bot configured for project ${JSON.stringify(saved.projectName)}`);
    console.log(`   Platform: ${saved.platform}`);
    console.log(`   App ID:   ${appId}`);
    console.log(`   Config:   ${saved.path}`);
    if (saved.allowFrom) console.log(`   allow_from: ${saved.allowFrom}`);
    console.log("");

    if (ownerOpenId) {
      try {
        const botId = await fetchBotOpenId(
          appId,
          appSecret,
          (finalPlatform || "feishu") as "feishu" | "lark",
        );
        if (botId && botId === ownerOpenId) {
          console.log("⚠️  注册返回的 open_id 可能是机器人自身 ID，不一定可用于 allow_from。");
          console.log("   启动后向机器人发送 /whoami 获取你的用户 open_id。\n");
        }
      } catch {
        /* ignore */
      }
    }

    printPostSetupGuide(saved.platform);
    return 0;
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    if (mode === FEISHU_SETUP_MODE_NEW || mode === FEISHU_SETUP_MODE_AUTO) {
      console.error(
        "Tip: you can bind an existing bot with `agent-connect feishu bind --app app_id:app_secret`",
      );
    }
    return 1;
  }
}

function printPostSetupGuide(platform: string): void {
  const base =
    platform === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn";
  console.log("下一步：");
  console.log("  1. 确认应用已启用「机器人」能力");
  console.log("  2. 事件订阅选择「使用长连接接收事件」，添加 im.message.receive_v1");
  console.log("  3. 发布应用版本，并把机器人加到会话");
  console.log(`  4. 开发者后台: ${base}/app`);
  console.log("  5. 启动桥接: agent-connect start --all");
  console.log("");
  console.log("提醒：扫码新建通常会预配权限与事件；请在开放平台核验发布状态与可用范围。");
}

export function resolveDefaultProject(configPath?: string, name?: string): string {
  if (name) return name;
  const { config } = loadConfig(configPath);
  const names = listProjectNames(config);
  if (names.length === 1) return names[0]!;
  if (names.length === 0) return "default";
  throw new Error(
    `multiple projects found, please specify --project (${names.join(", ")})`,
  );
}

// silence unused in some builds
void log;
