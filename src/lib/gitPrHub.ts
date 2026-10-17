/**
 * GitHub PR hub helpers for a project folder.
 * Pure parsers for `gh pr list|view|checks --json` and conversation comments/reviews (no network).
 */

/** Coarse checks rollup used in list rows and detail. */
export type PrChecksOverall =
  | "pass"
  | "fail"
  | "pending"
  | "mixed"
  | "none"
  | "unknown";

export type PrChecksSummary = {
  pass: number;
  fail: number;
  pending: number;
  skipping: number;
  cancel: number;
  total: number;
  overall: PrChecksOverall;
};

/** One open (or listed) pull request. */
export type GitPrHubEntry = {
  number: number;
  title: string;
  url: string;
  author: string;
  authorLogin?: string | null;
  state?: string | null;
  isDraft: boolean;
  /** MERGEABLE | CONFLICTING | UNKNOWN (gh) */
  mergeable?: string | null;
  headRefName?: string | null;
  baseRefName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  checks?: PrChecksSummary | null;
  body?: string | null;
};

export type GitPrCheckEntry = {
  name: string;
  state: string;
  /** pass | fail | pending | skipping | cancel */
  bucket: string;
  link?: string | null;
  description?: string | null;
  workflow?: string | null;
};

export type GitPrHubListResult = {
  available: boolean;
  prs: GitPrHubEntry[];
  reason?: string | null;
  ghFound: boolean;
  gitFound?: boolean;
  /** owner/name when known from remote */
  repo?: string | null;
};

export type GitPrHubViewResult = {
  available: boolean;
  pr?: GitPrHubEntry | null;
  reason?: string | null;
  ghFound: boolean;
};

export type GitPrChecksResult = {
  available: boolean;
  checks: GitPrCheckEntry[];
  summary?: PrChecksSummary | null;
  reason?: string | null;
  ghFound: boolean;
  prNumber?: number | null;
};

/** Issue comment or review body on a PR conversation. */
export type GitPrCommentKind = "comment" | "review";

export type GitPrCommentEntry = {
  id: string;
  author: string;
  authorLogin?: string | null;
  /** Full body (capped). */
  body: string;
  /** Single-line excerpt for list rows. */
  excerpt: string;
  url?: string | null;
  createdAt?: string | null;
  kind: GitPrCommentKind;
  /** Review state when kind is review (APPROVED | CHANGES_REQUESTED | COMMENTED | …). */
  state?: string | null;
};

export type GitPrCommentsResult = {
  available: boolean;
  comments: GitPrCommentEntry[];
  reason?: string | null;
  ghFound: boolean;
  prNumber?: number | null;
  /** PR conversation URL (`gh pr view` url). */
  url?: string | null;
};

const LIST_CAP = 100;
const BODY_CAP = 20_000;
const COMMENTS_CAP = 50;
const EXCERPT_CAP = 200;

function emptySummary(): PrChecksSummary {
  return {
    pass: 0,
    fail: 0,
    pending: 0,
    skipping: 0,
    cancel: 0,
    total: 0,
    overall: "none",
  };
}

function jsonStart(raw: string): number {
  const t = (raw ?? "").trim();
  return t.search(/[\[{]/);
}

function parseJsonSlice(raw: string): unknown | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const start = jsonStart(trimmed);
  if (start < 0) return null;
  try {
    return JSON.parse(trimmed.slice(start));
  } catch {
    return null;
  }
}

function strField(
  obj: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string") {
      const t = v.trim();
      if (t) return t;
    }
  }
  return null;
}

function numField(
  obj: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === "string" && /^\d+$/.test(v.trim())) {
      return Number.parseInt(v.trim(), 10);
    }
  }
  return null;
}

function boolField(
  obj: Record<string, unknown>,
  keys: string[],
): boolean {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "boolean") return v;
  }
  return false;
}

/**
 * Map a check conclusion / state / bucket into a coarse bucket.
 * Accepts gh `pr checks --json` bucket/state and GraphQL rollup conclusion/status.
 */
