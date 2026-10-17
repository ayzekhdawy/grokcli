/**
 * CLI supply-chain trust grades — pure helpers for Setup + Settings Runtime.
 *
 * Honesty (see docs/llm-wiki/setup.md):
 * - Never invent published sidecar presence (`hasSidecar` only when explicit).
 * - Mismatch is always fail-closed (no force-unverified path).
 * - Missing sidecar is allowed by default; strict mode needs allow-unverified.
 * - Grades map to i18n keys + severity chips only — no DOM / Tauri side effects.
 */

/** Explicit trust grade for last install / live install attempt. */
export type ChecksumTrustGrade =
  | "verified"
  | "missing_sidecar"
  | "mismatch"
  | "unverified_allowed"
  | "unknown";

/** Banner / chip severity (maps to ext-badge ok|warn|fail). */
export type CliTrustBannerSeverity = "ok" | "warn" | "error";

/** i18n keys + severity for Setup risk chip / Settings trust chip. */
export type CliTrustBanner = {
  titleKey: string;
  hintKey: string | null;
  severity: CliTrustBannerSeverity;
};

/** Inputs for grade resolution. All optional — never invent sidecar presence. */
export type ResolveChecksumTrustGradeOpts = {
  /**
   * Explicit: published sidecar was found for this artifact.
   * `true` / `false` only when host reported; omit/null = unknown.
   */
  hasSidecar?: boolean | null;
  /**
   * Explicit: stream digest matched published hash.
   * `false` → always `mismatch` (fail-closed).
   */
  match?: boolean | null;
  /** `GROK_CLI_REQUIRE_CHECKSUM=1` (or equivalent strict policy). */
  requireChecksum?: boolean | null;
  /**
   * Settings `allowUnverifiedCliInstall` or install-time escape hatch.
   * Does **not** override mismatch.
   */
  allowUnverified?: boolean | null;
  /**
   * Host settings `lastCliChecksumVerified`:
   * `true` = last App install matched sidecar;
   * `false` = installed without sidecar verify;
   * null/undefined = no App-managed install record.
   */
  verifiedFlag?: boolean | null;
};

/**
 * Resolve an honest checksum trust grade.
 * Never invents sidecar presence; mismatch always wins over allow-unverified.
 */
export function resolveChecksumTrustGrade(
  opts: ResolveChecksumTrustGradeOpts,
): ChecksumTrustGrade {
  // Explicit mismatch — fail-closed, never soft-graded.
  if (opts.match === false) return "mismatch";

  // Explicit match or last install recorded as verified.
  if (opts.match === true || opts.verifiedFlag === true) return "verified";

  // Known missing sidecar (explicit false) or last install unverified.
  const missingSidecar =
    opts.hasSidecar === false || opts.verifiedFlag === false;

  if (missingSidecar) {
    // Escape hatch engaged (or would allow under strict require).
    if (opts.allowUnverified === true) return "unverified_allowed";
    return "missing_sidecar";
  }

  // Sidecar known present but match not yet reported — do not invent verified.
  if (opts.hasSidecar === true) return "unknown";

  return "unknown";
}

/**
 * Map grade → title/hint i18n keys + severity for chips and banners.
 */
export function resolveCliTrustBanner(grade: ChecksumTrustGrade): CliTrustBanner {
  switch (grade) {
    case "verified":
      return {
        titleKey: "cliTrust.grade.verified",
        hintKey: null,
        severity: "ok",
      };
    case "missing_sidecar":
      return {
        titleKey: "cliTrust.grade.missingSidecar",
        hintKey: "cliTrust.hint.missingSidecar",
        severity: "warn",
      };
    case "mismatch":
      return {
        titleKey: "cliTrust.grade.mismatch",
        hintKey: "cliTrust.hint.mismatch",
        severity: "error",
      };
    case "unverified_allowed":
      return {
        titleKey: "cliTrust.grade.unverifiedAllowed",
        hintKey: "cliTrust.hint.unverifiedAllowed",
        severity: "warn",
      };
    case "unknown":
    default:
      return {
        titleKey: "cliTrust.grade.unknown",
        hintKey: "cliTrust.hint.unknown",
        severity: "warn",
      };
  }
}

