/**
 * 内联引用 token 的语法与取值。
 *
 * 存储态用不与正文撞车的专用 token，而不是直接把 `@路径` 写进 draft：
 * 否则「用户手打的 `@/goal`」与「真的文件引用」在编辑回填时无法区分。
 * 发送给 CLI 时才由 {@link refAgentText} 转成 `@绝对路径`。
 *
 * 与 skill token（`[[skill:name]]`）同族，但字符集必须容纳带 `/` 与空格的
 * 路径，因此单独定义。路径里只有两个字符会破坏该语法（`%` 与 `]`），按
 * URL 习惯做百分号转义——不含这两个字符的路径保持完全可读。
 */

/** 引用类型。`url` 的语法先在此固定。 */
export type RefKind = "file" | "dir" | "url";

const REF_KINDS: readonly RefKind[] = ["file", "dir", "url"];

/** token 前缀 → 类型；未知前缀一律不认。 */
const PREFIX: Record<RefKind, string> = {
  file: "file",
  dir: "dir",
  url: "url",
};

/**
 * 转义会破坏 `[[kind:value]]` 语法的字符。
 *
 * 只转义 `%`（转义符本身）与 `]`（会提前闭合 token）。换行由调用方拒绝，
 * 见 {@link isTokenizableRefValue}。
 */
export function escapeRefValue(value: string): string {
  return value.replace(/%/g, "%25").replace(/]/g, "%5D");
}

/** {@link escapeRefValue} 的逆操作。 */
export function unescapeRefValue(value: string): string {
  // 只认大写：`escapeRefValue` 只产出大写，带 `i` 会把路径里字面量的
  // `%5d` / `%25` 也当成转义序列解回 `]`，往返就不对称了。
  return value.replace(/%5D/g, "]").replace(/%25/g, "%");
}

/**
 * 该值能否安全地放进 token。换行会跨段落、破坏 inline 结构，因此拒绝；
 * 拒绝时调用方应退回纯文本，而不是写出一个解析不回来的 token。
 */
export function isTokenizableRefValue(value: string): boolean {
  return value.length > 0 && !/[\r\n]/.test(value);
}

/** token 文本形式（draft / 消息历史的存储态）。 */
export function refTokenText(kind: RefKind, value: string): string {
  return `[[${PREFIX[kind]}:${escapeRefValue(value)}]]`;
}

/** 匹配单个 token；`g` 标志，调用方需自行管理 `lastIndex`。 */
export const REF_TOKEN_RE = new RegExp(
  `\\[\\[(file|dir|url):((?:[^\\]\\r\\n])*)\\]\\]`,
  "g",
);

/** 解析一段文本开头的 token（markdown-it inline 规则用，锚定 pos）。 */
export function matchRefTokenAt(
  src: string,
  pos: number,
): { kind: RefKind; value: string; length: number } | null {
  if (src.charCodeAt(pos) !== 0x5b) return null;
  REF_TOKEN_RE.lastIndex = pos;
  const m = REF_TOKEN_RE.exec(src);
  if (!m || m.index !== pos) return null;
  const kind = m[1] as RefKind;
  if (!REF_KINDS.includes(kind)) return null;
  return { kind, value: unescapeRefValue(m[2] ?? ""), length: m[0].length };
}

/**
 * token 在**发送给 CLI 的 Markdown 源码**里的形态。
 *
 * 文件与目录沿用 CLI 既有的 `@路径` 引用语法（与 `buildAgentPrompt` 的附件
 * 写法一致，CLI 侧无需改动）；URL 就是链接本身。
 */
export function refAgentText(kind: RefKind, value: string): string {
  return kind === "url" ? value : `@${value}`;
}

/**
 * 路径的最后一段（chip 显示的短标签）。
 *
 * URL 显示「主机 + 路径、去掉参数与锚点」——`github.com/RongleCat/grok-app` 能认出
 * 是哪个仓库，而只留主机名（`github.com`）几乎等于没信息；带上 `?query#frag` 又会
 * 在输入框里撑得很宽。
 */
