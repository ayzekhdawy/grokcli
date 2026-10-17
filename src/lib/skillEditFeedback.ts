/**
 * SKILL-EDIT-PRO — pure helpers for Extensions → Skills edit / validate / save UX.
 *
 * Classifies SKILL.md content checks and host read/write/create errors into stable
 * machine kinds for i18n labels, severity chips, and GlassModal presentation.
 * Never invents success — only maps honest parse / host signals.
 */

import {
  sanitizeSkillFolderName,
  SKILL_DESCRIPTION_MAX,
} from "./skillScaffold";

/** Matches host `skill_edit` MAX_SKILL_BYTES (2 MiB). */
export const MAX_SKILL_EDIT_BYTES = 2 * 1024 * 1024;

/** Stable outcome kinds for validate / load / save / create. */
export type SkillEditKind =
  | "ok"
  | "empty"
  | "too_large"
  | "missing_frontmatter"
  | "unclosed_frontmatter"
  | "invalid_frontmatter"
  | "missing_name"
  | "invalid_name"
  | "name_mismatch"
  | "missing_description"
  | "empty_body"
  | "conflict"
  | "path_denied"
  | "path_outside"
  | "bundled_readonly"
  | "not_found"
  | "not_a_file"
  | "already_exists"
  | "host_only"
  | "host_error"
  | "other";

export type SkillEditSeverity = "ok" | "warn" | "err" | "info";

export type SkillEditPhase = "validate" | "load" | "save" | "create";

/** One issue in a content validation pass. */
export type SkillEditIssue = {
  kind: SkillEditKind;
  severity: SkillEditSeverity;
  /** Optional detail (e.g. parse note, expected vs actual name). */
  detail?: string;
};

/** Parsed SKILL.md frontmatter + body (simple YAML `key: value` lines). */
export type SkillFrontmatter = {
  name: string | null;
  description: string | null;
  /** All simple key/value pairs from the frontmatter block. */
  raw: Record<string, string>;
  body: string;
};

export type SkillEditPresentation = {
  kind: SkillEditKind;
  severity: SkillEditSeverity;
  phase: SkillEditPhase;
  /** Short headline (kind label or phase-specific title). */
  title: string;
  /** One-line summary for status / modal. */
  summary: string;
  /** Optional longer detail (host message, mismatch note, …). */
  detail: string;
  /** Machine reason / kind when useful to show as code. */
  reason: string | null;
  path: string | null;
  name: string | null;
  description: string | null;
  sizeBytes: number | null;
  issues: SkillEditIssue[];
  /** True when no blocking errors (warns/info allowed). */
  ok: boolean;
  /** True when save/create must not proceed. */
  blocking: boolean;
};

export type ValidateSkillMdOptions = {
  /** Folder / row skill name — mismatch is warn only. */
  expectedName?: string | null;
  /** Max UTF-8 byte size (defaults to {@link MAX_SKILL_EDIT_BYTES}). */
  maxBytes?: number;
};

export type ValidateSkillMdResult = {
  ok: boolean;
  blocking: boolean;
  kind: SkillEditKind;
  severity: SkillEditSeverity;
  issues: SkillEditIssue[];
  name: string | null;
  description: string | null;
  body: string;
  sizeBytes: number;
  frontmatter: SkillFrontmatter | null;
};

/** UTF-8 byte length (TextEncoder when available). */
export function skillMdByteLength(text: string | null | undefined): number {
  const s = text ?? "";
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(s).length;
  }
  // Fallback: approximate for environments without TextEncoder.
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x7f) n += 1;
    else if (c <= 0x7ff) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * Strip BOM + normalize newlines; trim only outer leading blank lines for open check.
 */
export function normalizeSkillMdSource(
  content: string | null | undefined,
): string {
  let s = (content ?? "").replace(/^\uFEFF/, "");
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return s;
}

/**
 * Parse SKILL.md YAML frontmatter (`---` … `---`) with simple `key: value` lines.
 * Pure — does not validate name rules.
 */