/**
 * Plan whether install may proceed when **no published checksum** is available.
 *
 * - `allow` — missing sidecar is OK (default) or escape hatch is set.
 * - `refuse_need_flag` — strict require-checksum without allow-unverified.
 * - `refuse_mismatch` — digest mismatch (fail-closed; never forceable).
 *
 * Callers pass `match: false` when the host already reported mismatch.
 * This helper never invents a sidecar.
 */
export function planInstallWithoutChecksum(opts: {
  requireChecksum: boolean;
  allowUnverified: boolean;
  /** Explicit mismatch → always refuse (fail-closed). */
  match?: boolean | null;
}): "allow" | "refuse_need_flag" | "refuse_mismatch" {
  if (opts.match === false) return "refuse_mismatch";
  if (opts.requireChecksum && !opts.allowUnverified) {
    return "refuse_need_flag";
  }
  return "allow";
}

/**
 * Redacted plain-text summary for logs / Doctor / support (no secrets).
 * Mirror is reduced to host only; version is trimmed as-is.
 */
export function formatCliTrustSummary(opts: {
  grade: ChecksumTrustGrade;
  mirror?: string | null;
  version?: string | null;
}): string {
  const parts: string[] = [`CLI trust: ${opts.grade}`];
  const ver = typeof opts.version === "string" ? opts.version.trim() : "";
  if (ver) parts.push(`version ${ver}`);
  const host = safeMirrorHost(opts.mirror);
  if (host) parts.push(`mirror ${host}`);
  return parts.join(" · ");
}

/**
 * CSS class for trust chips (reuses Extensions badge tokens).
 */
export function cliTrustChipClass(severity: CliTrustBannerSeverity): string {
  switch (severity) {
    case "ok":
      return "ext-badge ext-badge--ok";
    case "error":
      return "ext-badge ext-badge--fail";
    case "warn":
    default:
      return "ext-badge ext-badge--warn";
  }
}

/**
 * Map Setup gate error kind → trust grade when relevant.
 * Returns null for unrelated errors (no invented grade).
 */
export function gradeFromSetupErrorKind(
  kind: string | null | undefined,
): ChecksumTrustGrade | null {
  if (kind === "checksum_missing") return "missing_sidecar";
  if (kind === "checksum_mismatch") return "mismatch";
  return null;
}

/**
 * Optional Doctor finding line from a known grade.
 * Returns null for `unknown` (no invented finding).
 */
export function buildCliTrustDoctorFinding(grade: ChecksumTrustGrade): {
  id: string;
  level: "ok" | "warn" | "fail";
  titleKey: string;
  detailKey: string;
  summary: string;
} | null {
  if (grade === "unknown") return null;
  const banner = resolveCliTrustBanner(grade);
  const level: "ok" | "warn" | "fail" =
    banner.severity === "ok"
      ? "ok"
      : banner.severity === "error"
        ? "fail"
        : "warn";
  return {
    id: "cli_checksum_trust",
    level,
    titleKey: banner.titleKey,
    detailKey: banner.hintKey ?? banner.titleKey,
    summary: formatCliTrustSummary({ grade }),
  };
}

/**
 * Grade from host last-install flag (+ allow-unverified for escape hatch honesty).
 * Convenience for Settings Runtime CLI chip.
 */
export function gradeFromLastInstall(opts: {
  lastCliChecksumVerified?: boolean | null;
  allowUnverified?: boolean | null;
}): ChecksumTrustGrade {
  return resolveChecksumTrustGrade({
    verifiedFlag: opts.lastCliChecksumVerified,
    allowUnverified: opts.allowUnverified,
  });
}

/** Host-only mirror host for summary (strip path / credentials). */
function safeMirrorHost(mirror: string | null | undefined): string {
  if (mirror == null) return "";
  const raw = String(mirror).trim();
  if (!raw) return "";
  try {
    const withScheme = /:\/\//.test(raw) ? raw : `https://${raw}`;
    const u = new URL(withScheme);
    // Drop userinfo if somehow present.
    return u.host || "";
  } catch {
    // Best-effort: strip scheme, path, and userinfo.
    const noScheme = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
    const noUser = noScheme.includes("@")
      ? noScheme.slice(noScheme.lastIndexOf("@") + 1)
      : noScheme;
    return noUser.split("/")[0]?.split("?")[0]?.trim() || "";
  }
}
