/**
 * ChatCut Codex browser-handoff policy (pure helpers).
 *
 * Codex skills may request an in-app / “codex-internal-browser” handoff via
 * browserHandoff / liveProject / openStrategy. Grok App’s **default** is the
 * **system browser** — the side EmbeddedBrowser WebView cannot reliably play
 * ChatCut media or run the full editor. Opt into the side Resources browser
 * only with `forceEditorInApp: true`.
 *
 * Protocol notes:
 * - Prefer browserHandoff.url, then editorUrl, for the open target.
 * - System open uses a clean URL (strip Codex-only params dockviewLayout +
 *   editor-boot-token). In-app open (opt-in) may keep those params.
 * - Billing/pricing always uses the system browser.
 * - Locale path: zh → /zh/…, es → /es/…, else default English (no prefix).
 */

/** Codex-only query params that must stay on internal-browser URLs only. */
export const CHATCUT_INTERNAL_QUERY_PARAMS = [
  "dockviewLayout",
  "editor-boot-token",
] as const;

/** Host surface header value until ChatCut documents a Grok surface. */
export const CHATCUT_MCP_SURFACE_CODEX = "codex";

export const CHATCUT_MCP_URL =
  "https://api.chatcut.io/api/external-mcp/mcp";

export type ChatcutLocale = "zh" | "es" | "en" | "default";

export type ChatcutHandoffAction =
  | {
      kind: "open_in_app_browser";
      url: string;
      title?: string;
      /** Clean URL for Markdown / external display (params stripped). */
      displayUrl: string;
      source: "browserHandoff" | "editorUrl" | "liveProject" | "url";
    }
  | {
      kind: "open_external";
      url: string;
      /** editor = ChatCut editor (default system browser); billing; other hosts. */
      reason: "billing" | "non_editor" | "editor";
    }
  | { kind: "none" };

export type ResourceUrlOpenTarget = {
  type: "url";
  url: string;
  title?: string;
};

/** True for absolute http(s) URLs. */
export function isHttpUrl(raw: string | null | undefined): boolean {
  const t = (raw ?? "").trim();
  return /^https?:\/\//i.test(t);
}

/**
 * Hostnames treated as ChatCut product surfaces (editor, billing, marketing).
 */
export function isChatcutHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h) return false;
  return (
    h === "chatcut.io" ||
    h.endsWith(".chatcut.io") ||
    h === "app.chatcut.io"
  );
}

/**
 * Billing / pricing / checkout paths — must open in the system browser.
 */
export function isChatcutBillingUrl(url: string): boolean {
  if (!isHttpUrl(url)) return false;
  try {
    const u = new URL(url.trim());
    if (!isChatcutHost(u.hostname)) return false;
    const path = u.pathname.toLowerCase();
    const hay = `${path}?${u.search.toLowerCase()}`;
    return (
      /\/(pricing|billing|checkout|upgrade|subscribe|plans?)(\/|$)/i.test(
        path,
      ) ||
      /[?&](billing|pricing|checkout)=/i.test(hay) ||
      path.includes("/account/billing") ||
      path.includes("/settings/billing")
    );
  } catch {
    return false;
  }
}

/**
 * Editor / project URLs that should open ChatCut (system browser by default).
 */