export function parseSkillMdFrontmatter(
  content: string | null | undefined,
):
  | { ok: true; frontmatter: SkillFrontmatter }
  | { ok: false; kind: SkillEditKind; detail?: string } {
  const src = normalizeSkillMdSource(content);
  if (!src.trim()) {
    return { ok: false, kind: "empty" };
  }

  // Leading blank lines allowed before opening fence.
  const openMatch = src.match(/^(?:\s*\n)*---[ \t]*\n/);
  if (!openMatch) {
    return {
      ok: false,
      kind: "missing_frontmatter",
      detail: "SKILL.md must start with a YAML frontmatter block (---).",
    };
  }
  const afterOpen = src.slice(openMatch[0].length);
  const closeIdx = afterOpen.search(/^[ \t]*---[ \t]*$/m);
  if (closeIdx < 0) {
    return {
      ok: false,
      kind: "unclosed_frontmatter",
      detail: "Closing --- for frontmatter not found.",
    };
  }
  const fmBlock = afterOpen.slice(0, closeIdx);
  // Skip the closing --- line itself.
  const afterClose = afterOpen.slice(closeIdx);
  const closeLineEnd = afterClose.indexOf("\n");
  const body =
    closeLineEnd < 0 ? "" : afterClose.slice(closeLineEnd + 1).replace(/^\n/, "");

  const raw: Record<string, string> = {};
  for (const line of fmBlock.split("\n")) {
    const t = line.trimEnd();
    if (!t.trim() || t.trimStart().startsWith("#")) continue;
    // Multline / nested YAML not supported — reject folded markers as invalid.
    if (/^[ \t]/.test(line) && line.trim()) {
      return {
        ok: false,
        kind: "invalid_frontmatter",
        detail: "Nested or multi-line YAML is not supported in the app editor.",
      };
    }
    const m = t.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) {
      // Allow pure blank already skipped; otherwise invalid.
      if (t.trim()) {
        return {
          ok: false,
          kind: "invalid_frontmatter",
          detail: `Unrecognized frontmatter line: ${t.trim().slice(0, 80)}`,
        };
      }
      continue;
    }
    const key = m[1].toLowerCase();
    let val = m[2].trim();
    // Strip matching single/double quotes.
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    // Unescape common \" in double-quoted values (scaffold uses this).
    if (m[2].trim().startsWith('"')) {
      val = val.replace(/\\"/g, '"');
    }
    raw[key] = val;
  }

  const nameRaw = raw.name?.trim() || null;
  const descriptionRaw = raw.description?.trim() || null;

  return {
    ok: true,
    frontmatter: {
      name: nameRaw,
      description: descriptionRaw,
      raw,
      body,
    },
  };
}

/**
 * Severity for a classified kind.
 * Name mismatch / missing description / empty body are soft (warn/info).
 */
export function skillEditSeverity(kind: SkillEditKind): SkillEditSeverity {
  switch (kind) {
    case "ok":
      return "ok";
    case "name_mismatch":
    case "missing_description":
      return "warn";
    case "empty_body":
      return "info";
    case "host_only":
    case "path_denied":
    case "path_outside":
    case "bundled_readonly":
    case "already_exists":
      return "warn";
    default:
      return "err";
  }
}

/** True when this kind must block save / create. */
export function skillEditKindBlocksSave(kind: SkillEditKind): boolean {
  switch (kind) {
    case "ok":
    case "name_mismatch":
    case "missing_description":
    case "empty_body":
      return false;
    default:
      // Host / path kinds also block; content hard errors block.
      return true;
  }
}

/**
 * Validate SKILL.md draft content for the editor.
 * Blocking issues prevent save; warnings still return ok:false only when blocking.
 * `ok` is true when there are zero blocking issues (warns allowed).
 */