export function bucketFromCheckFields(input: {
  bucket?: string | null;
  state?: string | null;
  conclusion?: string | null;
  status?: string | null;
}): string {
  const bucket = (input.bucket ?? "").trim().toLowerCase();
  if (
    bucket === "pass" ||
    bucket === "fail" ||
    bucket === "pending" ||
    bucket === "skipping" ||
    bucket === "cancel"
  ) {
    return bucket;
  }

  const conclusion = (input.conclusion ?? "").trim().toUpperCase();
  const state = (input.state ?? "").trim().toUpperCase();
  const status = (input.status ?? "").trim().toUpperCase();

  // Prefer terminal conclusion when present.
  const terminal = conclusion || (state && !["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED", "EXPECTED"].includes(state) ? state : "");
  switch (terminal) {
    case "SUCCESS":
    case "NEUTRAL":
    case "PASS":
    case "PASSED":
      return "pass";
    case "FAILURE":
    case "FAILED":
    case "ERROR":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
      return "fail";
    case "CANCELLED":
    case "CANCELED":
      return "cancel";
    case "SKIPPED":
    case "STALE":
      return "skipping";
    default:
      break;
  }

  if (
    status === "IN_PROGRESS" ||
    status === "QUEUED" ||
    status === "PENDING" ||
    status === "WAITING" ||
    status === "REQUESTED" ||
    status === "EXPECTED" ||
    state === "PENDING" ||
    state === "QUEUED" ||
    state === "IN_PROGRESS"
  ) {
    return "pending";
  }

  if (!terminal && !status && !state) return "pending";
  return "unknown";
}

/** Build summary + overall from bucket counts. */
export function summarizeBuckets(
  buckets: Iterable<string>,
): PrChecksSummary {
  const s = emptySummary();
  for (const b of buckets) {
    const key = (b || "").toLowerCase();
    if (key === "pass") s.pass += 1;
    else if (key === "fail") s.fail += 1;
    else if (key === "pending") s.pending += 1;
    else if (key === "skipping") s.skipping += 1;
    else if (key === "cancel") s.cancel += 1;
    else if (key === "unknown" || key) s.pending += 1; // treat unknown as pending-ish
    s.total += 1;
  }
  s.overall = overallFromCounts(s);
  return s;
}

export function overallFromCounts(
  s: Pick<
    PrChecksSummary,
    "pass" | "fail" | "pending" | "cancel" | "total"
  >,
): PrChecksOverall {
  if (s.total <= 0) return "none";
  if (s.fail > 0) return "fail";
  if (s.pending > 0) return "pending";
  if (s.cancel > 0 && s.pass === 0) return "mixed";
  if (s.pass > 0 && s.cancel === 0) return "pass";
  if (s.pass > 0) return "pass";
  return "mixed";
}

/** Summarize GraphQL `statusCheckRollup` array from `gh pr list/view --json`. */
export function summarizeStatusCheckRollup(
  rollup: unknown,
): PrChecksSummary {
  if (!Array.isArray(rollup) || rollup.length === 0) return emptySummary();
  const buckets: string[] = [];
  for (const row of rollup) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    buckets.push(
      bucketFromCheckFields({
        conclusion:
          typeof o.conclusion === "string" ? o.conclusion : null,
        state: typeof o.state === "string" ? o.state : null,
        status: typeof o.status === "string" ? o.status : null,
        bucket: typeof o.bucket === "string" ? o.bucket : null,
      }),
    );
  }
  return summarizeBuckets(buckets);
}

export function summarizeChecks(
  checks: GitPrCheckEntry[] | null | undefined,
): PrChecksSummary {
  if (!checks || checks.length === 0) return emptySummary();
  return summarizeBuckets(checks.map((c) => c.bucket || "pending"));
}

/** Compact UI line: "3 pass · 1 fail" / "no checks". */
export function formatChecksSummaryLine(
  summary: PrChecksSummary | null | undefined,
): string {
  if (!summary || summary.total <= 0) return "";
  const parts: string[] = [];
  if (summary.pass > 0) parts.push(`${summary.pass} pass`);
  if (summary.fail > 0) parts.push(`${summary.fail} fail`);
  if (summary.pending > 0) parts.push(`${summary.pending} pending`);
  if (summary.cancel > 0) parts.push(`${summary.cancel} cancel`);
  if (summary.skipping > 0) parts.push(`${summary.skipping} skip`);
  return parts.join(" · ");
}

