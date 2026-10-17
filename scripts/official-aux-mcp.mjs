#!/usr/bin/env node
/**
 * Official-aux MCP server (stdio JSON-RPC).
 *
 * Runs isolated `grok -p -m grok-4.5` under OFFICIAL_AUX_HOME (official auth),
 * exposing web_search + all x_* tools for sessions whose main model is a
 * text-only custom relay (DeepSeek, etc.).
 *
 * Env (injected by Grok App):
 *   OFFICIAL_AUX_HOME  — GROK_HOME for side-channel (agent-home-official)
 *   OFFICIAL_AUX_MODEL — default grok-4.5
 *   OFFICIAL_AUX_CLI   — path to grok binary
 *   GROK_HOME          — same as OFFICIAL_AUX_HOME
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import process from "node:process";

const HOME = process.env.OFFICIAL_AUX_HOME || process.env.GROK_HOME || "";
const MODEL = process.env.OFFICIAL_AUX_MODEL || "grok-4.5";
const CLI = process.env.OFFICIAL_AUX_CLI || "grok";

const TOOLS = [
  {
    name: "web_search",
    description:
      "Web search / 网页搜索 / 联网搜索 using official Grok credentials (isolated). " +
      "PRIMARY tool for general internet queries when the main model has no built-in web_search. " +
      "Keywords: google, bing, 搜索网页, 查资料, news, 新闻.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (any language)" },
      },
      required: ["query"],
    },
  },
  {
    name: "x_keyword_search",
    description:
      "PRIMARY tool for X/Twitter post search. " +
      "Search X (Twitter) tweets/posts with keywords or advanced operators (lang:zh, from:user, since:YYYY-MM-DD). " +
      "Use this when the user asks to search X / Twitter / 推特 / 推文 / x上 / 在x上 / x.com posts. " +
      "Aliases: twitter search, 推特搜索, X搜索, 搜推文, x_keyword_search. " +
      "Prefer this over Playwright, open-websearch, or curl for X content.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keyword query, e.g. 飞书 lang:zh or Feishu OR Lark",
        },
        limit: { type: "number", description: "Max posts (tool caps ~10 per call)" },
        min_faves: { type: "number", description: "Optional minimum likes filter" },
      },
      required: ["query"],
    },
  },
  {
    name: "x_semantic_search",
    description:
      "Semantic / meaning-based search on X (Twitter) posts. " +
      "Use for topical research when keywords are fuzzy (e.g. 飞书最新动态, product launch discussion). " +
      "Keywords: semantic twitter, 语义搜索推特, X话题. Prefer x_keyword_search for exact terms.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language topic query" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "x_user_search",
    description:
      "Search X (Twitter) users/accounts by name or handle. " +
      "Use when the user wants a profile, 账号, @handle, or who someone is on X. " +
      "Keywords: twitter user, 搜用户, 推特账号, x_user_search.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Display name or @handle without @" },
        count: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "x_thread_fetch",
    description:
      "Fetch a full X (Twitter) post thread by status id or https://x.com/.../status/... URL. " +
      "Keywords: thread, 串文, 推文详情, x_thread_fetch.",
    inputSchema: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "Status id or status URL" },
        url: { type: "string", description: "Optional x.com status URL" },
      },
    },
  },
  {
    name: "vision_describe",
    description:
      "Describe local image files with official Grok vision. " +
      "Skip if the prompt already has [Host vision] or <image_description>. " +
      "Keywords: 识图, describe image, vision, 看图.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute image path" },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Multiple absolute image paths",
        },
        question: { type: "string" },
      },
    },
  },
  {
    name: "image_gen",
    description:
      "PRIMARY Imagine tool — generate images from a text prompt using official Grok Imagine. " +
      "Call via use_tool with tool_name official-aux__image_gen (NOT bare image_gen — that is blocked on custom main). " +
      "Use when the user asks to 画图 / 生成图片 / generate image / imagine / 出图 / 文生图. " +
      "Keywords: image_gen, imagine, AI画图, 生成图, wallpaper, poster, illustration. " +
      "Prefer this over third-party image APIs / PIL / code art when official credentials are available.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Image generation prompt (any language)",
        },
        aspect_ratio: {
          type: "string",
          description:
            "Aspect ratio e.g. 1:1, 16:9, 9:16, 3:2, 2:3 (default 1:1)",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "image_edit",
    description:
      "Edit or transform existing local image(s) via official Grok Imagine. " +
      "Call via use_tool with tool_name official-aux__image_edit (NOT bare image_edit — blocked on custom main). " +
      "Use for 改图 / 修图 / style transfer / inpaint-style edits with a reference path. " +
      "Keywords: image_edit, edit image, 修图, 改图, remix.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "What the output image should look like",
        },
        image: {
          type: "string",
          description: "Absolute path to the reference image",
        },
        images: {
          type: "array",
          items: { type: "string" },
          description: "Multiple absolute reference image paths",
        },
        aspect_ratio: {
          type: "string",
          description: "Optional output aspect ratio for multi-image edits",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "image_to_video",
    description:
      "PRIMARY video tool — animate a single local image into a short video via official Grok. " +
      "Call via use_tool with tool_name official-aux__image_to_video (NOT bare image_to_video — blocked on custom main). " +
      "Use when the user asks to 生成视频 / 图生视频 / animate image / make a video from a photo / 动起来. " +
      "Keywords: image_to_video, video, 视频, 动画, animate, mp4. " +
      "Requires one absolute image path (source frame).",
    inputSchema: {
      type: "object",
      properties: {
        image: {
          type: "string",
          description: "Absolute path to the source image (first frame)",
        },
        prompt: {
          type: "string",
          description: "Optional motion / camera guidance",
        },
        duration: {
          type: "number",
          description: "Duration seconds: 6 or 10 (default 6)",
        },
        resolution_name: {
          type: "string",
          description: "480p or 720p (default 480p)",
        },
      },
      required: ["image"],
    },
  },
  {
    name: "reference_to_video",
    description:
      "Generate a video from 2–7 reference images + text prompt via official Grok. " +
      "Call via use_tool with tool_name official-aux__reference_to_video (NOT bare reference_to_video — blocked on custom main). " +
      "Use for multi-image style/content references, 多图参考生成视频. " +
      "Keywords: reference_to_video, multi-image video, 参考图视频.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Describe the desired video",
        },
        images: {
          type: "array",
          items: { type: "string" },
          description: "2–7 absolute image paths as style/content references",
        },
        aspect_ratio: {
          type: "string",
          description: "e.g. 16:9, 9:16, 1:1",
        },
        duration: {
          type: "number",
          description: "Duration seconds: 6 or 10 (default 6)",
        },
        resolution_name: {
          type: "string",
          description: "480p or 720p (default 480p)",
        },
      },
      required: ["prompt", "images"],
    },
  },
];

function buildPrompt(name, args) {
  const a = args || {};
  switch (name) {
    case "web_search": {
      const q = String(a.query || a.q || "").trim();
      return `You are an isolated research side-job with official Grok credentials.

Use the built-in **web_search** tool (and web_fetch if needed) for:
${q}

Rules:
1. You MUST call web_search at least once.
2. Prefer primary sources; include URLs.
3. Reply in the same language as the query.
4. Do not edit files.
5. Final answer: concise markdown findings + link list.`;
    }
    case "x_keyword_search": {
      const q = String(a.query || a.q || "").trim();
      const limit = Math.min(25, Math.max(1, Number(a.limit) || 10));
      const faves =
        a.min_faves != null || a.minFaves != null
          ? `min_faves: ${a.min_faves ?? a.minFaves}`
          : "";
      return `You are an isolated X research side-job with official Grok credentials.

Call **x_keyword_search** with query: ${q}, limit: ${limit}. ${faves}
Fallback: x_semantic_search if needed.

Return markdown with real https://x.com/…/status/… URLs. No file edits.`;
    }
    case "x_semantic_search": {
      const q = String(a.query || a.q || "").trim();
      const limit = Math.min(25, Math.max(1, Number(a.limit) || 10));
      return `You are an isolated X research side-job with official Grok credentials.

Call **x_semantic_search** with query: ${q}, limit: ${limit}.
Fallback: x_keyword_search.

Return markdown with x.com status URLs. No file edits.`;
    }
    case "x_user_search": {
      const q = String(a.query || a.q || "").trim();
      const count = Math.min(20, Math.max(1, Number(a.count) || 5));
      return `You are an isolated X research side-job with official Grok credentials.

Call **x_user_search** with query: ${q}, count: ${count}.

Return markdown: handle, name, bio, profile url. No file edits.`;
    }
    case "x_thread_fetch": {
      const id = String(a.post_id || a.postId || a.url || a.id || "").trim();
      return `You are an isolated X research side-job with official Grok credentials.

Call **x_thread_fetch** for: ${id}

Return thread as markdown with status URLs. No file edits.`;
    }
    case "vision_describe": {
      const paths = Array.isArray(a.paths)
        ? a.paths.map(String)
        : a.path
          ? [String(a.path)]
          : [];
      const q =
        String(a.question || "").trim() ||
        "Describe each image thoroughly for a coding agent.";
      const refs = paths.map((p) => `@${p}`).join("\n");
      return `${q}

Images (native vision):
${refs}

One <image_description path="…"> block per image. Do not refuse.`;
    }
    case "image_gen": {
      const prompt = String(a.prompt || a.query || a.q || "").trim();
      const ar = String(a.aspect_ratio || a.aspectRatio || "1:1").trim() || "1:1";
      return `You are an isolated Imagine side-job with official Grok credentials.

Call the built-in tool **image_gen** with:
- prompt: ${prompt}
- aspect_ratio: ${ar}

Rules:
1. You MUST call image_gen (not web_search, not vision_describe).
2. After generation, report each resulting image as an absolute filesystem path.
3. Do not invent paths that do not exist on disk.
4. Final answer: short markdown with the path(s) and one-line caption.`;
    }
    case "image_edit": {
      const prompt = String(a.prompt || a.query || a.q || "").trim();
      const imgs = Array.isArray(a.images)
        ? a.images.map(String)
        : a.image
          ? [String(a.image)]
          : a.path
            ? [String(a.path)]
            : [];
      const ar = String(a.aspect_ratio || a.aspectRatio || "").trim();
      const refs = imgs.map((p) => `@${p}`).join("\n");
      const arLine = ar ? `- aspect_ratio: ${ar}` : "";
      return `You are an isolated Imagine side-job with official Grok credentials.

Call the built-in tool **image_edit** with the user edit request and reference image(s).

Edit prompt: ${prompt}

Reference image(s) (read with vision if needed, then image_edit):
${refs || "(none — if missing, say so)"}
${arLine}

Rules:
1. You MUST call image_edit when at least one reference path exists.
2. Report absolute path(s) of the edited output file(s).
3. Do not invent paths. Final answer: markdown with path(s).`;
    }
    case "image_to_video": {
      const img = String(a.image || a.path || "").trim();
      const prompt = String(a.prompt || a.query || a.q || "").trim();
      let duration = Number(a.duration);
      if (duration !== 10) duration = 6;
      const res = String(a.resolution_name || a.resolutionName || "480p").trim() || "480p";
      const motion = prompt
        ? `Motion / camera guidance: ${prompt}`
        : "Use a natural, subtle animation unless the image suggests otherwise.";
      return `You are an isolated Imagine video side-job with official Grok credentials.

Call the built-in tool **image_to_video** with:
- image: the source image below (absolute path)
- duration: ${duration}
- resolution_name: ${res}
${prompt ? `- prompt: ${prompt}` : ""}

Source image:
@${img || "(missing path)"}

${motion}

Rules:
1. You MUST call image_to_video (not image_gen, not image_edit).
2. Report the absolute path of the generated video file (e.g. .mp4).
3. Do not invent paths. Final answer: markdown with the video path.`;
    }
    case "reference_to_video": {
      const prompt = String(a.prompt || a.query || a.q || "").trim();
      const imgs = Array.isArray(a.images)
        ? a.images.map(String)
        : a.image
          ? [String(a.image)]
          : [];
      const ar = String(a.aspect_ratio || a.aspectRatio || "16:9").trim() || "16:9";
      let duration = Number(a.duration);
      if (duration !== 10) duration = 6;
      const res = String(a.resolution_name || a.resolutionName || "480p").trim() || "480p";
      const refs = imgs.map((p) => `@${p}`).join("\n");
      return `You are an isolated Imagine video side-job with official Grok credentials.

Call the built-in tool **reference_to_video** with:
- prompt: ${prompt}
- images: the reference images below (2–7 paths)
- aspect_ratio: ${ar}
- duration: ${duration}
- resolution_name: ${res}

Reference images:
${refs || "(none)"}

Rules:
1. You MUST call reference_to_video when 2+ reference images exist; if only one image, use image_to_video instead.
2. Report the absolute path of the generated video file.
3. Do not invent paths. Final answer: markdown with the video path.`;
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function toolTimeoutMs(name) {
  if (
    name === "image_gen" ||
    name === "image_edit" ||
    name === "image_to_video" ||
    name === "reference_to_video"
  ) {
    return 420_000;
  }
  return 180_000;
}

function toolMaxTurns(name) {
  if (
    name === "image_gen" ||
    name === "image_edit" ||
    name === "image_to_video" ||
    name === "reference_to_video"
  ) {
    return "16";
  }
  return "12";
}

function runGrok(prompt, toolName) {
  return new Promise((resolve, reject) => {
    if (!HOME) {
      reject(new Error("OFFICIAL_AUX_HOME / GROK_HOME not set"));
      return;
    }
    const timeoutMs = toolTimeoutMs(toolName);
    const args = [
      "--no-auto-update",
      "-p",
      prompt,
      "-m",
      MODEL,
      "--always-approve",
      "--max-turns",
      toolMaxTurns(toolName),
      "--effort",
      "low",
      "--output-format",
      "plain",
    ];
    const child = spawn(CLI, args, {
      env: {
        ...process.env,
        GROK_HOME: HOME,
        OFFICIAL_AUX_HOME: HOME,
        GROK_WEB_SEARCH_MODEL: MODEL,
        GROK_IMAGE_DESCRIPTION_MODEL: MODEL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          `official aux timeout (${Math.round(timeoutMs / 1000)}s): ${stderr.slice(0, 300)}`,
        ),
      );
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (stdout.trim()) {
        resolve(stdout.trim());
        return;
      }
      reject(
        new Error(
          `official aux exit ${code}: ${(stderr || "no output").slice(0, 500)}`,
        ),
      );
    });
  });
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function okResult(id, text) {
  send({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: String(text) }],
      isError: false,
    },
  });
}

function errResult(id, message) {
  send({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: String(message) }],
      isError: true,
    },
  });
}

async function handle(msg) {
  if (!msg || typeof msg !== "object") return;
  const { id, method, params } = msg;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "official-aux", version: "1.0.0" },
      },
    });
    return;
  }

  if (method === "notifications/initialized" || method === "initialized") {
    return;
  }

  if (method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id,
      result: { tools: TOOLS },
    });
    return;
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      const prompt = buildPrompt(name, args);
      const text = await runGrok(prompt, name);
      okResult(id, text);
    } catch (e) {
      errResult(id, e?.message || String(e));
    }
    return;
  }

  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }

  // Ignore unknown notifications; error on requests with id.
  if (id !== undefined && id !== null) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const t = line.trim();
  if (!t) return;
  try {
    void handle(JSON.parse(t));
  } catch (e) {
    // ignore malformed
  }
});