export function validateSkillMdContent(
  content: string | null | undefined,
  opts?: ValidateSkillMdOptions,
): ValidateSkillMdResult {
  const maxBytes = opts?.maxBytes ?? MAX_SKILL_EDIT_BYTES;
  const sizeBytes = skillMdByteLength(content);
  const issues: SkillEditIssue[] = [];

  if (!(content ?? "").trim()) {
    const kind: SkillEditKind = "empty";
    issues.push({ kind, severity: skillEditSeverity(kind) });
    return finishValidate(issues, null, sizeBytes);
  }

  if (sizeBytes > maxBytes) {
    const kind: SkillEditKind = "too_large";
    issues.push({
      kind,
      severity: skillEditSeverity(kind),
      detail: `${sizeBytes} > ${maxBytes}`,
    });
    return finishValidate(issues, null, sizeBytes);
  }

  const parsed = parseSkillMdFrontmatter(content);
  if (!parsed.ok) {
    issues.push({
      kind: parsed.kind,
      severity: skillEditSeverity(parsed.kind),
      detail: parsed.detail,
    });
    return finishValidate(issues, null, sizeBytes);
  }

  const fm = parsed.frontmatter;
  if (!fm.name) {
    const kind: SkillEditKind = "missing_name";
    issues.push({ kind, severity: skillEditSeverity(kind) });
  } else {
    const safe = sanitizeSkillFolderName(fm.name);
    if (!safe || safe !== fm.name.trim().toLowerCase()) {
      // Name present but fails folder rules (or has uppercase that sanitize fixes).
      const kind: SkillEditKind = "invalid_name";
      issues.push({
        kind,
        severity: skillEditSeverity(kind),
        detail: fm.name,
      });
    } else {
      const expected = (opts?.expectedName ?? "").trim();
      if (expected) {
        const expectedSafe =
          sanitizeSkillFolderName(expected) ?? expected.toLowerCase();
        if (safe !== expectedSafe) {
          const kind: SkillEditKind = "name_mismatch";
          issues.push({
            kind,
            severity: skillEditSeverity(kind),
            detail: `frontmatter=${safe}, folder=${expectedSafe}`,
          });
        }
      }
    }
  }

  if (!fm.description) {
    const kind: SkillEditKind = "missing_description";
    issues.push({ kind, severity: skillEditSeverity(kind) });
  } else if (fm.description.length > SKILL_DESCRIPTION_MAX) {
    // Host scaffold caps description; soft warn only (edit still allowed).
    issues.push({
      kind: "missing_description",
      severity: "warn",
      detail: `description longer than ${SKILL_DESCRIPTION_MAX} characters (scaffold limit)`,
    });
  }

  if (!fm.body.trim()) {
    const kind: SkillEditKind = "empty_body";
    issues.push({ kind, severity: skillEditSeverity(kind) });
  }

  return finishValidate(issues, fm, sizeBytes);
}

function finishValidate(
  issues: SkillEditIssue[],
  fm: SkillFrontmatter | null,
  sizeBytes: number,
): ValidateSkillMdResult {
  const blockingIssues = issues.filter((i) => skillEditKindBlocksSave(i.kind));
  const blocking = blockingIssues.length > 0;
  const primary =
    blockingIssues[0] ??
    issues.find((i) => i.severity === "warn") ??
    issues.find((i) => i.severity === "info") ??
    null;
  const kind: SkillEditKind = primary?.kind ?? "ok";
  return {
    ok: !blocking,
    blocking,
    kind,
    severity: skillEditSeverity(kind),
    issues,
    name: fm?.name ?? null,
    description: fm?.description ?? null,
    body: fm?.body ?? "",
    sizeBytes,
    frontmatter: fm,
  };
}

/**
 * Classify a thrown host / invoke error for skill read/write/create.
 */
export function classifySkillHostError(
  err: unknown,
  phase: SkillEditPhase = "save",
): SkillEditKind {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err ?? "");
  const m = raw.toLowerCase();
  if (!m.trim()) return "host_error";

  if (
    m.includes("not a tauri") ||
    m.includes("not available") ||
    m.includes("requires the desktop") ||
    m.includes("host only")
  ) {
    return "host_only";
  }

  if (m.includes("conflict:")) return "conflict";

  if (m.includes("bundled")) return "bundled_readonly";

  if (
    m.includes("outside known skills") ||
    m.includes("outside skills root") ||
    (m.includes("outside") && m.includes("skill"))
  ) {
    return "path_outside";
  }

  if (
    m.includes("path not allowed") ||
    m.includes("traversal") ||
    m.includes("only skill.md")
  ) {
    return "path_denied";
  }

  if (m.includes("too large")) return "too_large";

  if (
    m.includes("not a file") ||
    m.includes("is a directory") ||
    m.includes("not_a_file")
  ) {
    return "not_a_file";
  }

  if (
    m.includes("not found") ||
    m.includes("enoent") ||
    m.includes("no such file")
  ) {
    return "not_found";
  }

  if (
    phase === "create" &&
    (m.includes("already exist") ||
      m.includes("already_exist") ||
      m.includes("file exists") ||
      m.includes("eexist"))
  ) {
    return "already_exists";
  }

  if (
    m.includes("skill name") ||
    m.includes("name is required") ||
    m.includes("name too") ||
    m.includes("name is reserved")
  ) {
    return "invalid_name";
  }

  return "host_error";
}