export function refDisplayLabel(kind: RefKind, value: string): string {
  if (kind === "url") {
    const withoutScheme = value.replace(/^https?:\/\//i, "");
    // 先切掉 query / hash，再去掉尾斜杠
    const pathOnly = withoutScheme.split(/[?#]/)[0] ?? "";
    const trimmed = pathOnly.replace(/\/+$/, "");
    return trimmed || withoutScheme || value;
  }
  const trimmed = value.replace(/[/\\]+$/, "");
  const last = trimmed.split(/[/\\]/).pop();
  return last || value;
}

/**
 * 尾随标点：URL 紧邻句末标点时，标点属于句子而不是链接。
 * 覆盖中英文常见句读与右括号族。
 */
const TRAILING_URL_PUNCT_CHAR = /[.,;:!?)\]}>'"`，。；：！？）】》」』、…]/;

/**
 * 去掉 URL 末尾的句读标点。
 *
 * `)` 有例外：维基类链接常以 `(bar)` 结尾，只在**没有配对的 `(`** 时才把右括号
 * 当作句读剥掉——无脑剥离会把 `.../Foo_(bar)` 截断成 `.../Foo_(bar`。
 *
 * 逐字符剥而不是一次正则吃掉整段尾标点：`Foo_(bar).` 里 `)` 与 `.` 属于两类，
 * 一起吃掉就会把 URL 的右括号也带走。
 */
export function stripTrailingUrlPunctuation(url: string): string {
  let out = url;
  while (out.length > 0) {
    const last = out[out.length - 1]!;
    if (!TRAILING_URL_PUNCT_CHAR.test(last)) break;
    if (last === ")") {
      const opens = (out.match(/\(/g) ?? []).length;
      const closes = (out.match(/\)/g) ?? []).length;
      // 括号配对 → 这个 `)` 是 URL 的一部分，停手。
      if (closes <= opens) break;
    }
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * 粘贴整段文本时的 URL 候选：整段（去空白后）就是一个 http(s) 链接才转换。
 *
 * 只要包含空白就说明是普通文本/多行内容，不能整体变成 chip。
 */
export function matchPastedUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const url = stripTrailingUrlPunctuation(trimmed);
  return isExternalHttpUrl(url) ? url : null;
}

/**
 * 输入过程中的 URL 候选：`beforeCaret` 是光标前的文本，且刚敲下一个空白。
 *
 * 返回待替换的 URL 与它在 `beforeCaret` 中的起点；`null` 表示不转换。
 * 只在「URL 前是空白或行首」时成立，避免把 `xhttp://y` 里的片段切出来。
 */
export function matchTypedUrl(
  beforeCaret: string,
): { url: string; start: number } | null {
  const m = /(?:^|\s)(\S+)\s$/.exec(beforeCaret);
  if (!m) return null;
  const raw = m[1] ?? "";
  const url = stripTrailingUrlPunctuation(raw);
  if (!isExternalHttpUrl(url)) return null;
  // `raw` 紧跟在结尾空白之前；句读在 raw 的**尾部**被剥掉，不影响起点。
  const start = beforeCaret.length - 1 - raw.length;
  return { url, start };
}

/**
 * 只有 http(s) 才能成为 URL chip 或可点击链接。
 *
 * 在 `composerRefToken` 里做这个判定是为了让节点 / 粘贴 / 输入规则共用一条规则。
 * 与 `externalLinkPref.isExternalHttpUrl` 同源但**故意更严**（不复用）：这里还要挡住
 * `blob:` / `vbscript:` / `file:` 与协议相对地址 `//host/path`，并要求 URL 至少有一个
 * 主机字符 —— 输入框里的 chip 是可点击语义（验收 C11），不能只按「能外开」放行。
 * 两者不一致的用例见 `composerRefToken.test.ts` 的 `url scheme gate`。
 */
export function isExternalHttpUrl(url: string): boolean {
  const t = url.trim();
  if (!t) return false;
  if (/^(javascript|data|blob|vbscript|file|mailto):/i.test(t)) return false;
  if (t.startsWith("//") || t.startsWith("/") || t.startsWith("#")) return false;
  return /^https?:\/\/[^\s/]+/i.test(t);
}
