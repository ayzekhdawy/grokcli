/**
 * Grok Build CLI compaction mode / detail (0.2.117+).
 *
 * Flags (top-level, before `agent`):
 *   --compaction-mode summary|transcript|segments  → GROK_COMPACTION_MODE
 *   --compaction-detail none|minimal|balanced|verbose → GROK_COMPACTION_DETAIL
 *     (detail only affects `--compaction-mode segments`; default verbose)
 *
 * App stores both in AppSettings; Host always sets env (ignored by older CLIs)
 * and passes CLI flags when the probe reports ≥ 0.2.117.
 */

export const COMPACTION_MODES = [
  "summary",
  "transcript",
  "segments",
] as const;

export type CompactionModeId = (typeof COMPACTION_MODES)[number];

export const DEFAULT_COMPACTION_MODE: CompactionModeId = "summary";

export const COMPACTION_DETAILS = [
  "none",
  "minimal",
  "balanced",
  "verbose",
] as const;

export type CompactionDetailId = (typeof COMPACTION_DETAILS)[number];

export const DEFAULT_COMPACTION_DETAIL: CompactionDetailId = "verbose";

/** First CLI version that documents/accepts the compaction flags. */
export const COMPACTION_CLI_FLAGS_MIN = "0.2.117" as const;

const MODE_SET = new Set<string>(COMPACTION_MODES);
const DETAIL_SET = new Set<string>(COMPACTION_DETAILS);

/**
 * Normalize a raw settings / UI value to a known mode id.
 * Empty / unknown → {@link DEFAULT_COMPACTION_MODE}.
 */
export function normalizeCompactionMode(raw: unknown): CompactionModeId {
  if (raw == null) return DEFAULT_COMPACTION_MODE;
  if (typeof raw !== "string") return DEFAULT_COMPACTION_MODE;
  const t = raw.trim().toLowerCase();
  if (!t) return DEFAULT_COMPACTION_MODE;
  if (MODE_SET.has(t)) return t as CompactionModeId;
  return DEFAULT_COMPACTION_MODE;
}

/**
 * Normalize a raw settings / UI value to a known detail id.
 * Empty / unknown → {@link DEFAULT_COMPACTION_DETAIL}.
 */
export function normalizeCompactionDetail(raw: unknown): CompactionDetailId {
  if (raw == null) return DEFAULT_COMPACTION_DETAIL;
  if (typeof raw !== "string") return DEFAULT_COMPACTION_DETAIL;
  const t = raw.trim().toLowerCase();
  if (!t) return DEFAULT_COMPACTION_DETAIL;
  if (DETAIL_SET.has(t)) return t as CompactionDetailId;
  return DEFAULT_COMPACTION_DETAIL;
}

export function isCompactionModeId(value: unknown): value is CompactionModeId {
  return typeof value === "string" && MODE_SET.has(value.trim().toLowerCase());
}

export function isCompactionDetailId(
  value: unknown,
): value is CompactionDetailId {
  return (
    typeof value === "string" && DETAIL_SET.has(value.trim().toLowerCase())
  );
}

/** Detail only affects segments mode (CLI docs). */
export function compactionDetailApplies(
  mode: unknown,
): boolean {
  return normalizeCompactionMode(mode) === "segments";
}

/**
 * Top-level CLI args for compaction mode (before `agent`):
 * `["--compaction-mode", "<mode>"]`.
 */
export function compactionModeSpawnArgs(raw: unknown): string[] {
  const mode = normalizeCompactionMode(raw);
  return ["--compaction-mode", mode];
}

/**
 * Top-level CLI args for compaction detail — only when mode is `segments`.
 * Empty when detail does not apply.
 */
export function compactionDetailSpawnArgs(
  modeRaw: unknown,
  detailRaw: unknown,
): string[] {
  if (!compactionDetailApplies(modeRaw)) return [];
  const detail = normalizeCompactionDetail(detailRaw);
  return ["--compaction-detail", detail];
}

/** Combined CLI argv for mode + (optional) detail. */
export function compactionSpawnArgs(
  modeRaw: unknown,
  detailRaw: unknown,
): string[] {
  return [
    ...compactionModeSpawnArgs(modeRaw),
    ...compactionDetailSpawnArgs(modeRaw, detailRaw),
  ];
}

/** Env pairs always set for the agent process (safe soft-fail on older CLIs). */
export function compactionSpawnEnv(
  modeRaw: unknown,
  detailRaw: unknown,
): Array<[string, string]> {
  const mode = normalizeCompactionMode(modeRaw);
  const out: Array<[string, string]> = [["GROK_COMPACTION_MODE", mode]];
  if (mode === "segments") {
    out.push([
      "GROK_COMPACTION_DETAIL",
      normalizeCompactionDetail(detailRaw),
    ]);
  }
  return out;
}

/**
 * Parse a semver-ish token from a CLI version banner (`grok 0.2.117 (…)`).
 * Returns `[major, minor, patch]` or null.
 */
export function parseCliSemver(
  raw: string | null | undefined,
): [number, number, number] | null {
  if (raw == null) return null;
  const token = String(raw)
    .split(/[\s(,)]+/)
    .map((t) => t.trim().replace(/^[vV]/, ""))
    .find((t) => {
      const parts = t.split(".");
      if (parts.length < 2) return false;
      const major = parts[0] ?? "";
      const minor = parts[1] ?? "";
      return (
        major.length > 0 &&
        [...major].every((c) => c >= "0" && c <= "9") &&
        minor.length > 0 &&
        minor[0]! >= "0" &&
        minor[0]! <= "9"
      );
    });
  if (!token) return null;
  const bits = token.split(".").map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  return [bits[0] ?? 0, bits[1] ?? 0, bits[2] ?? 0];
}

/**
 * Whether CLI flags should be passed (not only env).
 * Unknown / unparseable version → false (env-only soft-fail).
 */
export function cliSupportsCompactionFlags(
  rawVersion: string | null | undefined,
): boolean {
  const v = parseCliSemver(rawVersion);
  if (!v) return false;
  const [a, b, c] = v;
  const [ma, mb, mc] = parseCliSemver(COMPACTION_CLI_FLAGS_MIN)!;
  if (a !== ma) return a > ma;
  if (b !== mb) return b > mb;
  return c >= mc;
}