/** English fallback labels (UI should prefer i18n). */
export const SKILL_EDIT_KIND_FALLBACK: Record<SkillEditKind, string> = {
  ok: "OK",
  empty: "Empty file",
  too_large: "Too large",
  missing_frontmatter: "Missing frontmatter",
  unclosed_frontmatter: "Unclosed frontmatter",
  invalid_frontmatter: "Invalid frontmatter",
  missing_name: "Missing name",
  invalid_name: "Invalid name",
  name_mismatch: "Name mismatch",
  missing_description: "Missing description",
  empty_body: "Empty body",
  conflict: "File conflict",
  path_denied: "Path denied",
  path_outside: "Outside skills roots",
  bundled_readonly: "Bundled (read-only)",
  not_found: "Not found",
  not_a_file: "Not a file",
  already_exists: "Already exists",
  host_only: "Desktop host required",
  host_error: "Host error",
  other: "Error",
};

/** Actionable English hints (UI should prefer i18n). */
export const SKILL_EDIT_HINT_FALLBACK: Partial<Record<SkillEditKind, string>> = {
  ok: "Frontmatter looks valid. You can save when ready.",
  empty: "Paste or write a SKILL.md with YAML frontmatter and body.",
  too_large: "Keep SKILL.md under 2 MiB for in-app edit.",
  missing_frontmatter:
    "Start the file with --- then name: / description: fields, then closing ---.",
  unclosed_frontmatter: "Add a closing --- line after the frontmatter fields.",
  invalid_frontmatter:
    "Use simple one-line key: value pairs in the frontmatter (no nested YAML).",
  missing_name: "Add a name: field in the frontmatter (slash-command style).",
  invalid_name:
    "Name must be lowercase a-z, digits, hyphens; 2–64 chars; start/end alnum.",
  name_mismatch:
    "Frontmatter name differs from the skill folder — save still works, but CLI may prefer the folder name.",
  missing_description:
    "Add a description: with what the skill does and trigger phrases.",
  empty_body: "Add markdown steps under the frontmatter so the agent has instructions.",
  conflict: "Reload from disk or overwrite with your draft.",
  path_denied: "Only SKILL.md under user/agent-home/project skills roots can be edited.",
  path_outside: "This path is outside known skills roots — open a user or project skill.",
  bundled_readonly: "Bundled/vendor skills are read-only. Copy into user skills to edit.",
  not_found: "File missing — refresh the skills list or recreate the skill.",
  not_a_file: "Target is not a SKILL.md file.",
  already_exists: "A skill with this name already exists — open it or pick another name.",
  host_only: "Open the desktop app (Tauri) to read or save skills.",
  host_error: "Host invoke failed — see detail.",
  other: "Unexpected outcome — see detail.",
};

export type SkillEditKindLabels = Partial<Record<SkillEditKind, string>>;

export function skillEditKindLabel(
  kind: SkillEditKind,
  labels?: SkillEditKindLabels,
): string {
  return labels?.[kind] ?? SKILL_EDIT_KIND_FALLBACK[kind] ?? kind;
}

export function skillEditHint(
  kind: SkillEditKind,
  hints?: Partial<Record<SkillEditKind, string>>,
): string {
  return hints?.[kind] ?? SKILL_EDIT_HINT_FALLBACK[kind] ?? "";
}

/** Badge class suffix helper (`ok` | `fail` | `muted`). */
export function skillEditBadgeTone(
  severity: SkillEditSeverity,
): "ok" | "fail" | "muted" {
  if (severity === "ok") return "ok";
  if (severity === "err") return "fail";
  return "muted";
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err ?? "");
}

/**
 * Build GlassModal presentation from a content validation result.
 */