/** Normalize gh mergeable enum → lowercase token. */
export function normalizeMergeable(
  raw: string | null | undefined,
): "mergeable" | "conflicting" | "unknown" | null {
  const t = (raw ?? "").trim().toUpperCase();
  if (!t) return null;
  if (t === "MERGEABLE") return "mergeable";
  if (t === "CONFLICTING") return "conflicting";
  if (t === "UNKNOWN") return "unknown";
  return "unknown";
}

function authorFromField(raw: unknown): {
  author: string;
  authorLogin: string | null;
} {
  if (!raw) return { author: "", authorLogin: null };
  if (typeof raw === "string") {
    const t = raw.trim();
    return { author: t, authorLogin: t || null };
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const login = strField(o, ["login", "name", "id"]);
    return { author: login ?? "", authorLogin: login };
  }
  return { author: "", authorLogin: null };
}

/** Parse one PR object from gh JSON. */
export function parseGhPrObject(raw: unknown): GitPrHubEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const number = numField(o, ["number", "Number"]);
  if (number == null || number <= 0) return null;
  const title = strField(o, ["title", "Title"]) ?? "";
  const url =
    strField(o, ["url", "URL", "htmlUrl", "html_url", "permalink"]) ?? "";
  const { author, authorLogin } = authorFromField(o.author);
  const state = strField(o, ["state", "State"]);
  const isDraft = boolField(o, ["isDraft", "is_draft", "draft"]);
  const mergeable = strField(o, ["mergeable", "mergeableState", "mergeable_state"]);
  const headRefName = strField(o, [
    "headRefName",
    "head_ref_name",
    "headBranch",
    "head",
  ]);
  const baseRefName = strField(o, [
    "baseRefName",
    "base_ref_name",
    "baseBranch",
    "base",
  ]);
  const createdAt = strField(o, ["createdAt", "created_at"]);
  const updatedAt = strField(o, ["updatedAt", "updated_at"]);
  let body = strField(o, ["body", "Body"]);
  if (body && body.length > BODY_CAP) body = body.slice(0, BODY_CAP);
  const rollup =
    o.statusCheckRollup ?? o.status_check_rollup ?? o.checks ?? null;
  const checks = Array.isArray(rollup)
    ? summarizeStatusCheckRollup(rollup)
    : null;
  return {
    number,
    title,
    url,
    author,
    authorLogin,
    state,
    isDraft,
    mergeable,
    headRefName,
    baseRefName,
    createdAt,
    updatedAt,
    checks,
    body,
  };
}

/**
 * Parse `gh pr list --json …` stdout.
 * Accepts a top-level array or `{ pullRequests | prs | items: [...] }`.
 */
export function parseGhPrListJson(raw: string): GitPrHubEntry[] {
  const value = parseJsonSlice(raw);
  if (value == null) return [];
  let items: unknown[] = [];
  if (Array.isArray(value)) {
    items = value;
  } else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const arr =
      o.pullRequests ?? o.prs ?? o.items ?? o.data ?? null;
    if (Array.isArray(arr)) items = arr;
    else return [];
  }
  const out: GitPrHubEntry[] = [];
  for (const row of items) {
    const pr = parseGhPrObject(row);
    if (!pr) continue;
    out.push(pr);
    if (out.length >= LIST_CAP) break;
  }
  return out;
}

/** Parse `gh pr view <n> --json …` stdout (single object). */
export function parseGhPrViewJson(raw: string): GitPrHubEntry | null {
  const value = parseJsonSlice(raw);
  if (value == null) return null;
  if (Array.isArray(value)) {
    return value.length > 0 ? parseGhPrObject(value[0]) : null;
  }
  return parseGhPrObject(value);
}