export function isChatcutEditorUrl(url: string): boolean {
  if (!isHttpUrl(url)) return false;
  if (isChatcutBillingUrl(url)) return false;
  try {
    const u = new URL(url.trim());
    if (!isChatcutHost(u.hostname)) return false;
    const path = u.pathname.toLowerCase();
    // /editor/<id>, /zh/editor/<id>, /es/editor/<id>, /project/…
    if (
      /(?:^|\/)(zh|es)\/editor(\/|$)/i.test(path) ||
      /(?:^|\/)editor(\/|$)/i.test(path) ||
      /(?:^|\/)project(\/|$)/i.test(path) ||
      /(?:^|\/)projects(\/|$)/i.test(path)
    ) {
      return true;
    }
    // Internal handoff markers on any chatcut host.
    if (
      u.searchParams.has("dockviewLayout") ||
      u.searchParams.has("editor-boot-token")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Strip Codex-only internal-browser query params for user-facing links. */
export function stripChatcutInternalParams(url: string): string {
  if (!isHttpUrl(url)) return (url ?? "").trim();
  try {
    const u = new URL(url.trim());
    for (const key of CHATCUT_INTERNAL_QUERY_PARAMS) {
      u.searchParams.delete(key);
    }
    // Normalize empty search (URL keeps trailing ? otherwise in some engines).
    const q = u.searchParams.toString();
    u.search = q ? `?${q}` : "";
    return u.toString();
  } catch {
    return url.trim();
  }
}

/**
 * Apply locale path prefix for ChatCut editor-site URLs.
 * Chinese → /zh/…, Spanish → /es/…, else strip locale prefix (English default).
 * Preserves domain, remaining path, query, and hash.
 */
export function applyChatcutLocalePath(
  url: string,
  locale: ChatcutLocale | string | null | undefined,
): string {
  if (!isHttpUrl(url)) return (url ?? "").trim();
  try {
    const u = new URL(url.trim());
    if (!isChatcutHost(u.hostname)) return u.toString();

    const loc = normalizeChatcutLocale(locale);
    let path = u.pathname || "/";
    // Drop existing /zh/ or /es/ prefix once.
    path = path.replace(/^\/(zh|es)(?=\/|$)/i, "") || "/";
    if (!path.startsWith("/")) path = `/${path}`;

    if (loc === "zh") {
      path = path === "/" ? "/zh" : `/zh${path}`;
    } else if (loc === "es") {
      path = path === "/" ? "/es" : `/es${path}`;
    }
    // en / default: no locale prefix
    u.pathname = path;
    return u.toString();
  } catch {
    return url.trim();
  }
}

export function normalizeChatcutLocale(
  locale: string | null | undefined,
): ChatcutLocale {
  const raw = (locale ?? "").trim().toLowerCase();
  if (!raw || raw === "default" || raw === "en" || raw.startsWith("en-")) {
    return raw === "default" ? "default" : "en";
  }
  if (raw === "zh" || raw.startsWith("zh-") || raw === "cn" || raw === "zh_cn") {
    return "zh";
  }
  if (raw === "es" || raw.startsWith("es-")) return "es";
  return "default";
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function pickString(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t || null;
  }
  return null;
}

/**
 * Deep-walk a ChatCut-shaped tool payload (or free text containing JSON)
 * and extract handoff-relevant fields.
 */
export function extractChatcutHandoffFields(payload: unknown): {
  browserHandoffUrl: string | null;
  browserHandoffRequired: boolean;
  editorUrl: string | null;
  preferredMode: string | null;
  billingUrl: string | null;
  anyEditorLikeUrl: string | null;
} {
  let browserHandoffUrl: string | null = null;
  let browserHandoffRequired = false;
  let editorUrl: string | null = null;
  let preferredMode: string | null = null;
  let billingUrl: string | null = null;
  let anyEditorLikeUrl: string | null = null;

  const visit = (node: unknown, depth: number) => {
    if (depth > 12 || node == null) return;
    if (typeof node === "string") {
      const t = node.trim();
      if (!t) return;
      // Embedded JSON blob
      if (
        (t.startsWith("{") && t.includes("}")) ||
        (t.startsWith("[") && t.includes("]"))
      ) {
        try {
          visit(JSON.parse(t), depth + 1);
        } catch {
          /* not JSON */
        }
      }
      // Bare URLs in prose
      const urlRe = /https?:\/\/[^\s"'<>)\]]+/gi;
      let m: RegExpExecArray | null;
      while ((m = urlRe.exec(t)) !== null) {
        const cleaned = m[0].replace(/[.,;:]+$/, "");
        if (isChatcutBillingUrl(cleaned) && !billingUrl) {
          billingUrl = cleaned;
        } else if (isChatcutEditorUrl(cleaned) && !anyEditorLikeUrl) {
          anyEditorLikeUrl = cleaned;
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const o = asRecord(node);
    if (!o) return;

    // browserHandoff
    const bh = asRecord(o.browserHandoff) ?? asRecord(o.browser_handoff);
    if (bh) {
      const u = pickString(bh.url);
      if (u && isHttpUrl(u)) browserHandoffUrl = browserHandoffUrl ?? u;
      if (bh.required === true || bh.required === "true") {
        browserHandoffRequired = true;
      }
    }
    if (o["browserHandoff.required"] === true) browserHandoffRequired = true;

    // editorUrl
    const eu =
      pickString(o.editorUrl) ??
      pickString(o.editor_url) ??
      pickString(o.editorURL);
    if (eu && isHttpUrl(eu)) editorUrl = editorUrl ?? eu;

    // liveProject / openStrategy
    const live =
      asRecord(o.liveProject) ??
      asRecord(o.live_project) ??
      asRecord(o.project);
    if (live) {
      const os =
        asRecord(live.openStrategy) ?? asRecord(live.open_strategy);
      if (os) {
        const mode =
          pickString(os.preferredMode) ?? pickString(os.preferred_mode);
        if (mode) preferredMode = preferredMode ?? mode;
      }
      const liveUrl =
        pickString(live.url) ??
        pickString(live.editorUrl) ??
        pickString(live.editor_url);
      if (liveUrl && isHttpUrl(liveUrl) && !anyEditorLikeUrl) {
        anyEditorLikeUrl = liveUrl;
      }
    }
    const osTop = asRecord(o.openStrategy) ?? asRecord(o.open_strategy);
    if (osTop) {
      const mode =
        pickString(osTop.preferredMode) ?? pickString(osTop.preferred_mode);
      if (mode) preferredMode = preferredMode ?? mode;
    }

    // billing
    const bill =
      pickString(o.billingUrl) ??
      pickString(o.billing_url) ??
      pickString(o.pricingUrl) ??
      pickString(o.pricing_url);
    if (bill && isHttpUrl(bill)) billingUrl = billingUrl ?? bill;

    // generic url field when clearly editor-like
    const generic = pickString(o.url);
    if (generic && isHttpUrl(generic)) {
      if (isChatcutBillingUrl(generic) && !billingUrl) billingUrl = generic;
      else if (isChatcutEditorUrl(generic) && !anyEditorLikeUrl) {
        anyEditorLikeUrl = generic;
      }
    }

    // Recurse into nested objects/arrays (structuredContent, rawOutput, parts, …)
    for (const [key, val] of Object.entries(o)) {
      if (key === "url") continue; // already handled
      if (val && typeof val === "object") visit(val, depth + 1);
      else if (typeof val === "string" && val.length > 8) visit(val, depth + 1);
    }
  };

  visit(payload, 0);
  return {
    browserHandoffUrl,
    browserHandoffRequired,
    editorUrl,
    preferredMode,
    billingUrl,
    anyEditorLikeUrl,
  };
}

export type ResolveChatcutHandoffOptions = {
  /** UI / conversation locale for path prefix (zh / es / en). */
  locale?: string | null;
  /**
   * When true, open the editor in the side Resources EmbeddedBrowser instead of
   * the system default browser. Default is **false** (system browser) because
   * the in-app WebView cannot reliably play ChatCut media.
   */
  forceEditorInApp?: boolean;
};

/**
 * Decide how to open a ChatCut tool result / link.
 *
 * Preference order for the open URL:
 * 1. browserHandoff.url
 * 2. editorUrl
 * 3. any editor-like URL found in the payload
 *
 * Default open mode is **system browser** (`open_external` / reason `editor`).
 * Pass `forceEditorInApp: true` for the legacy side EmbeddedBrowser path.
 */
export function resolveChatcutHandoff(
  payload: unknown,
  opts: ResolveChatcutHandoffOptions = {},
): ChatcutHandoffAction {
  const fields = extractChatcutHandoffFields(payload);
  const locale = opts.locale;

  // Billing always external.
  if (fields.billingUrl && isChatcutBillingUrl(fields.billingUrl)) {
    return {
      kind: "open_external",
      url: fields.billingUrl.trim(),
      reason: "billing",
    };
  }

  const hasHandoffSignal =
    fields.browserHandoffRequired ||
    fields.browserHandoffUrl != null ||
    (fields.preferredMode ?? "")
      .toLowerCase()
      .includes("codex-internal-browser") ||
    (fields.preferredMode ?? "").toLowerCase().includes("internal-browser");

  const rawInternal =
    fields.browserHandoffUrl ||
    fields.editorUrl ||
    fields.anyEditorLikeUrl ||
    null;

  if (!rawInternal || !isHttpUrl(rawInternal)) {
    return { kind: "none" };
  }

  if (isChatcutBillingUrl(rawInternal)) {
    return {
      kind: "open_external",
      url: rawInternal.trim(),
      reason: "billing",
    };
  }

  const isEditor = isChatcutEditorUrl(rawInternal) || hasHandoffSignal;
  if (!isEditor) {
    return {
      kind: "open_external",
      url: rawInternal.trim(),
      reason: "non_editor",
    };
  }

  const source: "browserHandoff" | "editorUrl" | "liveProject" | "url" =
    fields.browserHandoffUrl
      ? "browserHandoff"
      : fields.editorUrl
        ? "editorUrl"
        : fields.anyEditorLikeUrl
          ? "url"
          : "liveProject";

  // Locale first, then strip Codex-only params for system browser.
  let localized = applyChatcutLocalePath(rawInternal.trim(), locale);
  const displayUrl = stripChatcutInternalParams(localized);

  // Opt-in only: side EmbeddedBrowser (legacy Codex parity).
  if (opts.forceEditorInApp === true) {
    return {
      kind: "open_in_app_browser",
      // Preserve dockviewLayout / editor-boot-token for embedded layout.
      url: localized,
      displayUrl,
      title: "ChatCut",
      source,
    };
  }

  return {
    kind: "open_external",
    url: displayUrl,
    reason: "editor",
  };
}

/**
 * Map a resolved handoff to Resources `ResourceOpenTarget` shape.
 * Returns null when nothing should open in the side browser.
 */
export function chatcutHandoffToResourceOpenTarget(
  action: ChatcutHandoffAction,
): ResourceUrlOpenTarget | null {
  if (action.kind !== "open_in_app_browser") return null;
  return {
    type: "url",
    url: action.url,
    title: action.title ?? "ChatCut",
  };
}

/**
 * Convenience: payload → ResourceOpenTarget | null (in-app browser only).
 */
export function resourceOpenTargetFromChatcutPayload(
  payload: unknown,
  opts: ResolveChatcutHandoffOptions = {},
): ResourceUrlOpenTarget | null {
  return chatcutHandoffToResourceOpenTarget(
    resolveChatcutHandoff(payload, opts),
  );
}

/**
 * When the user clicks an http(s) link in chat, decide open strategy.
 * Editor → system browser (default); billing → system browser; other ChatCut → external.
 * Pass `forceEditorInApp: true` for the side Resources browser.
 */
export function resolveChatcutLinkClick(
  href: string,
  opts: ResolveChatcutHandoffOptions = {},
): ChatcutHandoffAction {
  const url = (href ?? "").trim();
  if (!isHttpUrl(url)) return { kind: "none" };
  if (!isChatcutHost(safeHostname(url))) return { kind: "none" };

  if (isChatcutBillingUrl(url)) {
    return { kind: "open_external", url, reason: "billing" };
  }

  if (isChatcutEditorUrl(url)) {
    return resolveChatcutHandoff(
      {
        editorUrl: stripChatcutInternalParams(url),
        browserHandoff: {
          // Keep raw href so forceEditorInApp can still preserve internal params.
          url,
          required: true,
        },
      },
      opts,
    );
  }

  return { kind: "open_external", url, reason: "non_editor" };
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * Scan free-form tool event fields (title / detail / path / content) for handoff.
 */
export function resolveChatcutHandoffFromToolEvent(
  event: {
    title?: string | null;
    detail?: string | null;
    path?: string | null;
    kind?: string | null;
    content?: string | null;
    raw?: unknown;
  },
  opts: ResolveChatcutHandoffOptions = {},
): ChatcutHandoffAction {
  const chunks: unknown[] = [];
  if (event.raw != null) chunks.push(event.raw);
  for (const s of [event.detail, event.content, event.path, event.title]) {
    if (s && String(s).trim()) chunks.push(String(s));
  }
  if (chunks.length === 0) return { kind: "none" };

  // Prefer first decisive action (billing > editor external > in-app opt-in > none).
  let best: ChatcutHandoffAction = { kind: "none" };
  for (const chunk of chunks) {
    const action = resolveChatcutHandoff(chunk, opts);
    if (action.kind === "open_external" && action.reason === "billing") {
      return action;
    }
    if (action.kind === "open_external" && action.reason === "editor") {
      // Default product path — system browser for ChatCut editor.
      if (best.kind !== "open_external" || best.reason !== "editor") {
        best = action;
      }
      continue;
    }
    if (action.kind === "open_in_app_browser" && best.kind === "none") {
      best = action;
    } else if (action.kind === "open_external" && best.kind === "none") {
      best = action;
    }
  }
  // Combined bag for nested structures split across fields.
  if (best.kind === "none" && chunks.length > 1) {
    return resolveChatcutHandoff({ parts: chunks }, opts);
  }
  return best;
}