export function buildSkillValidatePresentation(
  content: string | null | undefined,
  opts?: ValidateSkillMdOptions & {
    path?: string | null;
    labels?: SkillEditKindLabels;
    titles?: { ok?: string; fail?: string };
  },
): SkillEditPresentation {
  const check = validateSkillMdContent(content, opts);
  const kindLabel = skillEditKindLabel(check.kind, opts?.labels);
  const title = check.ok
    ? (opts?.titles?.ok ?? kindLabel)
    : (opts?.titles?.fail ?? kindLabel);

  let summary = title;
  if (check.ok && check.issues.length > 0) {
    // Soft warnings — summarize first issue.
    const soft = check.issues[0];
    const softLabel = skillEditKindLabel(soft.kind, opts?.labels);
    summary = softLabel;
  } else if (check.ok) {
    summary = title;
  } else {
    summary = title;
  }

  const detailParts = check.issues
    .filter((i) => i.kind !== check.kind || i.detail)
    .map((i) => {
      const lab = skillEditKindLabel(i.kind, opts?.labels);
      return i.detail ? `${lab}: ${i.detail}` : lab;
    });
  const detail =
    check.issues.find((i) => i.kind === check.kind)?.detail ??
    (detailParts.length ? detailParts.join(" · ") : "");

  return {
    kind: check.kind,
    severity: check.severity,
    phase: "validate",
    title,
    summary,
    detail: detail || "",
    reason: check.kind === "ok" ? null : check.kind,
    path: opts?.path ?? null,
    name: check.name,
    description: check.description,
    sizeBytes: check.sizeBytes,
    issues: check.issues,
    ok: check.ok,
    blocking: check.blocking,
  };
}

/**
 * Build presentation for a host error (load / save / create).
 */
export function buildSkillHostErrorPresentation(
  err: unknown,
  phase: SkillEditPhase,
  opts?: {
    path?: string | null;
    labels?: SkillEditKindLabels;
    fallbackTitle?: string;
  },
): SkillEditPresentation {
  const kind = classifySkillHostError(err, phase);
  const severity = skillEditSeverity(kind);
  const kindLabel = skillEditKindLabel(kind, opts?.labels);
  const raw = errMessage(err);
  const detail = raw.slice(0, 400);
  return {
    kind,
    severity,
    phase,
    title: opts?.fallbackTitle ?? kindLabel,
    summary: detail || kindLabel,
    detail,
    reason: kind,
    path: opts?.path ?? null,
    name: null,
    description: null,
    sizeBytes: null,
    issues: [{ kind, severity, detail: raw }],
    ok: false,
    blocking: true,
  };
}

/**
 * Build success presentation after a save.
 */
export function buildSkillSaveOkPresentation(opts?: {
  path?: string | null;
  name?: string | null;
  sizeBytes?: number | null;
  labels?: SkillEditKindLabels;
  title?: string;
}): SkillEditPresentation {
  const kind: SkillEditKind = "ok";
  const title = opts?.title ?? skillEditKindLabel(kind, opts?.labels);
  return {
    kind,
    severity: "ok",
    phase: "save",
    title,
    summary: title,
    detail: "",
    reason: null,
    path: opts?.path ?? null,
    name: opts?.name ?? null,
    description: null,
    sizeBytes: opts?.sizeBytes ?? null,
    issues: [],
    ok: true,
    blocking: false,
  };
}

/**
 * Preflight before host save: content validation + desktop host check.
 * Returns a presentation when the client should block the host call.
 */
export function buildSkillSavePreflightError(
  content: string | null | undefined,
  opts?: {
    isTauri?: boolean;
    expectedName?: string | null;
    path?: string | null;
    labels?: SkillEditKindLabels;
    hostOnlyTitle?: string;
  },
): SkillEditPresentation | null {
  if (opts?.isTauri === false) {
    const kind: SkillEditKind = "host_only";
    const title =
      opts.hostOnlyTitle ?? skillEditKindLabel(kind, opts.labels);
    return {
      kind,
      severity: skillEditSeverity(kind),
      phase: "save",
      title,
      summary: title,
      detail: "",
      reason: "host_only",
      path: opts.path ?? null,
      name: null,
      description: null,
      sizeBytes: skillMdByteLength(content),
      issues: [{ kind, severity: skillEditSeverity(kind) }],
      ok: false,
      blocking: true,
    };
  }
  const presentation = buildSkillValidatePresentation(content, {
    expectedName: opts?.expectedName,
    path: opts?.path,
    labels: opts?.labels,
  });
  if (presentation.blocking) {
    return { ...presentation, phase: "save" };
  }
  return null;
}