/** Parse one check row from `gh pr checks --json`. */
export function parseGhPrCheckObject(raw: unknown): GitPrCheckEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = strField(o, ["name", "Name", "context"]) ?? "";
  if (!name) return null;
  const state = strField(o, ["state", "State", "conclusion"]) ?? "";
  const bucket = bucketFromCheckFields({
    bucket: strField(o, ["bucket", "Bucket"]),
    state,
    conclusion: strField(o, ["conclusion", "Conclusion"]),
    status: strField(o, ["status", "Status"]),
  });
  const link = strField(o, ["link", "Link", "detailsUrl", "details_url", "url"]);
  const description = strField(o, ["description", "Description"]);
  const workflow = strField(o, ["workflow", "Workflow", "workflowName"]);
  return {
    name,
    state: state || bucket,
    bucket,
    link,
    description,
    workflow,
  };
}

/**
 * Parse `gh pr checks <n> --json name,state,bucket,…` stdout.
 * Accepts array or wrapped object.
 */
export function parseGhPrChecksJson(raw: string): GitPrCheckEntry[] {
  const value = parseJsonSlice(raw);
  if (value == null) return [];
  let items: unknown[] = [];
  if (Array.isArray(value)) {
    items = value;
  } else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const arr = o.checks ?? o.items ?? o.data ?? null;
    if (Array.isArray(arr)) items = arr;
    else return [];
  }
  const out: GitPrCheckEntry[] = [];
  for (const row of items) {
    const c = parseGhPrCheckObject(row);
    if (!c) continue;
    out.push(c);
    if (out.length >= 200) break;
  }
  return out;
}

/** Collapse body to a single-line excerpt for list rows. */
export function excerptCommentBody(
  body: string | null | undefined,
  max = EXCERPT_CAP,
): string {
  const flat = (body ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return "";
  if (flat.length <= max) return flat;
  return flat.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}

function idFromField(raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(Math.trunc(raw));
  }
  return null;
}

/** Parse one issue comment from `gh pr view --json comments`. */
export function parseGhPrCommentObject(raw: unknown): GitPrCommentEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const bodyRaw = strField(o, ["body", "Body", "bodyText"]) ?? "";
  const { author, authorLogin } = authorFromField(o.author ?? o.user);
  // Skip empty minimized shells with no body and no author.
  if (!bodyRaw.trim() && !author) return null;
  const id =
    idFromField(o.id) ??
    idFromField(o.databaseId) ??
    idFromField(o.node_id) ??
    `comment:${author}:${strField(o, ["createdAt", "created_at"]) ?? ""}`;
  let body = bodyRaw;
  if (body.length > BODY_CAP) body = body.slice(0, BODY_CAP);
  const url = strField(o, ["url", "URL", "htmlUrl", "html_url", "permalink"]);
  const createdAt = strField(o, ["createdAt", "created_at", "publishedAt"]);
  return {
    id,
    author,
    authorLogin,
    body,
    excerpt: excerptCommentBody(body),
    url,
    createdAt,
    kind: "comment",
    state: null,
  };
}

/** Parse one review from `gh pr view --json reviews`. */
export function parseGhPrReviewObject(raw: unknown): GitPrCommentEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const bodyRaw = strField(o, ["body", "Body", "bodyText"]) ?? "";
  const state = strField(o, ["state", "State"]);
  const { author, authorLogin } = authorFromField(o.author ?? o.user);
  // Pending empty reviews without state are noise.
  if (!bodyRaw.trim() && !state && !author) return null;
  // Skip pure PENDING reviews with no body (not yet submitted).
  if (
    !bodyRaw.trim() &&
    state &&
    state.trim().toUpperCase() === "PENDING"
  ) {
    return null;
  }
  const id =
    idFromField(o.id) ??
    idFromField(o.databaseId) ??
    idFromField(o.node_id) ??
    `review:${author}:${strField(o, ["submittedAt", "submitted_at", "createdAt"]) ?? ""}`;
  let body = bodyRaw;
  if (body.length > BODY_CAP) body = body.slice(0, BODY_CAP);
  const url = strField(o, ["url", "URL", "htmlUrl", "html_url", "permalink"]);
  const createdAt = strField(o, [
    "submittedAt",
    "submitted_at",
    "createdAt",
    "created_at",
    "publishedAt",
  ]);
  const excerpt =
    excerptCommentBody(body) ||
    (state ? state.trim() : "");
  return {
    id,
    author,
    authorLogin,
    body,
    excerpt,
    url,
    createdAt,
    kind: "review",
    state,
  };
}

function timeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Merge issue comments + reviews, newest first, capped.
 * Dedupes by id when both sources share the same node.
 */
export function mergePrComments(
  comments: GitPrCommentEntry[],
  reviews: GitPrCommentEntry[],
  cap = COMMENTS_CAP,
): GitPrCommentEntry[] {
  const seen = new Set<string>();
  const merged: GitPrCommentEntry[] = [];
  for (const c of [...comments, ...reviews]) {
    if (!c || !c.id) continue;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    merged.push(c);
  }
  merged.sort((a, b) => timeMs(b.createdAt) - timeMs(a.createdAt));
  return merged.slice(0, Math.max(0, cap));
}

/**
 * Parse `gh pr view <n> --json comments,reviews,url,number` stdout.
 * Also accepts a bare comments array or `{ comments, reviews }`.
 */
export function parseGhPrCommentsJson(raw: string): {
  comments: GitPrCommentEntry[];
  url: string | null;
  number: number | null;
} {
  const empty = { comments: [] as GitPrCommentEntry[], url: null as string | null, number: null as number | null };
  const value = parseJsonSlice(raw);
  if (value == null) return empty;

  if (Array.isArray(value)) {
    // Bare comments array
    const comments: GitPrCommentEntry[] = [];
    for (const row of value) {
      const c = parseGhPrCommentObject(row);
      if (c) comments.push(c);
      if (comments.length >= COMMENTS_CAP) break;
    }
    return { comments, url: null, number: null };
  }

  if (typeof value !== "object") return empty;
  const o = value as Record<string, unknown>;
  const url = strField(o, ["url", "URL", "htmlUrl", "html_url"]);
  const number = numField(o, ["number", "Number"]);

  const commentRows: unknown[] = Array.isArray(o.comments)
    ? o.comments
    : Array.isArray((o as { issueComments?: unknown }).issueComments)
      ? ((o as { issueComments: unknown[] }).issueComments)
      : [];
  const reviewRows: unknown[] = Array.isArray(o.reviews)
    ? o.reviews
    : Array.isArray(o.latestReviews)
      ? (o.latestReviews as unknown[])
      : [];

  const comments: GitPrCommentEntry[] = [];
  for (const row of commentRows) {
    const c = parseGhPrCommentObject(row);
    if (c) comments.push(c);
  }
  const reviews: GitPrCommentEntry[] = [];
  for (const row of reviewRows) {
    const r = parseGhPrReviewObject(row);
    if (r) reviews.push(r);
  }

  return {
    comments: mergePrComments(comments, reviews, COMMENTS_CAP),
    url,
    number,
  };
}

/** Soft reason keys the UI can map (host may also return free text). */
export function classifyPrHubReason(
  reason: string | null | undefined,
):
  | "empty_path"
  | "not_dir"
  | "no_git"
  | "not_repo"
  | "no_gh"
  | "gh_failed"
  | "other"
  | null {
  const r = (reason ?? "").trim().toLowerCase();
  if (!r) return null;
  if (r.includes("empty path") || r === "empty") return "empty_path";
  if (r.includes("not a directory") || r.includes("not a dir")) return "not_dir";
  if (r.includes("git not available") || r === "no git") return "no_git";
  if (r.includes("not a git") || r.includes("not a repository")) return "not_repo";
  if (
    r.includes("gh not") ||
    r.includes("gh cli") ||
    r.includes("github cli") ||
    r === "no gh" ||
    r.includes("command not found") && r.includes("gh")
  ) {
    return "no_gh";
  }
  if (r.includes("gh ") || r.includes("failed")) return "gh_failed";
  return "other";
}
